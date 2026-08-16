import { useEffect, useRef, useState } from 'react';
import { Calendar, Clock3, Flag, Layers2, Plus, Sparkles, X } from 'lucide-react';
import type { KanbanColumn, Priority, Project, TaskDraft } from '../domain/types';
import { columnForRule, PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';

type Props = {
  project: Project;
  columns: KanbanColumn[];
  preset?: Partial<Pick<TaskDraft, 'columnId' | 'priority' | 'startDate' | 'dueDate' | 'estimateMinutes'>>;
  onCreate: (draft: TaskDraft) => void;
  onClose: () => void;
};

export function TaskComposerModal({ project, columns, preset, onCreate, onClose }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [columnId, setColumnId] = useState(preset?.columnId ?? columnForRule(columns, 'new-task')?.id ?? '');
  const [priority, setPriority] = useState<Priority>(preset?.priority ?? 'none');
  const [startDate, setStartDate] = useState(preset?.startDate ?? '');
  const [dueDate, setDueDate] = useState(preset?.dueDate ?? '');
  const [estimate, setEstimate] = useState(preset?.estimateMinutes?.toString() ?? '');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') create();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const create = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || !columnId) {
      titleRef.current?.focus();
      return;
    }
    const estimateMinutes = estimate.trim() ? Math.max(0, Math.round(Number(estimate) * 60)) : undefined;
    onCreate({
      title: cleanTitle,
      columnId,
      priority,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      estimateMinutes: Number.isFinite(estimateMinutes) ? estimateMinutes : undefined,
    });
  };

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="task-composer modal-enter" role="dialog" aria-modal="true" aria-label={t('Create task')}>
        <header className="simple-modal-header">
          <span className="task-composer-icon"><Sparkles size={21} /></span>
          <div><h2>{t('Capture what matters')}</h2><p>{t('Add a clear next step to {{project}}.', { project: project.name })}</p></div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </header>
        <div className="task-composer-body">
          <label className="task-composer-title-label" htmlFor="new-task-title">{t('What needs to happen?')}</label>
          <input
            id="new-task-title"
            ref={titleRef}
            className="task-composer-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && create()}
            placeholder={t('Write a specific, useful next step…')}
          />
          <div className="task-composer-properties">
            <label>
              <span><Layers2 size={15} /> {t('Status')}</span>
              <select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {columns.map((column) => <option key={column.id} value={column.id}>{t(column.title)}</option>)}
              </select>
            </label>
            <label>
              <span><Flag size={15} /> {t('Priority')}</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                {(Object.keys(PRIORITY_META) as Priority[]).map((value) => <option key={value} value={value}>{t(PRIORITY_META[value].label)}</option>)}
              </select>
            </label>
            <label>
              <span><Calendar size={15} /> {t('Start')}</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <span><Calendar size={15} /> {t('Due')}</span>
              <input type="date" min={startDate || undefined} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <label>
              <span><Clock3 size={15} /> {t('Estimate')}</span>
              <div className="estimate-input"><input type="number" min="0" step="0.25" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="—" /><em>{t('hours')}</em></div>
            </label>
          </div>
          <p className="task-composer-note"><Sparkles size={14} /> {t('You can add details, labels, subtasks, and an owner right after creating it.')}</p>
        </div>
        <footer className="simple-modal-footer">
          <span><kbd>Ctrl</kbd> <kbd>Enter</kbd> {t('to create')}</span>
          <button className="button button-secondary" onClick={onClose}>{t('Cancel')}</button>
          <button className="button button-primary" onClick={create} disabled={!title.trim() || !columnId}><Plus size={16} /> {t('Create task')}</button>
        </footer>
      </section>
    </div>
  );
}
