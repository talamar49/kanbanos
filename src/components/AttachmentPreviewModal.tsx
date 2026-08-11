import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Presentation,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceAttachment } from '../domain/types';
import { useI18n } from '../i18n';

type PreviewTarget = { name: string; relativePath: string; kind: 'file' | 'folder' };

type Props = {
  attachment: WorkspaceAttachment;
  onClose: () => void;
  onOpen: (attachment: WorkspaceAttachment) => void;
  onReveal: (attachment: WorkspaceAttachment) => void;
  mobile?: boolean;
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

function previewIcon(preview?: AttachmentPreview) {
  if (!preview) return <Eye size={20} />;
  if (preview.type === 'image') return <FileImage size={20} />;
  if (preview.type === 'presentation') return <Presentation size={20} />;
  if (preview.type === 'spreadsheet') return <FileSpreadsheet size={20} />;
  if (preview.type === 'folder') return <Folder size={20} />;
  return <FileText size={20} />;
}

export function AttachmentPreviewModal({ attachment, onClose, onOpen, onReveal, mobile = false }: Props) {
  const { direction, locale, t } = useI18n();
  const rootTarget = useMemo<PreviewTarget>(() => ({
    name: attachment.name,
    relativePath: attachment.relativePath,
    kind: attachment.kind === 'folder' ? 'folder' : 'file',
  }), [attachment]);
  const [history, setHistory] = useState<PreviewTarget[]>([rootTarget]);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);
  const [activeSheet, setActiveSheet] = useState(0);
  const target = history[history.length - 1];

  useEffect(() => {
    setHistory([rootTarget]);
  }, [rootTarget]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setPreview(null);
    setActiveSlide(0);
    setActiveSheet(0);
    const api = window.kanbanos?.attachments;
    if (!api) {
      setLoading(false);
      setError(t('Previews are available in the desktop app.'));
      return;
    }
    void api.preview(target.relativePath).then((result) => {
      if (active) setPreview(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? t(reason.message) : t('Could not preview this attachment.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [t, target.relativePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const currentAttachment = { ...attachment, name: target.name, relativePath: target.relativePath, kind: target.kind };
  const openTarget = (entry: AttachmentPreviewEntry) => {
    setHistory((current) => [...current, { name: entry.name.split('/').pop() ?? entry.name, relativePath: entry.relativePath, kind: entry.kind }]);
  };

  return (
    <div className="modal-backdrop attachment-preview-backdrop fade-in" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="attachment-preview-modal modal-enter" role="dialog" aria-modal="true" aria-label={t('Preview {{name}}', { name: target.name })}>
        <header className="attachment-preview-header">
          <div className="attachment-preview-heading">
            {history.length > 1 ? <button className="icon-button" onClick={() => setHistory((current) => current.slice(0, -1))} aria-label={t('Back to folder')}><ArrowLeft size={20} /></button> : <span className="preview-heading-icon">{previewIcon(preview ?? undefined)}</span>}
            <div><small>{t('Attachment preview')}</small><strong><bdi>{target.name}</bdi></strong></div>
          </div>
          <div className="attachment-preview-actions">
            {!mobile && <button className="button button-secondary" onClick={() => onReveal(currentAttachment)}><FolderOpen size={17} /> {t('Show in folder')}</button>}
            <button className="button button-primary" onClick={() => onOpen(currentAttachment)}><ExternalLink size={17} /> {t(mobile ? 'Share file' : 'Open file')}</button>
            <button className="icon-button preview-close" onClick={onClose} aria-label={t('Close preview')}><X size={21} /></button>
          </div>
        </header>

        <div className={`attachment-preview-body preview-${preview?.type ?? 'loading'}`}>
          {loading && <div className="preview-state"><span className="spinner spinner-dark" /><strong>{t('Preparing preview…')}</strong></div>}
          {!loading && error && <div className="preview-state preview-error"><Eye size={35} /><strong>{t('Preview unavailable')}</strong><p>{error}</p><button className="button button-primary" onClick={() => onOpen(currentAttachment)}>{t('Open file')}</button></div>}

          {!loading && preview?.type === 'image' && <div className="image-preview"><img src={preview.url} alt={preview.name} /></div>}
          {!loading && preview?.type === 'pdf' && <iframe className="pdf-preview" src={preview.url} title={t('PDF preview of {{name}}', { name: preview.name })} />}
          {!loading && preview?.type === 'video' && <div className="media-preview"><video controls src={preview.url}><track kind="captions" /></video></div>}
          {!loading && preview?.type === 'audio' && <div className="audio-preview"><FileText size={54} /><strong><bdi>{preview.name}</bdi></strong><audio controls src={preview.url} /></div>}
          {!loading && preview?.type === 'text' && <div className="text-preview"><pre dir="auto">{preview.content}</pre>{preview.truncated && <p>{t('Preview shortened for performance.')}</p>}</div>}
          {!loading && preview?.type === 'markdown' && <article className="markdown-preview" dir={direction}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{preview.content}</ReactMarkdown>{preview.truncated && <p className="preview-truncated">{t('Preview shortened for performance.')}</p>}</article>}
          {!loading && preview?.type === 'word' && <article className="word-preview" dir="auto">{preview.paragraphs.length ? preview.paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>) : <div className="preview-state"><FileText size={35} /><strong>{t('This document has no previewable text.')}</strong></div>}{preview.truncated && <p className="preview-truncated">{t('Preview shortened for performance.')}</p>}</article>}
          {!loading && preview?.type === 'presentation' && (
            <div className="presentation-preview">
              <nav aria-label={t('Slides')}>{preview.slides.map((slide, index) => <button className={activeSlide === index ? 'active' : ''} key={index} onClick={() => setActiveSlide(index)}><span>{index + 1}</span><strong>{slide.title || t('Untitled slide')}</strong></button>)}</nav>
              {preview.slides.length ? <section className="presentation-slide"><small>{t('Slide {{current}} of {{total}}', { current: activeSlide + 1, total: preview.slides.length })}</small><h2>{preview.slides[activeSlide]?.title || t('Untitled slide')}</h2><ul>{preview.slides[activeSlide]?.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul></section> : <div className="preview-state"><Presentation size={35} /><strong>{t('This presentation has no previewable slides.')}</strong></div>}
            </div>
          )}
          {!loading && preview?.type === 'spreadsheet' && (
            <div className="spreadsheet-preview">
              <nav aria-label={t('Worksheets')}>{preview.sheets.map((sheet, index) => <button className={activeSheet === index ? 'active' : ''} key={sheet.name} onClick={() => setActiveSheet(index)}>{sheet.name}</button>)}</nav>
              {preview.sheets[activeSheet] ? <div className="spreadsheet-scroll"><table><tbody>{preview.sheets[activeSheet].rows.map((row, rowIndex) => <tr key={rowIndex}><th>{rowIndex + 1}</th>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <div className="preview-state"><FileSpreadsheet size={35} /><strong>{t('This workbook has no previewable cells.')}</strong></div>}
            </div>
          )}
          {!loading && preview?.type === 'folder' && (
            <div className="folder-preview">
              <header><div><strong>{t('{{count}} items', { count: preview.entries.length })}</strong><span>{t('Select a file to preview it here.')}</span></div>{preview.truncated && <small>{t('Showing the first {{count}} items', { count: preview.entries.length })}</small>}</header>
              <div className="folder-preview-list">
                {preview.entries.map((entry) => <button key={entry.relativePath} onClick={() => openTarget(entry)}><span className={`file-kind-icon ${entry.kind}`}>{entry.kind === 'folder' ? <Folder size={18} /> : <File size={18} />}</span><span><strong><bdi>{entry.name}</bdi></strong><small>{entry.kind === 'folder' ? t('Folder') : formatSize(entry.sizeBytes, locale)}</small></span><Eye size={17} /></button>)}
                {preview.entries.length === 0 && <div className="preview-state"><Folder size={35} /><strong>{t('This folder is empty.')}</strong></div>}
              </div>
            </div>
          )}
          {!loading && preview?.type === 'unsupported' && <div className="preview-state"><File size={42} /><strong>{t('No in-app preview for this format yet')}</strong><p>{t(mobile ? 'You can still share it with another app on this device.' : 'You can still open it with the default app on your computer.')}</p><button className="button button-primary" onClick={() => onOpen(currentAttachment)}><ExternalLink size={17} /> {t(mobile ? 'Share file' : 'Open file')}</button></div>}
        </div>
      </section>
    </div>
  );
}
