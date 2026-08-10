import { useEffect, useState } from 'react';
import { Cloud, GitBranch, ShieldCheck, X } from 'lucide-react';

type Props = {
  currentUrl?: string;
  onConnect: (url: string) => Promise<void>;
  onClose: () => void;
};

export function RemoteModal({ currentUrl, onConnect, onClose }: Props) {
  const [url, setUrl] = useState(currentUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const connect = async () => {
    if (!url.trim()) {
      setError('Enter a Git repository URL.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConnect(url.trim());
      onClose();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Could not add that remote.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="remote-modal modal-enter" role="dialog" aria-modal="true" aria-label="Remote repository">
        <header className="simple-modal-header">
          <span className="remote-modal-icon"><Cloud size={21} /></span>
          <div>
            <h2>{currentUrl ? 'Change remote repository' : 'Keep this workspace in sync'}</h2>
            <p>{currentUrl ? 'Future saves will sync with the new remote.' : 'Optional — your local workspace already works on its own.'}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="remote-modal-body">
          <label className="field-label" htmlFor="remote-url">Git repository URL</label>
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
          {error && <p className="form-error">{error}</p>}
          <div className="remote-note"><ShieldCheck size={16} /><span>Kanbanos uses your existing Git credentials. The remote is contacted only when you save or sync.</span></div>
        </div>
        <footer className="simple-modal-footer">
          <button className="button button-secondary" onClick={onClose} disabled={busy}>Not now</button>
          <button className="button button-primary" onClick={() => void connect()} disabled={busy || !url.trim()}>
            {busy ? <span className="spinner" /> : <><Cloud size={15} /> {currentUrl ? 'Update remote' : 'Add remote'}</>}
          </button>
        </footer>
      </section>
    </div>
  );
}
