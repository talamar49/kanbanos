import { useEffect, useState } from 'react';
import { Cloud, GitBranch, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  currentUrl?: string;
  privateRepository?: boolean;
  hasStoredCredentials?: boolean;
  onConnect: (url: string, credentials?: GitCredentials | null) => Promise<void>;
  onClose: () => void;
};

export function RemoteModal({
  currentUrl,
  privateRepository: initialPrivateRepository = false,
  hasStoredCredentials = false,
  onConnect,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState(currentUrl ?? '');
  const [privateRepository, setPrivateRepository] = useState(initialPrivateRepository);
  const [gitUsername, setGitUsername] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const connect = async () => {
    if (!url.trim()) {
      setError(t('Enter a Git repository URL.'));
      return;
    }
    const canReuseStoredCredentials = hasStoredCredentials && url.trim() === currentUrl?.trim();
    if (privateRepository && !gitToken.trim() && !canReuseStoredCredentials) {
      setError(t('Enter a personal access token or password to continue.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConnect(
        url.trim(),
        privateRepository
          ? gitToken.trim()
            ? { username: gitUsername.trim(), token: gitToken }
            : undefined
          : null,
      );
      onClose();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? t(connectionError.message) : t('Could not add that remote.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="remote-modal modal-enter" role="dialog" aria-modal="true" aria-label={t('Remote repository')}>
        <header className="simple-modal-header">
          <span className="remote-modal-icon"><Cloud size={21} /></span>
          <div>
            <h2>{t(currentUrl ? 'Change remote repository' : 'Keep this workspace in sync')}</h2>
            <p>{t(currentUrl ? 'Future saves will sync with the new remote.' : 'Optional — your local workspace already works on its own.')}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </header>
        <div className="remote-modal-body">
          <label className="field-label" htmlFor="remote-url">{t('Git repository URL')}</label>
          <div className={`repository-field ${error ? 'field-error' : ''}`}>
            <GitBranch size={17} />
            <input
              id="remote-url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setError(''); }}
              onKeyDown={(event) => event.key === 'Enter' && void connect()}
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
                    onKeyDown={(event) => event.key === 'Enter' && void connect()}
                    placeholder={t(hasStoredCredentials && url.trim() === currentUrl?.trim()
                      ? 'Stored credential — leave blank to keep it'
                      : 'Token with repository access')}
                    autoComplete="off"
                    dir="ltr"
                  />
                </div>
              </label>
              <p className="private-auth-hint">{t('SSH URLs use your existing SSH key and do not need a token here.')}</p>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="remote-note"><ShieldCheck size={16} /><span>{t(privateRepository ? 'Credentials stay in a permission-restricted, git-ignored workspace file and use system encryption when available.' : 'Kanbanos verifies the remote when you add it and uses your existing Git credentials for sync.')}</span></div>
        </div>
        <footer className="simple-modal-footer">
          <button className="button button-secondary" onClick={onClose} disabled={busy}>{t('Not now')}</button>
          <button className="button button-primary" onClick={() => void connect()} disabled={busy || !url.trim()}>
            {busy ? <span className="spinner" /> : <><Cloud size={15} /> {t(currentUrl ? 'Update remote' : 'Add remote')}</>}
          </button>
        </footer>
      </section>
    </div>
  );
}
