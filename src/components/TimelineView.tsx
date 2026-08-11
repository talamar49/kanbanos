import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Clock3,
  Ellipsis,
  GripVertical,
  Plus,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { Project, TaskDraft, WorkItem, WorkspaceAction, WorkspaceDocument } from '../domain/types';
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

type ScheduledTask = { item: WorkItem; start: Date; due: Date; startIndex: number; endIndex: number };
type TimelineRowLayout = ScheduledTask & { top: number; height: number; center: number; left: number; right: number };
type DependencyRope = { startX: number; startY: number; endX: number; endY: number; attached: boolean };
type Point = { x: number; y: number };

const DAY = 86_400_000;
const MIN_ROW_HEIGHT = 112;
const iso = (date: Date) => date.toISOString().slice(0, 10);

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

function startOfWindow(offset: number, span: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset + offset * span);
  return date;
}

function dateAt(rangeStart: Date, index: number): Date {
  return new Date(rangeStart.getTime() + index * DAY);
}

const timelineCollisionDetection: CollisionDetection = (args) => {
  const prefix = args.active.data.current?.dependencySourceId ? 'timeline-dependency-target:' : 'timeline-day:';
  return pointerWithin(args).filter((collision) => collision.id.toString().startsWith(prefix));
};

function TimelineDayDropZone({ date, active, today, weekend }: { date: string; active: boolean; today: boolean; weekend: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `timeline-day:${date}` });
  return <div ref={setNodeRef} className={`timeline-day-drop-zone ${today ? 'today' : ''} ${weekend ? 'weekend' : ''} ${active || isOver ? 'active' : ''}`} />;
}

function DependencyHandles({ item, connecting }: { item: WorkItem; connecting: boolean }) {
  const { t } = useI18n();
  const target = useDroppable({
    id: `timeline-dependency-target:${item.id}`,
    data: { dependencyTargetId: item.id },
  });
  const source = useDraggable({
    id: `timeline-dependency-source:${item.id}`,
    data: { dependencySourceId: item.id },
  });
  return (
    <>
      <span
        ref={target.setNodeRef}
        className={`timeline-dependency-handle incoming ${connecting ? 'connection-ready' : ''} ${target.isOver ? 'over' : ''}`}
        title={t('Drop another task here to create a dependency')}
        aria-label={t('Incoming dependency point for {{name}}', { name: item.title })}
      />
      <span
        ref={source.setNodeRef}
        {...source.listeners}
        {...source.attributes}
        className={`timeline-dependency-handle outgoing ${source.isDragging ? 'dragging' : ''}`}
        title={t("Drag to another task's left dot to create a dependency")}
        aria-label={t('Start a dependency from {{name}}', { name: item.title })}
        onClick={(event) => event.stopPropagation()}
      />
    </>
  );
}

