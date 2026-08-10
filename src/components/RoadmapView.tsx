import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDashed,
  Ellipsis,
  Flag,
  Plus,
  Route,
} from 'lucide-react';
import type { Project, WorkspaceDocument } from '../domain/types';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type Horizon = 'Now' | 'Next' | 'Later';

type Props = {
  document: WorkspaceDocument;
  saveState: SaveState;
  dirty: boolean;
  onSave: () => void;
  onAddProject: () => void;
  onEditProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
};

function horizonFor(project: Project): Horizon {
  if (!project.targetDate) return 'Later';
  const days = (new Date(`${project.targetDate}T12:00:00`).getTime() - Date.now()) / 86_400_000;
  if (days <= 45) return 'Now';
  if (days <= 120) return 'Next';
  return 'Later';
}

export function RoadmapView({ document, saveState, dirty, onSave, onAddProject, onEditProject, onOpenProject }: Props) {
  const projects = document.projects.filter((project) => !project.archived);
  const horizons: Horizon[] = ['Now', 'Next', 'Later'];

  const progressFor = (project: Project) => {
    const tasks = Object.values(document.items).filter((item) => item.projectId === project.id);
    const columns = document.modules.kanban.projects[project.id]?.columns ?? [];
    const done = columns.find((column) => column.id === 'done' || /done|complete/i.test(column.title));
    const completed = done ? tasks.filter((item) => item.moduleData.kanban.columnId === done.id).length : 0;
    return { tasks: tasks.length, completed, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
  };

  return (
    <main className="workspace-main roadmap-view page-enter">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>Roadmap</strong></div>
        <div className="topbar-actions">
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> Saving</> : saveState === 'synced' && !dirty ? <><Check size={16} /> Saved</> : 'Save now'}
          </button>
          <button className="button button-primary" onClick={onAddProject}><Plus size={16} /> New project</button>
        </div>
      </header>

      <div className="roadmap-heading">
        <div className="board-title">
          <span className="project-icon roadmap-icon"><Route size={23} /></span>
          <div><h1>Roadmap</h1><p>A human view of what matters now, what comes next, and what can wait.</p></div>
        </div>
        <div className="roadmap-summary">
          <span><strong>{projects.length}</strong> active projects</span>
          <span><strong>{projects.filter((project) => project.targetDate).length}</strong> with target dates</span>
        </div>
      </div>

      <div className="roadmap-content">
        <div className="roadmap-horizons">
          {horizons.map((horizon) => {
            const horizonProjects = projects.filter((project) => horizonFor(project) === horizon);
            return (
              <section className={`roadmap-column roadmap-${horizon.toLowerCase()}`} key={horizon}>
                <header>
                  <div><i /><h2>{horizon}</h2><span>{horizonProjects.length}</span></div>
                  <p>{horizon === 'Now' ? 'Focus for the next 45 days' : horizon === 'Next' ? 'Coming in the next quarter' : 'Ideas and longer-term work'}</p>
                </header>
                <div className="roadmap-projects">
                  {horizonProjects.map((project) => {
                    const progress = progressFor(project);
                    return (
                      <article className="roadmap-card" key={project.id}>
                        <div className="roadmap-card-top">
                          <span className="roadmap-project-mark" style={{ background: `${project.color}18`, color: project.color }}><Flag size={17} /></span>
                          <div><h3>{project.name}</h3><p>{project.description || 'A focused project with room to grow.'}</p></div>
                          <button className="icon-button" onClick={() => onEditProject(project.id)}><Ellipsis size={17} /></button>
                        </div>
                        <div className="roadmap-progress-label"><span>{progress.completed} of {progress.tasks} tasks complete</span><strong>{progress.percent}%</strong></div>
                        <div className="roadmap-progress"><span style={{ width: `${progress.percent}%`, background: project.color }} /></div>
                        <footer>
                          <span className={project.targetDate && new Date(`${project.targetDate}T23:59:59`).getTime() < Date.now() ? 'overdue' : ''}>
                            <CalendarDays size={14} />
                            {project.targetDate ? new Date(`${project.targetDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No target date'}
                          </span>
                          <button onClick={() => onOpenProject(project.id)}>Open project <ArrowRight size={14} /></button>
                        </footer>
                      </article>
                    );
                  })}
                  {horizonProjects.length === 0 && <div className="roadmap-empty"><CircleDashed size={24} /><strong>Nothing here yet</strong><span>{horizon === 'Now' ? 'Set a project target date within 45 days.' : 'Projects will appear here based on their target date.'}</span></div>}
                </div>
              </section>
            );
          })}
        </div>
        <div className="roadmap-footnote"><CheckCircle2 size={16} /> Project progress updates automatically when tasks move to Done.</div>
      </div>
    </main>
  );
}
