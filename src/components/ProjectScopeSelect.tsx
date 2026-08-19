import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Folder, Layers3 } from 'lucide-react';
import type { Project, ProjectScope } from '../domain/types';
import { useI18n } from '../i18n';

type Props = {
  project: Project;
  value: ProjectScope;
  onChange: (scope: ProjectScope) => void;
  content?: 'missions' | 'notes';
};

export function ProjectScopeSelect({ project, value, onChange, content = 'missions' }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const allProjects = value === 'all';

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, []);

  useEffect(() => setOpen(false), [project.id, value]);

  const choose = (scope: ProjectScope) => {
    onChange(scope);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={`project-scope-select ${allProjects ? 'all-projects' : ''} ${open ? 'open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="project-scope-trigger"
        aria-label={t(content === 'notes' ? 'Note scope' : 'Mission scope')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={`project-scope-icon ${allProjects ? 'workspace-scope' : ''}`}
          style={allProjects ? undefined : { color: project.color, background: `${project.color}18` }}
        >
          {allProjects ? <Layers3 size={15} /> : <Folder size={15} />}
        </span>
        <span className="project-scope-value">{allProjects ? t('All projects') : project.name}</span>
        <ChevronDown className="project-scope-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <div id={menuId} className="popover project-scope-menu scale-in" role="listbox" aria-label={t(content === 'notes' ? 'Note scope' : 'Mission scope')}>
          <p>{t(content === 'notes' ? 'View notes from' : 'View missions from')}</p>
          <button className={value === 'current' ? 'selected' : ''} role="option" aria-selected={value === 'current'} onClick={() => choose('current')}>
            <span className="project-scope-option-icon" style={{ color: project.color, background: `${project.color}18` }}><Folder size={16} /></span>
            <span className="project-scope-option-copy"><strong>{project.name}</strong><small>{t('Current project')}</small></span>
            <span className="project-scope-check">{value === 'current' && <Check size={15} />}</span>
          </button>
          <button className={value === 'all' ? 'selected' : ''} role="option" aria-selected={value === 'all'} onClick={() => choose('all')}>
            <span className="project-scope-option-icon workspace-scope"><Layers3 size={16} /></span>
            <span className="project-scope-option-copy"><strong>{t('All projects')}</strong><small>{t('Across this workspace')}</small></span>
            <span className="project-scope-check">{value === 'all' && <Check size={15} />}</span>
          </button>
        </div>
      )}
    </div>
  );
}
