import { CSSProperties, Fragment, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCorners,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Ellipsis,
  GripVertical,
  ListChecks,
  Plus,
  Rows3,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import type { KanbanColumn, Project, ProjectScope, TaskDraft, TimelineLayout, TimelineZoom, WorkItem, WorkspaceAction, WorkspaceDocument } from '../domain/types';
import { columnForRule, itemsForColumn } from '../domain/workspace';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';
import { ProjectScopeSelect } from './ProjectScopeSelect';
import { TaskCard } from './TaskCard';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask: (preset?: Partial<TaskDraft>) => void;
  onAction: (action: WorkspaceAction) => void;
  onSave: () => void;
  onEditProject: () => void;
  mobile?: boolean;
};

type ScheduledTask = { item: WorkItem; start: Date; due: Date; startIndex: number; endIndex: number; endClipped: boolean };
type TimelineDisplayRow = { id: string; entries: ScheduledTask[]; compact?: boolean };
type TimelineRowLayout = ScheduledTask & { rowId: string; top: number; height: number; center: number; left: number; right: number };
type DependencyRope = { startX: number; startY: number; endX: number; endY: number; attached: boolean };
type ResizePreview = { taskId: string; dueDate: string; deltaPx: number };
type TimelineMonthSegment = { id: string; date: Date; startIndex: number; dayCount: number };
type TimelineYearMonthLayout = { segment: TimelineMonthSegment; days: Date[]; rows: TimelineDisplayRow[] };
type TimelineFourWeekBandLayout = { id: string; days: Date[]; scheduled: ScheduledTask[]; rows: TimelineDisplayRow[] };
type TimelineFourWeekDependencyConnector = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceTitle: string;
  targetTitle: string;
  path: string;
  x1: number;
  y1: number;
  controlX: number;
  controlY: number;
  tone: number;
  routeLane?: number;
};
type TimelineFourWeekDependencyLayout = { width: number; height: number; signature: string; connectors: TimelineFourWeekDependencyConnector[] };
type Point = { x: number; y: number };
type UnscheduledDropPreviewState = { itemId: string; columnId: string; index: number; beforeItemId?: string };
type UnscheduledDragEvent = DragMoveEvent | DragOverEvent | DragEndEvent;

const DAY = 86_400_000;
const MIN_ROW_HEIGHT = 90;
const YEAR_ROW_HEIGHT = 72;
const UNSCHEDULED_DROP_ID = 'timeline-unscheduled-area';
const DEFAULT_UNSCHEDULED_PANE_HEIGHT = 300;
const MOBILE_UNSCHEDULED_PANE_HEIGHT = 220;
const MIN_UNSCHEDULED_PANE_HEIGHT = 120;
const MAX_UNSCHEDULED_PANE_HEIGHT = 720;
const MIN_TIMELINE_PANE_HEIGHT = 180;
const PANE_DIVIDER_SIZE = 30;
const PANE_RESIZE_STEP = 24;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parseLocalDate = (value: string) => new Date(`${value}T12:00:00`);

function compareTimelineItems(left: WorkItem, right: WorkItem, kanbanOrder: ReadonlyMap<string, number>): number {
  const dayDifference = (left.startDate ?? left.dueDate ?? '').localeCompare(right.startDate ?? right.dueDate ?? '');
  if (dayDifference) return dayDifference;
  const orderDifference = (kanbanOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (kanbanOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  return orderDifference || (left.dueDate ?? '').localeCompare(right.dueDate ?? '') || left.createdAt.localeCompare(right.createdAt);
}

function tasksStartSameDay(left: WorkItem, right: WorkItem): boolean {
  const leftDay = left.startDate ?? left.dueDate;
  const rightDay = right.startDate ?? right.dueDate;
  return Boolean(leftDay && leftDay === rightDay);
}

function buildCompactRows(tasks: ScheduledTask[], kanbanOrder: ReadonlyMap<string, number>): TimelineDisplayRow[] {
  const tracks: ScheduledTask[][] = [];
  [...tasks]
    .sort((left, right) => (kanbanOrder.get(left.item.id) ?? Number.MAX_SAFE_INTEGER) - (kanbanOrder.get(right.item.id) ?? Number.MAX_SAFE_INTEGER)
      || left.startIndex - right.startIndex
      || left.item.createdAt.localeCompare(right.item.createdAt))
    .forEach((task) => {
      const track = tracks.find((candidate) => candidate.every((placed) => placed.endIndex < task.startIndex || task.endIndex < placed.startIndex));
      if (track) track.push(task);
      else tracks.push([task]);
    });
  return tracks.map((entries, index) => ({ id: `compact:${index}`, entries, compact: true }));
}

function buildFourWeekBandDependencies(
  bandId: string,
  rows: TimelineDisplayRow[],
  rowHeights: Readonly<Record<string, number>>,
  span: number,
): { height: number; connectors: TimelineFourWeekDependencyConnector[] } {
  let top = 0;
  const layouts = rows.flatMap((row) => {
    const height = rowHeights[`${bandId}:${row.id}`] ?? MIN_ROW_HEIGHT;
    const entries = row.entries.map((entry) => ({
      ...entry,
      rowId: row.id,
      top,
      height,
      center: top + height / 2,
      left: entry.startIndex * 100 + 5,
      right: (entry.endIndex + 1) * 100 - 5,
    }));
    top += height;
    return entries;
  });
  const layoutByTaskId = new Map(layouts.map((layout) => [layout.item.id, layout]));
  const routeCounts = new Map<string, number>();
  let visibleConnectorIndex = 0;
  const chartRight = span * 100;
  const connectors = layouts.flatMap((target) => (target.item.dependencyIds ?? []).flatMap((sourceId, dependencyIndex) => {
    const source = layoutByTaskId.get(sourceId);
    if (!source) return [];
    const x1 = source.right;
    const x2 = target.left;
    const y1 = source.center;
    const y2 = target.center;
    const sameRow = source.rowId === target.rowId;
    let routeLane: number;
    let controlX: number;
    let controlY: number;
    let path: string;
    if (sameRow) {
      const forward = x2 > x1;
      const interveningTasks = forward ? layouts.filter((layout) => layout.rowId === source.rowId
        && layout.item.id !== source.item.id
        && layout.item.id !== target.item.id
        && layout.left < x2
        && layout.right > x1) : [];
      if (forward && interveningTasks.length === 0) {
        routeLane = y1;
        controlX = (x1 + x2) / 2;
        controlY = y1;
        path = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const routeIndex = routeCounts.get(source.rowId) ?? 0;
        const outerLanes = [source.top + 2, source.top + source.height - 2];
        routeLane = outerLanes[routeIndex % outerLanes.length];
        routeCounts.set(source.rowId, routeIndex + 1);
        const sourceTurnX = forward ? Math.min(x2 - 8, x1 + 12) : Math.min(chartRight - 8, Math.max(x1, x2) + 26 + dependencyIndex * 10);
        const targetTurnX = forward ? Math.max(sourceTurnX, x2 - 12) : sourceTurnX;
        controlX = (sourceTurnX + targetTurnX) / 2;
        controlY = routeLane;
        path = roundedOrthogonalPath([
          { x: x1, y: y1 },
          { x: sourceTurnX, y: y1 },
          { x: sourceTurnX, y: routeLane },
          { x: targetTurnX, y: routeLane },
          { x: targetTurnX, y: y2 },
          { x: x2, y: y2 },
        ], 8);
      }
    } else {
      const routeX = x2 > x1
        ? (x1 + x2) / 2
        : Math.min(chartRight - 8, Math.max(source.right, target.right) + 28 + dependencyIndex * 10);
      const targetLaneY = y2 >= y1 ? target.top + 4 : target.top + target.height - 4;
      const targetApproachX = Math.max(0, x2 - 18);
      routeLane = (y1 + targetLaneY) / 2;
      controlX = routeX;
      controlY = routeLane;
      path = roundedOrthogonalPath([
        { x: x1, y: y1 },
        { x: routeX, y: y1 },
        { x: routeX, y: targetLaneY },
        { x: targetApproachX, y: targetLaneY },
        { x: targetApproachX, y: y2 },
        { x: x2, y: y2 },
      ], 10);
    }
    const tone = visibleConnectorIndex % 5;
    visibleConnectorIndex += 1;
    return [{
      id: `${sourceId}-${target.item.id}`,
      sourceId,
      targetId: target.item.id,
      sourceTitle: source.item.title,
      targetTitle: target.item.title,
      path,
      x1,
      y1,
      controlX,
      controlY,
      tone,
      routeLane,
    }];
  }));
  return { height: top, connectors };
}

function roundedOrthogonalPath(points: Point[], radius = 12): string {
  const clean = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (clean.length < 2) return '';
  let path = `M ${clean[0].x} ${clean[0].y}`;
  for (let index = 1; index < clean.length; index += 1) {
    const point = clean[index];
    const next = clean[index + 1];
    if (!next) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }
    const previous = clean[index - 1];
    const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    const corner = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: point.x - Math.sign(point.x - previous.x) * corner,
      y: point.y - Math.sign(point.y - previous.y) * corner,
    };
    const after = {
      x: point.x + Math.sign(next.x - point.x) * corner,
      y: point.y + Math.sign(next.y - point.y) * corner,
    };
    path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  return path;
}

function startOfWindow(offset: number, zoom: TimelineZoom): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  if (zoom === 'year') return new Date(date.getFullYear() + offset, 0, 1, 12);
  if (zoom === 'month') return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  const span = zoom === 'week' ? 7 : zoom === 'two-weeks' ? 14 : 28;
  const sundayOffset = date.getDay();
  const navigationStep = zoom === 'two-weeks' ? 7 : span;
  date.setDate(date.getDate() - sundayOffset + offset * navigationStep);
  return date;
}

function initialTimelineZoom(stored: TimelineZoom | undefined, mobile: boolean): TimelineZoom {
  const supported: TimelineZoom[] = mobile ? ['week', 'month', 'year'] : ['two-weeks', 'four-weeks', 'year'];
  return stored && supported.includes(stored) ? stored : mobile ? 'week' : 'two-weeks';
}

function initialTimelineWindowStarts(stored: WorkspaceDocument['preferences']['timelineWindowStarts']): Record<TimelineZoom, string> {
  return {
    week: stored?.week ?? iso(startOfWindow(0, 'week')),
    month: stored?.month ?? iso(startOfWindow(0, 'month')),
    'two-weeks': stored?.['two-weeks'] ?? iso(startOfWindow(0, 'two-weeks')),
    'four-weeks': stored?.['four-weeks'] ?? iso(startOfWindow(0, 'four-weeks')),
    year: stored?.year ?? iso(startOfWindow(0, 'year')),
  };
}

function dateAt(rangeStart: Date, index: number): Date {
  const date = new Date(rangeStart);
  date.setDate(date.getDate() + index);
  return date;
}

function calendarDayDistance(later: Date, earlier: Date): number {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / DAY);
}

function spanForWindow(rangeStart: Date, zoom: TimelineZoom): number {
  if (zoom === 'year') return calendarDayDistance(new Date(rangeStart.getFullYear() + 1, 0, 1, 12), rangeStart);
  if (zoom === 'month') return calendarDayDistance(new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 1, 12), rangeStart);
  if (zoom === 'week') return 7;
  return zoom === 'two-weeks' ? 14 : 28;
}

function monthSegmentsForDays(days: Date[]): TimelineMonthSegment[] {
  return days.reduce<TimelineMonthSegment[]>((segments, day, index) => {
    const id = `${day.getFullYear()}-${day.getMonth()}`;
    const current = segments[segments.length - 1];
    if (current?.id === id) current.dayCount += 1;
    else segments.push({ id, date: day, startIndex: index, dayCount: 1 });
    return segments;
  }, []);
}

function weekBandClass(day: Date): string {
  const sunday = new Date(day);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekIndex = Math.floor(Date.UTC(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()) / (DAY * 7));
  const shade = ((weekIndex % 2) + 2) % 2 === 0 ? 'week-shade-a' : 'week-shade-b';
  return `${shade}${day.getDay() === 0 ? ' week-start' : ''}`;
}

function activatorClientY(event: Event): number | undefined {
  if ('clientY' in event && typeof event.clientY === 'number') return event.clientY;
  if ('touches' in event) {
    const touchEvent = event as TouchEvent;
    return (touchEvent.touches[0] ?? touchEvent.changedTouches[0])?.clientY;
  }
  return undefined;
}

function isBelowUnscheduledItem(event: UnscheduledDragEvent): boolean {
  if (!event.over) return false;
  const midpoint = event.over.rect.top + event.over.rect.height / 2;
  const clientY = activatorClientY(event.activatorEvent);
  const initial = event.active.rect.current.initial;
  const translated = event.active.rect.current.translated;
  if (clientY !== undefined && initial && translated) {
    return translated.top + (clientY - initial.top) > midpoint;
  }
  return translated ? translated.top + translated.height / 2 > midpoint : false;
}

