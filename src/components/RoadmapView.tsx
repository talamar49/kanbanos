import { CSSProperties, Fragment, ReactNode, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare2,
  CheckCircle2,
  CircleDashed,
  Ellipsis,
  Flag,
  GripVertical,
  ListChecks,
  Plus,
  Route,
} from 'lucide-react';
import type { Project, RoadmapHorizon, TaskDraft, WorkItem, WorkspaceDocument } from '../domain/types';
import { ROADMAP_HORIZONS } from '../domain/workspace';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type ProjectProgress = { tasks: number; completed: number; percent: number; upcoming: WorkItem[] };

const roadmapCollisionDetection: CollisionDetection = (args) => args.pointerCoordinates
  ? pointerWithin(args)
  : closestCenter(args);

type Props = {
  document: WorkspaceDocument;
  saveState: SaveState;
  dirty: boolean;
  onSave: () => void;
  onAddProject: (targetDate?: string) => void;
  onAddTask: (projectId: string, preset?: Partial<TaskDraft>) => void;
  onEditProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenTask: (item: WorkItem) => void;
  onMoveProject: (projectId: string, targetDate: string) => void;
  onReorderHorizons: (horizons: RoadmapHorizon[]) => void;
};

function targetDateFor(horizon: RoadmapHorizon): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + (horizon === 'Now' ? 30 : horizon === 'Next' ? 90 : 180));
  return date.toISOString().slice(0, 10);
}

function horizonFor(project: Project): RoadmapHorizon {
  if (!project.targetDate) return 'Later';
  const days = (new Date(`${project.targetDate}T12:00:00`).getTime() - Date.now()) / 86_400_000;
  if (days <= 45) return 'Now';
  if (days <= 120) return 'Next';
  return 'Later';
}

function RoadmapColumn({ horizon, count, dropActive, children }: { horizon: RoadmapHorizon; count: number; dropActive: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `roadmap-horizon:${horizon}`,
    data: { type: 'roadmap-column', horizon },
  });
  return (
    <section
      ref={setNodeRef}
      className={`roadmap-column roadmap-${horizon.toLowerCase()} ${dropActive ? 'drop-target' : ''} ${isDragging ? 'column-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header>
        <div>
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="roadmap-column-drag-handle"
            {...attributes}
            {...listeners}
            aria-label={t('Reorder {{name}} column', { name: t(horizon) })}
            title={t('Drag column to reorder')}
          ><GripVertical size={18} /></button>
          <i /><h2>{t(horizon)}</h2><span>{count}</span>{dropActive && <em>{t('Drop to move')}</em>}
        </div>
        <p>{t(horizon === 'Now' ? 'Committed outcomes · next 45 days' : horizon === 'Next' ? 'Planned outcomes · this quarter' : 'Ideas and longer-term opportunities')}</p>
      </header>
      <div className="roadmap-projects">{children}</div>
    </section>
  );
}

function RoadmapDropPreview({ project }: { project: Project }) {
  const { t } = useI18n();
  return (
    <div className="roadmap-drop-preview" style={{ '--project-color': project.color } as CSSProperties} aria-hidden="true">
      <span style={{ background: `${project.color}18`, color: project.color }}><Flag size={19} /></span>
      <div><strong>{project.name}</strong><small>{t('Drop to move')}</small></div>
    </div>
  );
}

function RoadmapCard({
  project,
  progress,
  recentlyMoved,
  onAddTask,
  onEdit,
  onOpen,
  onOpenTask,
  onMoveHorizon,
}: {
  project: Project;
  progress: ProjectProgress;
  recentlyMoved: boolean;
  onAddTask: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onOpenTask: (item: WorkItem) => void;
  onMoveHorizon: (horizon: RoadmapHorizon) => void;
}) {
  const { locale, t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `roadmap-project:${project.id}`,
    data: { type: 'roadmap-project', projectId: project.id },
  });
  return (
    <article
      ref={setNodeRef}
      className={`roadmap-card ${isDragging ? 'dragging' : ''} ${recentlyMoved ? 'just-moved' : ''}`}
      style={{ '--project-color': project.color, transform: CSS.Translate.toString(transform) } as CSSProperties}
      aria-label={t('Move {{name}}', { name: project.name })}
      {...attributes}
      {...listeners}
    >
      <div className="roadmap-card-top">
        <span className="roadmap-project-mark" style={{ background: `${project.color}18`, color: project.color }}><Flag size={19} /></span>
        <div><h3>{project.name}</h3><p>{project.description || t('A focused project with room to grow.')}</p></div>
        <button className="icon-button" onClick={onEdit} aria-label={t('Edit {{name}}', { name: project.name })}><Ellipsis size={18} /></button>
      </div>

      <div className="roadmap-progress-label"><span>{t('{{completed}} of {{total}} tasks complete', { completed: progress.completed, total: progress.tasks })}</span><strong>{progress.percent}%</strong></div>
      <div className="roadmap-progress"><span style={{ width: `${progress.percent}%`, background: project.color }} /></div>

      <div className="roadmap-task-preview">
        <div><span><ListChecks size={15} /> {t('Next work')}</span>{progress.tasks > progress.completed && <small>{t('{{count}} open', { count: progress.tasks - progress.completed })}</small>}</div>
        {progress.upcoming.length > 0 ? progress.upcoming.map((task) => (
          <button key={task.id} onClick={() => onOpenTask(task)} title={task.title}>
            <i style={{ background: project.color }} /><span>{task.title}</span>
            {task.dueDate && <time>{new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</time>}
          </button>
        )) : <p>{t(progress.tasks ? 'All project tasks are complete.' : 'No tasks yet—add the first concrete step.')}</p>}
      </div>

      <label className="mobile-roadmap-horizon">
        <span>{t('Planning horizon')}</span>
        <select value={horizonFor(project)} onChange={(event) => onMoveHorizon(event.target.value as RoadmapHorizon)}>
          {ROADMAP_HORIZONS.map((horizon) => <option key={horizon} value={horizon}>{t(horizon)}</option>)}
        </select>
      </label>

      <footer>
        <span className={project.targetDate && new Date(`${project.targetDate}T23:59:59`).getTime() < Date.now() ? 'overdue' : ''}>
          <CalendarDays size={16} />
          {project.targetDate ? new Date(`${project.targetDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : t('No target date')}
        </span>
        <div className="roadmap-card-actions"><button onClick={onAddTask}><CheckSquare2 size={15} /> {t('Add task')}</button><button onClick={onOpen}>{t('Open')} <ArrowRight size={16} /></button></div>
      </footer>
    </article>
  );
}

