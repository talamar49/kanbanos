import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Cloud, Laptop, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  conflicts: GitConflict[];
  onResolve: (strategy: 'local' | 'remote') => Promise<void>;
  onClose: () => void;
};

type Summary = { projects?: number; tasks?: number; updated?: string };

function summarize(content: string): Summary {
  try {
    const document = JSON.parse(content) as {
      projects?: unknown[];
      items?: Record<string, unknown>;
      workspace?: { updatedAt?: string };
    };
    return {
      projects: document.projects?.length,
      tasks: document.items ? Object.keys(document.items).length : undefined,
      updated: document.workspace?.updatedAt,
    };
  } catch {
    return {};
  }
}

function VersionCard({ type, summary }: { type: 'local' | 'remote'; summary: Summary }) {
  const { locale, t } = useI18n();
  const local = type === 'local';
  return (
    <div className="version-card">
      <span className={`version-icon ${local ? 'local' : 'remote'}`}>{local ? <Laptop size={19} /> : <Cloud size={19} />}</span>
      <div>
        <strong>{t(local ? 'This device' : 'Repository version')}</strong>
        <small>{t(local ? 'Your changes in Kanbanos' : 'Changes from another device')}</small>
      </div>
      <ul>
        {summary.tasks !== undefined && <li>{t('{{count}} tasks', { count: summary.tasks })}</li>}
        {summary.projects !== undefined && <li>{t('{{count}} projects', { count: summary.projects })}</li>}
        {summary.updated && <li>{t('Edited {{date}}', { date: new Date(summary.updated).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}</li>}
      </ul>
    </div>
  );
}

export function ConflictDialog({ conflicts, onResolve, onClose }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
  const conflict = conflicts.find((value) => value.path === '.kanbanos/workspace.json')
    ?? conflicts.find((value) => !value.contentOmitted)
    ?? conflicts[0];
  const localSummary = useMemo(() => summarize(conflict?.localContent ?? ''), [conflict]);
  const remoteSummary = useMemo(() => summarize(conflict?.remoteContent ?? ''), [conflict]);

  const resolve = async (strategy: 'local' | 'remote') => {
    setBusy(strategy);
    try {
      await onResolve(strategy);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop conflict-backdrop fade-in">
      <section className="conflict-modal modal-enter" role="alertdialog" aria-modal="true">
        <header>
          <span className="conflict-icon"><AlertTriangle size={22} /></span>
          <div><p>{t('Your work is safe')}</p><h2>{t('Two versions need your attention')}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={18} /></button>
        </header>
        <p className="conflict-lead">{t('This workspace changed in two places before they could sync. Choose which complete version you want to keep.')}</p>
        <div className="version-compare">
          <VersionCard type="local" summary={localSummary} />
          <span className="compare-arrow"><ArrowRight size={17} /></span>
          <VersionCard type="remote" summary={remoteSummary} />
        </div>
        <div className="conflict-reassurance"><CheckCircle2 size={16} /> {t('Kanbanos will finish the merge and sync the version you choose.')}</div>
        <details>
          <summary>{t('Technical details')}</summary>
          <p>{t(conflicts.length === 1 ? '{{count}} conflicting file' : '{{count}} conflicting files', { count: conflicts.length })}: {conflicts.map((value) => value.path).join(', ')}</p>
        </details>
        <footer>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => void resolve('remote')}>
            {busy === 'remote' ? <span className="spinner spinner-dark" /> : <Cloud size={16} />} {t('Use repository version')}
          </button>
          <button className="button button-primary" disabled={busy !== null} onClick={() => void resolve('local')}>
            {busy === 'local' ? <span className="spinner" /> : <Laptop size={16} />} {t('Keep my version')}
          </button>
        </footer>
      </section>
    </div>
  );
}
