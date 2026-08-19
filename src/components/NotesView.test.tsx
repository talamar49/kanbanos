import { useReducer } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocument } from '../domain/types';
import {
  createEmptyWorkspace,
  createProject,
  createProjectNote,
  createProjectSettings,
  normalizeWorkspaceDocument,
  workspaceReducer,
} from '../domain/workspace';
import { renderWithPreferences } from '../test/render';
import { noteTextDirection, NotesView } from './NotesView';

function NotesHarness({ initial }: { initial: WorkspaceDocument }) {
  const [document, dispatch] = useReducer(workspaceReducer, initial);
  const project = document.projects.find((candidate) => candidate.id === document.preferences.activeProjectId)!;
  return <NotesView document={document} project={project} onAction={dispatch} />;
}

function documentElement(): HTMLElement {
  return window.document.documentElement;
}

describe('project notes', () => {
  it('spreads notes across a Keep-style card board without a note-list sidebar', () => {
    const document = createEmptyWorkspace('Notes board');
    const first = createProjectNote(document.projects[0].id, 'Launch brief');
    first.content = '# Direction\n\nA **clear** launch plan.';
    const second = createProjectNote(document.projects[0].id, 'Research');
    second.content = '- Interview customers\n- Review findings';
    document.modules.notes.notes = { [first.id]: first, [second.id]: second };

    const { container } = renderWithPreferences(<NotesHarness initial={document} />);

    expect(container.querySelector('.keep-notes-grid')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll<HTMLElement>('.keep-note-card')).every((card) => card.style.gridRowEnd.startsWith('span '))).toBe(true);
    expect(container.querySelector('.notes-library')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open note Launch brief' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Direction' })).toBeInTheDocument();
    expect(screen.getByText('Interview customers')).toBeInTheDocument();
  });

  it('turns Markdown shortcuts into formatting immediately in one Typora-style editor', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<NotesHarness initial={createEmptyWorkspace('Live Markdown')} />);

    await user.click(screen.getByRole('button', { name: /Take a note/ }));
    const dialog = screen.getByRole('dialog');
    const title = within(dialog).getByRole('textbox', { name: 'Note title' });
    fireEvent.change(title, { target: { value: 'Launch brief' } });

    const editor = within(dialog).getByRole('textbox', { name: 'Note content' });
    await user.type(editor, '# Direction');

    expect(within(editor).getByRole('heading', { level: 1, name: 'Direction' })).toBeInTheDocument();
    expect(editor).not.toHaveTextContent('# Direction');
    expect(within(dialog).queryByRole('button', { name: 'Markdown' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Markdown source' })).not.toBeInTheDocument();

    const heading = within(editor).getByRole('heading', { level: 1, name: 'Direction' });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(heading);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(editor).toHaveTextContent('# Direction');
  });

  it('supports fast keyboard capture, search focus, and an animated-editor escape path', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Keyboard notes');
    renderWithPreferences(<NotesHarness initial={document} />);

    await user.keyboard('/');
    expect(screen.getByRole('textbox', { name: 'Search notes' })).toHaveFocus();
    const composer = screen.getByRole('button', { name: /Take a note/ });
    composer.focus();
    await user.keyboard('{Control>}n{/Control}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(composer).toHaveFocus();
  });

  it('labels and pins a note from the focused editor', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Organized notes');
    const note = createProjectNote(document.projects[0].id, 'Decision');
    document.modules.notes.notes[note.id] = note;
    renderWithPreferences(<NotesHarness initial={document} />);

    await user.click(screen.getByRole('button', { name: 'Open note Decision' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Pin note' }));
    expect(within(dialog).getByRole('button', { name: 'Unpin note' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Labels' }));
    const labelInput = within(dialog).getByRole('combobox', { name: 'Search or create labels' });
    await user.type(labelInput, 'Strategy{Enter}');
    expect(within(dialog).getByRole('button', { name: 'Remove label Strategy' })).toBeInTheDocument();
  });

  it('switches between the current project and every project and searches the board', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Scoped notes');
    const firstProject = document.projects[0];
    const secondProject = createProject('Website', '#1f9d78');
    const firstNote = createProjectNote(firstProject.id, 'Product decisions');
    const secondNote = createProjectNote(secondProject.id, 'Website research');
    document.projects.push(secondProject);
    document.modules.kanban.projects[secondProject.id] = createProjectSettings();
    document.modules.canvas.projects[secondProject.id] = {
      name: 'Canvas 1', nodes: {}, connections: {}, strokes: {}, viewport: { x: 0, y: 0, zoom: 1 }, activeViewId: 'canvas-main', views: {},
    };
    document.modules.notes.notes = { [firstNote.id]: firstNote, [secondNote.id]: secondNote };

    renderWithPreferences(<NotesHarness initial={document} />);
    expect(screen.getByText('Product decisions')).toBeInTheDocument();
    expect(screen.queryByText('Website research')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Note scope' }));
    await user.click(screen.getByRole('option', { name: /All projects/ }));
    expect(screen.getByText('Website research')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search notes' }), 'Website');
    expect(screen.queryByText('Product decisions')).not.toBeInTheDocument();
    expect(screen.getByText('Website research')).toBeInTheDocument();
  });

  it('deletes a note after confirmation', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Delete notes');
    const note = createProjectNote(document.projects[0].id, 'Temporary thought');
    document.modules.notes.notes[note.id] = note;
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithPreferences(<NotesHarness initial={document} />);
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Temporary thought'));
    expect(screen.getByText('Notes you add appear here')).toBeInTheDocument();
  });

  it('defaults Hebrew note content to RTL even in the English interface', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Hebrew notes');
    const note = createProjectNote(document.projects[0].id, 'תכנון הפרויקט');
    note.content = '# החלטות\n\nנקודות חשובות לפגישה.';
    document.modules.notes.notes[note.id] = note;

    const { container } = renderWithPreferences(<NotesHarness initial={document} />);
    expect(noteTextDirection(note, 'ltr')).toBe('rtl');
    await user.click(container.querySelector<HTMLElement>('.keep-note-open')!);
    expect(container.querySelector('.keep-wysiwyg-content')).toHaveAttribute('dir', 'rtl');
  });

  it('mirrors every Markdown checkbox per task in Hebrew and mixed-direction notes', async () => {
    const user = userEvent.setup();
    localStorage.setItem('kanbanos.language', 'he');
    const document = createEmptyWorkspace('RTL checkboxes');
    const note = createProjectNote(document.projects[0].id, 'רשימת משימות');
    note.content = '- [ ] לקנות חלב\n- [x] Review the plan';
    document.modules.notes.notes[note.id] = note;

    const { container } = renderWithPreferences(<NotesHarness initial={document} />);
    const previewCheckboxes = Array.from(container.querySelectorAll<HTMLInputElement>('.keep-note-preview input[type="checkbox"]'));
    expect(container.querySelector('.keep-note-preview')).toHaveAttribute('dir', 'rtl');
    expect(previewCheckboxes).toHaveLength(2);
    expect(previewCheckboxes.every((checkbox) => checkbox.closest('li')?.getAttribute('dir') === 'auto')).toBe(true);

    await user.click(container.querySelector<HTMLElement>('.keep-note-open')!);
    const dialog = screen.getByRole('dialog');
    const editorCheckboxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(container.querySelector('.keep-wysiwyg-content')).toHaveAttribute('dir', 'rtl');
    expect(editorCheckboxes).toHaveLength(2);
    expect(editorCheckboxes.every((checkbox) => checkbox.closest('li')?.getAttribute('dir') === 'auto')).toBe(true);
    await user.click(editorCheckboxes[0]);
    expect(editorCheckboxes[0]).toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'סגירת ההערה' }));
    expect(container.querySelector<HTMLInputElement>('.keep-note-preview input[type="checkbox"]')).toBeChecked();
  });

  it.each([
    ['en', 'light', 'ltr'],
    ['en', 'dark', 'ltr'],
    ['he', 'light', 'rtl'],
    ['he', 'dark', 'rtl'],
  ] as const)('supports %s in the %s theme', async (language, theme, direction) => {
    const user = userEvent.setup();
    localStorage.setItem('kanbanos.language', language);
    localStorage.setItem('kanbanos.theme', theme);
    const document = createEmptyWorkspace('Theme notes');
    const note = createProjectNote(document.projects[0].id, 'Direction');
    note.content = '# Heading';
    document.modules.notes.notes[note.id] = note;

    const { container } = renderWithPreferences(<NotesHarness initial={document} />);
    expect(documentElement()).toHaveAttribute('dir', direction);
    expect(documentElement()).toHaveAttribute('data-theme', theme);
    expect(container.querySelector('.keep-note-card')).toBeInTheDocument();
    await user.click(container.querySelector<HTMLElement>('.keep-note-open')!);
    expect(container.querySelector('.keep-note-dialog')).toBeInTheDocument();
    expect(container.querySelector('.keep-wysiwyg-content')).toHaveAttribute('dir', direction);
  });

  it('persists rich-editor Markdown through reducer updates and workspace normalization', () => {
    const document = createEmptyWorkspace('Durable notes');
    const note = createProjectNote(document.projects[0].id, 'Architecture');
    let updated = workspaceReducer(document, { type: 'addNote', note });
    updated = workspaceReducer(updated, {
      type: 'updateNote',
      noteId: note.id,
      changes: { content: '# Decision\n\nUse **local-first** storage.', labels: ['Decision'], pinned: true },
    });

    const reloaded = normalizeWorkspaceDocument(JSON.parse(JSON.stringify(updated)) as WorkspaceDocument);
    expect(reloaded.modules.notes.notes[note.id]).toMatchObject({
      title: 'Architecture',
      content: '# Decision\n\nUse **local-first** storage.',
      labels: ['Decision'],
      pinned: true,
    });
  });
});
