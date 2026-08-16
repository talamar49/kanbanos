import { CSSProperties, useRef, useState } from 'react';
import type { FormEvent } from 'react';
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
import { Calendar, Check, CheckSquare2, ChevronDown, Clock3, GripVertical, Paperclip, Plus } from 'lucide-react';
import type { Project, Subtask, WorkItem } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';

const LABEL_COLORS: Record<string, string> = {
  Design: '#8069d8',
  Product: '#487fca',
  Engineering: '#3a9580',
  Research: '#c8794e',
  Accessibility: '#318c89',
  Content: '#b46782',
  Release: '#d45d63',
  Strategy: '#7d879a',
  UX: '#7766d1',
  Interviews: '#d38b48',
};

function dueLabel(value: string, locale: string, t: (key: string) => string): { label: string; overdue: boolean } {
  const due = new Date(`${value}T23:59:59`);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  if (sameDay(due, today)) return { label: t('Today'), overdue: false };
  if (sameDay(due, tomorrow)) return { label: t('Tomorrow'), overdue: false };
  return {
    label: due.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    overdue: due.getTime() < today.setHours(0, 0, 0, 0),
  };
}

function estimateLabel(minutes: number, t: (key: string, variables?: Record<string, string | number>) => string): string {
  if (minutes < 60) return t('{{minutes}}m', { minutes });
  const hours = minutes / 60;
  return t('{{hours}}h', { hours: Number.isInteger(hours) ? hours : hours.toFixed(1) });
}

