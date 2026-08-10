import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Flag,
  Layers2,
  Plus,
  Tag,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import type { KanbanColumn, Priority, Subtask, WorkItem, WorkspaceAction } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';

type Props = {
  item: WorkItem;
  columns: KanbanColumn[];
  onAction: (action: WorkspaceAction) => void;
  onClose: () => void;
};

export function TaskModal({ item, columns, onAction, onClose }: Props) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [startDate, setStartDate] = useState(item.startDate ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');
  const [assignee, setAssignee] = useState(item.assignee ?? '');
  const [columnId, setColumnId] = useState(item.moduleData.kanban.columnId);
  const [labels, setLabels] = useState(item.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>(item.subtasks);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = () => {
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    onAction({
      type: 'updateItem',
      itemId: item.id,
      changes: {
        title: title.trim(),
        description: description.trim(),
        priority,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
        assignee: assignee.trim().toUpperCase().slice(0, 3) || undefined,
        labels,
        subtasks,
      },
    });
    if (columnId !== item.moduleData.kanban.columnId) {
      onAction({ type: 'moveItem', itemId: item.id, columnId, index: Number.MAX_SAFE_INTEGER });
    }
    onClose();
  };

  const addSubtask = () => {
    const clean = subtaskDraft.trim();
    if (!clean) return;
    setSubtasks((current) => [...current, { id: crypto.randomUUID(), title: clean, completed: false }]);
    setSubtaskDraft('');
  };

  const addLabel = () => {
    const clean = labelDraft.trim();
    if (clean && !labels.includes(clean)) setLabels((current) => [...current, clean]);
    setLabelDraft('');
  };

  const completed = subtasks.filter((subtask) => subtask.completed).length;
  const progress = subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0;

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="task-modal modal-enter" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="modal-header">
          <div className="modal-context"><span style={{ background: columns.find((column) => column.id === columnId)?.color }} /> Task details</div>
          <button className="icon-button" aria-label="Close task" onClick={onClose}><X size={19} /></button>
        </header>

        <div className="task-modal-body">
          <div className="task-form-main">
            <input
              ref={titleRef}
              className="task-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="Task title"
            />

            <section className="form-section description-section">
              <label><AlignLeft size={17} /> Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add context, intent, or a useful note…"
                rows={5}
              />
            </section>

            <section className="form-section">
              <div className="subtask-section-title">
                <label><CheckCircle2 size={17} /> Subtasks</label>
                {subtasks.length > 0 && <span>{completed} of {subtasks.length}</span>}
              </div>
              {subtasks.length > 0 && <div className="modal-progress"><span style={{ width: `${progress}%` }} /></div>}
              <div className="subtask-list">
                {subtasks.map((subtask) => (
                  <div className="subtask-row" key={subtask.id}>
                    <button
                      className={`subtask-check ${subtask.completed ? 'checked' : ''}`}
                      onClick={() => setSubtasks((current) => current.map((value) => value.id === subtask.id ? { ...value, completed: !value.completed } : value))}
                    >{subtask.completed ? <Check size={13} /> : <Circle size={14} />}</button>
                    <span className={subtask.completed ? 'completed' : ''}>{subtask.title}</span>
                    <button className="subtask-delete" onClick={() => setSubtasks((current) => current.filter((value) => value.id !== subtask.id))}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="subtask-composer">
                <Plus size={15} />
                <input
                  value={subtaskDraft}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && addSubtask()}
                  placeholder="Add a subtask"
                />
                {subtaskDraft && <button onClick={addSubtask}>Add</button>}
              </div>
            </section>
          </div>

          <aside className="task-properties">
            <h3>Properties</h3>
            <label className="property-field">
              <span><Layers2 size={15} /> Status</span>
              <select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
              </select>
            </label>
            <label className="property-field">
              <span><Flag size={15} /> Priority</span>
              <div className="select-with-dot">
                <i style={{ background: PRIORITY_META[priority].color }} />
                <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                  {(Object.keys(PRIORITY_META) as Priority[]).map((value) => <option key={value} value={value}>{PRIORITY_META[value].label}</option>)}
                </select>
              </div>
            </label>
            <label className="property-field">
              <span><Calendar size={15} /> Start date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="property-field">
              <span><Calendar size={15} /> Due date</span>
              <input type="date" min={startDate || undefined} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <label className="property-field">
              <span><UserRound size={15} /> Assignee</span>
              <input value={assignee} onChange={(event) => setAssignee(event.target.value)} maxLength={3} placeholder="Initials" />
            </label>

            <div className="property-field label-property">
              <span><Tag size={15} /> Labels</span>
              <div className="modal-labels">
                {labels.map((label) => <button key={label} onClick={() => setLabels((current) => current.filter((value) => value !== label))}>{label}<X size={11} /></button>)}
              </div>
              <input
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addLabel()}
                onBlur={addLabel}
                placeholder="Add label…"
              />
            </div>

            <div className="task-created">Created {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          </aside>
        </div>

        <footer className="modal-footer">
          <button className="button delete-task" onClick={() => {
            if (window.confirm('Delete this task? This cannot be undone after the workspace is saved.')) {
              onAction({ type: 'deleteItem', itemId: item.id });
              onClose();
            }
          }}><Trash2 size={15} /> Delete</button>
          <div><span><kbd>Ctrl</kbd> <kbd>Enter</kbd> to save</span><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={save}>Save task</button></div>
        </footer>
      </section>
    </div>
  );
}
