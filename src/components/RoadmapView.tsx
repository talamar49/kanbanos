import { CSSProperties, ReactNode, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
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
import type { Project, TaskDraft, WorkItem, WorkspaceDocument } from '../domain/types';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type Horizon = 'Now' | 'Next' | 'Later';
type ProjectProgress = { tasks: number; completed: number; percent: number; upcoming: WorkItem[] };

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
};

function targetDateFor(horizon: Horizon): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + (horizon === 'Now' ? 30 : horizon === 'Next' ? 90 : 180));
  return date.toISOString().slice(0, 10);
}

function horizonFor(project: Project): Horizon {
  if (!project.targetDate) return 'Later';
  const days = (new Date(`${project.targetDate}T12:00:00`).getTime() - Date.now()) / 86_400_000;
  if (days <= 45) return 'Now';
  if (days <= 120) return 'Next';
  return 'Later';
}

function RoadmapColumn({ horizon, count, active, children }: { horizon: Horizon; count: number; active: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: `roadmap-horizon:${horizon}` });
  return (
    <section ref={setNodeRef} className={`roadmap-column roadmap-${horizon.toLowerCase()} ${active || isOver ? 'drop-target' : ''}`}>
      <header>
        <div><i /><h2>{t(horizon)}</h2><span>{count}</span>{(active || isOver) && <em>{t('Drop to move')}</em>}</div>
        <p>{t(horizon === 'Now' ? 'Committed outcomes · next 45 days' : horizon === 'Next' ? 'Planned outcomes · this quarter' : 'Ideas and longer-term opportunities')}</p>
      </header>
      <div className="roadmap-projects">{children}</div>
    </section>
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
}: {
  project: Project;
  progress: ProjectProgress;
  recentlyMoved: boolean;
  onAddTask: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onOpenTask: (item: WorkItem) => void;
}) {
  const { locale, t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `roadmap-project:${project.id}`,
    data: { projectId: project.id },
  });
  return (
    <article
      ref={setNodeRef}
      className={`roadmap-card ${isDragging ? 'dragging' : ''} ${recentlyMoved ? 'just-moved' : ''}`}
      style={{ '--project-color': project.color, transform: CSS.Translate.toString(transform) } as CSSProperties}
    >
      <div className="roadmap-card-top">
        <button className="roadmap-drag-handle" {...listeners} {...attributes} aria-label={t('Move {{name}}', { name: project.name })} title={t('Drag to another horizon')}><GripVertical size={18} /></button>
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

export function RoadmapView({ document, saveState, dirty, onSave, onAddProject, onAddTask, onEditProject, onOpenProject, onOpenTask, onMoveProject }: Props) {
  const { t } = useI18n();
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverHorizon, setDragOverHorizon] = useState<Horizon | null>(null);
  const [recentlyMovedId, setRecentlyMovedId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const projects = document.projects.filter((project) => !project.archived);
  const horizons: Horizon[] = ['Now', 'Next', 'Later'];
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

  const handleDragStart = (event: DragStartEvent) => setDraggedProjectId(event.active.data.current?.projectId as string | undefined ?? null);
  const handleDragEnd = (event: DragEndEvent) => {
    const projectId = event.active.data.current?.projectId as string | undefined;
    const dropId = event.over?.id.toString();
    if (projectId && dropId?.startsWith('roadmap-horizon:')) {
      const horizon = dropId.slice('roadmap-horizon:'.length) as Horizon;
      const project = projects.find((candidate) => candidate.id === projectId);
      if (project && horizonFor(project) !== horizon) {
        onMoveProject(projectId, targetDateFor(horizon));
        setRecentlyMovedId(projectId);
        window.setTimeout(() => setRecentlyMovedId((current) => current === projectId ? null : current), 520);
      }
    }
    setDraggedProjectId(null);
    setDragOverHorizon(null);
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
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={(event) => {
          const id = event.over?.id.toString();
          setDragOverHorizon(id?.startsWith('roadmap-horizon:') ? id.slice('roadmap-horizon:'.length) as Horizon : null);
        }}
        onDragCancel={() => { setDraggedProjectId(null); setDragOverHorizon(null); }}
        onDragEnd={handleDragEnd}
      >
        <div className="roadmap-content">
          <div className="roadmap-horizons">
            {horizons.map((horizon) => {
              const horizonProjects = projects.filter((project) => horizonFor(project) === horizon);
              return (
                <RoadmapColumn key={horizon} horizon={horizon} count={horizonProjects.length} active={dragOverHorizon === horizon}>
                  {horizonProjects.map((project) => (
                    <RoadmapCard
                      key={project.id}
                      project={project}
                      progress={progressFor(project)}
                      recentlyMoved={recentlyMovedId === project.id}
                      onAddTask={() => onAddTask(project.id, project.targetDate ? { dueDate: project.targetDate } : undefined)}
                      onEdit={() => onEditProject(project.id)}
                      onOpen={() => onOpenProject(project.id)}
                      onOpenTask={onOpenTask}
                    />
                  ))}
                  {horizonProjects.length === 0 && <div className="roadmap-empty"><CircleDashed size={29} /><strong>{t('Nothing planned here yet')}</strong><span>{t('Drag an initiative here, or create one with a useful target date.')}</span></div>}
                  <button className="roadmap-add-mission" onClick={() => onAddProject(targetDateFor(horizon))}><Plus size={17} /> {t('Add initiative to {{horizon}}', { horizon: t(horizon) })}</button>
                </RoadmapColumn>
              );
            })}
          </div>
          <div className="roadmap-footnote"><CheckCircle2 size={18} /> {t('Progress is calculated from completed tasks. Drag initiatives between horizons to update target dates automatically.')}</div>
        </div>
        <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggedProject && <div className="roadmap-drag-overlay"><span style={{ color: draggedProject.color, background: `${draggedProject.color}18` }}><Flag size={20} /></span><div><strong>{draggedProject.name}</strong><small>{dragOverHorizon ? t('Move to {{horizon}}', { horizon: t(dragOverHorizon) }) : t('Choose a planning horizon')}</small></div></div>}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