function avatarColor(initials: string): string {
  const palette = ['#695dc7', '#d47b62', '#378976', '#477bb8', '#b16083'];
  return palette[initials.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
}

function SortableCardSubtask({ subtask, onToggle }: { subtask: Subtask; onToggle: () => void }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  return (
    <div
      ref={setNodeRef}
      className={`card-subtask-item ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span
        className="card-subtask-drag-guard"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="card-subtask-drag-handle"
          {...attributes}
          {...listeners}
          aria-label={t('Reorder {{name}}', { name: subtask.title })}
          title={t('Drag to reorder')}
        ><GripVertical size={14} /></button>
      </span>
      <button
        type="button"
        className={`card-subtask-toggle ${subtask.completed ? 'completed' : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onToggle(); }}
        title={t(subtask.completed ? 'Mark as not complete' : 'Mark as complete')}
      >
        <span>{subtask.completed ? <Check size={12} /> : null}</span>
        <em>{subtask.title}</em>
      </button>
    </div>
  );
}

type Props = {
  item: WorkItem;
  project?: Project;
  dragDisabled?: boolean;
  dropPreview?: boolean;
  compact?: boolean;
  dragData?: Record<string, unknown>;
  subtasksCollapsed: boolean;
  onOpen: (item: WorkItem) => void;
  onUpdateSubtasks: (itemId: string, subtasks: Subtask[]) => void;
  onSetSubtasksCollapsed: (itemId: string, collapsed: boolean) => void;
};

export function TaskCard({ item, project, dragDisabled = false, dropPreview = false, compact = false, dragData, subtasksCollapsed, onOpen, onUpdateSubtasks, onSetSubtasksCollapsed }: Props) {
  const { locale, t } = useI18n();
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dropPreview ? `task-drop-preview:${item.id}` : item.id,
    data: { type: dropPreview ? 'preview' : 'item', columnId: item.moduleData.kanban.columnId, ...dragData },
    disabled: dragDisabled || dropPreview,
  });
  const subtaskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const visibleSubtasks = subtasksExpanded ? item.subtasks : item.subtasks.slice(0, 3);
  const completed = item.subtasks.filter((subtask) => subtask.completed).length;
  const progress = item.subtasks.length ? Math.round((completed / item.subtasks.length) * 100) : 0;
  const due = item.dueDate ? dueLabel(item.dueDate, locale, t) : null;
  const attachedResourceCount = (item.attachmentIds?.length ?? 0) + (item.links?.length ?? 0);
  const priority = PRIORITY_META[item.priority];

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : undefined,
    zIndex: isDragging ? 5 : undefined,
  };

  const addSubtask = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const title = subtaskDraft.trim();
    if (!title) return;
    onUpdateSubtasks(item.id, [...item.subtasks, { id: crypto.randomUUID(), title, completed: false }]);
    setSubtaskDraft('');
    setAddingSubtask(false);
    onSetSubtasksCollapsed(item.id, false);
  };

  const reorderSubtasks = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = item.subtasks.findIndex((subtask) => subtask.id === active.id);
    const newIndex = item.subtasks.findIndex((subtask) => subtask.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onUpdateSubtasks(item.id, arrayMove(item.subtasks, oldIndex, newIndex));
  };

  const subtaskComposer = addingSubtask ? (
    <form className="card-inline-subtask" onSubmit={addSubtask} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <Plus size={14} />
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
      <button type="submit" disabled={!subtaskDraft.trim()} aria-label={t('Add')}><Check size={14} /></button>
    </form>
  ) : (
    <button
      type="button"
      className="card-add-subtask"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setAddingSubtask(true);
        window.setTimeout(() => subtaskInputRef.current?.focus(), 0);
      }}
    ><Plus size={14} /> {t('Add a subtask')}</button>
  );

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card ${compact ? 'timeline-task-card-compact' : ''} ${dragDisabled && !dropPreview ? 'drag-disabled' : ''} ${dropPreview ? 'task-drop-preview' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={dropPreview ? undefined : () => !isDragging && onOpen(item)}
      aria-hidden={dropPreview || undefined}
      aria-label={!dragDisabled && !dropPreview ? t('Move {{name}}', { name: item.title }) : undefined}
      {...(dragDisabled || dropPreview ? {} : attributes)}
      {...(dragDisabled || dropPreview ? {} : listeners)}
    >
      {project && (
        <div className="task-project-context" style={{ color: project.color }}>
          <i style={{ background: project.color }} />
          <span>{project.name}</span>
        </div>
      )}

      {item.priority !== 'none' && (
        <span className="priority-edge" style={{ background: priority.color }} title={t('{{priority}} priority', { priority: t(priority.label) })} />
      )}

      {!compact && item.labels.length > 0 && (
        <div className="card-labels">
          {item.labels.slice(0, 2).map((label) => (
            <span key={label} style={{ '--label-color': LABEL_COLORS[label] ?? '#76839a' } as CSSProperties}>
              <i />{label}
            </span>
          ))}
        </div>
      )}

      <h3>{item.title}</h3>
      {compact && item.subtasks.length > 0 && (
        <span className={`compact-task-subtasks ${progress === 100 ? 'complete' : ''}`} title={`${t('Subtasks')}: ${completed}/${item.subtasks.length}`}>
          {progress === 100 ? <Check size={13} /> : <CheckSquare2 size={13} />}{completed}/{item.subtasks.length}
        </span>
      )}
      {!compact && item.description && <p className="card-description">{item.description}</p>}

      {!compact && item.subtasks.length > 0 && (
        <div className={`card-subtask-section ${subtasksCollapsed ? 'collapsed' : ''}`}>
          <button
            type="button"
            className="card-subtask-collapse"
            aria-expanded={!subtasksCollapsed}
            aria-label={t(subtasksCollapsed ? 'Expand subtasks' : 'Collapse subtasks')}
            title={t(subtasksCollapsed ? 'Expand subtasks' : 'Collapse subtasks')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSetSubtasksCollapsed(item.id, !subtasksCollapsed);
            }}
          >
            <ChevronDown size={15} />
            <span>{t('Subtasks')}</span>
            <b className={progress === 100 ? 'complete' : ''}>
              {progress === 100 ? <Check size={12} /> : <CheckSquare2 size={12} />}
              {completed}/{item.subtasks.length}
            </b>
          </button>

          {!subtasksCollapsed && (
            <div className="card-subtask-body">
              <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={reorderSubtasks}>
                <SortableContext items={visibleSubtasks.map((subtask) => subtask.id)} strategy={verticalListSortingStrategy}>
                  <div className="card-subtask-list">
                    {visibleSubtasks.map((subtask) => (
                      <SortableCardSubtask
                        key={subtask.id}
                        subtask={subtask}
                        onToggle={() => onUpdateSubtasks(item.id, item.subtasks.map((value) => value.id === subtask.id ? { ...value, completed: !value.completed } : value))}
                      />
                    ))}
                    {item.subtasks.length > 3 && (
                      <button
                        type="button"
                        className="card-subtask-more"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); setSubtasksExpanded((current) => !current); }}
                      >{t(subtasksExpanded ? 'Show fewer subtasks' : '{{count}} more subtasks', { count: item.subtasks.length - 3 })}</button>
                    )}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="subtask-progress" role="progressbar" aria-valuemin={0} aria-valuemax={item.subtasks.length} aria-valuenow={completed}>
                <div><span style={{ width: `${progress}%` }} /></div>
              </div>
              {subtaskComposer}
            </div>
          )}
        </div>
      )}

      {!compact && item.subtasks.length === 0 && subtaskComposer}

      {!compact && (due || item.assignee || item.estimateMinutes || attachedResourceCount > 0) && (
        <footer className="card-footer">
          <div className="card-footer-meta">
            {due && <span className={`due-date ${due.overdue ? 'overdue' : ''}`}><Calendar size={13} />{due.label}</span>}
            {item.estimateMinutes && <span className="task-estimate"><Clock3 size={13} />{estimateLabel(item.estimateMinutes, t)}</span>}
            {attachedResourceCount > 0 && <span className="task-attachments" title={t('{{count}} attachments', { count: attachedResourceCount })}><Paperclip size={13} />{attachedResourceCount}</span>}
          </div>
          {item.assignee && <span className="member-avatar" style={{ background: avatarColor(item.assignee) }}>{item.assignee}</span>}
        </footer>
      )}
    </article>
  );
}