function TimelineTaskBar({
  scheduled,
  projectColor,
  projectName,
  columnColor,
  recentlyMoved,
  connecting,
  onOpen,
}: {
  scheduled: ScheduledTask;
  projectColor: string;
  projectName?: string;
  columnColor?: string;
  recentlyMoved: boolean;
  connecting: boolean;
  onOpen: () => void;
}) {
  const { locale, t } = useI18n();
  const { item, startIndex, endIndex } = scheduled;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `timeline-task:${item.id}`,
    data: { taskId: item.id },
  });
  const duration = Math.max(1, endIndex - startIndex + 1);
  const dateLabel = item.startDate && item.startDate !== item.dueDate
    ? `${new Date(`${item.startDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`
    : new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const style = {
    '--timeline-start': startIndex + 1,
    '--timeline-span': duration,
    '--project-color': projectColor,
    '--status-color': columnColor ?? projectColor,
    transform: CSS.Translate.toString(transform),
  } as CSSProperties;

  return (
    <div
      ref={setNodeRef}
      className={`timeline-bar-slot ${duration === 1 ? 'single-day' : ''} ${isDragging ? 'dragging' : ''} ${recentlyMoved ? 'just-moved' : ''}`}
      style={style}
    >
      <DependencyHandles item={item} connecting={connecting} />
      <button
        className="timeline-bar"
        {...listeners}
        {...attributes}
        onClick={() => !isDragging && onOpen()}
        title={`${item.title} · ${projectName ? `${projectName} · ` : ''}${dateLabel} · ${t('Drag to reschedule')}`}
      >
        <span className="timeline-bar-copy"><strong>{item.title}</strong><small><i />{projectName ? `${projectName} · ${dateLabel}` : dateLabel}</small></span>
        {(item.dependencyIds?.length ?? 0) > 0 && <span className="timeline-dependency-count" title={t('{{count}} dependencies', { count: item.dependencyIds?.length ?? 0 })}><Workflow size={13} />{item.dependencyIds?.length}</span>}
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

export function TimelineView({ document, project, saveState, dirty, onOpenTask, onCreateTask, onAction, onSave, onEditProject }: Props) {
  const { direction, locale, t } = useI18n();
  const [windowOffset, setWindowOffset] = useState(0);
  const [span, setSpan] = useState<14 | 28>(14);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dependencySourceId, setDependencySourceId] = useState<string | null>(null);
  const [dependencyTargetId, setDependencyTargetId] = useState<string | null>(null);
  const [dependencyRope, setDependencyRope] = useState<DependencyRope | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<ProjectScope>('current');
  const timelineRowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setScope('current'), [project.id]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rangeStart = startOfWindow(windowOffset, span);
  const days = Array.from({ length: span }, (_, index) => dateAt(rangeStart, index));
  const rangeEnd = days[days.length - 1];
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
  const scheduled = useMemo<ScheduledTask[]>(() => projectItems
    .filter((item) => item.dueDate)
    .map((item) => {
      const due = new Date(`${item.dueDate}T12:00:00`);
      const start = new Date(`${item.startDate ?? item.dueDate}T12:00:00`);
      return {
        item,
        start,
        due,
        startIndex: Math.max(0, Math.floor((start.getTime() - rangeStart.getTime()) / DAY)),
        endIndex: Math.min(span - 1, Math.floor((due.getTime() - rangeStart.getTime()) / DAY)),
      };
    })
    .filter(({ start, due }) => due >= rangeStart && start <= rangeEnd)
    .sort((left, right) => left.start.getTime() - right.start.getTime() || left.due.getTime() - right.due.getTime()), [projectItems, rangeEnd, rangeStart, span]);
  const unscheduled = projectItems.filter((item) => !item.dueDate);
  const draggedTask = draggedTaskId ? document.items[draggedTaskId] : undefined;
  const scheduledMeasureKey = scheduled.map(({ item, startIndex, endIndex }) => `${item.id}:${startIndex}:${endIndex}:${item.title}`).join('|');

  useLayoutEffect(() => {
    const container = timelineRowsRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > .timeline-row[data-task-id]'));
    const measure = () => {
      const next = Object.fromEntries(rows.map((row) => [row.dataset.taskId!, Math.max(MIN_ROW_HEIGHT, Math.ceil(row.getBoundingClientRect().height))]));
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
  }, [direction, scheduledMeasureKey, span]);

  const rowLayouts = useMemo<TimelineRowLayout[]>(() => {
    let top = 0;
    return scheduled.map((entry) => {
      const height = rowHeights[entry.item.id] ?? MIN_ROW_HEIGHT;
      const layout = {
        ...entry,
        top,
        height,
        center: top + height / 2,
        left: entry.startIndex * 100 + 5,
        right: (entry.endIndex + 1) * 100 - 5,
      };
      top += height;
      return layout;
    });
  }, [rowHeights, scheduled]);
  const timelineRowsHeight = rowLayouts.reduce((total, row) => total + row.height, 0);

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
      duration = Math.max(0, Math.round((previousDue.getTime() - previousStart.getTime()) / DAY));
    }
    onAction({
      type: 'updateItem',
      itemId: task.id,
      changes: { startDate: date, dueDate: iso(dateAt(nextStart, duration)) },
    });
    setRecentlyMovedId(task.id);
    window.setTimeout(() => setRecentlyMovedId((current) => current === task.id ? null : current), 520);
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
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    if (sourceId) {
      const rect = event.active.rect.current.initial;
      const pointer = event.activatorEvent as PointerEvent;
      const startX = rect ? rect.left + rect.width / 2 : pointer.clientX;
      const startY = rect ? rect.top + rect.height / 2 : pointer.clientY;
      setDependencySourceId(sourceId);
      setDependencyRope({ startX, startY, endX: startX, endY: startY, attached: false });
      setDraggedTaskId(null);
      return;
    }
    setDraggedTaskId(event.active.data.current?.taskId as string | undefined ?? null);
  };
  const handleDragMove = (event: DragMoveEvent) => {
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
      endX: targetRect ? targetRect.left + targetRect.width / 2 : startX + event.delta.x,
      endY: targetRect ? targetRect.top + targetRect.height / 2 : startY + event.delta.y,
      attached: Boolean(targetRect),
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
    const targetId = event.over?.data.current?.dependencyTargetId as string | undefined;
    const taskId = event.active.data.current?.taskId as string | undefined;
    const dropId = event.over?.id.toString();
    if (sourceId && targetId && canConnectTasks(sourceId, targetId)) {
      connectTasks(sourceId, targetId);
      setDependencyRope((current) => current ? { ...current, attached: true } : current);
      window.setTimeout(() => setDependencyRope(null), 260);
    } else {
      setDependencyRope(null);
    }
    if (taskId && dropId?.startsWith('timeline-day:')) scheduleTask(taskId, dropId.slice('timeline-day:'.length));
    setDraggedTaskId(null);
    setDependencySourceId(null);
    setDependencyTargetId(null);
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
          <div className="timeline-zoom-toggle"><button className={span === 14 ? 'active' : ''} onClick={() => { setSpan(14); setWindowOffset(0); }}>{t('2 weeks')}</button><button className={span === 28 ? 'active' : ''} onClick={() => { setSpan(28); setWindowOffset(0); }}>{t('4 weeks')}</button></div>
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
          const sourceId = event.active.data.current?.dependencySourceId as string | undefined;
          if (sourceId) {
            const targetId = event.over?.data.current?.dependencyTargetId as string | undefined;
            const validTarget = Boolean(targetId && canConnectTasks(sourceId, targetId));
            setDependencyTargetId(validTarget ? targetId! : null);
            if (validTarget && event.over) {
              setDependencyRope((current) => current ? {
                ...current,
                endX: event.over!.rect.left + event.over!.rect.width / 2,
                endY: event.over!.rect.top + event.over!.rect.height / 2,
                attached: true,
              } : current);
            }
            return;
          }
          setDragOverDate(event.over?.id.toString().replace('timeline-day:', '') ?? null);
        }}
        onDragCancel={() => { setDraggedTaskId(null); setDependencySourceId(null); setDependencyTargetId(null); setDependencyRope(null); setDragOverDate(null); }}
        onDragEnd={handleDragEnd}
      >
        <div className="timeline-content">
          <div className="timeline-range-label">
            <strong>{rangeStart.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</strong>
            <span>—</span>
            <strong>{rangeEnd.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            <small><GripVertical size={15} /> {t('Drag scheduled or unscheduled work to any day')}</small>
          </div>
          <div className={`timeline-chart ${draggedTaskId ? 'is-dragging' : ''}`} style={{ '--timeline-day-count': span, '--timeline-day-width': `${span === 14 ? 72 : 58}px` } as CSSProperties}>
            <div className="timeline-calendar-header">
              <div className="timeline-days" style={{ gridTemplateColumns: `repeat(${span}, minmax(${span === 14 ? 72 : 58}px, 1fr))` }}>
                {days.map((day) => <div key={iso(day)} className={`${iso(day) === iso(new Date()) ? 'today' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`}><span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
              </div>
            </div>
            <div className="timeline-stage">
              <div className="timeline-drop-layer" style={{ gridTemplateColumns: `repeat(${span}, minmax(${span === 14 ? 72 : 58}px, 1fr))` }}>
                {days.map((day) => <TimelineDayDropZone key={iso(day)} date={iso(day)} active={dragOverDate === iso(day)} today={iso(day) === iso(new Date())} weekend={day.getDay() === 0 || day.getDay() === 6} />)}
              </div>
              <div className="timeline-rows" ref={timelineRowsRef}>
                {scheduled.map((entry) => {
                  const taskProject = projectById.get(entry.item.projectId) ?? project;
                  const taskColumns = document.modules.kanban.projects[entry.item.projectId]?.columns ?? [];
                  const column = taskColumns.find((value) => value.id === entry.item.moduleData.kanban.columnId);
                  return (
                    <div className="timeline-row" data-task-id={entry.item.id} key={entry.item.id}>
                      <div className="timeline-row-grid" style={{ gridTemplateColumns: `repeat(${span}, minmax(${span === 14 ? 72 : 58}px, 1fr))` }}>
                        {days.map((day) => <i key={iso(day)} className={`${iso(day) === iso(new Date()) ? 'today-line' : ''} ${day.getDay() === 0 || day.getDay() === 6 ? 'weekend' : ''}`} />)}
                        <TimelineTaskBar scheduled={entry} projectColor={taskProject.color} projectName={showAllProjects ? taskProject.name : undefined} columnColor={column?.color} recentlyMoved={recentlyMovedId === entry.item.id} connecting={Boolean(dependencySourceId)} onOpen={() => onOpenTask(entry.item)} />
                      </div>
                    </div>
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
              <div className="timeline-create-row" style={{ gridTemplateColumns: `repeat(${span}, minmax(${span === 14 ? 72 : 58}px, 1fr))` }}>
                {days.map((day) => <button key={iso(day)} onClick={() => createForDay(day)} title={t('Add task on {{date}}', { date: day.toLocaleDateString(locale) })}><Plus size={16} /><span>{t('Add')}</span></button>)}
              </div>
            </div>
          </div>

          <section className="unscheduled-tasks">
            <header><Clock3 size={18} /><strong>{t('Unscheduled work')}</strong><span>{unscheduled.length}</span><small>{t('Drag a task directly onto the timeline')}</small><button onClick={() => onCreateTask({ columnId: plannedColumn?.id })}><Plus size={15} /> {t('Add task')}</button></header>
            {unscheduled.length ? <div>{unscheduled.map((item) => {
              const taskProject = projectById.get(item.projectId) ?? project;
              const taskColumns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
              const status = t(taskColumns.find((column) => column.id === item.moduleData.kanban.columnId)?.title ?? 'Task');
              return <UnscheduledTask key={item.id} item={item} status={showAllProjects ? `${taskProject.name} · ${status}` : status} onOpen={() => onOpenTask(item)} />;
            })}</div> : <p className="unscheduled-empty">{t(showAllProjects ? 'Everything in all projects has a place on the timeline.' : 'Everything in this project has a place on the timeline.')}</p>}
          </section>
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
          {draggedTask && !dependencySourceId ? <div className="timeline-drag-overlay"><GripVertical size={17} /><div><strong>{draggedTask.title}</strong><span>{t(draggedTask.dueDate ? 'Move while preserving its duration' : 'Drop on a day to schedule')}</span></div></div> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
