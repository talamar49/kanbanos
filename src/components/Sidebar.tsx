import { useEffect, useRef, useState } from 'react';
import {
  CalendarRange,
  ChartNoAxesGantt,
  Cloud,
  ChevronDown,
  CircleHelp,
  Columns3,
  Ellipsis,
  FolderOpen,
  LogOut,
  Plus,
  Settings2,
} from 'lucide-react';
import kanbanosLogo from '../assets/kanbanos-logo.png';
import type { Project, WorkspaceDocument, WorkspaceView } from '../domain/types';

type SyncState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  activeProject: Project;
  repositoryName: string;
  syncState: SyncState;
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onRenameProject: (projectId: string) => void;
  hasRemote: boolean;
  onAddRemote: () => void;
  onRevealRepository: () => void;
  onDisconnect: () => void;
};

export function Sidebar({
  document,
  activeProject,
  repositoryName,
  syncState,
  activeView,
  onChangeView,
  onSelectProject,
  onAddProject,
  onRenameProject,
  hasRemote,
  onAddRemote,
  onRevealRepository,
  onDisconnect,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!(event.target as Element).closest('.project-menu-host')) setProjectMenuId(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const itemCount = (projectId: string) =>
    Object.values(document.items).filter((item) => item.projectId === projectId).length;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark brand-mascot"><img src={kanbanosLogo} alt="Kanbanos mascot" /></span>
        <span className="brand-name">Kanbanos</span>
      </div>

      <div className="workspace-switcher" ref={menuRef}>
        <button className="workspace-button" onClick={() => setMenuOpen((open) => !open)}>
          <span className="workspace-avatar">{repositoryName.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-copy">
            <small>WORKSPACE</small>
            <strong>{repositoryName}</strong>
          </span>
          <ChevronDown size={15} />
        </button>
        {menuOpen && (
          <div className="popover workspace-menu scale-in">
            <button onClick={() => { onAddRemote(); setMenuOpen(false); }}><Cloud size={15} /> {hasRemote ? 'Change remote repository' : 'Add remote repository'}</button>
            <button onClick={onRevealRepository}><FolderOpen size={15} /> Open repository folder</button>
            <button><Settings2 size={15} /> Workspace settings <span className="coming-pill">Soon</span></button>
            <div className="popover-separator" />
            <button className="danger-option" onClick={onDisconnect}><LogOut size={15} /> Disconnect workspace</button>
          </div>
        )}
      </div>

      <nav className="primary-nav" aria-label="Workspace views">
        <p className="nav-label">WORKSPACE</p>
        <button className={`nav-item ${activeView === 'board' || activeView === 'list' ? 'active' : ''}`} onClick={() => onChangeView('board')}><Columns3 size={17} /><span>Project work</span></button>
        <button className={`nav-item ${activeView === 'timeline' ? 'active' : ''}`} onClick={() => onChangeView('timeline')}><CalendarRange size={17} /><span>Timeline</span></button>
        <button className={`nav-item ${activeView === 'roadmap' ? 'active' : ''}`} onClick={() => onChangeView('roadmap')}><ChartNoAxesGantt size={17} /><span>Roadmap</span></button>
      </nav>

      <nav className="project-nav" aria-label="Projects">
        <div className="nav-label-row">
          <p className="nav-label">PROJECTS</p>
          <button className="icon-button icon-button-small" aria-label="Add project" onClick={onAddProject}><Plus size={15} /></button>
        </div>
        <div className="project-list">
          {document.projects.filter((project) => !project.archived).map((project) => (
            <div className="project-list-row" key={project.id}>
              <button
                className={`project-item ${activeProject.id === project.id ? 'active' : ''}`}
                onClick={() => { onSelectProject(project.id); setProjectMenuId(null); }}
                onDoubleClick={() => onRenameProject(project.id)}
                title="Double-click to rename"
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span>{project.name}</span>
                <small>{itemCount(project.id)}</small>
              </button>
              <div className="project-menu-host">
                <button
                  className="project-more"
                  aria-label={`Options for ${project.name}`}
                  onClick={() => setProjectMenuId((current) => current === project.id ? null : project.id)}
                ><Ellipsis size={16} /></button>
                {projectMenuId === project.id && (
                  <div className="popover project-options-menu scale-in">
                    <button onClick={() => { onRenameProject(project.id); setProjectMenuId(null); }}>Rename project</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <button className="new-project-button" onClick={onAddProject}><Plus size={15} /> New project</button>
      </nav>

      <div className="sidebar-footer">
        <div className={`sync-indicator sync-${syncState}`}>
          <span className="sync-dot">{syncState === 'saving' && <span className="sync-pulse" />}</span>
          <div>
            <strong>{syncState === 'saving' ? 'Saving changes' : syncState === 'error' ? 'Sync needs attention' : syncState === 'local' ? 'Saved locally' : syncState === 'synced' ? 'All changes saved' : 'Ready to save'}</strong>
            <small>{syncState === 'error' ? 'Your local work is safe' : syncState === 'local' ? 'No remote configured' : 'Git-backed workspace'}</small>
          </div>
        </div>
        <button className="help-button"><CircleHelp size={17} /> Help & shortcuts <kbd>?</kbd></button>
        <div className="profile-row">
          <span className="profile-avatar">YO</span>
          <div><strong>Your workspace</strong><small>Private by default</small></div>
          <button className="icon-button"><Settings2 size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
