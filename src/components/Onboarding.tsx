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
import kanbanosLogo from '../assets/kanbanos-mascot.png';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';

type Props = {
  recentWorkspaces: RepositoryConnection[];
  onOpenRecent: (repositoryPath: string) => Promise<void>;
  onRemoveRecent: (repositoryPath: string) => Promise<void>;
  onCreateLocal: (name: string) => Promise<void>;
  onConnectRemote: (url: string, credentials?: GitCredentials) => Promise<void>;
  onChooseLocal: () => Promise<void>;
  mobile?: boolean;
};

export function Onboarding({
  recentWorkspaces,
  onOpenRecent,
  onRemoveRecent,
  onCreateLocal,
  onConnectRemote,
  onChooseLocal,
  mobile = false,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'home' | 'create' | 'remote'>('home');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [privateRepository, setPrivateRepository] = useState(false);
  const [gitUsername, setGitUsername] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [busy, setBusy] = useState<'create' | 'remote' | 'local' | 'recent' | null>(null);
  const [activeRecentPath, setActiveRecentPath] = useState('');
  const [startOptionsOpen, setStartOptionsOpen] = useState(false);
  const [error, setError] = useState('');

  const createLocal = async () => {
    if (!name.trim()) {
      setError(t('Give your workspace a name to continue.'));
      return;
    }
    setBusy('create');
    setError('');
    try {
      await onCreateLocal(name.trim());
    } catch (creationError) {
      setError(creationError instanceof Error ? t(creationError.message) : t('Could not create the workspace.'));
    } finally {
      setBusy(null);
    }
  };

  const connectRemote = async () => {
    if (!url.trim()) {
      setError(t('Paste a Git repository URL to continue.'));
      return;
    }
    if (privateRepository && !gitToken.trim()) {
      setError(t('Enter a personal access token or password to continue.'));
      return;
    }
    setBusy('remote');
    setError('');
    try {
      await onConnectRemote(
        url.trim(),
        privateRepository ? { username: gitUsername.trim(), token: gitToken } : undefined,
      );
    } catch (connectionError) {
      setError(connectionError instanceof Error ? t(connectionError.message) : t('Could not connect.'));
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
      setError(connectionError instanceof Error ? t(connectionError.message) : t('Could not open that workspace folder.'));
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
      setError(openError instanceof Error ? t(openError.message) : t('Could not open that workspace.'));
    } finally {
      setBusy(null);
      setActiveRecentPath('');
    }
  };

  const switchMode = (nextMode: 'home' | 'create' | 'remote') => {
    setMode(nextMode);
    setStartOptionsOpen(false);
    setError('');
  };

  if (mobile) {
    return (
      <main className="mobile-onboarding page-enter">
        <header className="mobile-onboarding-header">
          <div className="mobile-onboarding-brand">
            <span className="brand-mark brand-mascot"><img src={kanbanosLogo} alt="" /></span>
            <strong>Kanbanos</strong>
          </div>
          <PreferencesControls className="mobile-onboarding-preferences" />
        </header>

        {mode === 'home' && (
          <section className="mobile-onboarding-home">
            <div className="mobile-onboarding-hero">
              <div className="mobile-onboarding-hero-art">
                <span className="mobile-onboarding-hero-glow" />
                <span className="mobile-onboarding-hero-spark hero-spark-one"><Sparkles size={19} /></span>
                <span className="mobile-onboarding-hero-spark hero-spark-two"><Sparkles size={14} /></span>
                <img src={kanbanosLogo} alt={t('Kanbanos mascot')} />
              </div>
              <h1>{t(recentWorkspaces.length ? 'Welcome back' : 'Your work, your device.')}</h1>
              <p>{t(recentWorkspaces.length ? 'Pick up where you left off or start something new.' : 'Create a private workspace that is yours to keep.')}</p>
            </div>

            {recentWorkspaces.length > 0 && (
              <section className="mobile-recent-workspaces" aria-label={t('Continue working')}>
                <h2>{t('Continue working')}</h2>
                <div className="mobile-recent-workspace-list">
                  {recentWorkspaces.map((workspace) => (
                    <div className="mobile-recent-workspace" key={workspace.repositoryPath}>
                      <button type="button" onClick={() => void openRecent(workspace.repositoryPath)} disabled={busy !== null}>
                        <span className="mobile-recent-workspace-icon" style={{ background: workspace.remoteUrl ? '#e9f3f7' : '#efedfb', color: workspace.remoteUrl ? '#477c94' : '#6559c1' }}>
                          {workspace.remoteUrl ? <Cloud size={18} /> : <HardDrive size={18} />}
                        </span>
                        <span><strong>{workspace.displayName}</strong><small>{t('Stored securely on this device')}</small></span>
                        {busy === 'recent' && activeRecentPath === workspace.repositoryPath ? <span className="spinner spinner-dark" /> : <ChevronRight size={18} />}
                      </button>
                      <button
                        type="button"
                        className="mobile-recent-remove"
                        aria-label={t('Remove {{name}} from this device', { name: workspace.displayName })}
                        onClick={() => void onRemoveRecent(workspace.repositoryPath)}
                      ><X size={17} /></button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {error && <p className="form-error mobile-onboarding-error" role="alert">{error}</p>}
            <button type="button" className="mobile-onboarding-primary" onClick={() => switchMode('create')} disabled={busy !== null}>
              <Plus size={19} /> {t('New workspace')}
            </button>
            <button
              type="button"
              className="mobile-onboarding-more"
              aria-expanded={startOptionsOpen}
              onClick={() => setStartOptionsOpen((open) => !open)}
            >{t('More ways to start')} <ChevronRight size={17} /></button>
            {startOptionsOpen && (
              <div className="mobile-onboarding-options slide-up">
                <button type="button" onClick={() => void chooseLocal()} disabled={busy !== null}>
                  <FolderOpen size={19} />
                  <span><strong>{t('Import workspace package')}</strong><small>{t('Start from a workspace package or a Git repository.')}</small></span>
                  {busy === 'local' ? <span className="spinner spinner-dark" /> : <ChevronRight size={17} />}
                </button>
                <button type="button" onClick={() => switchMode('remote')} disabled={busy !== null}>
                  <GitBranch size={19} />
                  <span><strong>{t('Clone remote workspace')}</strong><small>{t('Download from a Git URL')}</small></span>
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
            <p className="mobile-onboarding-storage"><LockKeyhole size={15} /> {t('Workspaces are stored privately on this device and can be exported at any time.')}</p>
          </section>
        )}

        {mode === 'create' && (
          <section className="mobile-onboarding-sheet slide-up">
            <button type="button" className="mobile-onboarding-back" onClick={() => switchMode('home')}><ArrowLeft size={17} /> {t('Back to workspaces')}</button>
            <span className="mobile-onboarding-orb"><FolderPlus size={22} /></span>
            <h1>{t('Name your workspace')}</h1>
            <p>{t('A private Git workspace will be created on this device.')}</p>
            <label className="field-label" htmlFor="mobile-workspace-name">{t('Workspace name')}</label>
            <div className={`repository-field ${error ? 'field-error' : ''}`}>
              <FolderGit2 size={18} />
              <input
                id="mobile-workspace-name"
                value={name}
                onChange={(event) => { setName(event.target.value); setError(''); }}
                onKeyDown={(event) => event.key === 'Enter' && void createLocal()}
                placeholder={t('My creative workspace')}
                autoFocus
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="mobile-onboarding-primary" onClick={() => void createLocal()} disabled={busy !== null}>
              {busy === 'create' ? <span className="spinner" /> : <><Plus size={19} /> {t('Create workspace')}</>}
            </button>
          </section>
        )}

        {mode === 'remote' && (
          <section className="mobile-onboarding-sheet mobile-remote-sheet slide-up">
            <button type="button" className="mobile-onboarding-back" onClick={() => switchMode('home')}><ArrowLeft size={17} /> {t('Back to workspaces')}</button>
            <span className="mobile-onboarding-orb"><GitBranch size={22} /></span>
            <h1>{t('Clone a remote workspace')}</h1>
            <p>{t('Paste the Git URL. Kanbanos will clone the workspace to this device and remember it here.')}</p>
            <label className="field-label" htmlFor="mobile-repository-url">{t('Git repository URL')}</label>
            <div className={`repository-field ${error ? 'field-error' : ''}`}>
              <GitBranch size={18} />
              <input
                id="mobile-repository-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={url}
                onChange={(event) => { setUrl(event.target.value); setError(''); }}
                onKeyDown={(event) => event.key === 'Enter' && void connectRemote()}
                placeholder="https://git.example.com/you/workspace.git"
                spellCheck={false}
                autoFocus
              />
            </div>
            <label className="private-auth-toggle mobile-private-auth-toggle">
              <input
                type="checkbox"
                checked={privateRepository}
                onChange={(event) => {
                  setPrivateRepository(event.target.checked);
                  if (!event.target.checked) setGitToken('');
                  setError('');
                }}
              />
              <span><strong>{t('Private HTTPS repository')}</strong><small>{t('Authenticate with a personal access token or password')}</small></span>
            </label>
            {privateRepository && (
              <div className="mobile-private-auth-fields">
                <label>
                  <span className="field-label">{t('Username (optional)')}</span>
                  <div className="repository-field"><input value={gitUsername} onChange={(event) => { setGitUsername(event.target.value); setError(''); }} placeholder="oauth2" autoComplete="username" dir="ltr" /></div>
                </label>
                <label>
                  <span className="field-label">{t('Personal access token or password')}</span>
                  <div className={`repository-field ${error && !gitToken.trim() ? 'field-error' : ''}`}><input type="password" value={gitToken} onChange={(event) => { setGitToken(event.target.value); setError(''); }} onKeyDown={(event) => event.key === 'Enter' && void connectRemote()} placeholder={t('Token with repository access')} autoComplete="off" dir="ltr" /></div>
                </label>
              </div>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="mobile-onboarding-primary" onClick={() => void connectRemote()} disabled={busy !== null}>
              {busy === 'remote' ? <span className="spinner" /> : <><GitBranch size={18} /> {t('Clone workspace')}</>}
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="onboarding page-enter">
      <PreferencesControls className="onboarding-preferences" expanded />
      <section className="onboarding-visual" aria-label={t('Kanbanos preview')}>
        <div className="onboarding-glow onboarding-glow-one" />
        <div className="onboarding-glow onboarding-glow-two" />
        <img className="mascot-cameo" src={kanbanosLogo} alt={t('Kabanos, the cheerful Kanbanos mascot')} />
        <div className="preview-brand">
          <span className="brand-mark brand-mark-light brand-mascot"><img src={kanbanosLogo} alt="" /></span>
          <span>Kanbanos</span>
        </div>
        <div className="onboarding-message">
          <div className="eyebrow"><Sparkles size={14} /> {t('Thoughtfully simple')}</div>
          <h1>{t('Make space for meaningful work.')}</h1>
          <p>{t('A calm, focused home for your projects—designed to help ideas move forward.')}</p>
        </div>
        <div className="board-preview" aria-hidden="true">
          <div className="preview-column preview-column-back">
            <div className="preview-column-title"><i /> {t('Planned')} <span>3</span></div>
            <div className="preview-task preview-task-muted">
              <small>{t('Research')}</small>
              <strong>{t('Explore onboarding flows')}</strong>
              <div className="preview-meta"><span>◷ {t('Tomorrow')}</span><b>AM</b></div>
            </div>
          </div>
          <div className="preview-column preview-column-front">
            <div className="preview-column-title"><i /> {t('In progress')} <span>2</span></div>
            <div className="preview-task">
              <small>{t('Product · Design')}</small>
              <strong>{t('Shape the launch experience')}</strong>
              <p>{t('Bring the last details together.')}</p>
              <div className="preview-progress"><span style={{ width: '66%' }} /></div>
              <div className="preview-meta"><span><Check size={12} /> {t('2 of 3')}</span><b>SK</b></div>
            </div>
            <div className="preview-task preview-small">
              <small>{t('Engineering')}</small>
              <strong>{t('Polish desktop interactions')}</strong>
            </div>
          </div>
        </div>
        <p className="onboarding-quote">{t('“Clarity is a form of kindness.”')}</p>
      </section>

      <section className="onboarding-connect">
        <div className="connect-panel startup-panel">
          {mode === 'home' && (
            <>
              <div className="connect-icon"><FolderGit2 size={23} /></div>
              <p className="step-label">{t('Your workspaces')}</p>
              <h2>{t(recentWorkspaces.length ? 'Welcome back' : 'Start your first workspace')}</h2>
              <p className="connect-lead startup-lead">
                {t(recentWorkspaces.length
                  ? 'Continue where you left off, or open another workspace.'
                  : mobile
                    ? 'Create a private workspace on this device, import a workspace package, or clone one from a remote repository.'
                    : 'Create a private local workspace, open one from this device, or clone one from a remote repository.')}
              </p>

              {recentWorkspaces.length > 0 && (
                <div className="recent-workspaces">
                  <p>{t('Recent')}</p>
                  <div className="recent-workspace-list">
                    {recentWorkspaces.map((workspace) => (
                      <div className="recent-workspace-row" key={workspace.repositoryPath}>
                        <button className="recent-workspace-main" onClick={() => void openRecent(workspace.repositoryPath)} disabled={busy !== null}>
                          <span className="recent-workspace-icon" style={{ background: workspace.remoteUrl ? '#e9f3f7' : '#efedfb', color: workspace.remoteUrl ? '#477c94' : '#6559c1' }}>
                            {workspace.remoteUrl ? <Cloud size={17} /> : <HardDrive size={17} />}
                          </span>
                          <span className="recent-workspace-copy">
                            <strong>{workspace.displayName}</strong>
                            <small title={mobile ? undefined : workspace.repositoryPath}>{mobile ? t('Stored securely on this device') : workspace.repositoryPath}</small>
                          </span>
                          {busy === 'recent' && activeRecentPath === workspace.repositoryPath ? <span className="spinner spinner-dark" /> : <ChevronRight size={16} />}
                        </button>
                        <button
                          className="recent-remove"
                          title={t(mobile ? 'Remove workspace from this device' : 'Remove from recent workspaces')}
                          aria-label={t(mobile ? 'Remove {{name}} from this device' : 'Remove {{name}} from recent workspaces', { name: workspace.displayName })}
                          onClick={() => void onRemoveRecent(workspace.repositoryPath)}
                        ><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="form-error startup-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => switchMode('create')} disabled={busy !== null}>
                <Plus size={17} /> {t('Create a new workspace')}
              </button>

              <div className="or-divider"><span>{t('or open an existing workspace')}</span></div>
              <div className="startup-actions">
                <button onClick={() => void chooseLocal()} disabled={busy !== null}>
                  <span><FolderOpen size={18} /></span>
                  <div><strong>{t(mobile ? 'Import workspace package' : 'Open workspace folder')}</strong><small>{t(mobile ? 'Choose a .kanbanos.zip or workspace JSON file' : 'Find its folder on this device')}</small></div>
                  {busy === 'local' ? <span className="spinner spinner-dark" /> : <ChevronRight size={15} />}
                </button>
                <button onClick={() => switchMode('remote')} disabled={busy !== null}>
                  <span><GitBranch size={18} /></span>
                  <div><strong>{t('Clone remote workspace')}</strong><small>{t('Download from a Git URL')}</small></div>
                  <ChevronRight size={15} />
                </button>
              </div>
            </>
          )}

          {mode === 'create' && (
            <>
              <button className="back-link" onClick={() => switchMode('home')}><ArrowLeft size={14} /> {t('Back to workspaces')}</button>
              <div className="connect-icon"><FolderPlus size={23} /></div>
              <p className="step-label">{t('New local workspace')}</p>
              <h2>{t('Create your workspace')}</h2>
              <p className="connect-lead">
                {t(mobile
                  ? 'Name it first. Kanbanos will keep it safely on this device, and a remote can be added later.'
                  : 'Name it first, then choose exactly where its folder should be created. A remote can be added later.')}
              </p>
              <label className="field-label" htmlFor="workspace-name">{t('Workspace name')}</label>
              <div className={`repository-field ${error ? 'field-error' : ''}`}>
                <FolderGit2 size={17} />
                <input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => { setName(event.target.value); setError(''); }}
                  onKeyDown={(event) => event.key === 'Enter' && void createLocal()}
                  placeholder={t('My creative workspace')}
                  autoFocus
                />
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => void createLocal()} disabled={busy !== null}>
                {busy === 'create' ? <span className="spinner" /> : <>{t(mobile ? 'Create workspace' : 'Choose location')} <ArrowRight size={17} /></>}
              </button>
            </>
          )}

          {mode === 'remote' && (
            <>
              <button className="back-link" onClick={() => switchMode('home')}><ArrowLeft size={14} /> {t('Back to workspaces')}</button>
              <div className="connect-icon"><GitBranch size={23} /></div>
              <p className="step-label">{t('Remote workspace')}</p>
              <h2>{t('Clone a remote workspace')}</h2>
              <p className="connect-lead">
                {t('Paste the Git URL. Kanbanos will clone the workspace to this device and remember it here.')}
              </p>
              <label className="field-label" htmlFor="repository-url">{t('Git repository URL')}</label>
              <div className={`repository-field ${error ? 'field-error' : ''}`}>
                <GitBranch size={17} />
                <input
                  id="repository-url"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={url}
                  onChange={(event) => { setUrl(event.target.value); setError(''); }}
                  onKeyDown={(event) => event.key === 'Enter' && void connectRemote()}
                  placeholder="https://git.example.com/you/workspace.git"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <label className="private-auth-toggle">
                <input
                  type="checkbox"
                  checked={privateRepository}
                  onChange={(event) => {
                    setPrivateRepository(event.target.checked);
                    if (!event.target.checked) setGitToken('');
                    setError('');
                  }}
                />
                <span><strong>{t('Private HTTPS repository')}</strong><small>{t('Authenticate with a personal access token or password')}</small></span>
              </label>
              {privateRepository && (
                <div className="private-auth-fields">
                  <label>
                    <span className="field-label">{t('Username (optional)')}</span>
                    <div className="repository-field">
                      <input
                        value={gitUsername}
                        onChange={(event) => { setGitUsername(event.target.value); setError(''); }}
                        placeholder="oauth2"
                        autoComplete="username"
                        dir="ltr"
                      />
                    </div>
                  </label>
                  <label>
                    <span className="field-label">{t('Personal access token or password')}</span>
                    <div className={`repository-field ${error && !gitToken.trim() ? 'field-error' : ''}`}>
                      <input
                        type="password"
                        value={gitToken}
                        onChange={(event) => { setGitToken(event.target.value); setError(''); }}
                        onKeyDown={(event) => event.key === 'Enter' && void connectRemote()}
                        placeholder={t('Token with repository access')}
                        autoComplete="off"
                        dir="ltr"
                      />
                    </div>
                  </label>
                  <p className="private-auth-hint">{t(mobile
                    ? 'Mobile sync uses HTTPS. Use a personal access token for private repositories.'
                    : 'SSH URLs use your existing SSH key and do not need a token here.')}</p>
                </div>
              )}
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary button-connect" onClick={() => void connectRemote()} disabled={busy !== null}>
                {busy === 'remote' ? <span className="spinner" /> : <>{t('Clone workspace')} <ArrowRight size={17} /></>}
              </button>
            </>
          )}

          <div className="trust-note startup-trust">
            <LockKeyhole size={16} />
            <span><strong>{t('Your work stays yours.')}</strong> {t(mobile ? 'Workspaces are stored privately on this device and can be exported at any time.' : 'Workspaces live in folders you control.')}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
