import { CSSProperties, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
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
import type { Project, TaskDraft, TimelineLayout, WorkItem, WorkspaceAction, WorkspaceDocument } from '../domain/types';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';
import { ProjectScopeSelect, type ProjectScope } from './ProjectScopeSelect';

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
};

type ScheduledTask = { item: WorkItem; start: Date; due: Date; startIndex: number; endIndex: number; endClipped: boolean };
type TimelineDisplayRow = { id: string; entries: ScheduledTask[]; compact?: boolean };
type TimelineRowLayout = ScheduledTask & { rowId: string; top: number; height: number; center: number; left: number; right: number };
type DependencyRope = { startX: number; startY: number; endX: number; endY: number; attached: boolean };
type ResizePreview = { taskId: string; dueDate: string; deltaPx: number };
type TimelineZoom = 'two-weeks' | 'four-weeks' | 'year';
type TimelineMonthSegment = { id: string; date: Date; startIndex: number; dayCount: number };
type TimelineYearMonthLayout = { segment: TimelineMonthSegment; days: Date[]; rows: TimelineDisplayRow[] };
type Point = { x: number; y: number };

const DAY = 86_400_000;
const MIN_ROW_HEIGHT = 112;
const YEAR_ROW_HEIGHT = 72;
const UNSCHEDULED_DROP_ID = 'timeline-unscheduled-area';
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
  const span = zoom === 'two-weeks' ? 14 : 28;
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset + offset * span);
  return date;
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
  if (zoom !== 'year') return zoom === 'two-weeks' ? 14 : 28;
  return calendarDayDistance(new Date(rangeStart.getFullYear() + 1, 0, 1, 12), rangeStart);
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

const timelineCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (args.active.data.current?.dependencySourceId) {
    return collisions.filter((collision) => collision.id.toString().startsWith('timeline-dependency-target:'));
  }
  if (args.active.data.current?.reorderTaskId) {
    return collisions.filter((collision) => collision.id.toString().startsWith('timeline-reorder-target:'));
  }
  if (args.active.data.current?.taskId) {
    const reorderTargets = collisions.filter((collision) => collision.id.toString().startsWith('timeline-reorder-target:'));
    if (reorderTargets.length > 0) return reorderTargets;
  }
  return collisions.filter((collision) => {
    const id = collision.id.toString();
    return id.startsWith('timeline-day:') || id === UNSCHEDULED_DROP_ID;
  });
};

