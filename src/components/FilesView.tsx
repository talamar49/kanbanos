import { useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  Eye,
  File,
  Files,
  Folder,
  FolderOpen,
  Paperclip,
  Search,
  X,
} from 'lucide-react';
import type { WorkItem, WorkspaceAttachment, WorkspaceDocument } from '../domain/types';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  saveState: SaveState;
  dirty: boolean;
  onSave: () => void;
  onOpenTask: (item: WorkItem) => void;
  onPreviewAttachment: (attachment: WorkspaceAttachment) => void;
  onOpenAttachment: (attachment: WorkspaceAttachment) => void;
  onRevealAttachment: (attachment: WorkspaceAttachment) => void;
  mobile?: boolean;
};

type AttachmentRow = {
  attachment: WorkspaceAttachment;
  tasks: WorkItem[];
};

function formatSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value >= 10 ? 0 : 1 })} ${units[unit]}`;
}

export function FilesView({ document, saveState, dirty, onSave, onOpenTask, onPreviewAttachment, onOpenAttachment, onRevealAttachment, mobile = false }: Props) {
  const { locale, t } = useI18n();
  const [search, setSearch] = useState('');
  const projectById = new Map(document.projects.map((project) => [project.id, project]));
  const rows = useMemo<AttachmentRow[]>(() => {
    const tasks = Object.values(document.items);
    return Object.values(document.resources.attachments)
      .map((attachment) => ({
        attachment,
        tasks: tasks.filter((task) => task.attachmentIds?.includes(attachment.id)),
      }))
      .sort((left, right) => right.attachment.createdAt.localeCompare(left.attachment.createdAt));
  }, [document.items, document.resources.attachments]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(({ attachment, tasks }) => !normalizedSearch || [
    attachment.name,
    ...tasks.map((task) => task.title),
    ...tasks.map((task) => projectById.get(task.projectId)?.name ?? ''),
  ].join(' ').toLocaleLowerCase().includes(normalizedSearch));
  const totalSize = rows.reduce((sum, row) => sum + row.attachment.sizeBytes, 0);

  return (
    <main className="workspace-main files-view page-enter">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>{t('Workspace')}</span><b>/</b><strong>{t('Files')}</strong></div>
        <div className="topbar-actions">
          <PreferencesControls />
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> {t('Saving')}</> : saveState === 'synced' && !dirty ? <><Check size={16} /> {t('Saved')}</> : t('Save now')}
          </button>
        </div>
      </header>

      <div className="files-heading">
        <div className="board-title">
          <span className="project-icon files-icon"><Files size={25} /></span>
          <div><h1>{t('Workspace files')}</h1><p>{t('Every attached file and folder, with the task it belongs to.')}</p></div>
        </div>
        <div className="files-summary">
          <span><strong>{rows.length}</strong> {t(rows.length === 1 ? 'attachment' : 'attachments')}</span>
          <span><strong>{formatSize(totalSize, locale)}</strong> {t('stored')}</span>
        </div>
      </div>

      <div className="files-toolbar">
        <div className={`search-box ${search ? 'has-value' : ''}`}>
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search files and tasks')} />
          {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <span>{t('{{count}} shown', { count: visibleRows.length })}</span>
      </div>

      <div className="files-content">
        {visibleRows.length > 0 ? (
          <div className="files-table">
            <div className="files-table-header">
              <span>{t('Name')}</span><span>{t('Details')}</span><span>{t('Attached to')}</span><span>{t('Project')}</span><span>{t('Added')}</span><span>{t('Actions')}</span>
            </div>
            {visibleRows.map(({ attachment, tasks }) => (
              <div className="files-table-row" key={attachment.id}>
                <button className="file-name-cell" onClick={() => onPreviewAttachment(attachment)} title={t('Preview {{name}}', { name: attachment.name })}>
                  <span className={`file-kind-icon ${attachment.kind}`}>
                    {attachment.kind === 'folder' ? <Folder size={19} /> : <File size={19} />}
                  </span>
                  <span><strong><bdi>{attachment.name}</bdi></strong><small>{attachment.kind === 'folder' ? t('Folder') : t('File')}</small></span>
                </button>
                <div className="file-details-cell">
                  <strong>{formatSize(attachment.sizeBytes, locale)}</strong>
                  <small>{attachment.kind === 'folder' ? t('{{count}} files', { count: attachment.fileCount }) : t('Single file')}</small>
                </div>
                <div className="file-task-links">
                  {tasks.length > 0 ? tasks.map((task) => <button key={task.id} onClick={() => onOpenTask(task)}><Paperclip size={13} /><span><bdi>{task.title}</bdi></span></button>) : <span>{t('Not attached to a task')}</span>}
                </div>
                <div className="file-project-cell">{tasks[0] ? <><i style={{ background: projectById.get(tasks[0].projectId)?.color }} />{projectById.get(tasks[0].projectId)?.name}</> : '—'}</div>
                <time>{new Date(attachment.createdAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
                <div className="file-actions">
                  <button className="icon-button" onClick={() => onPreviewAttachment(attachment)} title={t('Preview')} aria-label={t('Preview {{name}}', { name: attachment.name })}><Eye size={16} /></button>
                  <button className="icon-button" onClick={() => onOpenAttachment(attachment)} title={t(mobile ? 'Share' : 'Open')} aria-label={t(mobile ? 'Share {{name}}' : 'Open {{name}}', { name: attachment.name })}><ExternalLink size={16} /></button>
                  {!mobile && <button className="icon-button" onClick={() => onRevealAttachment(attachment)} title={t('Show in workspace folder')} aria-label={t('Show {{name}} in workspace folder', { name: attachment.name })}><FolderOpen size={16} /></button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="files-empty">
            <span><Paperclip size={28} /></span>
            <strong>{t(search ? 'No matching files' : 'No attachments yet')}</strong>
            <p>{t(search ? 'Try a different search.' : 'Open a task to attach files or a complete folder.')}</p>
          </div>
        )}
      </div>
    </main>
  );
}
