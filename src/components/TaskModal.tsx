import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  Eye,
  File,
  Flag,
  Folder,
  FolderOpen,
  Layers2,
  Paperclip,
  Plus,
  Tag,
  Trash2,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import type { KanbanColumn, Priority, Subtask, WorkItem, WorkspaceAction, WorkspaceAttachment } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';

type Props = {
  item: WorkItem;
  columns: KanbanColumn[];
  projectTasks: WorkItem[];
  attachments: WorkspaceAttachment[];
  onAction: (action: WorkspaceAction) => void;
  onAddAttachments: (kind: 'files' | 'folders') => Promise<void>;
  onPreviewAttachment: (attachment: WorkspaceAttachment) => void;
  onOpenAttachment: (attachment: WorkspaceAttachment) => void;
  onRevealAttachment: (attachment: WorkspaceAttachment) => void;
  onRemoveAttachment: (attachment: WorkspaceAttachment) => Promise<void>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
};

function formatAttachmentSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value >= 10 ? 0 : 1 })} ${units[unit]}`;
}

export function TaskModal({ item, columns, projectTasks, attachments, onAction, onAddAttachments, onPreviewAttachment, onOpenAttachment, onRevealAttachment, onRemoveAttachment, onDelete, onClose }: Props) {
  const { locale, t } = useI18n();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [estimateMinutes, setEstimateMinutes] = useState(item.estimateMinutes?.toString() ?? '');
  const [startDate, setStartDate] = useState(item.startDate ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');
  const [dependencyIds, setDependencyIds] = useState(item.dependencyIds ?? []);
  const [assignee, setAssignee] = useState(item.assignee ?? '');
  const [columnId, setColumnId] = useState(item.moduleData.kanban.columnId);
  const [labels, setLabels] = useState(item.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>(item.subtasks);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [addingAttachment, setAddingAttachment] = useState<'files' | 'folders' | null>(null);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const initialSnapshot = useRef('');
  const savedSnapshot = useRef('');
  const estimateValue = estimateMinutes.trim() ? Math.max(0, Math.round(Number(estimateMinutes) * 60)) : undefined;
  const snapshot = JSON.stringify({ title, description, priority, estimateValue, startDate, dueDate, dependencyIds, assignee, columnId, labels, subtasks });

  if (!initialSnapshot.current) {
    initialSnapshot.current = snapshot;
    savedSnapshot.current = snapshot;
  }

  const persist = useCallback(() => {
    if (!title.trim() || snapshot === savedSnapshot.current) return;
    onAction({
      type: 'updateItem',
      itemId: item.id,
      changes: {
        title: title.trim(),
        description: description.trim(),
        priority,
        estimateMinutes: Number.isFinite(estimateValue) ? estimateValue : undefined,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
        dependencyIds,
        assignee: assignee.trim().toUpperCase().slice(0, 3) || undefined,
        labels,
        subtasks,
      },
    });
    if (columnId !== item.moduleData.kanban.columnId) {
      onAction({ type: 'moveItem', itemId: item.id, columnId, index: Number.MAX_SAFE_INTEGER });
    }
    savedSnapshot.current = snapshot;
  }, [assignee, columnId, dependencyIds, description, dueDate, estimateValue, item.id, item.moduleData.kanban.columnId, labels, onAction, priority, snapshot, startDate, subtasks, title]);

  useEffect(() => {
    if (snapshot === savedSnapshot.current || !title.trim()) return;
    const timer = window.setTimeout(persist, 350);
    return () => window.clearTimeout(timer);
  }, [persist, snapshot, title]);

  const finish = useCallback(() => {
    if (!title.trim()) {
      titleRef.current?.focus();
      return;
    }
    persist();
    onClose();
  }, [onClose, persist, title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

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

  const addAttachments = async (kind: 'files' | 'folders') => {
    setAddingAttachment(kind);
    try {
      await onAddAttachments(kind);
    } finally {
      setAddingAttachment(null);
    }
  };

  const removeAttachment = async (attachment: WorkspaceAttachment) => {
    setRemovingAttachmentId(attachment.id);
    try {
      await onRemoveAttachment(attachment);
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const createsCycle = (candidateId: string) => {
    const visited = new Set<string>();
    const reachesCurrentTask = (taskId: string): boolean => {
      if (taskId === item.id) return true;
      if (visited.has(taskId)) return false;
      visited.add(taskId);
      return (projectTasks.find((task) => task.id === taskId)?.dependencyIds ?? []).some(reachesCurrentTask);
    };
    return reachesCurrentTask(candidateId);
  };
  const dependencyOptions = projectTasks.filter((task) => task.id !== item.id && !dependencyIds.includes(task.id) && !createsCycle(task.id));
  const completed = subtasks.filter((subtask) => subtask.completed).length;
  const progress = subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0;

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && finish()}>
      <section className="task-modal modal-enter" role="dialog" aria-modal="true" aria-label={t('Task details')}>
        <header className="modal-header">
          <div className="modal-context"><span style={{ background: columns.find((column) => column.id === columnId)?.color }} /> {t('Task details')}</div>
          <button className="icon-button" aria-label={t('Close task')} onClick={onClose}><X size={19} /></button>
        </header>

        <div className="task-modal-body">
          <div className="task-form-main">
            <textarea
              ref={titleRef}
              className="task-title-input"
              value={title}
              rows={1}
              onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, ' '))}
              aria-label={t('Task title')}
            />

            <section className="form-section description-section">
              <label><AlignLeft size={17} /> {t('Description')}</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('Add context, intent, or a useful note…')}
                rows={5}
              />
            </section>

            <section className="form-section attachment-section">
              <div className="attachment-section-title">
                <label><Paperclip size={17} /> {t('Attachments')}</label>
                <span>{attachments.length}</span>
              </div>
              {attachments.length > 0 && (
                <div className="task-attachment-list">
                  {attachments.map((attachment) => (
                    <div className="task-attachment-row" key={attachment.id}>
                      <button className={`task-attachment-main ${attachment.kind}`} onClick={() => onPreviewAttachment(attachment)} title={t('Preview {{name}}', { name: attachment.name })}>
                        <span>{attachment.kind === 'folder' ? <Folder size={17} /> : <File size={17} />}</span>
                        <span><strong><bdi>{attachment.name}</bdi></strong><small>{attachment.kind === 'folder' ? t('{{count}} files · {{size}}', { count: attachment.fileCount, size: formatAttachmentSize(attachment.sizeBytes, locale) }) : formatAttachmentSize(attachment.sizeBytes, locale)}</small></span>
                      </button>
                      <button className="icon-button" onClick={() => onPreviewAttachment(attachment)} title={t('Preview')} aria-label={t('Preview {{name}}', { name: attachment.name })}><Eye size={15} /></button>
                      <button className="icon-button" onClick={() => onOpenAttachment(attachment)} title={t('Open')} aria-label={t('Open {{name}}', { name: attachment.name })}><ExternalLink size={15} /></button>
                      <button className="icon-button" onClick={() => onRevealAttachment(attachment)} title={t('Show in workspace folder')} aria-label={t('Show {{name}} in workspace folder', { name: attachment.name })}><FolderOpen size={15} /></button>
                      <button className="icon-button attachment-remove" disabled={removingAttachmentId === attachment.id} onClick={() => void removeAttachment(attachment)} title={t('Remove attachment')} aria-label={t('Remove {{name}}', { name: attachment.name })}>
                        {removingAttachmentId === attachment.id ? <span className="spinner spinner-dark" /> : <X size={15} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="attachment-actions">
                <button disabled={addingAttachment !== null} onClick={() => void addAttachments('files')}>
                  {addingAttachment === 'files' ? <span className="spinner spinner-dark" /> : <File size={15} />} {t('Attach files')}
                </button>
                <button disabled={addingAttachment !== null} onClick={() => void addAttachments('folders')}>
                  {addingAttachment === 'folders' ? <span className="spinner spinner-dark" /> : <Folder size={15} />} {t('Attach folder')}
                </button>
              </div>
              <p>{t('Copies are stored inside this workspace and stay linked to this task.')}</p>
            </section>

            <section className="form-section">
              <div className="subtask-section-title">
                <label><CheckCircle2 size={17} /> {t('Subtasks')}</label>
                {subtasks.length > 0 && <span>{t('{{completed}} of {{total}}', { completed, total: subtasks.length })}</span>}
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
                  placeholder={t('Add a subtask')}
                />
                {subtaskDraft && <button onClick={addSubtask}>{t('Add')}</button>}
              </div>
            </section>
          </div>

          <aside className="task-properties">
            <h3>{t('Properties')}</h3>
            <label className="property-field">
              <span><Layers2 size={15} /> {t('Status')}</span>
              <select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((column) => <option key={column.id} value={column.id}>{t(column.title)}</option>)}
              </select>
            </label>
            <label className="property-field">
              <span><Flag size={15} /> {t('Priority')}</span>
              <div className="select-with-dot">
                <i style={{ background: PRIORITY_META[priority].color }} />
                <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                  {(Object.keys(PRIORITY_META) as Priority[]).map((value) => <option key={value} value={value}>{t(PRIORITY_META[value].label)}</option>)}
                </select>
              </div>
            </label>
            <label className="property-field">
              <span><Clock3 size={15} /> {t('Estimate')}</span>
              <div className="estimate-input modal-estimate-input"><input type="number" min="0" step="0.25" value={estimateMinutes} onChange={(event) => setEstimateMinutes(event.target.value)} placeholder="—" /><em>{t('hours')}</em></div>
            </label>
            <label className="property-field">
              <span><Calendar size={15} /> {t('Start date')}</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="property-field">
              <span><Calendar size={15} /> {t('Due date')}</span>
              <input type="date" min={startDate || undefined} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <div className="property-field dependency-property">
              <span><Workflow size={15} /> {t('Depends on')}</span>
              {dependencyIds.length > 0 && (
                <div className="dependency-list">
                  {dependencyIds.map((dependencyId) => {
                    const dependency = projectTasks.find((task) => task.id === dependencyId);
                    return dependency ? <button key={dependencyId} title={dependency.title} onClick={() => setDependencyIds((current) => current.filter((id) => id !== dependencyId))}><span>{dependency.title}</span><X size={12} /></button> : null;
                  })}
                </div>
              )}
              <select value="" onChange={(event) => event.target.value && setDependencyIds((current) => [...current, event.target.value])} disabled={dependencyOptions.length === 0}>
                <option value="">{t(dependencyOptions.length ? 'Add a dependency…' : dependencyIds.length ? 'No more tasks available' : 'No eligible tasks')}</option>
                {dependencyOptions.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
              <small>{t('Linked tasks appear as connectors on the timeline.')}</small>
            </div>
            <label className="property-field">
              <span><UserRound size={15} /> {t('Assignee')}</span>
              <input value={assignee} onChange={(event) => setAssignee(event.target.value)} maxLength={3} placeholder={t('Initials')} />
            </label>

            <div className="property-field label-property">
              <span><Tag size={15} /> {t('Labels')}</span>
              <div className="modal-labels">
                {labels.map((label) => <button key={label} onClick={() => setLabels((current) => current.filter((value) => value !== label))}>{label}<X size={11} /></button>)}
              </div>
              <input
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addLabel()}
                onBlur={addLabel}
                placeholder={t('Add label…')}
              />
            </div>

            <div className="task-created">{t('Created {{date}}', { date: new Date(item.createdAt).toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' }) })}</div>
          </aside>
        </div>

        <footer className="modal-footer">
          <button className="button delete-task" onClick={() => void (async () => {
            if (window.confirm(t('Delete this task? This cannot be undone after the workspace is saved.')) && await onDelete()) onClose();
          })()}><Trash2 size={15} /> {t('Delete')}</button>
          <div><span className={snapshot === savedSnapshot.current ? 'autosave-state' : 'autosave-state saving'}>{snapshot === savedSnapshot.current ? <><Check size={12} /> {t('Saved automatically')}</> : <><span className="spinner spinner-dark" /> {t('Saving changes')}</>}</span><button className="button button-secondary" onClick={finish}>{t('Done button')}</button></div>
        </footer>
      </section>
    </div>
  );
}