function unscheduledTaskDropIndex(event: UnscheduledDragEvent, itemId: string, targetItems: WorkItem[]): number {
  const destinationItems = targetItems.filter((item) => item.id !== itemId);
  const overData = event.over?.data.current as { type?: string; index?: number } | undefined;
  if (overData?.type === 'timeline-unscheduled-preview') {
    return Math.max(0, Math.min(overData.index ?? destinationItems.length, destinationItems.length));
  }
  if (overData?.type !== 'timeline-unscheduled-item') return destinationItems.length;
  const overId = String(event.over?.id);
  if (overId === itemId) {
    const originalIndex = targetItems.findIndex((item) => item.id === itemId);
    return Math.max(0, Math.min(originalIndex, destinationItems.length));
  }
  const overIndex = destinationItems.findIndex((item) => item.id === overId);
  if (overIndex < 0) return destinationItems.length;
  return overIndex + (isBelowUnscheduledItem(event) ? 1 : 0);
}

const timelineCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const collisions = pointerCollisions.length > 0
    ? pointerCollisions
    : args.pointerCoordinates ? [] : closestCorners(args);
  if (args.active.data.current?.dependencySourceId) {
    return collisions.filter((collision) => collision.id.toString().startsWith('timeline-dependency-target:'));
  }
  if (args.active.data.current?.taskId) {
    const reorderTargets = collisions.filter((collision) => collision.id.toString().startsWith('timeline-reorder-target:'));
    if (reorderTargets.length > 0) return reorderTargets;
    const dayTargets = collisions.filter((collision) => collision.id.toString().startsWith('timeline-day:'));
    if (dayTargets.length > 0) return dayTargets;
    const canMoveInUnscheduledBoard = args.active.data.current.allowUnscheduledMove !== false;
    if (canMoveInUnscheduledBoard) {
      const previews = collisions.filter((collision) => collision.data?.droppableContainer?.data.current?.type === 'timeline-unscheduled-preview');
      if (previews.length > 0) return previews;
      const items = collisions.filter((collision) => collision.id !== args.active.id && collision.data?.droppableContainer?.data.current?.type === 'timeline-unscheduled-item');
      if (items.length > 0) return items;
      const columns = collisions.filter((collision) => collision.data?.droppableContainer?.data.current?.type === 'timeline-unscheduled-column');
      if (columns.length > 0) return columns;
    }
    return collisions.filter((collision) => collision.id === UNSCHEDULED_DROP_ID);
  }
  return collisions.filter((collision) => {
    const id = collision.id.toString();
    return id.startsWith('timeline-day:') || id === UNSCHEDULED_DROP_ID;
  });
};