function TimelineDayDropZone({ date, active, today, weekend }: { date: string; active: boolean; today: boolean; weekend: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-day:${date}` });
  return <div ref={setNodeRef} className={`timeline-day-drop-zone ${today ? 'today' : ''} ${weekend ? 'weekend' : ''} ${active || isOver ? 'active' : ''}`} />;
}

function TimelineDisplayRowView({ row, reordering, targeted, children }: { row: TimelineDisplayRow; reordering: boolean; targeted: boolean; children: ReactNode }) {
  return (
    <div
      className={`timeline-row ${row.compact ? 'compact-row' : ''} ${reordering ? 'reordering' : ''} ${targeted ? 'reorder-over' : ''}`}
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
  connecting,
  canAcceptDependency,
  canReorderTarget,
  reorderDropEnabled,
  reorderMode,
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
  connecting: boolean;
  canAcceptDependency: boolean;
  canReorderTarget: boolean;
  reorderDropEnabled: boolean;
  reorderMode: boolean;
  onOpen: () => void;
  onUpdateSubtasks: (subtasks: WorkItem['subtasks']) => void;
}) {
  const { locale, t } = useI18n();
  const { item, startIndex, endIndex, endClipped } = scheduled;
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-task:${item.id}`,
    data: reorderMode ? { reorderTaskId: item.id } : { taskId: item.id },
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
      className={`timeline-bar-slot ${duration === 1 ? 'single-day' : ''} ${addingSubtask ? 'adding-subtask' : ''} ${subtasksExpanded && !reorderMode ? 'subtasks-expanded' : ''} ${isDragging ? 'dragging' : ''} ${recentlyMoved ? 'just-moved' : ''} ${resizeFromScale ? 'just-resized' : ''} ${resizePreview ? 'live-resizing' : ''} ${canAcceptDependency ? 'dependency-target-ready' : ''} ${dependencyTarget.isOver ? 'dependency-target-over' : ''} ${reorderTarget.isOver ? 'reorder-target-over' : ''} ${reorderMode ? 'reorder-mode' : ''}`}
      style={style}
    >
      {!reorderMode && <DependencyHandles item={item} connecting={connecting && canAcceptDependency} targetOver={dependencyTarget.isOver} />}
      {!reorderMode && !endClipped && !addingSubtask && <TimelineEndResizeHandle item={item} />}
      <button
        className="timeline-bar"
        {...listeners}
        {...attributes}
        onClick={() => !isDragging && onOpen()}
        title={`${item.title} · ${projectName ? `${projectName} · ` : ''}${dateLabel} · ${t(reorderMode ? 'Drag to reorder' : 'Drag to reschedule or reorder')}`}
      >
        <span className="timeline-bar-copy"><strong>{item.title}</strong><small><i />{projectName ? `${projectName} · ${dateLabel}` : dateLabel}</small></span>
        {(item.dependencyIds?.length ?? 0) > 0 && <span className="timeline-dependency-count" title={t('{{count}} dependencies', { count: item.dependencyIds?.length ?? 0 })}><Workflow size={13} />{item.dependencyIds?.length}</span>}
      </button>
      {canAcceptDependency && <span className="timeline-dependency-card-prompt"><Workflow size={16} />{t(dependencyTarget.isOver ? 'Release to create dependency' : 'Drop here to create dependency')}</span>}
      {!reorderMode && !addingSubtask && (
        <button
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
          {item.subtasks.length > 0 && <span className="timeline-subtask-trigger-count">{completedSubtasks}/{item.subtasks.length}</span>}
        </button>
      )}
      {!reorderMode && (subtasksExpanded || addingSubtask) && (
        <section className="timeline-subtask-panel" aria-label={t('Subtasks')} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
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
                  <em>{subtask.title}</em>
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
        </section>
      )}
    </div>
  );
}

function TimelineYearContinuation({ scheduled, projectColor, columnColor, onOpen }: { scheduled: ScheduledTask; projectColor: string; columnColor?: string; onOpen: () => void }) {
  const { locale, t } = useI18n();
  const { item, startIndex, endIndex } = scheduled;
  const duration = Math.max(1, endIndex - startIndex + 1);
  const dateLabel = item.startDate && item.startDate !== item.dueDate
    ? `${parseLocalDate(item.startDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${parseLocalDate(item.dueDate!).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`
    : parseLocalDate(item.dueDate!).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return (
    <div
      className={`timeline-bar-slot year-continuation-slot ${duration === 1 ? 'single-day' : ''}`}
      style={{
        '--timeline-start': startIndex + 1,
        '--timeline-span': duration,
        '--project-color': projectColor,
        '--status-color': columnColor ?? projectColor,
      } as CSSProperties}
    >
      <button className="timeline-bar" onClick={onOpen} title={`${item.title} · ${dateLabel} · ${t('Continues from another month')}`}>
        <span className="timeline-bar-copy"><strong>{item.title}</strong><small><i />{dateLabel}</small></span>
      </button>
    </div>
  );
}

