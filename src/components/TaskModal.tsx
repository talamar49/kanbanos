import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  GripVertical,
  Layers2,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  Tag,
  Trash2,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import type { KanbanColumn, Priority, Subtask, TaskLink, WorkItem, WorkspaceAction, WorkspaceAttachment } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';

type EditingResource = {
  type: 'attachment' | 'link';
  id: string;
  title: string;
  description: string;
};

type Props = {
  item: WorkItem;
  columns: KanbanColumn[];
  projectTasks: WorkItem[];
  attachments: WorkspaceAttachment[];
  onAction: (action: WorkspaceAction) => void;
  onAddAttachments: (kind: 'files' | 'folders') => Promise<WorkspaceAttachment[]>;
  onPreviewAttachment: (attachment: WorkspaceAttachment) => void;
  onOpenAttachment: (attachment: WorkspaceAttachment) => void;
  onRevealAttachment: (attachment: WorkspaceAttachment) => void;
  onRemoveAttachment: (attachment: WorkspaceAttachment) => Promise<void>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
  mobile?: boolean;
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

function normalizeTaskLinkUrl(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value || /^(?:javascript|data|file|mailto|vbscript):/i.test(value)) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function taskLinkTitle(url: string): string {
  return new URL(url).hostname.replace(/^www\./i, '');
}

function displayTaskLinkUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function SortableModalSubtask({ subtask, onToggle, onDelete }: { subtask: Subtask; onToggle: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  return (
    <div
      ref={setNodeRef}
      className={`subtask-row ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="subtask-drag-handle"
        {...attributes}
        {...listeners}
        aria-label={t('Reorder {{name}}', { name: subtask.title })}
        title={t('Drag to reorder')}
      ><GripVertical size={16} /></button>
      <button
        type="button"
        className={`subtask-check ${subtask.completed ? 'checked' : ''}`}
        onClick={onToggle}
        title={t(subtask.completed ? 'Mark as not complete' : 'Mark as complete')}
      >{subtask.completed ? <Check size={13} /> : <Circle size={14} />}</button>
      <span className={subtask.completed ? 'completed' : ''}>{subtask.title}</span>
      <button type="button" className="subtask-delete" onClick={onDelete} aria-label={t('Remove {{name}}', { name: subtask.title })}><X size={14} /></button>
    </div>
  );
}

export function TaskModal({ item, columns, projectTasks, attachments, onAction, onAddAttachments, onPreviewAttachment, onOpenAttachment, onRevealAttachment, onRemoveAttachment, onDelete, onClose, mobile = false }: Props) {
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
  const subtaskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [addingAttachment, setAddingAttachment] = useState<'files' | 'folders' | null>(null);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [links, setLinks] = useState<TaskLink[]>(item.links ?? []);
  const [linkComposerOpen, setLinkComposerOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [linkTitleDraft, setLinkTitleDraft] = useState('');
  const [linkDescriptionDraft, setLinkDescriptionDraft] = useState('');
  const [linkError, setLinkError] = useState('');
  const [editingResource, setEditingResource] = useState<EditingResource | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const resourceTitleInputRef = useRef<HTMLInputElement>(null);
  const initialSnapshot = useRef('');
  const savedSnapshot = useRef('');
  const estimateValue = estimateMinutes.trim() ? Math.max(0, Math.round(Number(estimateMinutes) * 60)) : undefined;
  const snapshot = JSON.stringify({ title, description, priority, estimateValue, startDate, dueDate, dependencyIds, assignee, columnId, labels, subtasks, links });

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
        links,
      },
    });
    if (columnId !== item.moduleData.kanban.columnId) {
      onAction({ type: 'moveItem', itemId: item.id, columnId, index: Number.MAX_SAFE_INTEGER });
    }
    savedSnapshot.current = snapshot;
  }, [assignee, columnId, dependencyIds, description, dueDate, estimateValue, item.id, item.moduleData.kanban.columnId, labels, links, onAction, priority, snapshot, startDate, subtasks, title]);

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

  const reorderSubtasks = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setSubtasks((current) => {
      const oldIndex = current.findIndex((subtask) => subtask.id === active.id);
      const newIndex = current.findIndex((subtask) => subtask.id === over.id);
      return oldIndex < 0 || newIndex < 0 ? current : arrayMove(current, oldIndex, newIndex);
    });
  };

  const addLabel = () => {
    const clean = labelDraft.trim();
    if (clean && !labels.includes(clean)) setLabels((current) => [...current, clean]);
    setLabelDraft('');
  };

  const addAttachments = async (kind: 'files' | 'folders') => {
    setAddingAttachment(kind);
    try {
      const added = await onAddAttachments(kind);
      if (added.length === 1) {
        setEditingResource({
          type: 'attachment',
          id: added[0].id,
          title: added[0].title ?? '',
          description: added[0].description ?? '',
        });
      }
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

  const openLinkComposer = () => {
    setLinkComposerOpen(true);
    setLinkError('');
    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  };

  const closeLinkComposer = () => {
    setLinkComposerOpen(false);
    setLinkDraft('');
    setLinkTitleDraft('');
    setLinkDescriptionDraft('');
    setLinkError('');
  };

  const addLink = () => {
    const url = normalizeTaskLinkUrl(linkDraft);
    if (!url) {
      setLinkError(t('Enter a valid web address.'));
      return;
    }
    if (links.some((link) => link.url === url)) {
      setLinkError(t('This link is already attached.'));
      return;
    }
    const link: TaskLink = {
      id: crypto.randomUUID(),
      title: linkTitleDraft.trim() || undefined,
      description: linkDescriptionDraft.trim() || undefined,
      url,
      createdAt: new Date().toISOString(),
    };
    setLinks((current) => [...current, link]);
    closeLinkComposer();
  };

  const editAttachmentDetails = (attachment: WorkspaceAttachment) => {
    setEditingResource({
      type: 'attachment',
      id: attachment.id,
      title: attachment.title ?? '',
      description: attachment.description ?? '',
    });
  };

  const editLinkDetails = (link: TaskLink) => {
    setEditingResource({
      type: 'link',
      id: link.id,
      title: link.title ?? '',
      description: link.description ?? '',
    });
  };

  useEffect(() => {
    if (!editingResource) return;
    const frame = window.requestAnimationFrame(() => resourceTitleInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editingResource?.id, editingResource?.type]);

  const saveResourceDetails = () => {
    if (!editingResource) return;
    const changes = {
      title: editingResource.title.trim() || undefined,
      description: editingResource.description.trim() || undefined,
    };
    if (editingResource.type === 'attachment') {
      onAction({ type: 'updateAttachment', attachmentId: editingResource.id, changes });
    } else {
      setLinks((current) => current.map((link) => link.id === editingResource.id ? { ...link, ...changes } : link));
    }
    setEditingResource(null);
  };

  const renderResourceDetailsEditor = (type: EditingResource['type'], id: string) => {
    if (!editingResource || editingResource.type !== type || editingResource.id !== id) return null;
    return (
      <div className="resource-details-editor" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setEditingResource(null);
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.stopPropagation();
          saveResourceDetails();
        }
      }}>
        <label>
          <span>{t('Title')} <em>{t('Optional')}</em></span>
          <input
            ref={resourceTitleInputRef}
            value={editingResource.title}
            onChange={(event) => setEditingResource((current) => current ? { ...current, title: event.target.value } : current)}
            placeholder={t('Add a title…')}
          />
        </label>
        <label>
          <span>{t('Description')} <em>{t('Optional')}</em></span>
          <textarea
            value={editingResource.description}
            onChange={(event) => setEditingResource((current) => current ? { ...current, description: event.target.value } : current)}
            placeholder={t('Add a short description…')}
            rows={2}
          />
        </label>
        <div>
          <button className="resource-details-cancel" onClick={() => setEditingResource(null)}>{t('Cancel')}</button>
          <button className="resource-details-save" onClick={saveResourceDetails}><Check size={14} /> {t('Save details')}</button>
        </div>
      </div>
    );
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
          <button className="icon-button" aria-label={t('Close task')} onClick={finish}><X size={19} /></button>
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
                <span>{attachments.length + links.length}</span>
              </div>
              {(attachments.length > 0 || links.length > 0) && (
                <div className="task-attachment-list">
                  {attachments.map((attachment) => (
                    <div className="task-attachment-row" key={attachment.id}>
                      <button className={`task-attachment-main ${attachment.kind}`} onClick={() => onPreviewAttachment(attachment)} title={t('Preview {{name}}', { name: attachment.name })}>
                        <span>{attachment.kind === 'folder' ? <Folder size={17} /> : <File size={17} />}</span>
                        <span><strong><bdi>{attachment.title?.trim() || attachment.name}</bdi></strong><small><bdi>{attachment.description?.trim() || (attachment.kind === 'folder' ? t('{{count}} files · {{size}}', { count: attachment.fileCount, size: formatAttachmentSize(attachment.sizeBytes, locale) }) : formatAttachmentSize(attachment.sizeBytes, locale))}</bdi></small></span>
                      </button>
                      <div className="task-attachment-controls">
                        <button className="icon-button" onClick={() => editAttachmentDetails(attachment)} title={t('Edit details')} aria-label={t('Edit details for {{name}}', { name: attachment.title?.trim() || attachment.name })}><Pencil size={14} /></button>
                        <button className="icon-button" onClick={() => onPreviewAttachment(attachment)} title={t('Preview')} aria-label={t('Preview {{name}}', { name: attachment.name })}><Eye size={15} /></button>
                        <button className="icon-button" onClick={() => onOpenAttachment(attachment)} title={t(mobile ? 'Share' : 'Open')} aria-label={t(mobile ? 'Share {{name}}' : 'Open {{name}}', { name: attachment.name })}><ExternalLink size={15} /></button>
                        {!mobile && <button className="icon-button" onClick={() => onRevealAttachment(attachment)} title={t('Show in workspace folder')} aria-label={t('Show {{name}} in workspace folder', { name: attachment.name })}><FolderOpen size={15} /></button>}
                        <button className="icon-button attachment-remove" disabled={removingAttachmentId === attachment.id} onClick={() => void removeAttachment(attachment)} title={t('Remove attachment')} aria-label={t('Remove {{name}}', { name: attachment.name })}>
                          {removingAttachmentId === attachment.id ? <span className="spinner spinner-dark" /> : <X size={15} />}
                        </button>
                      </div>
                      {renderResourceDetailsEditor('attachment', attachment.id)}
                    </div>
                  ))}
                  {links.map((link) => (
                    <div className="task-attachment-row task-link-row" key={link.id}>
                      <a className="task-attachment-main link" href={link.url} target="_blank" rel="noreferrer" title={t('Open {{name}}', { name: link.title?.trim() || taskLinkTitle(link.url) })}>
                        <span><Link2 size={17} /></span>
                        <span>
                          <strong><bdi>{link.title?.trim() || taskLinkTitle(link.url)}</bdi></strong>
                          <small className="task-link-url"><bdi>{displayTaskLinkUrl(link.url)}</bdi></small>
                          {link.description?.trim() && <small className="task-resource-description"><bdi>{link.description.trim()}</bdi></small>}
                        </span>
                      </a>
                      <div className="task-attachment-controls">
                        <button className="icon-button" onClick={() => editLinkDetails(link)} title={t('Edit details')} aria-label={t('Edit details for {{name}}', { name: link.title?.trim() || taskLinkTitle(link.url) })}><Pencil size={14} /></button>
                        <a className="icon-button" href={link.url} target="_blank" rel="noreferrer" title={t('Open')} aria-label={t('Open {{name}}', { name: link.title?.trim() || taskLinkTitle(link.url) })}><ExternalLink size={15} /></a>
                        <button className="icon-button attachment-remove" onClick={() => setLinks((current) => current.filter((value) => value.id !== link.id))} title={t('Remove link')} aria-label={t('Remove {{name}}', { name: link.title?.trim() || taskLinkTitle(link.url) })}><X size={15} /></button>
                      </div>
                      {renderResourceDetailsEditor('link', link.id)}
                    </div>
                  ))}
                </div>
              )}
              <div className="attachment-actions">
                <button disabled={addingAttachment !== null} onClick={() => void addAttachments('files')}>
                  {addingAttachment === 'files' ? <span className="spinner spinner-dark" /> : <File size={16} />} {t('Attach files')}
                </button>
                <button disabled={addingAttachment !== null} onClick={() => void addAttachments('folders')}>
                  {addingAttachment === 'folders' ? <span className="spinner spinner-dark" /> : <Folder size={16} />} {t('Attach folder')}
                </button>
                <button className={linkComposerOpen ? 'active' : ''} aria-expanded={linkComposerOpen} onClick={() => linkComposerOpen ? closeLinkComposer() : openLinkComposer()}>
                  <Link2 size={16} /> {t('Add link')}
                </button>
              </div>
              {linkComposerOpen && (
                <div className={`link-composer ${linkError ? 'invalid' : ''}`} onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.stopPropagation(); closeLinkComposer(); }
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.stopPropagation(); addLink(); }
                }}>
                  <div className="link-composer-url">
                    <Link2 size={17} />
                    <label>
                      <span>{t('Web address')}</span>
                      <input
                        ref={linkInputRef}
                        type="url"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={linkDraft}
                        onChange={(event) => { setLinkDraft(event.target.value); setLinkError(''); }}
                        aria-invalid={Boolean(linkError)}
                        placeholder={t('Paste a web address…')}
                      />
                    </label>
                    <button className="icon-button" onClick={closeLinkComposer} aria-label={t('Cancel')}><X size={16} /></button>
                  </div>
                  <div className="link-composer-details">
                    <label>
                      <span>{t('Title')} <em>{t('Optional')}</em></span>
                      <input value={linkTitleDraft} onChange={(event) => setLinkTitleDraft(event.target.value)} placeholder={t('Add a title…')} />
                    </label>
                    <label>
                      <span>{t('Description')} <em>{t('Optional')}</em></span>
                      <textarea value={linkDescriptionDraft} onChange={(event) => setLinkDescriptionDraft(event.target.value)} placeholder={t('Add a short description…')} rows={2} />
                    </label>
                  </div>
                  <div className="link-composer-footer">
                    {linkError ? <small role="alert">{linkError}</small> : <span />}
                    <button className="link-composer-add" onClick={addLink}><Link2 size={14} /> {t('Add link')}</button>
                  </div>
                </div>
              )}
              <p>{t('Files and folders are copied into this workspace; links stay with this task.')}</p>
            </section>

            <section className="form-section subtask-section">
              <div className="subtask-section-title">
                <label><CheckCircle2 size={17} /> {t('Subtasks')}</label>
                <div className="subtask-section-meta">
                  {subtasks.length > 1 && <small><GripVertical size={14} /> {t('Drag to reorder')}</small>}
                  {subtasks.length > 0 && <span>{t('{{completed}} of {{total}}', { completed, total: subtasks.length })}</span>}
                </div>
              </div>
              {subtasks.length > 0 && <div className="modal-progress"><span style={{ width: `${progress}%` }} /></div>}
              <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={reorderSubtasks}>
                <SortableContext items={subtasks.map((subtask) => subtask.id)} strategy={verticalListSortingStrategy}>
                  <div className="subtask-list">
                    {subtasks.map((subtask) => (
                      <SortableModalSubtask
                        key={subtask.id}
                        subtask={subtask}
                        onToggle={() => setSubtasks((current) => current.map((value) => value.id === subtask.id ? { ...value, completed: !value.completed } : value))}
                        onDelete={() => setSubtasks((current) => current.filter((value) => value.id !== subtask.id))}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
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
          <div><span className={snapshot === savedSnapshot.current ? 'autosave-state' : 'autosave-state saving'}>{snapshot === savedSnapshot.current ? <><Check size={12} /> {t('Saved automatically')}</> : <><span className="spinner spinner-dark" /> {t('Saving changes')}</>}</span><button className="button button-secondary" onClick={finish}>{t('Done editing')}</button></div>
        </footer>
      </section>
    </div>
  );
}