function TimelineDayDropZone({ day, active, today, weekend }: { day: Date; active: boolean; today: boolean; weekend: boolean }) {
  const date = iso(day);
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-day:${date}` });
  return <div ref={setNodeRef} data-date={date} className={`timeline-day-drop-zone ${weekBandClass(day)} ${today ? 'today' : ''} ${weekend ? 'weekend' : ''} ${active || isOver ? 'active' : ''}`} />;
}

function TimelineDisplayRowView({ row, targeted, children }: { row: TimelineDisplayRow; targeted: boolean; children: ReactNode }) {
  return (
    <div
      className={`timeline-row ${row.compact ? 'compact-row' : ''} ${targeted ? 'reorder-over' : ''}`}
      data-row-id={row.id}
    >
      {children}
    </div>
  );
}

function DependencyHandles({ item, connecting, targetOver }: { item: WorkItem; connecting: boolean; targetOver: boolean }) {
  const { t } = useI18n();
  const source = useDraggable({
    id: `timeline-dependency-source:${item.id}`,
    data: { dependencySourceId: item.id },
  });
  return (
    <>
      <span
        className={`timeline-dependency-handle incoming ${connecting ? 'connection-ready' : ''} ${targetOver ? 'over' : ''}`}
        title={t('Drop another task here to create a dependency')}
        aria-label={t('Incoming dependency point for {{name}}', { name: item.title })}
      />
      <span
        ref={source.setNodeRef}
        {...source.listeners}
        {...source.attributes}
        className={`timeline-dependency-handle outgoing ${source.isDragging ? 'dragging' : ''}`}
        title={t('Drag onto another task to create a dependency')}
        aria-label={t('Start a dependency from {{name}}', { name: item.title })}
        onClick={(event) => event.stopPropagation()}
      />
    </>
  );
}

function TimelineEndResizeHandle({ item }: { item: WorkItem }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `timeline-resize-end:${item.id}`,
    data: { resizeTaskId: item.id },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`timeline-resize-handle ${isDragging ? 'dragging' : ''}`}
      title={t('Drag to change the due date')}
      aria-label={t('Extend or shorten {{name}}', { name: item.title })}
      onClick={(event) => event.stopPropagation()}
      {...attributes}
      {...listeners}
    ><span /></button>
  );
}

function TimelineTaskBar({
  scheduled,
  projectColor,
  projectName,
  columnColor,
  recentlyMoved,
  resizeFromScale,
  resizePreview,
  dependencyHighlight,
  connecting,
  canAcceptDependency,
  canReorderTarget,
  reorderDropEnabled,
  onOpen,
  onUpdateSubtasks,
}: {
  scheduled: ScheduledTask;
  projectColor: string;
  projectName?: string;
  columnColor?: string;
  recentlyMoved: boolean;
  resizeFromScale?: number;
  resizePreview?: ResizePreview;
  dependencyHighlight?: 'source' | 'target';
  connecting: boolean;
  canAcceptDependency: boolean;
  canReorderTarget: boolean;
  reorderDropEnabled: boolean;
  onOpen: () => void;
  onUpdateSubtasks: (subtasks: WorkItem['subtasks']) => void;
}) {
  const { direction, locale, t } = useI18n();
  const { item, startIndex, endIndex, endClipped } = scheduled;
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [subtaskPopoverPosition, setSubtaskPopoverPosition] = useState<{ top: number; left: number; width: number; opensAbove: boolean } | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const subtaskPanelRef = useRef<HTMLElement>(null);
  const subtaskTriggerRef = useRef<HTMLButtonElement>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-task:${item.id}`,
    data: { taskId: item.id },
  });
  const dependencyTarget = useDroppable({
    id: `timeline-dependency-target:${item.id}`,
    data: { dependencyTargetId: item.id },
    disabled: !canAcceptDependency,
  });
  const reorderTarget = useDroppable({
    id: `timeline-reorder-target:${item.id}`,
    data: { reorderTargetId: item.id },
    disabled: !reorderDropEnabled || !canReorderTarget,
  });
  const setSlotRef = (node: HTMLDivElement | null) => {
    slotRef.current = node;
    setNodeRef(node);
    dependencyTarget.setNodeRef(node);
    reorderTarget.setNodeRef(node);
  };
  const duration = Math.max(1, endIndex - startIndex + 1);
  const visibleDueDate = resizePreview?.dueDate ?? item.dueDate!;
  const dateLabel = item.startDate && item.startDate !== visibleDueDate
    ? `${new Date(`${item.startDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${new Date(`${visibleDueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`
    : new Date(`${visibleDueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const style = {
    '--timeline-start': startIndex + 1,
    '--timeline-span': duration,
    '--project-color': projectColor,
    '--status-color': columnColor ?? projectColor,
    '--timeline-resize-from-scale': resizeFromScale ?? 1,
    '--timeline-resize-delta': `${resizePreview?.deltaPx ?? 0}px`,
    transform: CSS.Translate.toString(transform),
  } as CSSProperties;
  const completedSubtasks = item.subtasks.filter((subtask) => subtask.completed).length;
  const subtaskPanelOpen = subtasksExpanded || addingSubtask;

  useLayoutEffect(() => {
    if (!subtaskPanelOpen) {
      setSubtaskPopoverPosition(null);
      return;
    }
    const updatePosition = () => {
      const slot = slotRef.current;
      const panel = subtaskPanelRef.current;
      if (!slot || !panel) return;
      const slotRect = slot.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
      const availableWidth = Math.max(200, viewportWidth - 24);
      const width = Math.min(320, Math.max(240, slotRect.width), availableWidth);
      const panelHeight = Math.min(210, Math.max(48, panelRect.height || panel.scrollHeight || 160));
      const desiredLeft = direction === 'rtl' ? slotRect.right - width : slotRect.left;
      const left = Math.max(12, Math.min(desiredLeft, viewportWidth - width - 12));
      const belowTop = slotRect.bottom + 5;
      const roomBelow = viewportHeight - belowTop - 12;
      const roomAbove = slotRect.top - 17;
      const opensAbove = roomBelow < panelHeight && roomAbove > roomBelow;
      const top = opensAbove
        ? Math.max(12, slotRect.top - panelHeight - 5)
        : Math.max(12, Math.min(belowTop, viewportHeight - panelHeight - 12));
      setSubtaskPopoverPosition((current) => current
        && current.top === top
        && current.left === left
        && current.width === width
        && current.opensAbove === opensAbove
        ? current
        : { top, left, width, opensAbove });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [addingSubtask, direction, item.subtasks.length, subtaskPanelOpen, subtasksExpanded]);

  useEffect(() => {
    if (!subtaskPanelOpen) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node;
      if (!slotRef.current?.contains(target) && !subtaskPanelRef.current?.contains(target)) {
        setAddingSubtask(false);
        setSubtasksExpanded(false);
        setSubtaskDraft('');
      }
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAddingSubtask(false);
      setSubtasksExpanded(false);
      setSubtaskDraft('');
      subtaskTriggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('focusin', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('focusin', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [subtaskPanelOpen]);

  const addSubtask = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const title = subtaskDraft.trim();
    if (!title) return;
    onUpdateSubtasks([...item.subtasks, { id: crypto.randomUUID(), title, completed: false }]);
    setSubtaskDraft('');
    setAddingSubtask(false);
    setSubtasksExpanded(true);
  };

  return (
    <div
      ref={setSlotRef}
      data-timeline-task-id={item.id}
      className={`timeline-bar-slot ${duration === 1 ? 'single-day' : ''} ${addingSubtask ? 'adding-subtask' : ''} ${subtasksExpanded ? 'subtasks-expanded' : ''} ${isDragging ? 'dragging' : ''} ${recentlyMoved ? 'just-moved' : ''} ${resizeFromScale ? 'just-resized' : ''} ${resizePreview ? 'live-resizing' : ''} ${dependencyHighlight ? `dependency-highlight-${dependencyHighlight}` : ''} ${canAcceptDependency ? 'dependency-target-ready' : ''} ${dependencyTarget.isOver ? 'dependency-target-over' : ''} ${reorderTarget.isOver ? 'reorder-target-over' : ''}`}
      style={style}
    >
      <DependencyHandles item={item} connecting={connecting && canAcceptDependency} targetOver={dependencyTarget.isOver} />
      {!endClipped && !addingSubtask && <TimelineEndResizeHandle item={item} />}
      <button
        className="timeline-bar"
        {...listeners}
        {...attributes}
        onClick={() => !isDragging && onOpen()}
        title={`${item.title} · ${projectName ? `${projectName} · ` : ''}${dateLabel} · ${t('Drag to reschedule or reorder')}`}
      >
        <span className="timeline-bar-copy"><strong dir="auto">{item.title}</strong><small dir={projectName ? 'auto' : undefined}><i />{projectName ? `${projectName} · ${dateLabel}` : dateLabel}</small></span>
        {(item.dependencyIds?.length ?? 0) > 0 && <span className="timeline-dependency-count" title={t('{{count}} dependencies', { count: item.dependencyIds?.length ?? 0 })}><Workflow size={10} />{item.dependencyIds?.length}</span>}
      </button>
      {canAcceptDependency && <span className="timeline-dependency-card-prompt"><Workflow size={16} />{t(dependencyTarget.isOver ? 'Release to create dependency' : 'Drop here to create dependency')}</span>}
      {!addingSubtask && (
        <button
          ref={subtaskTriggerRef}
          type="button"
          className={`timeline-subtask-trigger ${item.subtasks.length ? 'has-subtasks' : ''} ${subtasksExpanded ? 'expanded' : ''} ${item.subtasks.length > 0 && completedSubtasks === item.subtasks.length ? 'complete' : ''}`}
          title={t(item.subtasks.length ? subtasksExpanded ? 'Collapse subtasks' : 'Expand subtasks' : 'Add a subtask')}
          aria-label={`${t('Subtasks')}: ${item.title}`}
          aria-expanded={item.subtasks.length ? subtasksExpanded : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (item.subtasks.length) {
              setSubtasksExpanded((current) => !current);
            } else {
              setAddingSubtask(true);
              window.setTimeout(() => subtaskInputRef.current?.focus(), 0);
            }
          }}
        >
          <span className="timeline-subtask-trigger-icon">
            {item.subtasks.length ? <ChevronDown size={14} /> : <ListChecks size={14} />}
            {item.subtasks.length === 0 && <i><Plus size={9} /></i>}
          </span>
          <span className="timeline-subtask-trigger-label">{t('Subtasks')}</span>
          <span className="timeline-subtask-trigger-count">{completedSubtasks}/{item.subtasks.length}</span>
        </button>
      )}
      {subtaskPanelOpen && createPortal(
        <section
          ref={subtaskPanelRef}
          className={`timeline-subtask-panel ${subtaskPopoverPosition?.opensAbove ? 'opens-above' : ''}`}
          aria-label={t('Subtasks')}
          style={{
            top: subtaskPopoverPosition?.top ?? 0,
            left: subtaskPopoverPosition?.left ?? 0,
            width: subtaskPopoverPosition?.width ?? 240,
            visibility: subtaskPopoverPosition ? 'visible' : 'hidden',
            '--project-color': projectColor,
            '--status-color': columnColor ?? projectColor,
          } as CSSProperties}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {subtasksExpanded && item.subtasks.length > 0 && (
            <div className="timeline-subtask-list">
              {item.subtasks.map((subtask) => (
                <button
                  type="button"
                  key={subtask.id}
                  className={`timeline-subtask-item ${subtask.completed ? 'completed' : ''}`}
                  title={subtask.title}
                  onClick={() => onUpdateSubtasks(item.subtasks.map((value) => value.id === subtask.id ? { ...value, completed: !value.completed } : value))}
                >
                  <span>{subtask.completed ? <Check size={10} /> : null}</span>
                  <em dir="auto">{subtask.title}</em>
                </button>
              ))}
            </div>
          )}
          {addingSubtask ? (
            <form className="timeline-inline-subtask" onSubmit={addSubtask}>
              <Plus size={13} />
              <input
                ref={subtaskInputRef}
                value={subtaskDraft}
                onChange={(event) => setSubtaskDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setAddingSubtask(false);
                    setSubtaskDraft('');
                  }
                }}
                placeholder={t('Add a subtask')}
                aria-label={t('Add a subtask')}
                dir="auto"
              />
              <button
                type="button"
                className="timeline-inline-subtask-cancel"
                title={t('Cancel')}
                aria-label={t('Cancel')}
                onClick={() => {
                  setAddingSubtask(false);
                  setSubtaskDraft('');
                }}
              ><X size={12} /></button>
              <button type="submit" disabled={!subtaskDraft.trim()} aria-label={t('Add')}><Check size={12} /></button>
            </form>
          ) : (
            <button
              type="button"
              className="timeline-subtask-add"
              onClick={() => {
                setAddingSubtask(true);
                window.setTimeout(() => subtaskInputRef.current?.focus(), 0);
              }}
            ><Plus size={12} /> {t('Add a subtask')}</button>
          )}
        </section>,
        document.body,
      )}
    </div>
  );
}

function TimelineYearContinuation({ scheduled, projectColor, columnColor, continuationLabel = 'Continues from another month', onOpen }: { scheduled: ScheduledTask; projectColor: string; columnColor?: string; continuationLabel?: string; onOpen: () => void }) {
  const { locale, t } = useI18n();
  const { item, startIndex, endIndex } = scheduled;
  const duration = Math.max(1, endIndex - startIndex + 1);
  const dateLabel = item.startDate && item.startDate !== item.dueDate
    ? `${parseLocalDate(item.startDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${parseLocalDate(item.dueDate!).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`
    : parseLocalDate(item.dueDate!).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return (
    <div
      className={`timeline-bar-slot timeline-continuation-slot year-continuation-slot ${duration === 1 ? 'single-day' : ''}`}
      style={{
        '--timeline-start': startIndex + 1,
        '--timeline-span': duration,
        '--project-color': projectColor,
        '--status-color': columnColor ?? projectColor,
      } as CSSProperties}
    >
      <button className="timeline-bar" onClick={onOpen} title={`${item.title} · ${dateLabel} · ${t(continuationLabel)}`}>
        <span className="timeline-bar-copy"><strong dir="auto">{item.title}</strong><small><i />{dateLabel}</small></span>
      </button>
    </div>
  );
}

function UnscheduledTaskDropPreview({ item, columnId, index, project, subtasksCollapsed, onAction, onOpenTask }: {
  item: WorkItem;
  columnId: string;
  index: number;
  project?: Project;
  subtasksCollapsed: boolean;
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `timeline-unscheduled-preview:${item.id}:${columnId}:${index}`,
    data: { type: 'timeline-unscheduled-preview', columnId, index },
  });
  return (
    <div ref={setNodeRef} className="task-drop-slot timeline-unscheduled-drop-slot">
      <TaskCard
        item={item}
        project={project}
        dropPreview
        compact
        subtasksCollapsed={subtasksCollapsed}
        onOpen={onOpenTask}
        onUpdateSubtasks={(itemId, subtasks) => onAction({ type: 'updateItem', itemId, changes: { subtasks } })}
        onSetSubtasksCollapsed={(itemId, collapsed) => onAction({ type: 'setKanbanSubtasksCollapsed', itemId, collapsed })}
      />
    </div>
  );
}

function UnscheduledKanbanColumn({
  column,
  items,
  projectById,
  showProject,
  allowUnscheduledMove,
  collapsedSubtaskItemIds,
  dropPreview,
  onAction,
  onOpenTask,
  onCreateTask,
}: {
  column: KanbanColumn;
  items: WorkItem[];
  projectById: ReadonlyMap<string, Project>;
  showProject: boolean;
  allowUnscheduledMove: boolean;
  collapsedSubtaskItemIds: ReadonlySet<string>;
  dropPreview?: UnscheduledDropPreviewState & { item: WorkItem };
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask: (preset?: Partial<TaskDraft>) => void;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({
    id: `timeline-unscheduled-column:${column.id}`,
    data: { type: 'timeline-unscheduled-column', columnId: column.id },
  });
  const dropActive = isOver || Boolean(dropPreview);
  return (
    <section
      ref={setNodeRef}
      className={`board-column unscheduled-kanban-column ${dropActive ? 'column-over' : ''}`}
      style={{ '--column-color': column.color } as CSSProperties}
      aria-label={t('{{name}} unscheduled tasks', { name: t(column.title) })}
    >
      <header className="column-header">
        <div className="column-heading"><i style={{ background: column.color }} /><h2>{t(column.title)}</h2><span>{items.length}</span></div>
        <div className="column-actions">
          <button
            type="button"
            className="icon-button column-add-task-button"
            aria-label={t('Add task to {{name}}', { name: t(column.title) })}
            title={t('Add task to {{name}}', { name: t(column.title) })}
            onClick={() => onCreateTask({ columnId: column.id })}
          ><Plus size={16} /></button>
        </div>
      </header>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {items.map((item) => (
            <Fragment key={item.id}>
              {dropPreview?.beforeItemId === item.id && (
                <UnscheduledTaskDropPreview
                  item={dropPreview.item}
                  columnId={dropPreview.columnId}
                  index={dropPreview.index}
                  project={showProject ? projectById.get(dropPreview.item.projectId) : undefined}
                  subtasksCollapsed={collapsedSubtaskItemIds.has(dropPreview.item.id)}
                  onAction={onAction}
                  onOpenTask={onOpenTask}
                />
              )}
              <TaskCard
                item={item}
                project={showProject ? projectById.get(item.projectId) : undefined}
                compact
                dragData={{
                  type: 'timeline-unscheduled-item',
                  taskId: item.id,
                  columnId: column.id,
                  allowUnscheduledMove,
                }}
                subtasksCollapsed={collapsedSubtaskItemIds.has(item.id)}
                onOpen={onOpenTask}
                onUpdateSubtasks={(itemId, subtasks) => onAction({ type: 'updateItem', itemId, changes: { subtasks } })}
                onSetSubtasksCollapsed={(itemId, collapsed) => onAction({ type: 'setKanbanSubtasksCollapsed', itemId, collapsed })}
              />
            </Fragment>
          ))}
          {dropPreview && (!dropPreview.beforeItemId || !items.some((item) => item.id === dropPreview.beforeItemId)) && (
            <UnscheduledTaskDropPreview
              item={dropPreview.item}
              columnId={dropPreview.columnId}
              index={dropPreview.index}
              project={showProject ? projectById.get(dropPreview.item.projectId) : undefined}
              subtasksCollapsed={collapsedSubtaskItemIds.has(dropPreview.item.id)}
              onAction={onAction}
              onOpenTask={onOpenTask}
            />
          )}
          {items.length === 0 && !dropPreview && (
            <div className="empty-column unscheduled-column-empty"><Sparkles size={18} /><span>{t('No unscheduled tasks in this column')}</span></div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function UnscheduledDropArea({ canDrop, childDropActive, children }: { canDrop: boolean; childDropActive: boolean; children: (isOver: boolean) => ReactNode }) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED_DROP_ID });
  const scheduledTaskIsOver = canDrop && (isOver || childDropActive);
  return (
    <section
      id="timeline-unscheduled-work"
      ref={setNodeRef}
      className={`unscheduled-tasks ${canDrop ? 'accepts-scheduled-drop' : ''} ${scheduledTaskIsOver ? 'drop-active' : ''}`}
      aria-label={t('Unscheduled work drop area')}
    >
      {children(scheduledTaskIsOver)}
    </section>
  );
}

export function TimelineView({ document, project, saveState, dirty, onOpenTask, onCreateTask, onAction, onSave, onEditProject, mobile = false }: Props) {
  const { direction, locale, t } = useI18n();
  const [windowStarts, setWindowStarts] = useState<Record<TimelineZoom, string>>(() => initialTimelineWindowStarts(document.preferences.timelineWindowStarts));
  const [zoom, setZoom] = useState<TimelineZoom>(() => initialTimelineZoom(document.preferences.timelineZoom, mobile));
  const windowStart = windowStarts[zoom];
  const layoutMode = document.preferences.timelineLayout ?? 'tasks';
  const setLayoutMode = (layout: TimelineLayout) => onAction({ type: 'setTimelineLayout', layout });
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
  const [dependencySourceId, setDependencySourceId] = useState<string | null>(null);
  const [dependencyRope, setDependencyRope] = useState<DependencyRope | null>(null);
  const [highlightedDependencyId, setHighlightedDependencyId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const [resizeAnimation, setResizeAnimation] = useState<{ taskId: string; fromScale: number } | null>(null);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const scope = document.preferences.projectScope ?? 'current';
  const setScope = (nextScope: ProjectScope) => onAction({ type: 'setProjectScope', scope: nextScope });
  const [unscheduledDropPreview, setUnscheduledDropPreview] = useState<UnscheduledDropPreviewState | null>(null);
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(false);
  const [unscheduledPaneHeight, setUnscheduledPaneHeight] = useState(() => mobile ? MOBILE_UNSCHEDULED_PANE_HEIGHT : DEFAULT_UNSCHEDULED_PANE_HEIGHT);
  const [paneResizing, setPaneResizing] = useState(false);
  const [fourWeekDependencyLayout, setFourWeekDependencyLayout] = useState<TimelineFourWeekDependencyLayout | null>(null);
  const [fourWeekRowHeights, setFourWeekRowHeights] = useState<Record<string, number>>({});
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const timelineRowsRef = useRef<HTMLDivElement>(null);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const fourWeekBoardRef = useRef<HTMLDivElement>(null);
  const fourWeekRowsRefs = useRef(new Map<string, HTMLDivElement>());
  const resizeRowsRef = useRef<HTMLElement | null>(null);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => { setUnscheduledDropPreview(null); }, [project.id]);
  useEffect(() => {
    setWindowStarts(initialTimelineWindowStarts(document.preferences.timelineWindowStarts));
  }, [document.preferences.timelineWindowStarts, document.workspace.id]);
  useLayoutEffect(() => {
    if (!mobile) return;
    if (chartScrollRef.current) chartScrollRef.current.scrollLeft = 0;
  }, [mobile, windowStart, zoom]);
  useEffect(() => {
    if (!paneResizing) return;
    const resizePane = (clientY: number) => {
      const bounds = timelineContentRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const availableMaximum = Math.max(
        MIN_UNSCHEDULED_PANE_HEIGHT,
        Math.min(MAX_UNSCHEDULED_PANE_HEIGHT, bounds.height - MIN_TIMELINE_PANE_HEIGHT - PANE_DIVIDER_SIZE),
      );
      const nextHeight = Math.max(
        MIN_UNSCHEDULED_PANE_HEIGHT,
        Math.min(availableMaximum, bounds.bottom - clientY),
      );
      setUnscheduledPaneHeight(Math.round(nextHeight));
    };
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      resizePane(event.clientY);
    };
    const stopResizing = () => setPaneResizing(false);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [paneResizing]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rangeStart = new Date(`${windowStart}T12:00:00`);
  const span = spanForWindow(rangeStart, zoom);
  const setActiveWindowStart = (nextStart: Date) => {
    const startDate = iso(nextStart);
    setWindowStarts((current) => ({ ...current, [zoom]: startDate }));
    onAction({ type: 'setTimelineWindowStart', zoom, startDate });
  };
  const moveActiveWindow = (direction: -1 | 1) => {
    const nextStart = new Date(rangeStart);
    if (zoom === 'year') nextStart.setFullYear(nextStart.getFullYear() + direction);
    else if (zoom === 'month') nextStart.setMonth(nextStart.getMonth() + direction);
    else nextStart.setDate(nextStart.getDate() + direction * (zoom === 'two-weeks' ? 7 : span));
    setActiveWindowStart(nextStart);
  };
  const days = Array.from({ length: span }, (_, index) => dateAt(rangeStart, index));
  const rangeEnd = days[days.length - 1];
  const isYearView = zoom === 'year';
  const isFourWeekView = zoom === 'four-weeks';
  const dayWidth = zoom === 'week' ? 82 : zoom === 'two-weeks' ? 72 : zoom === 'month' || zoom === 'four-weeks' ? 58 : 8;
  const minimumRowHeight = isYearView ? YEAR_ROW_HEIGHT : MIN_ROW_HEIGHT;
  const gridTemplateColumns = `repeat(${span}, minmax(${dayWidth}px, 1fr))`;
  const monthSegments = isYearView ? monthSegmentsForDays(days) : [];
  const todayIso = iso(new Date());
  const showAllProjects = scope === 'all';
  const activeColumns = document.modules.kanban.projects[project.id]?.columns ?? [];
  const plannedColumn = columnForRule(activeColumns, 'new-task');
  const scopedProjects = useMemo(() => showAllProjects
    ? [project, ...document.projects.filter((candidate) => candidate.id !== project.id && !candidate.archived)]
    : [project], [document.projects, project, showAllProjects]);
  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((candidate) => candidate.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(document.projects.map((candidate) => [candidate.id, candidate])), [document.projects]);
  const collapsedSubtaskItemIds = useMemo(
    () => new Set(document.preferences.collapsedKanbanSubtaskItemIds ?? []),
    [document.preferences.collapsedKanbanSubtaskItemIds],
  );
  const unscheduledColumns = useMemo(() => {
    const seen = new Set<string>();
    return scopedProjects.flatMap((candidate) => document.modules.kanban.projects[candidate.id]?.columns ?? [])
      .filter((column) => {
        if (seen.has(column.id)) return false;
        seen.add(column.id);
        return true;
      });
  }, [document.modules.kanban.projects, scopedProjects]);
  const projectItems = useMemo(() => Object.values(document.items)
    .filter((item) => scopedProjectIds.has(item.projectId)), [document.items, scopedProjectIds]);
  const kanbanOrder = useMemo(() => {
    const projectPosition = new Map(scopedProjects.map((candidate, index) => [candidate.id, index]));
    const columnPosition = new Map<string, number>();
    scopedProjects.forEach((candidate) => {
      (document.modules.kanban.projects[candidate.id]?.columns ?? []).forEach((column, index) => {
        columnPosition.set(`${candidate.id}:${column.id}`, index);
      });
    });
    const ordered = [...projectItems].sort((left, right) =>
      (projectPosition.get(left.projectId) ?? Number.MAX_SAFE_INTEGER) - (projectPosition.get(right.projectId) ?? Number.MAX_SAFE_INTEGER)
      || left.moduleData.kanban.rank - right.moduleData.kanban.rank
      || (columnPosition.get(`${left.projectId}:${left.moduleData.kanban.columnId}`) ?? Number.MAX_SAFE_INTEGER) - (columnPosition.get(`${right.projectId}:${right.moduleData.kanban.columnId}`) ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt.localeCompare(right.createdAt));
    return new Map(ordered.map((item, index) => [item.id, index]));
  }, [document.modules.kanban.projects, projectItems, scopedProjects]);
  const scheduled = useMemo<ScheduledTask[]>(() => projectItems
    .filter((item) => item.dueDate)
    .map((item) => {
      const due = new Date(`${item.dueDate}T12:00:00`);
      const start = new Date(`${item.startDate ?? item.dueDate}T12:00:00`);
      return {
        item,
        start,
        due,
        startIndex: Math.max(0, calendarDayDistance(start, rangeStart)),
        endIndex: Math.min(span - 1, calendarDayDistance(due, rangeStart)),
        endClipped: due > rangeEnd,
      };
    })
    .filter(({ start, due }) => due >= rangeStart && start <= rangeEnd)
    .sort((left, right) => compareTimelineItems(left.item, right.item, kanbanOrder)), [kanbanOrder, projectItems, rangeEnd, rangeStart, span]);
  const displayRows = useMemo<TimelineDisplayRow[]>(() => layoutMode === 'compact'
    ? buildCompactRows(scheduled, kanbanOrder)
    : scheduled.map((entry) => ({ id: entry.item.id, entries: [entry] })), [kanbanOrder, layoutMode, scheduled]);
  const fourWeekBandLayouts = useMemo<TimelineFourWeekBandLayout[]>(() => isFourWeekView ? [0, 14].map((bandStartIndex) => {
    const bandDays = days.slice(bandStartIndex, bandStartIndex + 14);
    const bandStart = bandDays[0];
    const bandEnd = bandDays[bandDays.length - 1];
    const bandTasks = scheduled
      .filter(({ start, due }) => due >= bandStart && start <= bandEnd)
      .map((entry) => ({
        ...entry,
        startIndex: Math.max(0, calendarDayDistance(entry.start, bandStart)),
        endIndex: Math.min(13, calendarDayDistance(entry.due, bandStart)),
        endClipped: entry.due > bandEnd,
      }))
      .sort((left, right) => compareTimelineItems(left.item, right.item, kanbanOrder));
    const rows = layoutMode === 'compact'
      ? buildCompactRows(bandTasks, kanbanOrder)
      : bandTasks.map((entry) => ({ id: entry.item.id, entries: [entry] }));
    return { id: `four-week-band:${bandStartIndex / 14}`, days: bandDays, scheduled: bandTasks, rows };
  }) : [], [days, isFourWeekView, kanbanOrder, layoutMode, scheduled]);
  const fourWeekDependencyMeasureKey = `${layoutMode}|${fourWeekBandLayouts.map((band) => `${band.id}:${band.rows.map((row) => `${row.id}:${row.entries.map(({ item }) => `${item.id}[${(item.dependencyIds ?? []).join(',')}]`).join(',')}`).join('|')}`).join('||')}`;
  const fourWeekLocalDependencyIds = new Set(fourWeekBandLayouts.flatMap((band) => {
    const visibleTaskIds = new Set(band.scheduled.map(({ item }) => item.id));
    return band.scheduled.flatMap(({ item }) => (item.dependencyIds ?? [])
      .filter((sourceId) => visibleTaskIds.has(sourceId))
      .map((sourceId) => `${sourceId}-${item.id}`));
  }));
  const fourWeekLocalDependencyKey = [...fourWeekLocalDependencyIds].sort().join('|');
  const yearMonthLayouts: TimelineYearMonthLayout[] = isYearView ? monthSegments.map((segment) => {
    const monthDays = days.slice(segment.startIndex, segment.startIndex + segment.dayCount);
    const monthStart = monthDays[0];
    const monthEnd = monthDays[monthDays.length - 1];
    const monthTasks = scheduled
      .filter(({ start, due }) => due >= monthStart && start <= monthEnd)
      .map((entry) => ({
        ...entry,
        startIndex: Math.max(0, calendarDayDistance(entry.start, monthStart)),
        endIndex: Math.min(segment.dayCount - 1, calendarDayDistance(entry.due, monthStart)),
        endClipped: entry.due > monthEnd,
      }))
      .sort((left, right) => compareTimelineItems(left.item, right.item, kanbanOrder));
    const rows = layoutMode === 'compact'
      ? buildCompactRows(monthTasks, kanbanOrder)
      : monthTasks.map((entry) => ({ id: entry.item.id, entries: [entry] }));
    return { segment, days: monthDays, rows };
  }) : [];
  const unscheduled = useMemo(() => projectItems
    .filter((item) => !item.dueDate)
    .sort((left, right) => (kanbanOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (kanbanOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)), [kanbanOrder, projectItems]);
  const unscheduledItemsForColumn = (columnId: string) => unscheduled.filter((item) => item.moduleData.kanban.columnId === columnId);
  const draggedTask = draggedTaskId ? document.items[draggedTaskId] : undefined;
  const orderingSource = draggedTask?.dueDate ? draggedTask : undefined;
  const scheduledMeasureKey = displayRows.map((row) => `${row.id}:${row.entries.map(({ item, startIndex, endIndex }) => `${item.id}:${startIndex}:${endIndex}:${item.title}`).join(',')}`).join('|');

  useLayoutEffect(() => {
    const container = timelineRowsRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > .timeline-row[data-row-id]'));
    const measure = () => {
      const next = Object.fromEntries(rows.map((row) => [row.dataset.rowId!, Math.max(minimumRowHeight, Math.ceil(row.getBoundingClientRect().height))]));
      setRowHeights((current) => {
        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(next);
        return currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === next[key]) ? current : next;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    rows.forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [direction, minimumRowHeight, scheduledMeasureKey, span]);

  const rowLayouts = useMemo<TimelineRowLayout[]>(() => {
    let top = 0;
    return displayRows.flatMap((row) => {
      const height = rowHeights[row.id] ?? minimumRowHeight;
      const layouts = row.entries.map((entry) => ({
        ...entry,
        rowId: row.id,
        top,
        height,
        center: top + height / 2,
        left: entry.startIndex * 100 + 5,
        right: (entry.endIndex + 1) * 100 - 5,
      }));
      top += height;
      return layouts;
    });
  }, [displayRows, minimumRowHeight, rowHeights]);
  const timelineRowsHeight = displayRows.reduce((total, row) => total + (rowHeights[row.id] ?? minimumRowHeight), 0);

  const dependencyPaths = useMemo(() => {
    const rowById = new Map(rowLayouts.map((row) => [row.item.id, row]));
    const sameTrackRouteCounts = new Map<string, number>();
    let visibleConnectorIndex = 0;
    const chartRight = span * 100;
    return rowLayouts.flatMap((target) => (target.item.dependencyIds ?? []).flatMap((dependencyId, dependencyIndex) => {
      const source = rowById.get(dependencyId);
      if (!source) return [];
      const tone = visibleConnectorIndex % 5;
      visibleConnectorIndex += 1;
      const x1 = source.right;
      const x2 = target.left;
      const y1 = source.center;
      const y2 = target.center;
      const sameTrack = source.rowId === target.rowId && x2 > x1;
      const shortSameTrack = sameTrack && x2 - x1 <= 28;
      if (shortSameTrack) {
        const targetEndX = Math.min(target.right - 12, x2 + 18);
        return [{
          id: `${dependencyId}-${target.item.id}`,
          sourceId: dependencyId,
          targetId: target.item.id,
          sourceTitle: source.item.title,
          targetTitle: target.item.title,
          path: `M ${x1} ${y1} L ${targetEndX} ${y2}`,
          x1,
          y1,
          controlX: (x1 + targetEndX) / 2,
          controlY: y1,
          routeLane: y1,
          sourceDetourLane: undefined,
          tone,
          inlineDirection: false,
          overlaps: false,
        }];
      }
      if (sameTrack) {
        const routeIndex = sameTrackRouteCounts.get(source.rowId) ?? 0;
        const interveningObstacles = rowLayouts
          .filter((row) => row.rowId === source.rowId && row.item.id !== source.item.id && row.item.id !== target.item.id && row.right > x1 && row.left < x2)
          .sort((left, right) => left.left - right.left);
        const laneOffsets = [-24, 24, -38, 38, -46, 46, -14, 14];
        const routeLane = source.center + laneOffsets[routeIndex % laneOffsets.length];
        const turnInset = 10 + (routeIndex % 3) * 4;
        const firstObstacle = interveningObstacles[0];
        const lastObstacle = interveningObstacles[interveningObstacles.length - 1];
        const sourceTurnX = Math.min(x2 - 10, x1 + turnInset, firstObstacle ? Math.max(x1 + 3, firstObstacle.left - 4) : Number.POSITIVE_INFINITY);
        const targetTurnX = Math.max(sourceTurnX, x2 - turnInset, lastObstacle ? Math.min(x2 - 3, lastObstacle.right + 4) : Number.NEGATIVE_INFINITY);
        const adjacentSourceObstacle = firstObstacle && firstObstacle.left - x1 <= 18 ? firstObstacle : undefined;
        const outerLanes = [source.top + 3, source.top + source.height - 3, source.top + 1, source.top + source.height - 1];
        const sourceDetourLane = adjacentSourceObstacle ? outerLanes[routeIndex % outerLanes.length] : undefined;
        const routeStartX = adjacentSourceObstacle ? Math.min(targetTurnX, adjacentSourceObstacle.right + 4) : sourceTurnX;
        sameTrackRouteCounts.set(source.rowId, routeIndex + 1);

        const obstacles = interveningObstacles.filter((row) => row.right > routeStartX && row.left < targetTurnX);
        let gapStart = routeStartX;
        let widestGap = { start: routeStartX, end: routeStartX };
        const considerGap = (start: number, end: number) => {
          if (end - start > widestGap.end - widestGap.start) widestGap = { start, end };
        };
        obstacles.forEach((obstacle) => {
          considerGap(gapStart, Math.min(targetTurnX, obstacle.left - 6));
          gapStart = Math.max(gapStart, obstacle.right + 6);
        });
        considerGap(gapStart, targetTurnX);
        const directionX = (widestGap.start + widestGap.end) / 2;
        const sourceRoutePoints = sourceDetourLane === undefined
          ? [{ x: sourceTurnX, y: routeLane }]
          : [
            { x: sourceTurnX, y: sourceDetourLane },
            { x: routeStartX, y: sourceDetourLane },
            { x: routeStartX, y: routeLane },
          ];
        const path = roundedOrthogonalPath([
          { x: x1, y: y1 },
          { x: sourceTurnX, y: y1 },
          ...sourceRoutePoints,
          { x: targetTurnX, y: routeLane },
          { x: targetTurnX, y: y2 },
          { x: x2, y: y2 },
        ], 8);
        return [{
          id: `${dependencyId}-${target.item.id}`,
          sourceId: dependencyId,
          targetId: target.item.id,
          sourceTitle: source.item.title,
          targetTitle: target.item.title,
          path,
          x1,
          y1,
          controlX: directionX,
          controlY: routeLane,
          routeLane,
          sourceDetourLane,
          tone,
          inlineDirection: widestGap.end - widestGap.start >= 18,
          overlaps: false,
        }];
      }
      const overlaps = x2 <= x1 + 28;
      const verticalStart = Math.min(y1, y2);
      const verticalEnd = Math.max(y1, y2);
      const obstacles = rowLayouts.filter((row) => row.item.id !== source.item.id && row.top < verticalEnd && row.top + row.height > verticalStart);
      const minRouteX = Math.min(chartRight - 8, x1 + 20);
      const preferredRouteX = overlaps
        ? Math.max(source.right, target.right, ...obstacles.map((row) => row.right)) + 28 + dependencyIndex * 12
        : (x1 + x2) / 2;
      const routeCandidates: number[] = [];
      for (let offset = 0; offset <= chartRight; offset += 10) {
        routeCandidates.push(preferredRouteX + offset, preferredRouteX - offset);
      }
      const routeX = routeCandidates
        .map((candidate) => Math.max(minRouteX, Math.min(chartRight - 8, candidate)))
        .find((candidate) => obstacles.every((row) => candidate < row.left - 14 || candidate > row.right + 14))
        ?? Math.max(minRouteX, Math.min(chartRight - 8, preferredRouteX));
      const targetLaneY = y2 >= y1 ? target.top + 3 : target.top + target.height - 3;
      const targetApproachX = Math.max(0, x2 - 18);
      const path = roundedOrthogonalPath([
        { x: x1, y: y1 },
        { x: routeX, y: y1 },
        { x: routeX, y: targetLaneY },
        { x: targetApproachX, y: targetLaneY },
        { x: targetApproachX, y: y2 },
        { x: x2, y: y2 },
      ]);
      return [{
        id: `${dependencyId}-${target.item.id}`,
        sourceId: dependencyId,
        targetId: target.item.id,
        sourceTitle: source.item.title,
        targetTitle: target.item.title,
        path,
        x1,
        y1,
        controlX: routeX,
        controlY: (y1 + targetLaneY) / 2,
        routeLane: (y1 + targetLaneY) / 2,
        sourceDetourLane: undefined,
        tone,
        inlineDirection: false,
        overlaps,
      }];
    }));
  }, [rowLayouts, span]);
  const highlightedDependency = dependencyPaths.find((connector) => connector.id === highlightedDependencyId);

  const scheduleTask = (taskId: string, date: string) => {
    const task = document.items[taskId];
    if (!task) return;
    const nextStart = new Date(`${date}T12:00:00`);
    let duration = 0;
    if (task.dueDate) {
      const previousStart = new Date(`${task.startDate ?? task.dueDate}T12:00:00`);
      const previousDue = new Date(`${task.dueDate}T12:00:00`);
      duration = Math.max(0, calendarDayDistance(previousDue, previousStart));
    }
    onAction({
      type: 'updateItem',
      itemId: task.id,
      changes: { startDate: date, dueDate: iso(dateAt(nextStart, duration)) },
    });
    setRecentlyMovedId(task.id);
    window.setTimeout(() => setRecentlyMovedId((current) => current === task.id ? null : current), 520);
  };

  const unscheduleTask = (taskId: string) => {
    const task = document.items[taskId];
    if (!task || (!task.startDate && !task.dueDate)) return;
    onAction({
      type: 'updateItem',
      itemId: task.id,
      changes: { startDate: undefined, dueDate: undefined },
    });
  };

  const resizeTaskEnd = (taskId: string, date: string) => {
    const task = document.items[taskId];
    if (!task?.dueDate) return;
    const startDate = task.startDate ?? task.dueDate;
    const dueDate = date < startDate ? startDate : date;
    if (dueDate === task.dueDate && task.startDate) return;
    const oldDuration = Math.max(1, calendarDayDistance(parseLocalDate(task.dueDate), parseLocalDate(startDate)) + 1);
    const newDuration = Math.max(1, calendarDayDistance(parseLocalDate(dueDate), parseLocalDate(startDate)) + 1);
    onAction({
      type: 'updateItem',
      itemId: task.id,
      changes: { startDate, dueDate },
    });
    setResizeAnimation({ taskId: task.id, fromScale: Math.max(.96, Math.min(1.04, oldDuration / newDuration)) });
    window.setTimeout(() => setResizeAnimation((current) => current?.taskId === task.id ? null : current), 460);
  };

  const reorderTimelineTasks = (taskId: string, targetId: string) => {
    if (taskId === targetId) return;
    const movingTask = document.items[taskId];
    const targetTask = document.items[targetId];
    if (!movingTask || !targetTask || movingTask.projectId !== targetTask.projectId || !tasksStartSameDay(movingTask, targetTask)) return;
    const ordered = projectItems
      .filter((item) => item.projectId === movingTask.projectId)
      .sort((left, right) => (kanbanOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (kanbanOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    const fromIndex = ordered.findIndex((item) => item.id === taskId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moving] = ordered.splice(fromIndex, 1);
    ordered.splice(targetIndex, 0, moving);
    onAction({ type: 'reorderKanbanItems', projectId: movingTask.projectId, itemIds: ordered.map((item) => item.id) });
    setRecentlyMovedId(taskId);
    window.setTimeout(() => setRecentlyMovedId((current) => current === taskId ? null : current), 520);
  };

  const wouldCreateDependencyCycle = (sourceId: string, targetId: string) => {
    const visited = new Set<string>();
    const reachesTarget = (taskId: string): boolean => {
      if (taskId === targetId) return true;
      if (visited.has(taskId)) return false;
      visited.add(taskId);
      return (document.items[taskId]?.dependencyIds ?? []).some(reachesTarget);
    };
    return reachesTarget(sourceId);
  };

  const canConnectTasks = (sourceId: string, targetId: string) => {
    const source = document.items[sourceId];
    const target = document.items[targetId];
    return Boolean(source && target && source.projectId === target.projectId && sourceId !== targetId && !target.dependencyIds?.includes(sourceId) && !wouldCreateDependencyCycle(sourceId, targetId));
  };

  const connectTasks = (sourceId: string, targetId: string) => {
    const target = document.items[targetId];
    if (!target || !canConnectTasks(sourceId, targetId)) return;
    onAction({ type: 'updateItem', itemId: targetId, changes: { dependencyIds: [...(target.dependencyIds ?? []), sourceId] } });
    setRecentlyMovedId(targetId);
    window.setTimeout(() => setRecentlyMovedId((current) => current === targetId ? null : current), 520);
  };

  const cancelDependency = (sourceId: string, targetId: string) => {
    const target = document.items[targetId];
    if (!target?.dependencyIds?.includes(sourceId)) return;
    onAction({ type: 'updateItem', itemId: targetId, changes: { dependencyIds: target.dependencyIds.filter((dependencyId) => dependencyId !== sourceId) } });
    setRecentlyMovedId(targetId);
    window.setTimeout(() => setRecentlyMovedId((current) => current === targetId ? null : current), 520);
  };

  const updateUnscheduledDropPreview = (event: DragMoveEvent | DragOverEvent) => {
    const taskId = event.active.data.current?.taskId as string | undefined;
    const allowUnscheduledMove = event.active.data.current?.allowUnscheduledMove !== false;
    if (!taskId || !allowUnscheduledMove) {
      setUnscheduledDropPreview(null);
      return;
    }
    if (!event.over) return;
    const overData = event.over.data.current as { type?: string; columnId?: string } | undefined;
    if (!overData?.type?.startsWith('timeline-unscheduled-')) {
      setUnscheduledDropPreview(null);
      return;
    }
    const item = document.items[taskId];
    const columnId = overData.columnId;
    const itemColumns = item ? document.modules.kanban.projects[item.projectId]?.columns ?? [] : [];
    if (!item || !columnId || !itemColumns.some((column) => column.id === columnId)) {
      setUnscheduledDropPreview(null);
      return;
    }
    const targetItems = unscheduled
      .filter((candidate) => candidate.projectId === item.projectId && candidate.moduleData.kanban.columnId === columnId)
      .sort((left, right) => left.moduleData.kanban.rank - right.moduleData.kanban.rank);
    const destinationItems = targetItems.filter((candidate) => candidate.id !== taskId);
    const index = unscheduledTaskDropIndex(event, taskId, targetItems);
    const originalIndex = targetItems.findIndex((candidate) => candidate.id === taskId);
    if (!item.dueDate && columnId === item.moduleData.kanban.columnId && index === originalIndex) {
      setUnscheduledDropPreview(null);
      return;
    }
    const nextPreview = { itemId: taskId, columnId, index, beforeItemId: destinationItems[index]?.id };
    setUnscheduledDropPreview((current) => current?.itemId === nextPreview.itemId
      && current.columnId === nextPreview.columnId
      && current.index === nextPreview.index
      && current.beforeItemId === nextPreview.beforeItemId
      ? current
      : nextPreview);
  };

  const moveTaskInUnscheduledKanban = (taskId: string, columnId: string, visibleIndex: number) => {
    const item = document.items[taskId];
    if (!item) return;
    const fullTargetItems = itemsForColumn(document, item.projectId, columnId).filter((candidate) => candidate.id !== taskId);
    const unscheduledTargetItems = fullTargetItems.filter((candidate) => !candidate.dueDate);
    const beforeItem = unscheduledTargetItems[visibleIndex];
    const fullIndex = beforeItem ? fullTargetItems.findIndex((candidate) => candidate.id === beforeItem.id) : fullTargetItems.length;
    onAction({ type: 'moveItem', itemId: taskId, columnId, index: fullIndex });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setUnscheduledDropPreview(null);
    setReorderTargetId(null);
    setResizePreview(null);
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    if (sourceId) {
      const rect = event.active.rect.current.initial;
      const pointer = event.activatorEvent as PointerEvent;
      const startX = rect ? rect.left + rect.width / 2 : pointer.clientX;
      const startY = rect ? rect.top + rect.height / 2 : pointer.clientY;
      setDependencySourceId(sourceId);
      setDependencyRope({ startX, startY, endX: startX, endY: startY, attached: false });
      setDraggedTaskId(null);
      setResizingTaskId(null);
      return;
    }
    const resizeTaskId = event.active.data.current?.resizeTaskId as string | undefined;
    if (resizeTaskId) {
      const task = document.items[resizeTaskId];
      const slot = Array.from(window.document.querySelectorAll<HTMLElement>('[data-timeline-task-id]'))
        .find((candidate) => candidate.dataset.timelineTaskId === resizeTaskId);
      resizeRowsRef.current = slot?.closest<HTMLElement>('.timeline-rows') ?? null;
      resizeStartWidthRef.current = slot?.getBoundingClientRect().width ?? 0;
      setResizingTaskId(resizeTaskId);
      setResizePreview(task?.dueDate ? { taskId: resizeTaskId, dueDate: task.dueDate, deltaPx: 0 } : null);
      setDraggedTaskId(null);
      return;
    }
    setResizingTaskId(null);
    setDraggedTaskId(event.active.data.current?.taskId as string | undefined ?? null);
  };
  const handleDragMove = (event: DragMoveEvent) => {
    const resizeTaskId = event.active.data.current?.resizeTaskId as string | undefined;
    if (resizeTaskId) {
      const task = document.items[resizeTaskId];
      if (!task?.dueDate) return;
      const overId = event.over?.id.toString();
      const overDate = overId?.startsWith('timeline-day:') ? overId.slice('timeline-day:'.length) : undefined;
      const startDate = task.startDate ?? task.dueDate;
      const dueDate = overDate && overDate >= startDate ? overDate : overDate ? startDate : resizePreview?.dueDate ?? task.dueDate;
      const visibleSpan = Number(resizeRowsRef.current?.closest<HTMLElement>('.timeline-chart')?.dataset.dayCount) || span;
      const gridWidth = resizeRowsRef.current?.getBoundingClientRect().width ?? visibleSpan * dayWidth;
      const minimumWidth = isYearView ? Math.max(6, gridWidth / visibleSpan - 2) : Math.max(40, gridWidth / visibleSpan - 12);
      const logicalDelta = direction === 'rtl' ? -event.delta.x : event.delta.x;
      setResizePreview({ taskId: resizeTaskId, dueDate, deltaPx: Math.max(minimumWidth - resizeStartWidthRef.current, logicalDelta) });
      return;
    }
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    if (!sourceId) {
      updateUnscheduledDropPreview(event);
      return;
    }
    const initial = event.active.rect.current.initial;
    if (!initial) return;
    const startX = initial.left + initial.width / 2;
    const startY = initial.top + initial.height / 2;
    const targetId = event.over?.data.current?.dependencyTargetId as string | undefined;
    const targetRect = targetId && canConnectTasks(sourceId, targetId) ? event.over?.rect : undefined;
    setDependencyRope({
      startX,
      startY,
      endX: targetRect ? direction === 'rtl' ? targetRect.right : targetRect.left : startX + event.delta.x,
      endY: targetRect ? targetRect.top + targetRect.height / 2 : startY + event.delta.y,
      attached: Boolean(targetRect),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    const targetId = event.over?.data.current?.dependencyTargetId as string | undefined;
    const taskId = event.active.data.current?.taskId as string | undefined;
    const resizeTaskId = event.active.data.current?.resizeTaskId as string | undefined;
    const reorderOverId = event.over?.data.current?.reorderTargetId as string | undefined;
    const overData = event.over?.data.current as { type?: string; columnId?: string } | undefined;
    const dropId = event.over?.id.toString();
    if (sourceId && targetId && canConnectTasks(sourceId, targetId)) {
      connectTasks(sourceId, targetId);
      setDependencyRope((current) => current ? { ...current, attached: true } : current);
      window.setTimeout(() => setDependencyRope(null), 260);
    } else {
      setDependencyRope(null);
    }
    if (taskId && reorderOverId) {
      reorderTimelineTasks(taskId, reorderOverId);
    } else if (resizeTaskId && dropId?.startsWith('timeline-day:')) {
      resizeTaskEnd(resizeTaskId, dropId.slice('timeline-day:'.length));
    } else if (taskId && dropId?.startsWith('timeline-day:')) {
      scheduleTask(taskId, dropId.slice('timeline-day:'.length));
    } else if (taskId && overData?.type?.startsWith('timeline-unscheduled-') && overData.columnId) {
      const task = document.items[taskId];
      if (task?.dueDate) unscheduleTask(taskId);
      if (task && event.active.data.current?.allowUnscheduledMove !== false) {
        const targetItems = unscheduled
          .filter((candidate) => candidate.projectId === task.projectId && candidate.moduleData.kanban.columnId === overData.columnId)
          .sort((left, right) => left.moduleData.kanban.rank - right.moduleData.kanban.rank);
        const index = unscheduledTaskDropIndex(event, taskId, targetItems);
        const originalIndex = targetItems.findIndex((candidate) => candidate.id === taskId);
        if (task.dueDate || overData.columnId !== task.moduleData.kanban.columnId || index !== originalIndex) {
          moveTaskInUnscheduledKanban(taskId, overData.columnId, index);
        }
      }
    } else if (taskId && dropId === UNSCHEDULED_DROP_ID) {
      unscheduleTask(taskId);
    }
    setDraggedTaskId(null);
    setResizingTaskId(null);
    setResizePreview(null);
    resizeRowsRef.current = null;
    setReorderTargetId(null);
    setDependencySourceId(null);
    setDragOverDate(null);
    setUnscheduledDropPreview(null);
  };

  useLayoutEffect(() => {
    if (!isFourWeekView) {
      fourWeekRowsRefs.current.clear();
      setFourWeekRowHeights((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }
    const containers = [...fourWeekRowsRefs.current.entries()];
    const rows = containers.flatMap(([bandId, container]) => Array.from(container.querySelectorAll<HTMLElement>(':scope > .timeline-row[data-row-id]'))
      .map((row) => ({ bandId, row })));
    const measure = () => {
      const next = Object.fromEntries(rows.map(({ bandId, row }) => [
        `${bandId}:${row.dataset.rowId!}`,
        Math.max(MIN_ROW_HEIGHT, Math.ceil(row.getBoundingClientRect().height)),
      ]));
      setFourWeekRowHeights((current) => {
        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(next);
        return currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === next[key]) ? current : next;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    rows.forEach(({ row }) => observer.observe(row));
    return () => observer.disconnect();
  }, [direction, fourWeekDependencyMeasureKey, isFourWeekView]);

  useLayoutEffect(() => {
    if (!isFourWeekView) {
      setFourWeekDependencyLayout((current) => current === null ? current : null);
      return;
    }
    const board = fourWeekBoardRef.current;
    if (!board) return;

    const measure = () => {
      const boardRect = board.getBoundingClientRect();
      const width = Math.max(1, boardRect.width || board.clientWidth || 1400);
      const height = Math.max(1, boardRect.height || board.scrollHeight || 600);
      const slots = Array.from(board.querySelectorAll<HTMLElement>('[data-timeline-task-id]'));
      const slotByTaskId = new Map(slots.map((slot) => [slot.dataset.timelineTaskId!, slot]));
      let visibleConnectorIndex = 0;
      const connectors = slots.flatMap((targetSlot) => {
        const targetId = targetSlot.dataset.timelineTaskId!;
        const target = document.items[targetId];
        if (!target) return [];
        return (target.dependencyIds ?? []).flatMap((sourceId, dependencyIndex) => {
          if (fourWeekLocalDependencyIds.has(`${sourceId}-${targetId}`)) return [];
          const source = document.items[sourceId];
          const sourceSlot = slotByTaskId.get(sourceId);
          if (!source || !sourceSlot) return [];
          const sourceRect = sourceSlot.getBoundingClientRect();
          const targetRect = targetSlot.getBoundingClientRect();
          const sourceChartRect = sourceSlot.closest<HTMLElement>('.timeline-chart')?.getBoundingClientRect();
          const targetChartRect = targetSlot.closest<HTMLElement>('.timeline-chart')?.getBoundingClientRect();
          const x1 = (direction === 'rtl' ? sourceRect.left : sourceRect.right) - boardRect.left;
          const x2 = (direction === 'rtl' ? targetRect.right : targetRect.left) - boardRect.left;
          const y1 = sourceRect.top - boardRect.top + sourceRect.height / 2;
          const y2 = targetRect.top - boardRect.top + targetRect.height / 2;
          const sameBand = sourceSlot.closest('.timeline-chart') === targetSlot.closest('.timeline-chart');
          let controlX: number;
          let controlY: number;
          let path: string;
          if (sameBand) {
            const forward = direction === 'rtl' ? x2 < x1 : x2 > x1;
            const routeX = forward
              ? (x1 + x2) / 2
              : direction === 'rtl'
                ? Math.max(8, Math.min(x1, x2) - 28 - dependencyIndex * 10)
                : Math.min(width - 8, Math.max(x1, x2) + 28 + dependencyIndex * 10);
            controlX = routeX;
            controlY = (y1 + y2) / 2;
            path = roundedOrthogonalPath([
              { x: x1, y: y1 },
              { x: routeX, y: y1 },
              { x: routeX, y: y2 },
              { x: x2, y: y2 },
            ]);
          } else {
            const movingDown = y2 >= y1;
            const sourceEdge = sourceChartRect ? (movingDown ? sourceChartRect.bottom : sourceChartRect.top) - boardRect.top : y1;
            const targetEdge = targetChartRect ? (movingDown ? targetChartRect.top : targetChartRect.bottom) - boardRect.top : y2;
            const routeY = (sourceEdge + targetEdge) / 2;
            const directionSign = direction === 'rtl' ? -1 : 1;
            const sourceLeadX = Math.max(8, Math.min(width - 8, x1 + directionSign * 16));
            const targetLeadX = Math.max(8, Math.min(width - 8, x2 - directionSign * 16));
            controlX = (sourceLeadX + targetLeadX) / 2;
            controlY = routeY;
            path = roundedOrthogonalPath([
              { x: x1, y: y1 },
              { x: sourceLeadX, y: y1 },
              { x: sourceLeadX, y: routeY },
              { x: targetLeadX, y: routeY },
              { x: targetLeadX, y: y2 },
              { x: x2, y: y2 },
            ]);
          }
          const tone = visibleConnectorIndex % 5;
          visibleConnectorIndex += 1;
          return [{
            id: `${sourceId}-${targetId}`,
            sourceId,
            targetId,
            sourceTitle: source.title,
            targetTitle: target.title,
            path,
            x1,
            y1,
            controlX,
            controlY,
            tone,
          }];
        });
      });
      const signature = `${width}:${height}:${connectors.map(({ id, path }) => `${id}:${path}`).join('|')}`;
      setFourWeekDependencyLayout((current) => current?.signature === signature ? current : { width, height, signature, connectors });
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(board);
    Array.from(board.querySelectorAll<HTMLElement>('[data-timeline-task-id]')).forEach((slot) => observer?.observe(slot));
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [direction, document.items, fourWeekDependencyMeasureKey, fourWeekLocalDependencyKey, isFourWeekView]);

  const ropePath = dependencyRope ? (() => {
    const horizontal = dependencyRope.endX - dependencyRope.startX;
    const distance = Math.hypot(horizontal, dependencyRope.endY - dependencyRope.startY);
    const sag = Math.min(90, Math.max(24, distance * (dependencyRope.attached ? .08 : .18)));
    return `M ${dependencyRope.startX} ${dependencyRope.startY} C ${dependencyRope.startX + horizontal * .3} ${dependencyRope.startY + sag}, ${dependencyRope.startX + horizontal * .7} ${dependencyRope.endY + sag}, ${dependencyRope.endX} ${dependencyRope.endY}`;
  })() : '';

  const createForDay = (day: Date) => onCreateTask({
    columnId: plannedColumn?.id,
    startDate: iso(day),
    dueDate: iso(day),
  });

  const zoomOptions: Array<{ value: TimelineZoom; label: string }> = mobile
    ? [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]
    : [{ value: 'two-weeks', label: '2 weeks' }, { value: 'four-weeks', label: '4 weeks' }, { value: 'year', label: 'Year' }];

  return (
    <main className={`workspace-main timeline-view page-enter ${mobile ? 'mobile-timeline-view' : ''}`}>
      <header className="board-topbar">
        <div className="breadcrumbs"><span>{t('Projects')}</span><b>/</b><strong>{showAllProjects ? t('All projects') : project.name}</strong><b>/</b><span>{t('Timeline')}</span></div>
        <div className="topbar-actions">
          <PreferencesControls />
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> {t('Saving')}</> : saveState === 'synced' && !dirty ? <><Check size={16} /> {t('Saved')}</> : t('Save now')}
          </button>
          <button className="icon-button top-more" onClick={onEditProject}><Ellipsis size={18} /></button>
        </div>
      </header>

      <div className="board-heading-row timeline-heading">
        <div className="board-title">
          <span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}><CalendarRange size={26} /></span>
          <div><h1>{t('Timeline')}</h1><p>{showAllProjects ? t('All projects') : project.name} · {t('Plan work, connect dependencies, and drag tasks onto new dates.')}</p></div>
        </div>
        <div className="timeline-heading-actions">
          <ProjectScopeSelect project={project} value={scope} onChange={setScope} />
          <div className="timeline-zoom-toggle">
            {zoomOptions.map(({ value, label }) => (
              <button key={value} className={zoom === value ? 'active' : ''} onClick={() => { setZoom(value); onAction({ type: 'setTimelineZoom', zoom: value }); }}>{t(label)}</button>
            ))}
          </div>
          <div className="timeline-controls">
            <button className="icon-button" onClick={() => moveActiveWindow(-1)} aria-label={t('Previous range')}><ChevronLeft size={19} /></button>
            <button onClick={() => setActiveWindowStart(startOfWindow(0, zoom))}>{t('Today')}</button>
            <button className="icon-button" onClick={() => moveActiveWindow(1)} aria-label={t('Next range')}><ChevronRight size={19} /></button>
          </div>
          <button type="button" className="timeline-add-task-button" onClick={() => createForDay(rangeStart)}><Plus size={18} /> {t('Add task')}</button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={timelineCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={(event) => {
          const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
          if (sourceId) {
            const targetId = event.over?.data.current?.dependencyTargetId as string | undefined;
            const validTarget = Boolean(targetId && canConnectTasks(sourceId, targetId));
            if (validTarget && event.over) {
              setDependencyRope((current) => current ? {
                ...current,
                endX: direction === 'rtl' ? event.over!.rect.right : event.over!.rect.left,
                endY: event.over!.rect.top + event.over!.rect.height / 2,
                attached: true,
              } : current);
            }
            return;
          }
          const taskId = event.active.data.current?.taskId as string | undefined;
          updateUnscheduledDropPreview(event);
          const directReorderTargetId = taskId ? event.over?.data.current?.reorderTargetId as string | undefined : undefined;
          setReorderTargetId(directReorderTargetId ?? null);
          if (directReorderTargetId) {
            setDragOverDate(null);
            return;
          }
          const overId = event.over?.id.toString();
          setDragOverDate(overId?.startsWith('timeline-day:') ? overId.slice('timeline-day:'.length) : null);
        }}
        onDragCancel={() => { setDraggedTaskId(null); setResizingTaskId(null); setResizePreview(null); resizeRowsRef.current = null; setReorderTargetId(null); setDependencySourceId(null); setDependencyRope(null); setDragOverDate(null); setUnscheduledDropPreview(null); }}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={timelineContentRef}
          className={`timeline-content ${paneResizing ? 'is-pane-resizing' : ''} ${unscheduledCollapsed ? 'unscheduled-collapsed' : ''} ${isFourWeekView ? 'four-week-active' : ''}`}
          style={{ '--timeline-unscheduled-height': `${unscheduledPaneHeight}px` } as CSSProperties}
        >
          <div className="timeline-planner-sticky">
          <div className="timeline-range-label">
            <strong>{rangeStart.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</strong>
            <span>—</span>
            <strong>{rangeEnd.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            <div className="timeline-layout-toggle" role="group" aria-label={t('Timeline layout')}>
              <button className={layoutMode === 'tasks' ? 'active' : ''} aria-pressed={layoutMode === 'tasks'} onClick={() => setLayoutMode('tasks')}><Rows3 size={15} />{t('Task rows')}</button>
              <button className={layoutMode === 'compact' ? 'active' : ''} aria-pressed={layoutMode === 'compact'} onClick={() => setLayoutMode('compact')}><Workflow size={15} />{t('Compact lanes')}</button>
            </div>
            <small><GripVertical size={15} /> {t('Drag a task onto a same-day task to reorder, or onto a date to reschedule')}</small>
          </div>
          {isYearView ? (
            <div className={`timeline-year-board layout-${layoutMode} ${draggedTask?.dueDate ? 'is-dragging' : ''}`}>
              {yearMonthLayouts.map(({ segment, days: monthDays, rows }) => {
                const monthGridColumns = `repeat(${segment.dayCount}, minmax(0, 1fr))`;
                const taskCount = rows.reduce((count, row) => count + row.entries.length, 0);
                return (
                  <section className={`timeline-year-month ${segment.date.getFullYear() === new Date().getFullYear() && segment.date.getMonth() === new Date().getMonth() ? 'current-month' : ''}`} key={segment.id}>
                    <header>
                      <div><span>{segment.date.getFullYear()}</span><strong>{segment.date.toLocaleDateString(locale, { month: 'long' })}</strong></div>
                      <em>{t(taskCount === 1 ? '{{count}} task' : '{{count}} tasks', { count: taskCount })}</em>
                      <button onClick={() => createForDay(segment.date)} title={t('Add task in {{month}}', { month: segment.date.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) })}><Plus size={15} />{t('Add task')}</button>
                    </header>
                    <div className="timeline-year-days" style={{ gridTemplateColumns: monthGridColumns }}>
                      {monthDays.map((day) => <div key={iso(day)} data-date={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'narrow' })}</span><strong>{day.getDate()}</strong></div>)}
                    </div>
                    <div className="timeline-year-stage">
                      <div className="timeline-drop-layer" style={{ gridTemplateColumns: monthGridColumns }}>
                        {monthDays.map((day) => <TimelineDayDropZone key={iso(day)} day={day} active={dragOverDate === iso(day)} today={iso(day) === todayIso} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
                      </div>
                      <div className="timeline-year-rows">
                        {rows.map((row) => (
                          <TimelineDisplayRowView row={row} targeted={row.entries.some((entry) => entry.item.id === reorderTargetId)} key={`${segment.id}:${row.id}`}>
                            <div className="timeline-row-grid" style={{ gridTemplateColumns: monthGridColumns }}>
                              {monthDays.map((day) => <i key={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                              {row.entries.map((entry) => {
                                const taskProject = projectById.get(entry.item.projectId) ?? project;
                                const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                                const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                                const visibleStart = entry.start < rangeStart ? rangeStart : entry.start;
                                const isPrimarySegment = segment.id === `${visibleStart.getFullYear()}-${visibleStart.getMonth()}`;
                                if (!isPrimarySegment) return <TimelineYearContinuation key={entry.item.id} scheduled={entry} projectColor={taskProject.color} columnColor={column?.color} onOpen={() => onOpenTask(entry.item)} />;
                                const canReorderTarget = !orderingSource || (entry.item.id !== orderingSource.id && entry.item.projectId === orderingSource.projectId && tasksStartSameDay(entry.item, orderingSource));
                                return <TimelineTaskBar key={entry.item.id} scheduled={{ ...entry, endClipped: true }} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} connecting={Boolean(dependencySourceId)} canAcceptDependency={Boolean(dependencySourceId && canConnectTasks(dependencySourceId, entry.item.id))} canReorderTarget={canReorderTarget} reorderDropEnabled={Boolean(orderingSource)} onOpen={() => onOpenTask(entry.item)} onUpdateSubtasks={(subtasks) => onAction({ type: 'updateItem', itemId: entry.item.id, changes: { subtasks } })} />;
                              })}
                            </div>
                          </TimelineDisplayRowView>
                        ))}
                        {rows.length === 0 && <div className="timeline-year-empty">{t('No scheduled work in this month')}</div>}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : isFourWeekView ? (
            <div ref={fourWeekBoardRef} className={`timeline-four-week-board layout-${layoutMode} ${draggedTaskId ? 'is-dragging' : ''} ${resizingTaskId ? 'is-resizing' : ''}`}>
              {fourWeekBandLayouts.map((band) => {
                const bandStart = band.days[0];
                const bandEnd = band.days[band.days.length - 1];
                const bandGridColumns = 'repeat(14, minmax(0, 1fr))';
                const bandDependencyLayout = buildFourWeekBandDependencies(band.id, band.rows, fourWeekRowHeights, 14);
                const bandMarkerId = `timeline-four-week-arrow-${band.id.replace(/[^a-z0-9]/gi, '-')}`;
                return (
                  <section
                    className={`timeline-chart layout-${layoutMode} ${draggedTaskId ? 'is-dragging' : ''} ${resizingTaskId ? 'is-resizing' : ''}`}
                    data-day-count="14"
                    aria-label={`${bandStart.toLocaleDateString(locale)} — ${bandEnd.toLocaleDateString(locale)}`}
                    style={{ '--timeline-day-count': 14, '--timeline-day-width': '0px' } as CSSProperties}
                    key={band.id}
                  >
                    <div className="timeline-calendar-header">
                      <div className="timeline-days" style={{ gridTemplateColumns: bandGridColumns }}>
                        {band.days.map((day) => <div key={iso(day)} data-date={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
                      </div>
                    </div>
                    <div className="timeline-stage">
                      <div className="timeline-drop-layer" style={{ gridTemplateColumns: bandGridColumns }}>
                        {band.days.map((day) => <TimelineDayDropZone key={iso(day)} day={day} active={dragOverDate === iso(day)} today={iso(day) === todayIso} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
                      </div>
                      <div
                        className="timeline-rows"
                        data-four-week-band-id={band.id}
                        ref={(node) => {
                          if (node) fourWeekRowsRefs.current.set(band.id, node);
                          else fourWeekRowsRefs.current.delete(band.id);
                        }}
                      >
                        {band.rows.map((row) => (
                          <TimelineDisplayRowView
                            row={row}
                            targeted={row.entries.some((entry) => entry.item.id === reorderTargetId)}
                            key={`${band.id}:${row.id}`}
                          >
                            <div className="timeline-row-grid" style={{ gridTemplateColumns: bandGridColumns }}>
                              {band.days.map((day) => <i key={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                              {row.entries.map((entry) => {
                                const taskProject = projectById.get(entry.item.projectId) ?? project;
                                const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                                const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                                const visibleStart = entry.start < rangeStart ? rangeStart : entry.start;
                                const isPrimaryBand = visibleStart >= bandStart && visibleStart <= bandEnd;
                                if (!isPrimaryBand) return <TimelineYearContinuation key={entry.item.id} scheduled={entry} projectColor={taskProject.color} columnColor={column?.color} continuationLabel="Continues from the previous timeline row" onOpen={() => onOpenTask(entry.item)} />;
                                const canReorderTarget = !orderingSource || (entry.item.id !== orderingSource.id && entry.item.projectId === orderingSource.projectId && tasksStartSameDay(entry.item, orderingSource));
                                return <TimelineTaskBar key={entry.item.id} scheduled={entry} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} resizeFromScale={resizeAnimation?.taskId === entry.item.id ? resizeAnimation.fromScale : undefined} resizePreview={resizePreview?.taskId === entry.item.id ? resizePreview : undefined} dependencyHighlight={highlightedDependency?.sourceId === entry.item.id ? 'source' : highlightedDependency?.targetId === entry.item.id ? 'target' : undefined} connecting={Boolean(dependencySourceId)} canAcceptDependency={Boolean(dependencySourceId && canConnectTasks(dependencySourceId, entry.item.id))} canReorderTarget={canReorderTarget} reorderDropEnabled={Boolean(orderingSource)} onOpen={() => onOpenTask(entry.item)} onUpdateSubtasks={(subtasks) => onAction({ type: 'updateItem', itemId: entry.item.id, changes: { subtasks } })} />;
                              })}
                            </div>
                          </TimelineDisplayRowView>
                        ))}
                        {band.scheduled.length === 0 && <div className="timeline-empty"><CalendarRange size={34} /><strong>{t('No scheduled work in this range')}</strong><span>{t('Drag an unscheduled task onto a day or create a new one.')}</span><button className="button button-primary" onClick={() => createForDay(bandStart)}><Sparkles size={17} /> {t('Schedule a task')}</button></div>}
                        {bandDependencyLayout.connectors.length > 0 && (
                          <svg
                            className={`timeline-dependencies timeline-four-week-dependencies ${highlightedDependencyId ? 'has-highlighted-dependency' : ''}`}
                            viewBox={`0 0 1400 ${bandDependencyLayout.height}`}
                            preserveAspectRatio="none"
                            aria-label={t('Task dependency connectors')}
                          >
                            <defs><marker id={bandMarkerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                            <g transform={direction === 'rtl' ? 'translate(1400 0) scale(-1 1)' : undefined}>
                              {bandDependencyLayout.connectors.map((connector) => {
                                const dependencyLabel = t('{{target}} depends on {{source}}', { source: connector.sourceTitle, target: connector.targetTitle });
                                const cancelLabel = t('Cancel dependency from {{source}} to {{target}}', { source: connector.sourceTitle, target: connector.targetTitle });
                                const cancel = () => cancelDependency(connector.sourceId, connector.targetId);
                                return (
                                  <g
                                    className={`timeline-dependency-connector dependency-tone-${connector.tone} ${highlightedDependencyId === connector.id ? 'dependency-highlighted' : ''}`}
                                    data-route-lane={connector.routeLane}
                                    data-dependency-tone={connector.tone}
                                    key={connector.id}
                                    onPointerEnter={() => setHighlightedDependencyId(connector.id)}
                                    onPointerLeave={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                                    onFocus={() => setHighlightedDependencyId(connector.id)}
                                    onBlur={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                                  >
                                    <path className="dependency-hit-area" d={connector.path} vectorEffect="non-scaling-stroke" />
                                    <circle className="dependency-source-knot" cx={connector.x1} cy={connector.y1} r="4" />
                                    <path className="dependency-visual-path" d={connector.path} markerEnd={`url(#${bandMarkerId})`} vectorEffect="non-scaling-stroke"><title>{dependencyLabel}</title></path>
                                    <g
                                      className="dependency-cancel-control"
                                      transform={`translate(${connector.controlX} ${connector.controlY})`}
                                      role="button"
                                      tabIndex={0}
                                      aria-label={cancelLabel}
                                      onClick={(event) => { event.stopPropagation(); cancel(); }}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault();
                                          cancel();
                                        }
                                      }}
                                    >
                                      <title>{cancelLabel}</title>
                                      <circle r="13" vectorEffect="non-scaling-stroke" />
                                      <line x1="-4" y1="-4" x2="4" y2="4" vectorEffect="non-scaling-stroke" />
                                      <line x1="4" y1="-4" x2="-4" y2="4" vectorEffect="non-scaling-stroke" />
                                    </g>
                                  </g>
                                );
                              })}
                            </g>
                          </svg>
                        )}
                      </div>
                      <div className="timeline-create-row" style={{ gridTemplateColumns: bandGridColumns }}>
                        {band.days.map((day) => <button key={iso(day)} className={weekBandClass(day)} onClick={() => createForDay(day)} title={t('Add task on {{date}}', { date: day.toLocaleDateString(locale) })}><Plus size={16} /><span>{t('Add')}</span></button>)}
                      </div>
                    </div>
                  </section>
                );
              })}
              {fourWeekDependencyLayout && fourWeekDependencyLayout.connectors.length > 0 && (
                <svg
                  className={`timeline-dependencies timeline-four-week-dependencies ${highlightedDependencyId ? 'has-highlighted-dependency' : ''}`}
                  viewBox={`0 0 ${fourWeekDependencyLayout.width} ${fourWeekDependencyLayout.height}`}
                  preserveAspectRatio="none"
                  aria-label={t('Task dependency connectors')}
                >
                  <defs><marker id="timeline-four-week-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                  {fourWeekDependencyLayout.connectors.map((connector) => {
                    const dependencyLabel = t('{{target}} depends on {{source}}', { source: connector.sourceTitle, target: connector.targetTitle });
                    const cancelLabel = t('Cancel dependency from {{source}} to {{target}}', { source: connector.sourceTitle, target: connector.targetTitle });
                    const cancel = () => cancelDependency(connector.sourceId, connector.targetId);
                    return (
                      <g
                        className={`timeline-dependency-connector dependency-tone-${connector.tone} ${highlightedDependencyId === connector.id ? 'dependency-highlighted' : ''}`}
                        data-dependency-tone={connector.tone}
                        key={connector.id}
                        onPointerEnter={() => setHighlightedDependencyId(connector.id)}
                        onPointerLeave={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                        onFocus={() => setHighlightedDependencyId(connector.id)}
                        onBlur={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                      >
                        <path className="dependency-hit-area" d={connector.path} vectorEffect="non-scaling-stroke" />
                        <circle className="dependency-source-knot" cx={connector.x1} cy={connector.y1} r="4" />
                        <path className="dependency-visual-path" d={connector.path} markerEnd="url(#timeline-four-week-arrow)" vectorEffect="non-scaling-stroke"><title>{dependencyLabel}</title></path>
                        <g
                          className="dependency-cancel-control"
                          transform={`translate(${connector.controlX} ${connector.controlY})`}
                          role="button"
                          tabIndex={0}
                          aria-label={cancelLabel}
                          onClick={(event) => { event.stopPropagation(); cancel(); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              cancel();
                            }
                          }}
                        >
                          <title>{cancelLabel}</title>
                          <circle r="13" vectorEffect="non-scaling-stroke" />
                          <line x1="-4" y1="-4" x2="4" y2="4" vectorEffect="non-scaling-stroke" />
                          <line x1="4" y1="-4" x2="-4" y2="4" vectorEffect="non-scaling-stroke" />
                        </g>
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          ) : (
          <div className="timeline-chart-scroll" ref={chartScrollRef}>
          <div className={`timeline-chart layout-${layoutMode} ${draggedTaskId ? 'is-dragging' : ''} ${resizingTaskId ? 'is-resizing' : ''}`} data-day-count={span} style={{ '--timeline-day-count': span, '--timeline-day-width': `${dayWidth}px` } as CSSProperties}>
            <div className="timeline-calendar-header">
              <div className="timeline-days" style={{ gridTemplateColumns }}>
                {days.map((day) => <div key={iso(day)} data-date={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
              </div>
            </div>
            <div className="timeline-stage">
              <div className="timeline-drop-layer" style={{ gridTemplateColumns }}>
                {days.map((day) => <TimelineDayDropZone key={iso(day)} day={day} active={dragOverDate === iso(day)} today={iso(day) === todayIso} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
              </div>
              <div className="timeline-rows" ref={timelineRowsRef}>
                {displayRows.map((row) => {
                  return (
                    <TimelineDisplayRowView
                      row={row}
                      targeted={row.entries.some((entry) => entry.item.id === reorderTargetId)}
                      key={row.id}
                    >
                      <div className="timeline-row-grid" style={{ gridTemplateColumns }}>
                        {days.map((day) => <i key={iso(day)} className={`${weekBandClass(day)} ${iso(day) === todayIso ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                        {row.entries.map((entry) => {
                          const taskProject = projectById.get(entry.item.projectId) ?? project;
                          const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                          const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                          const canReorderTarget = !orderingSource || (entry.item.id !== orderingSource.id && entry.item.projectId === orderingSource.projectId && tasksStartSameDay(entry.item, orderingSource));
                          return <TimelineTaskBar key={entry.item.id} scheduled={entry} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} resizeFromScale={resizeAnimation?.taskId === entry.item.id ? resizeAnimation.fromScale : undefined} resizePreview={resizePreview?.taskId === entry.item.id ? resizePreview : undefined} dependencyHighlight={highlightedDependency?.sourceId === entry.item.id ? 'source' : highlightedDependency?.targetId === entry.item.id ? 'target' : undefined} connecting={Boolean(dependencySourceId)} canAcceptDependency={Boolean(dependencySourceId && canConnectTasks(dependencySourceId, entry.item.id))} canReorderTarget={canReorderTarget} reorderDropEnabled={Boolean(orderingSource)} onOpen={() => onOpenTask(entry.item)} onUpdateSubtasks={(subtasks) => onAction({ type: 'updateItem', itemId: entry.item.id, changes: { subtasks } })} />;
                        })}
                      </div>
                    </TimelineDisplayRowView>
                  );
                })}
                {scheduled.length === 0 && <div className="timeline-empty"><CalendarRange size={34} /><strong>{t('No scheduled work in this range')}</strong><span>{t('Drag an unscheduled task onto a day or create a new one.')}</span><button className="button button-primary" onClick={() => createForDay(rangeStart)}><Sparkles size={17} /> {t('Schedule a task')}</button></div>}
                {dependencyPaths.length > 0 && (
                  <svg className={`timeline-dependencies ${highlightedDependencyId ? 'has-highlighted-dependency' : ''}`} viewBox={`0 0 ${span * 100} ${timelineRowsHeight}`} preserveAspectRatio="none" aria-label={t('Task dependency connectors')}>
                    <defs><marker id="timeline-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                    <g transform={direction === 'rtl' ? `translate(${span * 100} 0) scale(-1 1)` : undefined}>
                      {dependencyPaths.map((connector) => {
                        const dependencyLabel = t('{{target}} depends on {{source}}', { source: connector.sourceTitle, target: connector.targetTitle });
                        const cancelLabel = t('Cancel dependency from {{source}} to {{target}}', { source: connector.sourceTitle, target: connector.targetTitle });
                        const cancel = () => cancelDependency(connector.sourceId, connector.targetId);
                        return (
                          <g
                            className={`timeline-dependency-connector dependency-tone-${connector.tone} ${connector.overlaps ? 'same-day-dependency' : ''} ${highlightedDependencyId === connector.id ? 'dependency-highlighted' : ''}`}
                            data-route-lane={connector.routeLane}
                            data-source-detour-lane={connector.sourceDetourLane}
                            data-dependency-tone={connector.tone}
                            key={connector.id}
                            onPointerEnter={() => setHighlightedDependencyId(connector.id)}
                            onPointerLeave={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                            onFocus={() => setHighlightedDependencyId(connector.id)}
                            onBlur={() => setHighlightedDependencyId((current) => current === connector.id ? null : current)}
                          >
                            <path className="dependency-hit-area" d={connector.path} vectorEffect="non-scaling-stroke" />
                            <circle className="dependency-source-knot" cx={connector.x1} cy={connector.y1} r="4" />
                            <path className="dependency-visual-path" d={connector.path} markerEnd="url(#timeline-arrow)" vectorEffect="non-scaling-stroke"><title>{connector.overlaps ? `${dependencyLabel} — ${t('Same-day dependency')}` : dependencyLabel}</title></path>
                            {connector.inlineDirection && (
                              <g className="dependency-direction-indicator" transform={`translate(${connector.controlX} ${connector.controlY})`} aria-hidden="true">
                                <path d="M -6 -7 L 7 0 L -6 7 Z" vectorEffect="non-scaling-stroke" />
                              </g>
                            )}
                            <g
                              className="dependency-cancel-control"
                              transform={`translate(${connector.controlX} ${connector.controlY})`}
                              role="button"
                              tabIndex={0}
                              aria-label={cancelLabel}
                              onClick={(event) => { event.stopPropagation(); cancel(); }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  cancel();
                                }
                              }}
                            >
                              <title>{cancelLabel}</title>
                              <circle r="13" vectorEffect="non-scaling-stroke" />
                              <line x1="-4" y1="-4" x2="4" y2="4" vectorEffect="non-scaling-stroke" />
                              <line x1="4" y1="-4" x2="-4" y2="4" vectorEffect="non-scaling-stroke" />
                            </g>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                )}
              </div>
              <div className="timeline-create-row" style={{ gridTemplateColumns }}>
                {days.map((day) => <button key={iso(day)} className={weekBandClass(day)} onClick={() => createForDay(day)} title={t('Add task on {{date}}', { date: day.toLocaleDateString(locale) })}><Plus size={16} /><span>{t('Add')}</span></button>)}
              </div>
            </div>
          </div>
          </div>
          )}
          </div>

          <div className={`timeline-pane-divider ${unscheduledCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="timeline-pane-resizer"
              role="separator"
              aria-label={t('Resize timeline and unscheduled work')}
              title={t('Resize timeline and unscheduled work')}
              aria-orientation="horizontal"
              aria-valuemin={MIN_UNSCHEDULED_PANE_HEIGHT}
              aria-valuemax={MAX_UNSCHEDULED_PANE_HEIGHT}
              aria-valuenow={unscheduledPaneHeight}
              aria-disabled={unscheduledCollapsed}
              tabIndex={unscheduledCollapsed ? -1 : 0}
              onPointerDown={(event) => {
                if (unscheduledCollapsed || event.button !== 0) return;
                event.preventDefault();
                setPaneResizing(true);
              }}
              onDoubleClick={() => !unscheduledCollapsed && setUnscheduledPaneHeight(mobile ? MOBILE_UNSCHEDULED_PANE_HEIGHT : DEFAULT_UNSCHEDULED_PANE_HEIGHT)}
              onKeyDown={(event) => {
                if (unscheduledCollapsed) return;
                let nextHeight: number | undefined;
                if (event.key === 'ArrowUp') nextHeight = Math.min(MAX_UNSCHEDULED_PANE_HEIGHT, unscheduledPaneHeight + PANE_RESIZE_STEP);
                if (event.key === 'ArrowDown') nextHeight = Math.max(MIN_UNSCHEDULED_PANE_HEIGHT, unscheduledPaneHeight - PANE_RESIZE_STEP);
                if (event.key === 'Home') nextHeight = MIN_UNSCHEDULED_PANE_HEIGHT;
                if (event.key === 'End') nextHeight = MAX_UNSCHEDULED_PANE_HEIGHT;
                if (nextHeight === undefined) return;
                event.preventDefault();
                setUnscheduledPaneHeight(nextHeight);
              }}
            />
            <button
              type="button"
              className="timeline-pane-toggle"
              aria-label={t(unscheduledCollapsed ? 'Expand unscheduled work' : 'Collapse unscheduled work')}
              title={t(unscheduledCollapsed ? 'Expand unscheduled work' : 'Collapse unscheduled work')}
              aria-controls="timeline-unscheduled-work"
              aria-expanded={!unscheduledCollapsed}
              onClick={() => setUnscheduledCollapsed((current) => !current)}
            >
              {unscheduledCollapsed && <><Clock3 size={14} /><span>{t('Unscheduled work')}</span><b>{unscheduled.length}</b></>}
              <ChevronDown size={16} />
            </button>
          </div>

          {!unscheduledCollapsed && <UnscheduledDropArea canDrop={Boolean(draggedTask?.dueDate)} childDropActive={Boolean(unscheduledDropPreview && draggedTask?.dueDate)}>
            {(isOver) => (
              <>
                <header><Clock3 size={18} /><strong>{t('Unscheduled work')}</strong><span>{unscheduled.length}</span><small className={draggedTask?.dueDate ? 'unschedule-drop-hint' : ''}>{t(isOver ? 'Release to move to unscheduled work' : draggedTask?.dueDate ? 'Drop here to remove the task dates' : 'Drag cards between columns, or drop one on a date to schedule it.')}</small><button type="button" className="timeline-add-task-button" onClick={() => onCreateTask({ columnId: plannedColumn?.id })}><Plus size={15} /> {t('Add task')}</button></header>
                <div className="unscheduled-kanban-scroll">
                  <div
                    className="board-columns unscheduled-kanban-columns"
                    style={{ '--board-column-count': Math.max(unscheduledColumns.length, 1), '--unscheduled-column-count': Math.max(unscheduledColumns.length, 1) } as CSSProperties}
                  >
                    {unscheduledColumns.map((column) => {
                      const columnItems = unscheduledItemsForColumn(column.id);
                      return (
                        <UnscheduledKanbanColumn
                          key={column.id}
                          column={column}
                          items={columnItems}
                          projectById={projectById}
                          showProject={showAllProjects}
                          allowUnscheduledMove={!showAllProjects}
                          collapsedSubtaskItemIds={collapsedSubtaskItemIds}
                          dropPreview={unscheduledDropPreview?.columnId === column.id && draggedTask
                            ? { ...unscheduledDropPreview, item: draggedTask }
                            : undefined}
                          onAction={onAction}
                          onOpenTask={onOpenTask}
                          onCreateTask={onCreateTask}
                        />
                      );
                    })}
                  </div>
                </div>
                {unscheduled.length === 0 && <p className="unscheduled-empty">{t(showAllProjects ? 'Everything in all projects has a place on the timeline.' : 'Everything in this project has a place on the timeline.')}</p>}
              </>
            )}
          </UnscheduledDropArea>}
        </div>
        {dependencyRope && (
          <svg className={`timeline-live-rope ${dependencyRope.attached ? 'attached' : ''}`} aria-hidden="true">
            <defs>
              <linearGradient id="dependency-rope-gradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#887dde" /><stop offset="1" stopColor={dependencyRope.attached ? '#45aa83' : '#6458bd'} /></linearGradient>
              <filter id="dependency-rope-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#3f376f" floodOpacity=".28" /></filter>
            </defs>
            <path className="rope-shadow" d={ropePath} />
            <path className="rope-core" d={ropePath} />
            <path className="rope-highlight" d={ropePath} />
            <circle className="rope-knot rope-knot-start" cx={dependencyRope.startX} cy={dependencyRope.startY} r="7" />
            <circle className="rope-knot rope-knot-end" cx={dependencyRope.endX} cy={dependencyRope.endY} r={dependencyRope.attached ? 9 : 7} />
          </svg>
        )}
        <DragOverlay dropAnimation={{ duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggedTask && !dependencySourceId ? <div className="timeline-drag-overlay">{reorderTargetId ? <ListChecks size={17} /> : <GripVertical size={17} />}<div><strong dir="auto">{draggedTask.title}</strong><span>{t(reorderTargetId ? 'Drop to update the Kanban order' : draggedTask.dueDate ? 'Move while preserving its duration' : 'Drop on a day to schedule')}</span></div></div> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
