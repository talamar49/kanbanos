import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Cloud, Laptop, X } from 'lucide-react';

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
  const local = type === 'local';
  return (
    <div className="version-card">
      <span className={`version-icon ${local ? 'local' : 'remote'}`}>{local ? <Laptop size={19} /> : <Cloud size={19} />}</span>
      <div>
        <strong>{local ? 'This device' : 'Repository version'}</strong>
        <small>{local ? 'Your changes in Kanbanos' : 'Changes from another device'}</small>
      </div>
      <ul>
        {summary.tasks !== undefined && <li><b>{summary.tasks}</b> tasks</li>}
        {summary.projects !== undefined && <li><b>{summary.projects}</b> projects</li>}
        {summary.updated && <li>Edited {new Date(summary.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</li>}
      </ul>
    </div>
  );
}

export function ConflictDialog({ conflicts, onResolve, onClose }: Props) {
  const [busy, setBusy] = useState<'local' | 'remote' | null>(null);
  const conflict = conflicts[0];
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
          <div><p>YOUR WORK IS SAFE</p><h2>Two versions need your attention</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <p className="conflict-lead">This workspace changed in two places before they could sync. Choose which complete version you want to keep.</p>
        <div className="version-compare">
          <VersionCard type="local" summary={localSummary} />
          <span className="compare-arrow"><ArrowRight size={17} /></span>
          <VersionCard type="remote" summary={remoteSummary} />
        </div>
        <div className="conflict-reassurance"><CheckCircle2 size={16} /> Kanbanos will finish the merge and sync the version you choose.</div>
        <details>
          <summary>Technical details</summary>
          <p>{conflicts.length} conflicting {conflicts.length === 1 ? 'file' : 'files'}: {conflicts.map((value) => value.path).join(', ')}</p>
        </details>
        <footer>
          <button className="button button-secondary" disabled={busy !== null} onClick={() => void resolve('remote')}>
            {busy === 'remote' ? <span className="spinner spinner-dark" /> : <Cloud size={16} />} Use repository version
          </button>
          <button className="button button-primary" disabled={busy !== null} onClick={() => void resolve('local')}>
            {busy === 'local' ? <span className="spinner" /> : <Laptop size={16} />} Keep my version
          </button>
        </footer>
      </section>
    </div>
  );
}
