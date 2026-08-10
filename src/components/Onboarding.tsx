import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Cloud,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  LockKeyhole,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import kanbanosLogo from '../assets/kanbanos-logo.png';

type Props = {
  recentWorkspaces: RepositoryConnection[];
  onOpenRecent: (repositoryPath: string) => Promise<void>;
  onRemoveRecent: (repositoryPath: string) => Promise<void>;
  onCreateLocal: (name: string) => Promise<void>;
  onConnectRemote: (url: string) => Promise<void>;
  onChooseLocal: () => Promise<void>;
};

export function Onboarding({
  recentWorkspaces,
  onOpenRecent,
  onRemoveRecent,
  onCreateLocal,
  onConnectRemote,
  onChooseLocal,
}: Props) {
  const [mode, setMode] = useState<'home' | 'create' | 'remote'>('home');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'create' | 'remote' | 'local' | 'recent' | null>(null);
  const [activeRecentPath, setActiveRecentPath] = useState('');
  const [error, setError] = useState('');

  const createLocal = async () => {
    if (!name.trim()) {
      setError('Give your workspace a name to continue.');
      return;
    }
    setBusy('create');
    setError('');
    try {
      await onCreateLocal(name.trim());
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : 'Could not create the workspace.');
    } finally {
      setBusy(null);
    }
  };

  const connectRemote = async () => {
    if (!url.trim()) {
      setError('Paste a Git repository URL to continue.');
      return;
    }
    setBusy('remote');
    setError('');
    try {
      await onConnectRemote(url.trim());
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  };

  const chooseLocal = async () => {
    setBusy('local');
    setError('');
    try {
      await onChooseLocal();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Could not open that workspace folder.');
    } finally {
      setBusy(null);
    }
  };

  const openRecent = async (repositoryPath: string) => {
    setBusy('recent');
    setActiveRecentPath(repositoryPath);
    setError('');
    try {
      await onOpenRecent(repositoryPath);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open that workspace.');
    } finally {
      setBusy(null);
      setActiveRecentPath('');
    }
  };

  const switchMode = (nextMode: 'home' | 'create' | 'remote') => {
    setMode(nextMode);
    setError('');
  };

  return (
    <main className="onboarding page-enter">
      <section className="onboarding-visual" aria-label="Kanbanos preview">
        <div className="onboarding-glow onboarding-glow-one" />
        <div className="onboarding-glow onboarding-glow-two" />
        <img className="mascot-cameo" src={kanbanosLogo} alt="Kabanos, the cheerful Kanbanos mascot" />
        <div className="preview-brand">
          <span className="brand-mark brand-mark-light brand-mascot"><img src={kanbanosLogo} alt="" /></span>
          <span>Kanbanos</span>
        </div>
        <div className="onboarding-message">
          <div className="eyebrow"><Sparkles size={14} /> Thoughtfully simple</div>
          <h1>Make space for<br />meaningful work.</h1>
          <p>A calm, focused home for your projects—designed to help ideas move forward.</p>
        </div>
        <div className="board-preview" aria-hidden="true">
          <div className="preview-column preview-column-back">
            <div className="preview-column-title"><i /> Planned <span>3</span></div>
            <div className="preview-task preview-task-muted">
              <small>RESEARCH</small>
              <strong>Explore onboarding flows</strong>
              <div className="preview-meta"><span>◷ Tomorrow</span><b>AM</b></div>
            </div>
          </div>
          <div className="preview-column preview-column-front">
            <div className="preview-column-title"><i /> In progress <span>2</span></div>
            <div className="preview-task">
              <small>PRODUCT · DESIGN</small>
              <strong>Shape the launch experience</strong>
              <p>Bring the last details together.</p>
              <div className="preview-progress"><span style={{ width: '66%' }} /></div>
              <div className="preview-meta"><span><Check size={12} /> 2 of 3</span><b>SK</b></div>
            </div>
            <div className="preview-task preview-small">
              <small>ENGINEERING</small>
              <strong>Polish desktop interactions</strong>
            </div>
          </div>
        </div>
        <p className="onboarding-quote">“Clarity is a form of kindness.”</p>
      </section>

      <section className="onboarding-connect">
        <div className="connect-panel startup-panel">
          {mode === 'home' && (
            <>
              <div className="connect-icon"><FolderGit2 size={23} /></div>
              <p className="step-label">YOUR WORKSPACES</p>
              <h2>{recentWorkspaces.length ? 'Welcome back' : 'Start your first workspace'}</h2>
              <p className="connect-lead startup-lead">
                {recentWorkspaces.length
                  ? 'Continue where you left off, or open another workspace.'
                  : 'Create a private local workspace, open one from this device, or clone one from a remote repository.'}
              </p>

              {recentWorkspaces.length > 0 && (
                <div className="recent-workspaces">
                  <p>RECENT</p>
                  <div className="recent-workspace-list">
                    {recentWorkspaces.map((workspace) => (
                      <div className="recent-workspace-row" key={workspace.repositoryPath}>
                        <button className="recent-workspace-main" onClick={() => void openRecent(workspace.repositoryPath)} disabled={busy !== null}>
                          <span className="recent-workspace-icon" style={{ background: workspace.remoteUrl ? '#e9f3f7' : '#efedfb', color: workspace.remoteUrl ? '#477c94' : '#6559c1' }}>
                            {workspace.remoteUrl ? <Cloud size={17} /> : <HardDrive size={17} />}
                          </span>
                          <span className="recent-workspace-copy">
                            <strong>{workspace.displayName}</strong>
                            <small title={workspace.repositoryPath}>{workspace.repositoryPath}</small>
                          </span>
                          {busy === 'recent' && activeRecentPath === workspace.repositoryPath ? <span className="spinner spinner-dark" /> : <ChevronRight size={16} />}
                        </button>
                        <button className="recent-remove" title="Remove from recent workspaces" aria-label={`Remove ${workspace.displayName} from recent workspaces`} onClick={() => void onRemoveRecent(workspace.repositoryPath)}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="form-error startup-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => switchMode('create')} disabled={busy !== null}>
                <Plus size={17} /> Create a new workspace
              </button>

              <div className="or-divider"><span>or open an existing workspace</span></div>
              <div className="startup-actions">
                <button onClick={() => void chooseLocal()} disabled={busy !== null}>
                  <span><FolderOpen size={18} /></span>
                  <div><strong>Open workspace folder</strong><small>Find its folder on this device</small></div>
                  {busy === 'local' ? <span className="spinner spinner-dark" /> : <ChevronRight size={15} />}
                </button>
                <button onClick={() => switchMode('remote')} disabled={busy !== null}>
                  <span><GitBranch size={18} /></span>
                  <div><strong>Clone remote workspace</strong><small>Download from a Git URL</small></div>
                  <ChevronRight size={15} />
                </button>
              </div>
            </>
          )}

          {mode === 'create' && (
            <>
              <button className="back-link" onClick={() => switchMode('home')}><ArrowLeft size={14} /> Back to workspaces</button>
              <div className="connect-icon"><FolderPlus size={23} /></div>
              <p className="step-label">NEW LOCAL WORKSPACE</p>
              <h2>Create your workspace</h2>
              <p className="connect-lead">
                Name it first, then choose exactly where its folder should be created. A remote can be added later.
              </p>
              <label className="field-label" htmlFor="workspace-name">Workspace name</label>
              <div className={`repository-field ${error ? 'field-error' : ''}`}>
                <FolderGit2 size={17} />
                <input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => { setName(event.target.value); setError(''); }}
                  onKeyDown={(event) => event.key === 'Enter' && void createLocal()}
                  placeholder="My creative workspace"
                  autoFocus
                />
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => void createLocal()} disabled={busy !== null}>
                {busy === 'create' ? <span className="spinner" /> : <>Choose location <ArrowRight size={17} /></>}
              </button>
            </>
          )}

          {mode === 'remote' && (
            <>
              <button className="back-link" onClick={() => switchMode('home')}><ArrowLeft size={14} /> Back to workspaces</button>
              <div className="connect-icon"><GitBranch size={23} /></div>
              <p className="step-label">REMOTE WORKSPACE</p>
              <h2>Clone a remote workspace</h2>
              <p className="connect-lead">
                Paste the Git URL. Kanbanos will clone the workspace to this device and remember it here.
              </p>
              <label className="field-label" htmlFor="repository-url">Git repository URL</label>
              <div className={`repository-field ${error ? 'field-error' : ''}`}>
                <GitBranch size={17} />
                <input
                  id="repository-url"
                  value={url}
                  onChange={(event) => { setUrl(event.target.value); setError(''); }}
                  onKeyDown={(event) => event.key === 'Enter' && void connectRemote()}
                  placeholder="https://git.example.com/you/workspace.git"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => void connectRemote()} disabled={busy !== null}>
                {busy === 'remote' ? <span className="spinner" /> : <>Clone workspace <ArrowRight size={17} /></>}
              </button>
            </>
          )}

          <div className="trust-note startup-trust">
            <LockKeyhole size={16} />
            <span><strong>Your work stays yours.</strong> Workspaces live in folders you control.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