function UnscheduledTask({ item, status, onOpen }: { item: WorkItem; status: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-unscheduled:${item.id}`,
    data: { taskId: item.id },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'dragging' : ''}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => !isDragging && onOpen()}
    >
      <GripVertical className="unscheduled-grip" size={15} />
      <span>{item.title}</span><small>{status}</small><ChevronRight size={16} />
    </button>
  );
}

function UnscheduledDropArea({ canDrop, children }: { canDrop: boolean; children: (isOver: boolean) => ReactNode }) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED_DROP_ID });
  const scheduledTaskIsOver = canDrop && isOver;
  return (
    <section
      ref={setNodeRef}
      className={`unscheduled-tasks ${canDrop ? 'accepts-scheduled-drop' : ''} ${scheduledTaskIsOver ? 'drop-active' : ''}`}
      aria-label={t('Unscheduled work drop area')}
    >
      {children(scheduledTaskIsOver)}
    </section>
  );
}

export function TimelineView({ document, project, saveState, dirty, onOpenTask, onCreateTask, onAction, onSave, onEditProject }: Props) {
  const { direction, locale, t } = useI18n();
  const [windowOffset, setWindowOffset] = useState(0);
  const [zoom, setZoom] = useState<TimelineZoom>('two-weeks');
  const layoutMode = document.preferences.timelineLayout ?? 'tasks';
  const setLayoutMode = (layout: TimelineLayout) => onAction({ type: 'setTimelineLayout', layout });
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [resizingTaskId, setResizingTaskId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderingTaskId, setReorderingTaskId] = useState<string | null>(null);
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
  const [dependencySourceId, setDependencySourceId] = useState<string | null>(null);
  const [dependencyRope, setDependencyRope] = useState<DependencyRope | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const [resizeAnimation, setResizeAnimation] = useState<{ taskId: string; fromScale: number } | null>(null);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<ProjectScope>('current');
  const timelineRowsRef = useRef<HTMLDivElement>(null);
  const resizeStartWidthRef = useRef(0);

  useEffect(() => { setScope('current'); setReorderMode(false); }, [project.id]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rangeStart = startOfWindow(windowOffset, zoom);
  const span = spanForWindow(rangeStart, zoom);
  const days = Array.from({ length: span }, (_, index) => dateAt(rangeStart, index));
  const rangeEnd = days[days.length - 1];
  const isYearView = zoom === 'year';
  const dayWidth = zoom === 'two-weeks' ? 72 : zoom === 'four-weeks' ? 58 : 8;
  const minimumRowHeight = isYearView ? YEAR_ROW_HEIGHT : MIN_ROW_HEIGHT;
  const gridTemplateColumns = `repeat(${span}, minmax(${dayWidth}px, 1fr))`;
  const monthSegments = isYearView ? monthSegmentsForDays(days) : [];
  const todayIso = iso(new Date());
  const showAllProjects = scope === 'all';
  const activeColumns = document.modules.kanban.projects[project.id]?.columns ?? [];
  const plannedColumn = activeColumns.find((column) => column.id === 'planned') ?? activeColumns[0];
  const scopedProjects = useMemo(() => showAllProjects
    ? [project, ...document.projects.filter((candidate) => candidate.id !== project.id && !candidate.archived)]
    : [project], [document.projects, project, showAllProjects]);
  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((candidate) => candidate.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(document.projects.map((candidate) => [candidate.id, candidate])), [document.projects]);
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
  const unscheduled = projectItems.filter((item) => !item.dueDate);
  const draggedTask = draggedTaskId ? document.items[draggedTaskId] : undefined;
  const reorderingTask = reorderingTaskId ? document.items[reorderingTaskId] : undefined;
  const orderingSource = reorderingTask ?? (draggedTask?.dueDate ? draggedTask : undefined);
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
    const chartRight = span * 100;
    return rowLayouts.flatMap((target) => (target.item.dependencyIds ?? []).flatMap((dependencyId, dependencyIndex) => {
      const source = rowById.get(dependencyId);
      if (!source) return [];
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
          overlaps: false,
        }];
      }
      if (sameTrack) {
        return [{
          id: `${dependencyId}-${target.item.id}`,
          sourceId: dependencyId,
          targetId: target.item.id,
          sourceTitle: source.item.title,
          targetTitle: target.item.title,
          path: `M ${x1} ${y1} L ${x2} ${y2}`,
          x1,
          y1,
          controlX: (x1 + x2) / 2,
          controlY: y1,
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
        overlaps,
      }];
    }));
  }, [rowLayouts, span]);

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

  const handleDragStart = (event: DragStartEvent) => {
    setReorderingTaskId(null);
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
    const reorderTaskId = event.active.data.current?.reorderTaskId as string | undefined;
    if (reorderTaskId) {
      setReorderingTaskId(reorderTaskId);
      setReorderTargetId(reorderTaskId);
      setDraggedTaskId(null);
      setResizingTaskId(null);
      return;
    }
    const resizeTaskId = event.active.data.current?.resizeTaskId as string | undefined;
    if (resizeTaskId) {
      const task = document.items[resizeTaskId];
      const slot = Array.from(timelineRowsRef.current?.querySelectorAll<HTMLElement>('[data-timeline-task-id]') ?? [])
        .find((candidate) => candidate.dataset.timelineTaskId === resizeTaskId);
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
      const gridWidth = timelineRowsRef.current?.getBoundingClientRect().width ?? span * dayWidth;
      const minimumWidth = isYearView ? Math.max(6, gridWidth / span - 2) : Math.max(40, gridWidth / span - 12);
      const logicalDelta = direction === 'rtl' ? -event.delta.x : event.delta.x;
      setResizePreview({ taskId: resizeTaskId, dueDate, deltaPx: Math.max(minimumWidth - resizeStartWidthRef.current, logicalDelta) });
      return;
    }
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    const initial = event.active.rect.current.initial;
    if (!sourceId || !initial) return;
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
    const reorderTaskId = event.active.data.current?.reorderTaskId as string | undefined;
    const reorderOverId = event.over?.data.current?.reorderTargetId as string | undefined;
    const dropId = event.over?.id.toString();
    if (sourceId && targetId && canConnectTasks(sourceId, targetId)) {
      connectTasks(sourceId, targetId);
      setDependencyRope((current) => current ? { ...current, attached: true } : current);
      window.setTimeout(() => setDependencyRope(null), 260);
    } else {
      setDependencyRope(null);
    }
    if (reorderTaskId && reorderOverId) {
      reorderTimelineTasks(reorderTaskId, reorderOverId);
    } else if (taskId && reorderOverId) {
      reorderTimelineTasks(taskId, reorderOverId);
    } else if (resizeTaskId && dropId?.startsWith('timeline-day:')) {
      resizeTaskEnd(resizeTaskId, dropId.slice('timeline-day:'.length));
    } else if (taskId && dropId?.startsWith('timeline-day:')) {
      scheduleTask(taskId, dropId.slice('timeline-day:'.length));
    } else if (taskId && dropId === UNSCHEDULED_DROP_ID) {
      unscheduleTask(taskId);
    }
    setDraggedTaskId(null);
    setResizingTaskId(null);
    setResizePreview(null);
    setReorderingTaskId(null);
    setReorderTargetId(null);
    setDependencySourceId(null);
    setDragOverDate(null);
  };

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

  return (
    <main className="workspace-main timeline-view page-enter">
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
            <button className={zoom === 'two-weeks' ? 'active' : ''} onClick={() => { setZoom('two-weeks'); setWindowOffset(0); }}>{t('2 weeks')}</button>
            <button className={zoom === 'four-weeks' ? 'active' : ''} onClick={() => { setZoom('four-weeks'); setWindowOffset(0); }}>{t('4 weeks')}</button>
            <button className={zoom === 'year' ? 'active' : ''} onClick={() => { setZoom('year'); setWindowOffset(0); }}>{t('Year')}</button>
          </div>
          <div className="timeline-controls">
            <button className="icon-button" onClick={() => setWindowOffset((value) => value - 1)} aria-label={t('Previous range')}><ChevronLeft size={19} /></button>
            <button onClick={() => setWindowOffset(0)}>{t('Today')}</button>
            <button className="icon-button" onClick={() => setWindowOffset((value) => value + 1)} aria-label={t('Next range')}><ChevronRight size={19} /></button>
          </div>
          <button className="button button-primary" onClick={() => createForDay(rangeStart)}><Plus size={18} /> {t('Add task')}</button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={timelineCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={(event) => {
          const reorderTaskId = event.active.data.current?.reorderTaskId as string | undefined;
          if (reorderTaskId) {
            setReorderTargetId(event.over?.data.current?.reorderTargetId as string | undefined ?? null);
            return;
          }
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
          const directReorderTargetId = taskId ? event.over?.data.current?.reorderTargetId as string | undefined : undefined;
          setReorderTargetId(directReorderTargetId ?? null);
          if (directReorderTargetId) {
            setDragOverDate(null);
            return;
          }
          const overId = event.over?.id.toString();
          setDragOverDate(overId?.startsWith('timeline-day:') ? overId.slice('timeline-day:'.length) : null);
        }}
        onDragCancel={() => { setDraggedTaskId(null); setResizingTaskId(null); setResizePreview(null); setReorderingTaskId(null); setReorderTargetId(null); setDependencySourceId(null); setDependencyRope(null); setDragOverDate(null); }}
        onDragEnd={handleDragEnd}
      >
        <div className="timeline-content">
          <div className="timeline-range-label">
            <strong>{rangeStart.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</strong>
            <span>—</span>
            <strong>{rangeEnd.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            <div className="timeline-layout-toggle" role="group" aria-label={t('Timeline layout')}>
              <button className={layoutMode === 'tasks' ? 'active' : ''} aria-pressed={layoutMode === 'tasks'} onClick={() => setLayoutMode('tasks')}><Rows3 size={15} />{t('Task rows')}</button>
              <button className={layoutMode === 'compact' ? 'active' : ''} aria-pressed={layoutMode === 'compact'} onClick={() => setLayoutMode('compact')}><Workflow size={15} />{t('Compact lanes')}</button>
            </div>
            <small><GripVertical size={15} /> {t(reorderMode ? 'Drag same-day cards vertically to sync their Kanban order' : layoutMode === 'compact' ? 'Overlapping tasks follow their Kanban order' : 'Drag work between the timeline and unscheduled area')}</small>
            <button className={`timeline-reorder-toggle ${reorderMode ? 'active' : ''}`} aria-pressed={reorderMode} onClick={() => setReorderMode((current) => !current)}><ListChecks size={15} /> {t(reorderMode ? 'Done ordering' : 'Reorder tasks')}</button>
          </div>
          {isYearView ? (
            <div className={`timeline-year-board layout-${layoutMode} ${reorderMode ? 'is-reorder-mode' : ''}`}>
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
                      {monthDays.map((day) => <div key={iso(day)} className={`${iso(day) === todayIso ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'narrow' })}</span><strong>{day.getDate()}</strong></div>)}
                    </div>
                    <div className="timeline-year-stage">
                      <div className="timeline-drop-layer" style={{ gridTemplateColumns: monthGridColumns }}>
                        {monthDays.map((day) => <TimelineDayDropZone key={iso(day)} date={iso(day)} active={dragOverDate === iso(day)} today={iso(day) === todayIso} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
                      </div>
                      <div className="timeline-year-rows">
                        {rows.map((row) => (
                          <TimelineDisplayRowView row={row} reordering={row.entries.some((entry) => entry.item.id === reorderingTaskId)} targeted={row.entries.some((entry) => entry.item.id === reorderTargetId)} key={`${segment.id}:${row.id}`}>
                            <div className="timeline-row-grid" style={{ gridTemplateColumns: monthGridColumns }}>
                              {monthDays.map((day) => <i key={iso(day)} className={`${iso(day) === todayIso ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                              {row.entries.map((entry) => {
                                const taskProject = projectById.get(entry.item.projectId) ?? project;
                                const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                                const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                                const visibleStart = entry.start < rangeStart ? rangeStart : entry.start;
                                const isPrimarySegment = segment.id === `${visibleStart.getFullYear()}-${visibleStart.getMonth()}`;
                                if (!isPrimarySegment) return <TimelineYearContinuation key={entry.item.id} scheduled={entry} projectColor={taskProject.color} columnColor={column?.color} onOpen={() => onOpenTask(entry.item)} />;
                                const canReorderTarget = !orderingSource || (entry.item.id !== orderingSource.id && entry.item.projectId === orderingSource.projectId && tasksStartSameDay(entry.item, orderingSource));
                                return <TimelineTaskBar key={entry.item.id} scheduled={{ ...entry, endClipped: true }} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} connecting={Boolean(dependencySourceId)} canAcceptDependency={Boolean(dependencySourceId && canConnectTasks(dependencySourceId, entry.item.id))} canReorderTarget={canReorderTarget} reorderDropEnabled={Boolean(reorderMode || orderingSource)} reorderMode={reorderMode} onOpen={() => onOpenTask(entry.item)} onUpdateSubtasks={(subtasks) => onAction({ type: 'updateItem', itemId: entry.item.id, changes: { subtasks } })} />;
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
          ) : (
          <div className={`timeline-chart layout-${layoutMode} ${draggedTaskId ? 'is-dragging' : ''} ${resizingTaskId ? 'is-resizing' : ''} ${reorderMode ? 'is-reorder-mode' : ''}`} style={{ '--timeline-day-count': span, '--timeline-day-width': `${dayWidth}px` } as CSSProperties}>
            <div className="timeline-calendar-header">
              <div className="timeline-days" style={{ gridTemplateColumns }}>
                {days.map((day) => <div key={iso(day)} className={`${iso(day) === todayIso ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
              </div>
            </div>
            <div className="timeline-stage">
              <div className="timeline-drop-layer" style={{ gridTemplateColumns }}>
                {days.map((day) => <TimelineDayDropZone key={iso(day)} date={iso(day)} active={dragOverDate === iso(day)} today={iso(day) === todayIso} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
              </div>
              <div className="timeline-rows" ref={timelineRowsRef}>
                {displayRows.map((row) => {
                  return (
                    <TimelineDisplayRowView
                      row={row}
                      reordering={row.entries.some((entry) => entry.item.id === reorderingTaskId)}
                      targeted={row.entries.some((entry) => entry.item.id === reorderTargetId)}
                      key={row.id}
                    >
                      <div className="timeline-row-grid" style={{ gridTemplateColumns }}>
                        {days.map((day) => <i key={iso(day)} className={`${iso(day) === todayIso ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                        {row.entries.map((entry) => {
                          const taskProject = projectById.get(entry.item.projectId) ?? project;
                          const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                          const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                          const canReorderTarget = !orderingSource || (entry.item.id !== orderingSource.id && entry.item.projectId === orderingSource.projectId && tasksStartSameDay(entry.item, orderingSource));
                          return <TimelineTaskBar key={entry.item.id} scheduled={entry} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} resizeFromScale={resizeAnimation?.taskId === entry.item.id ? resizeAnimation.fromScale : undefined} resizePreview={resizePreview?.taskId === entry.item.id ? resizePreview : undefined} connecting={Boolean(dependencySourceId)} canAcceptDependency={Boolean(dependencySourceId && canConnectTasks(dependencySourceId, entry.item.id))} canReorderTarget={canReorderTarget} reorderDropEnabled={Boolean(reorderMode || orderingSource)} reorderMode={reorderMode} onOpen={() => onOpenTask(entry.item)} onUpdateSubtasks={(subtasks) => onAction({ type: 'updateItem', itemId: entry.item.id, changes: { subtasks } })} />;
                        })}
                      </div>
                    </TimelineDisplayRowView>
                  );
                })}
                {scheduled.length === 0 && <div className="timeline-empty"><CalendarRange size={34} /><strong>{t('No scheduled work in this range')}</strong><span>{t('Drag an unscheduled task onto a day or create a new one.')}</span><button className="button button-primary" onClick={() => createForDay(rangeStart)}><Sparkles size={17} /> {t('Schedule a task')}</button></div>}
                {dependencyPaths.length > 0 && (
                  <svg className="timeline-dependencies" viewBox={`0 0 ${span * 100} ${timelineRowsHeight}`} preserveAspectRatio="none" aria-label={t('Task dependency connectors')}>
                    <defs><marker id="timeline-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
                    <g transform={direction === 'rtl' ? `translate(${span * 100} 0) scale(-1 1)` : undefined}>
                      {dependencyPaths.map((connector) => {
                        const cancelLabel = t('Cancel dependency from {{source}} to {{target}}', { source: connector.sourceTitle, target: connector.targetTitle });
                        const cancel = () => cancelDependency(connector.sourceId, connector.targetId);
                        return (
                          <g className={`timeline-dependency-connector ${connector.overlaps ? 'same-day-dependency' : ''}`} key={connector.id}>
                            <path className="dependency-hit-area" d={connector.path} vectorEffect="non-scaling-stroke" />
                            <circle className="dependency-source-knot" cx={connector.x1} cy={connector.y1} r="4" />
                            <path className="dependency-visual-path" d={connector.path} markerEnd="url(#timeline-arrow)" vectorEffect="non-scaling-stroke"><title>{t(connector.overlaps ? 'Same-day dependency' : 'Task dependency')}</title></path>
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
                {days.map((day) => <button key={iso(day)} onClick={() => createForDay(day)} title={t('Add task on {{date}}', { date: day.toLocaleDateString(locale) })}><Plus size={16} /><span>{t('Add')}</span></button>)}
              </div>
            </div>
          </div>
          )}

          <UnscheduledDropArea canDrop={Boolean(draggedTask?.dueDate)}>
            {(isOver) => (
              <>
                <header><Clock3 size={18} /><strong>{t('Unscheduled work')}</strong><span>{unscheduled.length}</span><small className={draggedTask?.dueDate ? 'unschedule-drop-hint' : ''}>{t(isOver ? 'Release to move to unscheduled work' : draggedTask?.dueDate ? 'Drop here to remove the task dates' : 'Drag a task directly onto the timeline')}</small><button onClick={() => onCreateTask({ columnId: plannedColumn?.id })}><Plus size={15} /> {t('Add task')}</button></header>
                {unscheduled.length ? <div>{unscheduled.map((item) => {
                  const taskProject = projectById.get(item.projectId) ?? project;
                  const taskColumns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
                  const status = t(taskColumns.find((column) => column.id === item.moduleData.kanban.columnId)?.title ?? 'Task');
                  return <UnscheduledTask key={item.id} item={item} status={showAllProjects ? `${taskProject.name} · ${status}` : status} onOpen={() => onOpenTask(item)} />;
                })}</div> : <p className="unscheduled-empty">{t(showAllProjects ? 'Everything in all projects has a place on the timeline.' : 'Everything in this project has a place on the timeline.')}</p>}
              </>
            )}
          </UnscheduledDropArea>
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
          {reorderingTask ? <div className="timeline-drag-overlay reorder-overlay"><ListChecks size={17} /><div><strong>{reorderingTask.title}</strong><span>{t('Drop to update the Kanban order')}</span></div></div> : draggedTask && !dependencySourceId ? <div className="timeline-drag-overlay">{reorderTargetId ? <ListChecks size={17} /> : <GripVertical size={17} />}<div><strong>{draggedTask.title}</strong><span>{t(reorderTargetId ? 'Drop to update the Kanban order' : draggedTask.dueDate ? 'Move while preserving its duration' : 'Drop on a day to schedule')}</span></div></div> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
