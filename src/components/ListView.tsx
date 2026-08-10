import { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Columns3,
  Ellipsis,
  Flag,
  List,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import type { Project, WorkItem, WorkspaceAction, WorkspaceDocument, WorkspaceView } from '../domain/types';
import { createWorkItem, PRIORITY_META } from '../domain/workspace';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
  onSave: () => void;
  onChangeView: (view: WorkspaceView) => void;
  onEditProject: () => void;
};

export function ListView({ document, project, saveState, dirty, onAction, onOpenTask, onSave, onChangeView, onEditProject }: Props) {
  const [search, setSearch] = useState('');
  const columns = document.modules.kanban.projects[project.id]?.columns ?? [];
  const doneColumn = columns.find((column) => column.id === 'done' || /done|complete/i.test(column.title));
  const firstColumn = columns[0];
  const columnMap = new Map(columns.map((column) => [column.id, column]));
  const items = useMemo(() => Object.values(document.items)
    .filter((item) => item.projectId === project.id)
    .filter((item) => !search.trim() || [item.title, item.description, ...item.labels].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((left, right) => {
      const columnDifference = columns.findIndex((column) => column.id === left.moduleData.kanban.columnId)
        - columns.findIndex((column) => column.id === right.moduleData.kanban.columnId);
      return columnDifference || left.moduleData.kanban.rank - right.moduleData.kanban.rank;
    }), [columns, document.items, project.id, search]);

  const addTask = () => {
    if (!firstColumn) return;
    const item = createWorkItem(project.id, firstColumn.id, 'Untitled task', Date.now());
    onAction({ type: 'addItem', item });
    onOpenTask(item);
  };

  const toggleComplete = (item: WorkItem) => {
    if (!doneColumn || !firstColumn) return;
    const isDone = item.moduleData.kanban.columnId === doneColumn.id;
    onAction({ type: 'moveItem', itemId: item.id, columnId: isDone ? firstColumn.id : doneColumn.id, index: Number.MAX_SAFE_INTEGER });
  };

  return (
    <main className="workspace-main list-view page-enter">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project.name}</strong><b>/</b><span>List</span></div>
        <div className="topbar-actions">
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> Saving</> : saveState === 'synced' && !dirty ? <><Check size={16} /> Saved</> : 'Save now'}
          </button>
          <button className="icon-button top-more" onClick={onEditProject}><Ellipsis size={18} /></button>
        </div>
      </header>

      <div className="board-heading-row">
        <div className="board-title">
          <span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}><List size={22} /></span>
          <div><h1>{project.name}</h1><p>Scan, sort, and edit every task in one place.</p></div>
        </div>
        <div className="board-view-toggle">
          <button onClick={() => onChangeView('board')}><Columns3 size={15} /> Board</button>
          <button className="active"><List size={15} /> List</button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className={`search-box ${search ? 'has-value' : ''}`}><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" />{search && <button onClick={() => setSearch('')}><X size={14} /></button>}</div>
        <span>{items.length} {items.length === 1 ? 'task' : 'tasks'}</span>
        <button className="button button-primary" onClick={addTask}><Plus size={16} /> Add task</button>
      </div>

      <div className="list-table-wrap">
        <div className="task-table">
          <div className="task-table-header">
            <span>Task</span><span>Status</span><span><Flag size={13} /> Priority</span><span><Calendar size={13} /> Due</span><span><UserRound size={13} /> Owner</span><span />
          </div>
          {items.map((item) => {
            const column = columnMap.get(item.moduleData.kanban.columnId);
            const completed = item.subtasks.filter((subtask) => subtask.completed).length;
            const isDone = doneColumn?.id === item.moduleData.kanban.columnId;
            return (
              <div className="task-table-row" key={item.id} onClick={() => onOpenTask(item)}>
                <div className="list-task-title">
                  <button className={isDone ? 'done' : ''} onClick={(event) => { event.stopPropagation(); toggleComplete(item); }}>{isDone ? <CheckCircle2 size={18} /> : <Circle size={18} />}</button>
                  <div><strong className={isDone ? 'completed' : ''}>{item.title}</strong>{item.subtasks.length > 0 && <small>{completed}/{item.subtasks.length} subtasks complete</small>}</div>
                </div>
                <div><span className="list-status"><i style={{ background: column?.color }} />{column?.title ?? 'Unknown'}</span></div>
                <div>{item.priority === 'none' ? <span className="table-muted">—</span> : <span className="list-priority" style={{ color: PRIORITY_META[item.priority].color }}><i />{PRIORITY_META[item.priority].label}</span>}</div>
                <div>{item.dueDate ? new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : <span className="table-muted">No date</span>}</div>
                <div>{item.assignee ? <span className="list-assignee">{item.assignee}</span> : <span className="table-muted">Unassigned</span>}</div>
                <button className="icon-button"><Ellipsis size={16} /></button>
              </div>
            );
          })}
          {items.length === 0 && <div className="list-empty"><List size={28} /><strong>{search ? 'No matching tasks' : 'No tasks yet'}</strong><p>{search ? 'Try a different search.' : 'Add the first task to get this project moving.'}</p>{!search && <button className="button button-primary" onClick={addTask}><Plus size={16} /> Add task</button>}</div>}
        </div>
      </div>
    </main>
  );
}
