import { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Check, CheckSquare2, GripVertical } from 'lucide-react';
import type { WorkItem } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';

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

function dueLabel(value: string): { label: string; overdue: boolean } {
  const due = new Date(`${value}T23:59:59`);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  if (sameDay(due, today)) return { label: 'Today', overdue: false };
  if (sameDay(due, tomorrow)) return { label: 'Tomorrow', overdue: false };
  return {
    label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    overdue: due.getTime() < today.setHours(0, 0, 0, 0),
  };
}

function avatarColor(initials: string): string {
  const palette = ['#695dc7', '#d47b62', '#378976', '#477bb8', '#b16083'];
  return palette[initials.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
}

type Props = {
  item: WorkItem;
  onOpen: (item: WorkItem) => void;
  onToggleSubtask: (itemId: string, subtaskId: string) => void;
};

export function TaskCard({ item, onOpen, onToggleSubtask }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: 'item', columnId: item.moduleData.kanban.columnId },
  });
  const completed = item.subtasks.filter((subtask) => subtask.completed).length;
  const progress = item.subtasks.length ? Math.round((completed / item.subtasks.length) * 100) : 0;
  const due = item.dueDate ? dueLabel(item.dueDate) : null;
  const priority = PRIORITY_META[item.priority];

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card ${isDragging ? 'dragging' : ''}`}
      onClick={() => onOpen(item)}
      {...attributes}
      {...listeners}
    >
      <button
        className="card-drag-handle"
        aria-label="Drag task"
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      ><GripVertical size={15} /></button>

      {item.priority !== 'none' && (
        <span className="priority-edge" style={{ background: priority.color }} title={`${priority.label} priority`} />
      )}

      {item.labels.length > 0 && (
        <div className="card-labels">
          {item.labels.slice(0, 2).map((label) => (
            <span key={label} style={{ '--label-color': LABEL_COLORS[label] ?? '#76839a' } as CSSProperties}>
              <i />{label}
            </span>
          ))}
        </div>
      )}

      <h3>{item.title}</h3>
      {item.description && <p className="card-description">{item.description}</p>}

      {item.subtasks.length > 0 && (
        <div className="card-subtask-list">
          {item.subtasks.slice(0, 3).map((subtask) => (
            <button
              key={subtask.id}
              className={subtask.completed ? 'completed' : ''}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSubtask(item.id, subtask.id);
              }}
              title={subtask.completed ? 'Mark as not complete' : 'Mark as complete'}
            >
              <span>{subtask.completed ? <Check size={12} /> : null}</span>
              <em>{subtask.title}</em>
            </button>
          ))}
          {item.subtasks.length > 3 && <small>+{item.subtasks.length - 3} more subtasks</small>}
        </div>
      )}

      {item.subtasks.length > 0 && (
        <div className="subtask-progress">
          <div><span style={{ width: `${progress}%` }} /></div>
          <small className={progress === 100 ? 'complete' : ''}>
            {progress === 100 ? <Check size={12} /> : <CheckSquare2 size={12} />}
            {completed}/{item.subtasks.length}
          </small>
        </div>
      )}

      {(due || item.assignee) && (
        <footer className="card-footer">
          {due ? <span className={`due-date ${due.overdue ? 'overdue' : ''}`}><Calendar size={13} />{due.label}</span> : <span />}
          {item.assignee && <span className="member-avatar" style={{ background: avatarColor(item.assignee) }}>{item.assignee}</span>}
        </footer>
      )}
    </article>
  );
}
