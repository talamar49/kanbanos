import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarRange,
  ChartNoAxesGantt,
  Cloud,
  ChevronDown,
  CircleHelp,
  Columns3,
  Ellipsis,
  FolderOpen,
  FileClock,
  LogOut,
  Paperclip,
  PenTool,
  Plus,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import kanbanosLogo from '../assets/kanbanos-mascot.png';
import type { Project, WorkspaceDocument, WorkspaceView } from '../domain/types';
import { useI18n } from '../i18n';
import type { SyncIssue } from '../sync-status';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { PreferencesControls } from './PreferencesControls';

type SyncState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  activeProject: Project;
  repositoryName: string;
  syncState: SyncState;
  syncError: string;
  syncIssue?: SyncIssue;
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onSelectProject: (projectId: string) => void;
  onAddProject: () => void;
  onRenameProject: (projectId: string) => void;
  hasRemote: boolean;
  onAddRemote: () => void;
  onRetrySync: () => void;
  onRevealRepository: () => void;
  onOpenDiagnostics?: () => void;
  onDisconnect: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mobile?: boolean;
};

export function Sidebar({
  document,
  activeProject,
  repositoryName,
  syncState,
  syncError,
  syncIssue,
  activeView,
  onChangeView,
  onSelectProject,
  onAddProject,
  onRenameProject,
  hasRemote,
  onAddRemote,
  onRetrySync,
  onRevealRepository,
  onOpenDiagnostics,
  onDisconnect,
  mobileOpen = false,
  onMobileClose,
  mobile = false,
}: Props) {
  const { direction, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!(event.target as Element).closest('.project-menu-host, .project-options-menu')) setProjectMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    const openShortcuts = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener('keydown', openShortcuts);
    return () => window.removeEventListener('keydown', openShortcuts);
  }, []);

  const itemCount = (projectId: string) =>
    Object.values(document.items).filter((item) => item.projectId === projectId).length;
  const activeSyncIssue = syncState === 'error' ? syncIssue ?? 'both' : undefined;
  const syncCopy = activeSyncIssue === 'offline'
    ? { title: 'Offline — saved locally', message: 'Online sync is unavailable because you are not connected to the internet. Your work is still saved on this device.' }
    : activeSyncIssue === 'remote'
      ? { title: 'Online sync paused', message: 'Your work is still saved on this device. Check the connection or remote settings, then try again.' }
      : activeSyncIssue === 'local'
        ? { title: 'Local save paused', message: 'Your work could not be saved on this device. Check your device storage, then try again.' }
        : { title: 'Saving needs attention', message: 'Local saving and online sync are unavailable. Check your device and connection, then try again.' };

  return (
    <>
      <button
        type="button"
        className={`mobile-sidebar-backdrop ${mobileOpen ? 'visible' : ''}`}
        aria-label={t('Close navigation')}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={onMobileClose}
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark brand-mascot"><img src={kanbanosLogo} alt={t('Kanbanos mascot')} /></span>
        <span className="brand-name">Kanbanos</span>
      </div>

      <div className="workspace-switcher" ref={menuRef}>
        <button className="workspace-button" onClick={() => setMenuOpen((open) => !open)}>
          <span className="workspace-avatar">{repositoryName.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-copy">
            <small>{t('Workspace')}</small>
            <strong>{repositoryName}</strong>
          </span>
          <ChevronDown size={15} />
        </button>
        {menuOpen && (
          <div className="popover workspace-menu scale-in">
            <button onClick={() => { onAddRemote(); setMenuOpen(false); }}><Cloud size={15} /> {t(hasRemote ? 'Change remote repository' : 'Add remote repository')}</button>
            <button onClick={() => { onRevealRepository(); setMenuOpen(false); }}><FolderOpen size={15} /> {t(mobile ? 'Export workspace package' : 'Open repository folder')}</button>
            {!mobile && onOpenDiagnostics && <button onClick={() => { onOpenDiagnostics(); setMenuOpen(false); }}><FileClock size={15} /> {t('Diagnostics & logs')}</button>}
            <button><Settings2 size={15} /> {t('Workspace settings')} <span className="coming-pill">{t('Soon')}</span></button>
            <div className="popover-separator" />
            <button className="danger-option" onClick={onDisconnect}><LogOut size={15} /> {t('Disconnect workspace')}</button>
          </div>
        )}
      </div>

      <nav className="primary-nav" aria-label={t('Workspace views')}>
        <p className="nav-label">{t('Workspace')}</p>
        <button className={`nav-item ${activeView === 'board' || activeView === 'list' ? 'active' : ''}`} onClick={() => { onChangeView('board'); onMobileClose?.(); }}><Columns3 size={17} /><span>{t('Project work')}</span></button>
        <button className={`nav-item ${activeView === 'timeline' ? 'active' : ''}`} onClick={() => { onChangeView('timeline'); onMobileClose?.(); }}><CalendarRange size={17} /><span>{t('Timeline')}</span></button>
        <button className={`nav-item canvas-nav-item ${activeView === 'canvas' ? 'active' : ''}`} onClick={() => { onChangeView('canvas'); onMobileClose?.(); }}><PenTool size={17} /><span>{t('Canvas')}</span></button>
        <button className={`nav-item ${activeView === 'roadmap' ? 'active' : ''}`} onClick={() => { onChangeView('roadmap'); onMobileClose?.(); }}><ChartNoAxesGantt size={17} /><span>{t('Roadmap')}</span></button>
        <button className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => { onChangeView('files'); onMobileClose?.(); }}><Paperclip size={17} /><span>{t('Files')}</span><em>{Object.keys(document.resources.attachments).length}</em></button>
      </nav>

      <nav className="project-nav" aria-label={t('Projects')}>
        <div className="nav-label-row">
          <p className="nav-label">{t('Projects')}</p>
          <button className="icon-button icon-button-small" aria-label={t('Add project')} onClick={onAddProject}><Plus size={15} /></button>
        </div>
        <div className="project-list">
          {document.projects.filter((project) => !project.archived).map((project) => (
            <div className="project-list-row" key={project.id}>
              <button
                className={`project-item ${activeProject.id === project.id ? 'active' : ''}`}
                onClick={() => { onSelectProject(project.id); setProjectMenu(null); onMobileClose?.(); }}
                onDoubleClick={() => onRenameProject(project.id)}
                title={t('Double-click to rename')}
              >
                <span className="project-dot" style={{ background: project.color }} />
                <span>{project.name}</span>
                <small>{itemCount(project.id)}</small>
              </button>
              <div className="project-menu-host">
                <button
                  className="project-more"
                  aria-label={t('Options for {{name}}', { name: project.name })}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setProjectMenu((current) => current?.id === project.id
                      ? null
                      : { id: project.id, top: bounds.bottom + 5, left: direction === 'rtl' ? bounds.left : bounds.right - 150 });
                  }}
                ><Ellipsis size={16} /></button>
                {projectMenu?.id === project.id && createPortal(
                  <div
                    className="popover project-options-menu project-options-portal scale-in"
                    style={{ top: projectMenu.top, left: projectMenu.left }}
                  >
                    <button onClick={() => { onRenameProject(project.id); setProjectMenu(null); }}>{t('Rename project')}</button>
                  </div>,
                  window.document.body,
                )}
              </div>
            </div>
          ))}
        </div>
        <button className="new-project-button" onClick={onAddProject}><Plus size={15} /> {t('New project')}</button>
      </nav>

      <div className="sidebar-footer">
        {mobile && <PreferencesControls className="sidebar-preferences" expanded />}
        <div className={`sync-indicator sync-${syncState} ${activeSyncIssue ? `sync-issue-${activeSyncIssue}` : ''}`}>
          <span className="sync-dot">{syncState === 'saving' && <span className="sync-pulse" />}</span>
          <div className="sync-copy">
            <strong>{t(syncState === 'saving' ? 'Saving changes' : syncState === 'error' ? syncCopy.title : syncState === 'local' ? 'Saved locally' : syncState === 'synced' ? 'All changes saved' : 'Ready to save')}</strong>
            <small
              className={syncState === 'error' ? 'sync-status-message' : ''}
              title={syncState === 'error' ? t(syncError || 'Git sync failed. Check the remote and try again.') : undefined}
            >
              {t(syncState === 'error' ? syncCopy.message : syncState === 'local' ? 'No remote configured' : 'Git-backed workspace')}
            </small>
            {syncState === 'error' && (
              <div className="sync-error-actions">
                <button onClick={onRetrySync}><RefreshCw size={14} /> {t(activeSyncIssue === 'local' ? 'Retry save' : 'Retry sync')}</button>
                {!mobile && onOpenDiagnostics && <button onClick={onOpenDiagnostics}>{t('View logs')}</button>}
                {activeSyncIssue !== 'local' && <button onClick={onAddRemote}>{t('Credentials')}</button>}
              </div>
            )}
          </div>
        </div>
        <button
          className="help-button"
          aria-haspopup="dialog"
          aria-expanded={shortcutsOpen}
          aria-keyshortcuts="?"
          onClick={() => setShortcutsOpen(true)}
        ><CircleHelp size={18} /> {t('Help & shortcuts')} <kbd>?</kbd></button>
        <div className="profile-row">
          <span className="profile-avatar">YO</span>
          <div><strong>{t('Your workspace')}</strong><small>{t('Private by default')}</small></div>
          <button className="icon-button"><Settings2 size={16} /></button>
        </div>
      </div>
      </aside>
      {shortcutsOpen && createPortal(
        <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />,
        window.document.body,
      )}
    </>
  );
}
