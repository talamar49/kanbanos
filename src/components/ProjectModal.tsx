import { useEffect, useState } from 'react';
import { CalendarDays, FolderKanban, Palette, X } from 'lucide-react';
import type { Project, WorkspaceAction } from '../domain/types';
import { createProject, createProjectSettings, PROJECT_COLORS } from '../domain/workspace';

type Props = {
  project?: Project;
  onAction: (action: WorkspaceAction) => void;
  onClose: () => void;
};

export function ProjectModal({ project, onAction, onClose }: Props) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? '');

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const save = () => {
    const clean = name.trim();
    if (!clean) return;
    if (project) {
      onAction({ type: 'updateProject', projectId: project.id, changes: { name: clean, description: description.trim(), color, targetDate: targetDate || undefined } });
    } else {
      onAction({
        type: 'addProject',
        project: { ...createProject(clean, color, description.trim()), targetDate: targetDate || undefined },
        settings: createProjectSettings(),
      });
    }
    onClose();
  };

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="project-modal modal-enter" role="dialog" aria-modal="true">
        <header className="simple-modal-header">
          <span className="project-modal-icon" style={{ color, background: `${color}17` }}><FolderKanban size={21} /></span>
          <div><h2>{project ? 'Project details' : 'Create a new project'}</h2><p>{project ? 'Keep the purpose clear and recognizable.' : 'Give this stream of work a focused home.'}</p></div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="project-modal-form">
          <label className="field-label">Project name</label>
          <input className="text-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Mobile app launch" autoFocus onKeyDown={(event) => event.key === 'Enter' && save()} />
          <label className="field-label">Short description <span>Optional</span></label>
          <textarea className="text-field" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="What does success look like?" />
          <label className="field-label color-label"><CalendarDays size={14} /> Target date <span>Optional</span></label>
          <input className="text-field" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
          <label className="field-label color-label"><Palette size={14} /> Project color</label>
          <div className="color-options">
            {PROJECT_COLORS.map((value) => <button key={value} aria-label={`Use color ${value}`} className={color === value ? 'selected' : ''} style={{ background: value }} onClick={() => setColor(value)}>{color === value && <span>✓</span>}</button>)}
          </div>
        </div>
        <footer className="simple-modal-footer">
          <button className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={save} disabled={!name.trim()}>{project ? 'Save project' : 'Create project'}</button>
        </footer>
      </section>
    </div>
  );
}
