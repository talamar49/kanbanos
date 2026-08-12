import { useCallback, useEffect, useState } from 'react';
import { Download, FileClock, RefreshCw, Trash2, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  onClose: () => void;
  onNotify: (message: string, kind?: 'success' | 'error') => void;
};

export function DiagnosticsModal({ onClose, onNotify }: Props) {
  const { language, locale, t } = useI18n();
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'export' | 'clear' | null>(null);

  const load = useCallback(async () => {
    const api = window.kanbanos?.diagnostics;
    if (!api) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setEntries(await api.list());
    } catch (error) {
      onNotify(error instanceof Error ? t(error.message) : t('Could not load diagnostics.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify, t]);

  useEffect(() => {
    void load();
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [load, onClose]);

  const exportLog = async () => {
    const api = window.kanbanos?.diagnostics;
    if (!api) return;
    setBusy('export');
    try {
      const destination = await api.export(language);
      if (destination) onNotify(t('Diagnostic log exported.'));
    } catch (error) {
      onNotify(error instanceof Error ? t(error.message) : t('Could not export diagnostics.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    const api = window.kanbanos?.diagnostics;
    if (!api || !window.confirm(t('Clear all diagnostic logs?'))) return;
    setBusy('clear');
    try {
      await api.clear();
      setEntries([]);
      onNotify(t('Diagnostic logs cleared.'));
    } catch (error) {
      onNotify(error instanceof Error ? t(error.message) : t('Could not clear diagnostics.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop diagnostics-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="diagnostics-modal modal-enter" role="dialog" aria-modal="true" aria-label={t('Diagnostics & logs')}>
        <header className="diagnostics-header">
          <div className="diagnostics-heading">
            <span><FileClock size={22} /></span>
            <div><small>{t('Workspace diagnostics')}</small><h2>{t('Activity log')}</h2><p>{t('Recent app and Git activity is retained on this device so you can investigate a problem after it happens.')}</p></div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={20} /></button>
        </header>
        <div className="diagnostics-toolbar">
          <span>{t('{{count}} events retained', { count: entries.length })}</span>
          <div>
            <button className="button button-secondary" onClick={() => void load()} disabled={loading || busy !== null}><RefreshCw size={16} /> {t('Refresh')}</button>
            <button className="button button-secondary diagnostics-clear" onClick={() => void clear()} disabled={entries.length === 0 || busy !== null}>{busy === 'clear' ? <span className="spinner spinner-dark" /> : <Trash2 size={16} />} {t('Clear logs')}</button>
            <button className="button button-primary" onClick={() => void exportLog()} disabled={busy !== null}>{busy === 'export' ? <span className="spinner" /> : <Download size={16} />} {t('Export log')}</button>
          </div>
        </div>
        <div className="diagnostics-body">
          {loading ? <div className="diagnostics-state"><span className="spinner spinner-dark" /> {t('Loading diagnostics…')}</div>
            : entries.length === 0 ? <div className="diagnostics-state"><FileClock size={34} /><strong>{t('No diagnostic events yet')}</strong><p>{t('App actions, Git activity, and errors will appear here.')}</p></div>
              : <ol className="diagnostics-list">{entries.map((entry, index) => (
                <li className={entry.level === 'error' ? 'error' : ''} key={`${entry.timestamp}-${index}`}>
                  <time dir="ltr">{new Date(entry.timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' })}</time>
                  <span className="diagnostic-level">{t(entry.level === 'error' ? 'Error' : 'Info')}</span>
                  <div><strong>{entry.scope}</strong><p>{t(entry.message)}</p>{entry.details && <pre dir="auto">{entry.details}</pre>}</div>
                </li>
              ))}</ol>}
        </div>
        <footer className="diagnostics-footer">{t('The latest 25,000 events or 25 MiB are retained. Export includes the complete retained log.')}</footer>
      </section>
    </div>
  );
}
