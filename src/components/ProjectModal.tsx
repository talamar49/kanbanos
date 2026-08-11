import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, FolderKanban, Palette, X } from 'lucide-react';
import type { Project, WorkspaceAction } from '../domain/types';
import { createProject, createProjectSettings, PROJECT_COLORS } from '../domain/workspace';
import { useI18n } from '../i18n';

type Props = {
  project?: Project;
  initialTargetDate?: string;
  onAction: (action: WorkspaceAction) => void;
  onClose: () => void;
};

export function ProjectModal({ project, initialTargetDate, onAction, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? initialTargetDate ?? '');
  const lastSaved = useRef('');
  const snapshot = JSON.stringify({ name, description, color, targetDate });

  if (!lastSaved.current && project) lastSaved.current = snapshot;

  const persist = useCallback(() => {
    const clean = name.trim();
    if (!project || !clean || snapshot === lastSaved.current) return;
    onAction({
      type: 'updateProject',
      projectId: project.id,
      changes: { name: clean, description: description.trim(), color, targetDate: targetDate || undefined },
    });
    lastSaved.current = snapshot;
  }, [color, description, name, onAction, project, snapshot, targetDate]);

  useEffect(() => {
    if (!project || snapshot === lastSaved.current || !name.trim()) return;
    const timer = window.setTimeout(persist, 350);
    return () => window.clearTimeout(timer);
  }, [name, persist, project, snapshot]);

  const finish = useCallback(() => {
    persist();
    onClose();
  }, [onClose, persist]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && finish();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [finish]);

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    onAction({
      type: 'addProject',
      project: { ...createProject(clean, color, description.trim()), targetDate: targetDate || undefined },
      settings: createProjectSettings(),
    });
    onClose();
  };

  const submit = project ? finish : create;

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && finish()}>
      <section className="project-modal modal-enter" role="dialog" aria-modal="true">
        <header className="simple-modal-header">
          <span className="project-modal-icon" style={{ color, background: `${color}17` }}><FolderKanban size={21} /></span>
          <div><h2>{t(project ? 'Project details' : 'Create a new project')}</h2><p>{t(project ? 'Every change is saved automatically.' : 'Give this stream of work a focused home.')}</p></div>
          <button className="icon-button" onClick={finish} aria-label={t('Close')}><X size={18} /></button>
        </header>
        <div className="project-modal-form">
          <label className="field-label">{t('Project name')}</label>
          <input className="text-field" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('e.g. Mobile app launch')} autoFocus onKeyDown={(event) => event.key === 'Enter' && submit()} />
          <label className="field-label">{t('Short description')} <span>{t('Optional')}</span></label>
          <textarea className="text-field" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder={t('What does success look like?')} />
          <label className="field-label color-label"><CalendarDays size={14} /> {t('Target date')} <span>{t('Optional')}</span></label>
          <input className="text-field" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          <label className="field-label color-label"><Palette size={14} /> {t('Project color')}</label>
          <div className="color-options">
            {PROJECT_COLORS.map((value) => <button key={value} aria-label={t('Use color {{color}}', { color: value })} className={color === value ? 'selected' : ''} style={{ background: value }} onClick={() => setColor(value)}>{color === value && <span>✓</span>}</button>)}
          </div>
        </div>
        <footer className="simple-modal-footer">
          {project && <span className="project-autosave"><Check size={13} /> {t('Saved automatically')}</span>}
          <button className="button button-secondary" onClick={finish}>{t(project ? 'Done action' : 'Cancel')}</button>
          {!project && <button className="button button-primary" onClick={create} disabled={!name.trim()}>{t('Create project')}</button>}
        </footer>
      </section>
    </div>
  );
}
