import { useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus } from 'lucide-react';
import type { Project, TaskDraft, WorkItem, WorkspaceDocument } from '../domain/types';
import { PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask: (preset?: Partial<TaskDraft>) => void;
  onSave: () => void;
};

const DAY = 86_400_000;

function localDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function weekStart(offset = 0): Date {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - mondayOffset + offset * 7);
  return today;
}

function taskRange(item: WorkItem, locale: string): string {
  if (!item.dueDate) return '';
  const start = item.startDate ?? item.dueDate;
  const due = item.dueDate;
  if (start === due) return localDate(due).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${localDate(start).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${localDate(due).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
}

function isScheduledOn(item: WorkItem, day: string): boolean {
  if (!item.dueDate) return false;
  const start = item.startDate ?? item.dueDate;
  return start <= day && day <= item.dueDate;
}

export function MobileTimelineView({ document, project, saveState, dirty, onOpenTask, onCreateTask, onSave }: Props) {
  const { locale, t } = useI18n();
  const [offset, setOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const start = weekStart(offset);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const columns = document.modules.kanban.projects[project.id]?.columns ?? [];
  const plannedColumn = columns.find((column) => column.id === 'planned') ?? columns[0];
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const tasks = useMemo(() => Object.values(document.items)
    .filter((item) => item.projectId === project.id)
    .sort((left, right) => (left.startDate ?? left.dueDate ?? '9999-12-31').localeCompare(right.startDate ?? right.dueDate ?? '9999-12-31')
      || left.moduleData.kanban.rank - right.moduleData.kanban.rank), [document.items, project.id]);
  const scheduled = tasks.filter((item) => isScheduledOn(item, selectedDate));
  const unscheduled = tasks.filter((item) => !item.dueDate);
  const selected = localDate(selectedDate);
  const today = dateKey(new Date());

  const createForSelectedDay = () => onCreateTask({
    columnId: plannedColumn?.id,
    startDate: selectedDate,
    dueDate: selectedDate,
  });

  const moveWeek = (change: number) => {
    const nextOffset = offset + change;
    const nextStart = weekStart(nextOffset);
    setOffset(nextOffset);
    setSelectedDate(dateKey(nextStart));
  };

  const resetWeek = () => {
    setOffset(0);
    setSelectedDate(today);
  };

  return (
    <main className="workspace-main mobile-timeline-view page-enter">
      <header className="mobile-view-topbar">
        <div className="mobile-view-project">
          <i style={{ background: project.color }} />
          <span>{project.name}</span>
        </div>
        <button
          className={`mobile-save-control ${dirty ? 'dirty' : ''}`}
          disabled={saveState === 'saving' || (!dirty && saveState === 'synced')}
          onClick={onSave}
          aria-label={t(saveState === 'saving' ? 'Saving' : saveState === 'synced' && !dirty ? 'Saved' : 'Save now')}
        >
          {saveState === 'saving' ? <span className="spinner spinner-dark" /> : <Check size={18} />}
        </button>
      </header>

      <section className="mobile-agenda" aria-label={t('Timeline')}>
        <header className="mobile-agenda-heading">
          <div>
            <span className="mobile-agenda-kicker"><CalendarDays size={16} /> {t('Timeline')}</span>
            <h1>{t('Week of {{date}}', { date: start.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}</h1>
          </div>
          <button className="mobile-agenda-add" onClick={createForSelectedDay}><Plus size={18} /> {t('New task')}</button>
        </header>

        <div className="mobile-agenda-controls" role="group" aria-label={t('Timeline')}>
          <button type="button" className="icon-button" onClick={() => moveWeek(-1)} aria-label={t('Previous range')}><ChevronLeft size={20} /></button>
          <button type="button" onClick={resetWeek}>{t('Today')}</button>
          <button type="button" className="icon-button" onClick={() => moveWeek(1)} aria-label={t('Next range')}><ChevronRight size={20} /></button>
        </div>

        <div className="mobile-week-picker" role="tablist" aria-label={t('Timeline')}>
          {days.map((day) => {
            const key = dateKey(day);
            const active = key === selectedDate;
            const count = tasks.filter((item) => isScheduledOn(item, key)).length;
            return (
              <button
                type="button"
                key={key}
                role="tab"
                aria-selected={active}
                className={`${active ? 'active' : ''} ${key === today ? 'today' : ''}`}
                onClick={() => setSelectedDate(key)}
                aria-label={t('Tasks for {{date}}', { date: day.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' }) })}
              >
                <small>{day.toLocaleDateString(locale, { weekday: 'narrow' })}</small>
                <strong>{day.getDate()}</strong>
                {count > 0 && <i>{count}</i>}
              </button>
            );
          })}
        </div>

        <section className="mobile-agenda-day" aria-labelledby="mobile-agenda-selected-day">
          <header>
            <div>
              <p>{selected.toLocaleDateString(locale, { weekday: 'long' })}</p>
              <h2 id="mobile-agenda-selected-day">{selected.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</h2>
            </div>
            <button type="button" className="icon-button" onClick={createForSelectedDay} aria-label={t('Add task on {{date}}', { date: selected.toLocaleDateString(locale, { month: 'long', day: 'numeric' }) })}><Plus size={20} /></button>
          </header>

          {scheduled.length > 0 ? (
            <div className="mobile-agenda-task-list">
              {scheduled.map((item) => {
                const column = columnById.get(item.moduleData.kanban.columnId);
                return (
                  <button type="button" key={item.id} className="mobile-agenda-task" onClick={() => onOpenTask(item)}>
                    <i style={{ background: column?.color ?? project.color }} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{t(column?.title ?? 'Unknown')} · {taskRange(item, locale)}</small>
                    </span>
                    {item.estimateMinutes && <em><Clock3 size={14} />{t('{{hours}}h', { hours: Math.max(1, Math.round(item.estimateMinutes / 60)) })}</em>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mobile-agenda-empty">
              <p>{t('No tasks on this day')}</p>
              <button type="button" onClick={createForSelectedDay}><Plus size={16} /> {t('Add task')}</button>
            </div>
          )}
        </section>

        {unscheduled.length > 0 && (
          <section className="mobile-unscheduled-tasks">
            <header><span>{t('Unscheduled work')}</span><small>{unscheduled.length}</small></header>
            {unscheduled.map((item) => {
              const column = columnById.get(item.moduleData.kanban.columnId);
              return (
                <button type="button" key={item.id} onClick={() => onOpenTask(item)}>
                  <i style={{ background: column?.color ?? project.color }} />
                  <span><strong>{item.title}</strong><small>{t(column?.title ?? 'Unknown')}</small></span>
                </button>
              );
            })}
          </section>
        )}
      </section>
    </main>
  );
}
