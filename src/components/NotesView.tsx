import '@fontsource-variable/assistant';
import { Extension } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bold,
  CheckSquare,
  Code2,
  FileText,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Pin,
  PinOff,
  Plus,
  Quote,
  Search,
  Sparkles,
  Strikethrough,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Project, ProjectNote, WorkspaceAction, WorkspaceDocument } from '../domain/types';
import { createProjectNote, labelUsageForNotes } from '../domain/workspace';
import { useI18n } from '../i18n';
import { LabelPicker } from './LabelPicker';
import { ProjectScopeSelect } from './ProjectScopeSelect';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  onAction: (action: WorkspaceAction) => void;
};

const AutoTextDirection = Extension.create({
  name: 'autoTextDirection',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote'],
      attributes: {
        dir: {
          default: 'auto',
          renderHTML: () => ({ dir: 'auto' }),
        },
      },
    }];
  },
});

const RevealMarkdownHeadingOnBackspace = Extension.create({
  name: 'revealMarkdownHeadingOnBackspace',
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'heading') return false;
        const level = Number($from.parent.attrs.level) || 1;
        return this.editor.chain().setParagraph().insertContent(`${'#'.repeat(level)} `).run();
      },
    };
  },
});

function plainExcerpt(note: ProjectNote): string {
  return note.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`\[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(content: string): number {
  return content.trim() ? content.trim().split(/\s+/u).length : 0;
}

export function noteTextDirection(note: Pick<ProjectNote, 'title' | 'content'>, fallback: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
  if (fallback === 'rtl') return 'rtl';
  const firstStrongCharacter = `${note.title}\n${note.content}`.match(/[A-Za-z\u0590-\u05ff\u0600-\u06ff]/u)?.[0];
  if (!firstStrongCharacter) return fallback;
  return /[\u0590-\u05ff\u0600-\u06ff]/u.test(firstStrongCharacter) ? 'rtl' : 'ltr';
}

function NoteCard({ note, project: noteProject, showProject, index, onOpen, onPin, onDelete }: {
  note: ProjectNote;
  project?: Project;
  showProject: boolean;
  index: number;
  onOpen: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const { direction, t } = useI18n();
  const cardRef = useRef<HTMLElement>(null);
  const [rowSpan, setRowSpan] = useState(12);
  const writingDirection = noteTextDirection(note, direction);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const updateSpan = (height: number) => setRowSpan(Math.max(7, Math.ceil((height + 16) / 24)));
    updateSpan(card.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => updateSpan(entries[0]?.contentRect.height ?? card.getBoundingClientRect().height));
    observer.observe(card);
    return () => observer.disconnect();
  }, [note.content, note.labels.length, note.title, showProject]);

  return (
    <article
      ref={cardRef}
      className="keep-note-card"
      style={{
        gridRowEnd: `span ${rowSpan}`,
        '--note-accent': noteProject?.color ?? '#6759cf',
        '--note-index': Math.min(index, 10),
      } as CSSProperties}
    >
      <div className="keep-note-open" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }} aria-label={t('Open note {{name}}', { name: note.title })}>
        <span className="keep-note-card-title"><strong dir="auto">{note.title}</strong>{note.pinned && <Pin size={14} aria-label={t('Pinned')} />}</span>
        {note.content ? (
          <div className="keep-note-preview" dir={writingDirection}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{ li: ({ node: _node, ...props }) => <li {...props} dir="auto" /> }}
            >
              {note.content}
            </ReactMarkdown>
          </div>
        ) : <p className="keep-note-empty">{t('Empty note')}</p>}
        {note.labels.length > 0 && <span className="keep-note-labels">{note.labels.map((label) => <small key={label}>{label}</small>)}</span>}
        {showProject && noteProject && <span className="keep-note-project"><i style={{ background: noteProject.color }} />{noteProject.name}</span>}
      </div>
      <div className="keep-note-card-actions">
        <button type="button" onClick={onPin} aria-label={t(note.pinned ? 'Unpin note' : 'Pin note')}>{note.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
        <button type="button" onClick={onDelete} aria-label={t('Delete note')}><Trash2 size={16} /></button>
      </div>
    </article>
  );
}

function MarkdownNoteEditor({ note, labelOptions, onUpdate, onDelete, onClose }: {
  note: ProjectNote;
  labelOptions: ReturnType<typeof labelUsageForNotes>;
  onUpdate: (changes: Extract<WorkspaceAction, { type: 'updateNote' }>['changes']) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { direction, locale, t } = useI18n();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const writingDirection = noteTextDirection(note, direction);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t('Start writing…') }),
      AutoTextDirection,
      RevealMarkdownHeadingOnBackspace,
    ],
    content: note.content,
    contentType: 'markdown',
    autofocus: note.content.length === 0 ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'keep-wysiwyg-content',
        role: 'textbox',
        'aria-label': t('Note content'),
        'aria-multiline': 'true',
        dir: writingDirection,
      },
    },
    onUpdate: ({ editor: currentEditor }) => onUpdate({ content: currentEditor.getMarkdown() }),
  }, [note.id]);

  const run = (action: () => boolean) => {
    editor?.chain().focus();
    action();
  };
  const toolbarButton = (label: string, icon: ReactNode, active: boolean, action: () => boolean) => (
    <button type="button" className={active ? 'active' : ''} aria-label={t(label)} title={t(label)} onClick={() => run(action)}>{icon}</button>
  );
  const edited = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.updatedAt));

  return (
    <div className="keep-editor-backdrop" role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="keep-note-dialog" role="dialog" aria-modal="true" aria-label={t('Edit note {{name}}', { name: note.title })}>
        <header className="keep-editor-header">
          <input
            aria-label={t('Note title')}
            dir="auto"
            value={note.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            onBlur={(event) => { if (!event.target.value.trim()) onUpdate({ title: t('Untitled note') }); }}
          />
          <button type="button" className={note.pinned ? 'active' : ''} onClick={() => onUpdate({ pinned: !note.pinned })} aria-label={t(note.pinned ? 'Unpin note' : 'Pin note')}>
            {note.pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
          <button type="button" onClick={onClose} aria-label={t('Close note')}><X size={20} /></button>
        </header>

        <div
          className="keep-editor-scroll"
          onKeyDownCapture={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Backspace' || !editor) return;
            const selection = window.getSelection();
            const anchor = selection?.anchorNode;
            const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
            const heading = anchorElement?.closest('h1, h2, h3, h4, h5, h6');
            if (!selection?.isCollapsed || selection.anchorOffset !== 0 || !heading || !event.currentTarget.contains(heading)) return;
            const level = Number(heading.tagName.slice(1)) || 1;
            const position = editor.view.posAtDOM(heading, 0);
            event.preventDefault();
            event.stopPropagation();
            editor.chain().focus().setTextSelection(position).setParagraph().insertContent(`${'#'.repeat(level)} `).run();
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {labelsOpen && (
          <div className="keep-label-panel">
            <div><strong>{t('Note labels')}</strong><button type="button" onClick={() => setLabelsOpen(false)} aria-label={t('Close labels')}><X size={17} /></button></div>
            <LabelPicker value={note.labels} options={labelOptions} onChange={(labels) => onUpdate({ labels })} countType="note" />
          </div>
        )}

        <nav className="keep-format-toolbar" aria-label={t('Markdown formatting')}>
          {toolbarButton('Bold', <Bold size={17} />, Boolean(editor?.isActive('bold')), () => editor?.chain().focus().toggleBold().run() ?? false)}
          {toolbarButton('Italic', <Italic size={17} />, Boolean(editor?.isActive('italic')), () => editor?.chain().focus().toggleItalic().run() ?? false)}
          {toolbarButton('Strikethrough', <Strikethrough size={17} />, Boolean(editor?.isActive('strike')), () => editor?.chain().focus().toggleStrike().run() ?? false)}
          {toolbarButton('Heading', <Heading2 size={18} />, Boolean(editor?.isActive('heading', { level: 2 })), () => editor?.chain().focus().toggleHeading({ level: 2 }).run() ?? false)}
          {toolbarButton('Bulleted list', <List size={18} />, Boolean(editor?.isActive('bulletList')), () => editor?.chain().focus().toggleBulletList().run() ?? false)}
          {toolbarButton('Numbered list', <ListOrdered size={18} />, Boolean(editor?.isActive('orderedList')), () => editor?.chain().focus().toggleOrderedList().run() ?? false)}
          {toolbarButton('Task list', <CheckSquare size={17} />, Boolean(editor?.isActive('taskList')), () => editor?.chain().focus().toggleTaskList().run() ?? false)}
          {toolbarButton('Quote', <Quote size={17} />, Boolean(editor?.isActive('blockquote')), () => editor?.chain().focus().toggleBlockquote().run() ?? false)}
          {toolbarButton('Code block', <Code2 size={17} />, Boolean(editor?.isActive('codeBlock')), () => editor?.chain().focus().toggleCodeBlock().run() ?? false)}
          <button type="button" aria-label={t('Add link')} title={t('Add link')} onClick={() => {
            const previous = editor?.getAttributes('link').href as string | undefined;
            const url = window.prompt(t('Paste a link'), previous ?? '')?.trim();
            if (!editor || url === undefined) return;
            if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else if (/^https?:\/\//i.test(url)) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}><Link size={17} /></button>
          <i />
          <button type="button" className={labelsOpen ? 'active' : ''} onClick={() => setLabelsOpen((open) => !open)} aria-expanded={labelsOpen}><Tag size={17} /><span>{t('Labels')}</span></button>
          <button type="button" className="keep-delete-note" onClick={onDelete} aria-label={t('Delete note')}><Trash2 size={17} /></button>
        </nav>
        <footer className="keep-editor-status">
          <span>{t('{{count}} words', { count: wordCount(note.content) })}</span>
          <span>{t('Edited {{date}}', { date: edited })}</span>
          <button type="button" onClick={onClose}>{t('Done action')}</button>
        </footer>
      </section>
    </div>
  );
}

function NoteGroup({ title, notes, projectById, showProject, onOpen, onPin, onDelete }: {
  title?: string;
  notes: ProjectNote[];
  projectById: Map<string, Project>;
  showProject: boolean;
  onOpen: (note: ProjectNote) => void;
  onPin: (note: ProjectNote) => void;
  onDelete: (note: ProjectNote) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <section className="keep-note-group">
      {title && <h2>{title}</h2>}
      <div className="keep-notes-grid">
        {notes.map((note, index) => <NoteCard key={note.id} note={note} project={projectById.get(note.projectId)} showProject={showProject} index={index} onOpen={() => onOpen(note)} onPin={() => onPin(note)} onDelete={() => onDelete(note)} />)}
      </div>
    </section>
  );
}

export function NotesView({ document, project, onAction }: Props) {
  const { t } = useI18n();
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const scope = document.preferences.projectScope ?? 'current';
  const allNotes = useMemo(() => Object.values(document.modules.notes.notes), [document.modules.notes.notes]);
  const scopedNotes = useMemo(() => allNotes.filter((note) => scope === 'all' || note.projectId === project.id), [allNotes, project.id, scope]);
  const labels = useMemo(() => labelUsageForNotes(scopedNotes), [scopedNotes]);
  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return scopedNotes.filter((note) => (
      (!labelFilter || note.labels.some((label) => label.toLocaleLowerCase() === labelFilter.toLocaleLowerCase()))
      && (!needle || `${note.title}\n${note.content}\n${note.labels.join(' ')}`.toLocaleLowerCase().includes(needle))
    )).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [labelFilter, query, scopedNotes]);
  const pinnedNotes = visibleNotes.filter((note) => note.pinned);
  const otherNotes = visibleNotes.filter((note) => !note.pinned);
  const openNote = openNoteId ? document.modules.notes.notes[openNoteId] : undefined;
  const projectById = useMemo(() => new Map(document.projects.map((candidate) => [candidate.id, candidate])), [document.projects]);
  const newNoteShortcut = /Mac|iPhone|iPad/i.test(window.navigator.userAgent) ? t('⌘ N') : t('Ctrl N');

  const updateNote = (noteId: string, changes: Extract<WorkspaceAction, { type: 'updateNote' }>['changes']) => onAction({ type: 'updateNote', noteId, changes });
  const openEditor = (noteId: string) => {
    lastFocusedRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    setOpenNoteId(noteId);
  };
  const closeEditor = () => {
    setOpenNoteId(null);
    window.setTimeout(() => lastFocusedRef.current?.focus(), 0);
  };
  const createNote = () => {
    const note = createProjectNote(project.id, t('Untitled note'));
    onAction({ type: 'addNote', note });
    openEditor(note.id);
  };
  const deleteNote = (note: ProjectNote) => {
    if (!window.confirm(t('Delete “{{name}}”? This note cannot be recovered after the workspace is saved.', { name: note.title }))) return;
    onAction({ type: 'deleteNote', noteId: note.id });
    if (openNoteId === note.id) closeEditor();
  };

  useEffect(() => {
    const handleShortcuts = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (openNoteId && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeEditor();
        return;
      }
      if (openNoteId || target?.closest('input, textarea, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault();
        createNote();
      } else if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcuts, true);
    return () => window.removeEventListener('keydown', handleShortcuts, true);
  });

  return (
    <main className="workspace-main notes-view page-enter">
      <header className="keep-notes-topbar">
        <div className="keep-notes-heading"><span><FileText size={22} /></span><div><h1>{t('Notes')}</h1><p>{t('A quiet place for project knowledge, ideas, and decisions.')}</p></div></div>
        <div className="keep-notes-search"><Search size={19} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(scope === 'all' ? 'Search all notes' : 'Search project notes')} aria-label={t('Search notes')} />{query && <button type="button" onClick={() => setQuery('')} aria-label={t('Clear search')}><X size={17} /></button>}</div>
        <ProjectScopeSelect project={project} value={scope} content="notes" onChange={(nextScope) => onAction({ type: 'setProjectScope', scope: nextScope })} />
      </header>

      <div className="keep-notes-scroll">
        <button type="button" className="keep-note-composer" onClick={createNote}>
          <span className="keep-composer-icon"><Sparkles size={18} /></span>
          <span className="keep-composer-copy"><strong>{t('Take a note…')}</strong><small>{t('Markdown formats as you type')}</small></span>
          <kbd aria-label={t('New note shortcut')}>{newNoteShortcut}</kbd>
        </button>
        {labels.length > 0 && <div className="keep-label-filters" aria-label={t('Filter notes by label')}><button type="button" className={!labelFilter ? 'active' : ''} onClick={() => setLabelFilter(null)}>{t('All')}</button>{labels.map(({ label, count }) => <button type="button" key={label} className={labelFilter === label ? 'active' : ''} onClick={() => setLabelFilter(label)}><Tag size={13} />{label}<small>{count}</small></button>)}</div>}

        {visibleNotes.length > 0 ? (
          <div className="keep-notes-board">
            <NoteGroup title={pinnedNotes.length ? t('Pinned notes') : undefined} notes={pinnedNotes} projectById={projectById} showProject={scope === 'all'} onOpen={(note) => openEditor(note.id)} onPin={(note) => updateNote(note.id, { pinned: !note.pinned })} onDelete={deleteNote} />
            <NoteGroup title={pinnedNotes.length && otherNotes.length ? t('Other notes') : undefined} notes={otherNotes} projectById={projectById} showProject={scope === 'all'} onOpen={(note) => openEditor(note.id)} onPin={(note) => updateNote(note.id, { pinned: !note.pinned })} onDelete={deleteNote} />
          </div>
        ) : (
          <div className="keep-notes-empty"><span><FileText size={32} /></span><h2>{t(query || labelFilter ? 'No matching notes' : 'Notes you add appear here')}</h2><p>{t(query || labelFilter ? 'Try another search or label.' : 'Capture ideas, decisions, and project knowledge in Markdown.')}</p>{!query && !labelFilter && <button type="button" onClick={createNote}><Plus size={16} />{t('Create note')}</button>}</div>
        )}
      </div>

      {openNote && <MarkdownNoteEditor key={openNote.id} note={openNote} labelOptions={labels} onUpdate={(changes) => updateNote(openNote.id, changes)} onDelete={() => deleteNote(openNote)} onClose={closeEditor} />}
    </main>
  );
}