export function RoadmapView({ document, saveState, dirty, onSave, onAddProject, onAddTask, onEditProject, onOpenProject, onOpenTask, onMoveProject, onReorderHorizons }: Props) {
  const { t } = useI18n();
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [draggedHorizon, setDraggedHorizon] = useState<RoadmapHorizon | null>(null);
  const [dragOverHorizon, setDragOverHorizon] = useState<RoadmapHorizon | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projects = document.projects.filter((project) => !project.archived);
  const horizons = document.preferences.roadmapHorizonOrder ?? ROADMAP_HORIZONS;
  const draggedProject = projects.find((project) => project.id === draggedProjectId);

  const progressFor = (project: Project): ProjectProgress => {
    const tasks = Object.values(document.items).filter((item) => item.projectId === project.id);
    const columns = document.modules.kanban.projects[project.id]?.columns ?? [];
    const done = columns.find((column) => column.id === 'done' || /done|complete/i.test(column.title));
    const completed = done ? tasks.filter((item) => item.moduleData.kanban.columnId === done.id) : [];
    const upcoming = tasks
      .filter((item) => !done || item.moduleData.kanban.columnId !== done.id)
      .sort((left, right) => (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31') || left.moduleData.kanban.rank - right.moduleData.kanban.rank)
      .slice(0, 2);
    return { tasks: tasks.length, completed: completed.length, percent: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0, upcoming };
  };

  const clearDragState = () => {
    setDraggedProjectId(null);
    setDraggedHorizon(null);
    setDragOverHorizon(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string; projectId?: string; horizon?: RoadmapHorizon } | undefined;
    if (data?.type === 'roadmap-column') {
      setDraggedHorizon(data.horizon ?? null);
      setDraggedProjectId(null);
      return;
    }
    const project = projects.find((candidate) => candidate.id === data?.projectId);
    setDraggedProjectId(data?.projectId ?? null);
    setDraggedHorizon(null);
    setDragOverHorizon(project ? horizonFor(project) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const data = event.active.data.current as { type?: string; projectId?: string; horizon?: RoadmapHorizon } | undefined;
    const dropId = event.over?.id.toString();

    if (data?.type === 'roadmap-column') {
      const overHorizon = event.over?.data.current?.horizon as RoadmapHorizon | undefined
        ?? (dropId?.startsWith('roadmap-horizon:') ? dropId.slice('roadmap-horizon:'.length) as RoadmapHorizon : undefined);
      const oldIndex = horizons.indexOf(data.horizon as RoadmapHorizon);
      const newIndex = overHorizon ? horizons.indexOf(overHorizon) : -1;
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        onReorderHorizons(arrayMove(horizons, oldIndex, newIndex));
      }
      clearDragState();
      return;
    }

    const projectId = data?.projectId;
    if (projectId && dropId?.startsWith('roadmap-horizon:')) {
      const horizon = dropId.slice('roadmap-horizon:'.length) as RoadmapHorizon;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (project && horizonFor(project) !== horizon) {
        onMoveProject(projectId, targetDateFor(horizon));
        setRecentlyMovedId(projectId);
        window.setTimeout(() => setRecentlyMovedId((current) => current === projectId ? null : current), 520);
      }
    }
    clearDragState();
  };
  const openTasks = Object.values(document.items).filter((item) => {
    const columns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
    const done = columns.find((column) => column.id === 'done' || /done|complete/i.test(column.title));
    return !done || item.moduleData.kanban.columnId !== done.id;
  }).length;

  return (
    <main className="workspace-main roadmap-view page-enter">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>{t('Workspace')}</span><b>/</b><strong>{t('Roadmap')}</strong></div>
        <div className="topbar-actions">
          <PreferencesControls />
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> {t('Saving')}</> : saveState === 'synced' && !dirty ? <><Check size={16} /> {t('Saved')}</> : t('Save now')}
          </button>
          <button className="button button-primary" onClick={() => onAddProject()}><Plus size={18} /> {t('New initiative')}</button>
        </div>
      </header>

      <div className="roadmap-heading">
        <div className="board-title">
          <span className="project-icon roadmap-icon"><Route size={27} /></span>
          <div><h1>{t('Roadmap')}</h1><p>{t('Prioritize outcomes across Now, Next, and Later. Drag an initiative to change its horizon.')}</p></div>
        </div>
        <div className="roadmap-summary">
          <span>{t('{{count}} active initiatives', { count: projects.length })}</span>
          <span>{t('{{count}} open tasks', { count: openTasks })}</span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={roadmapCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={(event) => {
          if (event.active.data.current?.type !== 'roadmap-project') {
            setDragOverHorizon(null);
            return;
          }
          const id = event.over?.id.toString();
          setDragOverHorizon(id?.startsWith('roadmap-horizon:') ? id.slice('roadmap-horizon:'.length) as RoadmapHorizon : null);
        }}
        onDragCancel={clearDragState}
        onDragEnd={handleDragEnd}
      >
        <div className="roadmap-content">
          <div className="roadmap-horizons">
            <SortableContext items={horizons.map((horizon) => `roadmap-horizon:${horizon}`)} strategy={horizontalListSortingStrategy}>
              {horizons.map((horizon) => {
                const horizonProjects = projects.filter((project) => horizonFor(project) === horizon);
                const draggedProjectIndex = draggedProject ? projects.findIndex((project) => project.id === draggedProject.id) : -1;
                const previewIndex = draggedProject && dragOverHorizon === horizon
                  ? horizonProjects.filter((project) => project.id !== draggedProject.id && projects.findIndex((candidate) => candidate.id === project.id) < draggedProjectIndex).length
                  : -1;
                return (
                  <RoadmapColumn key={horizon} horizon={horizon} count={horizonProjects.length} dropActive={dragOverHorizon === horizon}>
                    {horizonProjects.map((project, index) => (
                      <Fragment key={project.id}>
                        {draggedProject && previewIndex === index && <RoadmapDropPreview project={draggedProject} />}
                        <RoadmapCard
                          project={project}
                          progress={progressFor(project)}
                          recentlyMoved={recentlyMovedId === project.id}
                          onAddTask={() => onAddTask(project.id, project.targetDate ? { dueDate: project.targetDate } : undefined)}
                          onEdit={() => onEditProject(project.id)}
                          onOpen={() => onOpenProject(project.id)}
                          onOpenTask={onOpenTask}
                          onMoveHorizon={(horizon) => onMoveProject(project.id, targetDateFor(horizon))}
                        />
                      </Fragment>
                    ))}
                    {draggedProject && previewIndex === horizonProjects.length && <RoadmapDropPreview project={draggedProject} />}
                    {horizonProjects.length === 0 && previewIndex < 0 && <div className="roadmap-empty"><CircleDashed size={29} /><strong>{t('Nothing planned here yet')}</strong><span>{t('Drag an initiative here, or create one with a useful target date.')}</span></div>}
                    <button className="roadmap-add-mission" onClick={() => onAddProject(targetDateFor(horizon))}><Plus size={17} /> {t('Add initiative to {{horizon}}', { horizon: t(horizon) })}</button>
                  </RoadmapColumn>
                );
              })}
            </SortableContext>
          </div>
          <div className="roadmap-footnote"><CheckCircle2 size={18} /> {t('Progress is calculated from completed tasks. Drag initiatives between horizons to update target dates automatically.')}</div>
        </div>
        <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggedProject ? <div className="roadmap-drag-overlay"><span style={{ color: draggedProject.color, background: `${draggedProject.color}18` }}><Flag size={20} /></span><div><strong>{draggedProject.name}</strong><small>{dragOverHorizon ? t('Move to {{horizon}}', { horizon: t(dragOverHorizon) }) : t('Choose a planning horizon')}</small></div></div> : draggedHorizon ? <div className="roadmap-column-drag-overlay"><GripVertical size={20} /><div><strong>{t(draggedHorizon)}</strong><small>{t('Drop to reorder columns')}</small></div></div> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
