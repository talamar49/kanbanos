import type { SyntheticEvent } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';

function stopCardInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

type CompleteProps = {
  className: string;
  completed: boolean;
  taskName: string;
  onToggle: () => void;
};

export function TaskCompleteButton({ className, completed, taskName, onToggle }: CompleteProps) {
  const { t } = useI18n();
  const label = t(completed ? 'Mark {{name}} as not complete' : 'Mark {{name}} as complete', { name: taskName });
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-label={label}
      title={label}
      className={`task-complete-control ${className} ${completed ? 'completed' : ''}`}
      onPointerDown={stopCardInteraction}
      onMouseDown={stopCardInteraction}
      onTouchStart={stopCardInteraction}
      onKeyDown={stopCardInteraction}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span>{completed ? <Check size={11} strokeWidth={2.5} /> : null}</span>
    </button>
  );
}

type DeleteProps = {
  className: string;
  taskName: string;
  onDelete: () => void;
};

export function TaskDeleteButton({ className, taskName, onDelete }: DeleteProps) {
  const { t } = useI18n();
  const label = t('Delete {{name}}', { name: taskName });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`task-delete-control ${className}`}
      onPointerDown={stopCardInteraction}
      onMouseDown={stopCardInteraction}
      onTouchStart={stopCardInteraction}
      onKeyDown={stopCardInteraction}
      onClick={(event) => {
        event.stopPropagation();
        if (window.confirm(t('Delete this task? This cannot be undone after the workspace is saved.'))) onDelete();
      }}
    >
      <Trash2 size={14} strokeWidth={1.8} />
    </button>
  );
}
