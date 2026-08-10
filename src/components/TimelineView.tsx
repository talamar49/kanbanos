import { CSSProperties, useMemo, useState } from 'react';
import {
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Ellipsis,
} from 'lucide-react';
import type { Project, WorkItem, WorkspaceDocument } from '../domain/types';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onOpenTask: (item: WorkItem) => void;
  onSave: () => void;
  onEditProject: () => void;
};

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

function startOfWindow(offset: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset + offset * 14);
  return date;
}

export function TimelineView({ document, project, saveState, dirty, onOpenTask, onSave, onEditProject }: Props) {
  const [windowOffset, setWindowOffset] = useState(0);
  const rangeStart = startOfWindow(windowOffset);
  const days = Array.from({ length: 14 }, (_, index) => new Date(rangeStart.getTime() + index * DAY));
  const rangeEnd = days[days.length - 1];
  const projectItems = Object.values(document.items).filter((item) => item.projectId === project.id);
  const scheduled = useMemo(() => projectItems
    .filter((item) => item.dueDate)
    .map((item) => {
      const due = new Date(`${item.dueDate}T12:00:00`);
      const start = new Date(`${item.startDate ?? item.dueDate}T12:00:00`);
      return { item, start, due };
    })
    .filter(({ start, due }) => due >= rangeStart && start <= rangeEnd)
    .sort((left, right) => left.start.getTime() - right.start.getTime()), [projectItems, rangeEnd, rangeStart]);
  const unscheduled = projectItems.filter((item) => !item.dueDate);

  return (
    <main className="workspace-main timeline-view page-enter">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project.name}</strong><b>/</b><span>Timeline</span></div>
        <div className="topbar-actions">
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> Saving</> : saveState === 'synced' && !dirty ? <><Check size={16} /> Saved</> : 'Save now'}
          </button>
          <button className="icon-button top-more" onClick={onEditProject}><Ellipsis size={18} /></button>
        </div>
      </header>

      <div className="board-heading-row timeline-heading">
        <div className="board-title">
          <span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}><CalendarRange size={22} /></span>
          <div><h1>Timeline</h1><p>{project.name} · Plan work across time without losing the task details.</p></div>
        </div>
        <div className="timeline-controls">
          <button className="icon-button" onClick={() => setWindowOffset((value) => value - 1)}><ChevronLeft size={17} /></button>
          <button onClick={() => setWindowOffset(0)}>Today</button>
          <button className="icon-button" onClick={() => setWindowOffset((value) => value + 1)}><ChevronRight size={17} /></button>
        </div>
      </div>

      <div className="timeline-content">
        <div className="timeline-range-label">
          <strong>{rangeStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</strong>
          <span>—</span>
          <strong>{rangeEnd.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
        </div>
        <div className="timeline-chart">
          <div className="timeline-calendar-header">
            <div className="timeline-task-label">Task</div>
            <div className="timeline-days">
              {days.map((day) => <div key={iso(day)} className={iso(day) === iso(new Date()) ? 'today' : ''}><span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}
            </div>
          </div>
          <div className="timeline-rows">
            {scheduled.map(({ item, start, due }) => {
              const rawStart = Math.floor((start.getTime() - rangeStart.getTime()) / DAY);
              const rawEnd = Math.floor((due.getTime() - rangeStart.getTime()) / DAY);
              const startIndex = Math.max(0, rawStart);
              const endIndex = Math.min(13, rawEnd);
              const column = document.modules.kanban.projects[project.id]?.columns.find((value) => value.id === item.moduleData.kanban.columnId);
              return (
                <div className="timeline-row" key={item.id} onClick={() => onOpenTask(item)}>
                  <div className="timeline-task-label"><i style={{ background: column?.color }} /><span>{item.title}</span>{item.assignee && <small>{item.assignee}</small>}</div>
                  <div className="timeline-row-grid">
                    {days.map((day) => <i key={iso(day)} className={iso(day) === iso(new Date()) ? 'today-line' : ''} />)}
                    <button
                      className="timeline-bar"
                      style={{ '--timeline-start': startIndex + 1, '--timeline-span': Math.max(1, endIndex - startIndex + 1), '--project-color': project.color } as CSSProperties}
                      title={`${item.title}: ${item.startDate ?? item.dueDate} to ${item.dueDate}`}
                    ><span>{item.title}</span></button>
                  </div>
                </div>
              );
            })}
            {scheduled.length === 0 && <div className="timeline-empty"><CalendarRange size={28} /><strong>No scheduled tasks in these two weeks</strong><span>Add start and due dates from a task, or move to another date range.</span></div>}
          </div>
        </div>

        {unscheduled.length > 0 && (
          <section className="unscheduled-tasks">
            <header><Clock3 size={16} /><strong>Unscheduled</strong><span>{unscheduled.length}</span><small>Open a task to add dates</small></header>
            <div>{unscheduled.map((item) => <button key={item.id} onClick={() => onOpenTask(item)}><span>{item.title}</span><small>{item.moduleData.kanban.columnId}</small><ChevronRight size={14} /></button>)}</div>
          </section>
        )}
      </div>
    </main>
  );
}
