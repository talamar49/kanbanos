import { readFileSync } from 'node:fs';
import { useReducer } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocument } from '../domain/types';
import {
  createCanvasNode,
  createCanvasProject,
  createEmptyWorkspace,
  createProject,
  createProjectSettings,
  createWorkItem,
  normalizeWorkspaceDocument,
  workspaceReducer,
} from '../domain/workspace';
import { renderWithPreferences } from '../test/render';
import { CanvasView } from './CanvasView';
import { FilesView } from './FilesView';
import { KanbanBoard } from './KanbanBoard';
import { ListView } from './ListView';
import { MobileNavigation } from './MobileNavigation';
import { RoadmapView } from './RoadmapView';
import { Sidebar } from './Sidebar';
import { TimelineView } from './TimelineView';

function featureWorkspace(): WorkspaceDocument {
  const document = createEmptyWorkspace('Feature workspace');
  const project = document.projects[0];
  const secondProject = createProject('Website', '#1f9d78', 'Refresh the website');
  secondProject.targetDate = '2099-12-15';
  const first = createWorkItem(project.id, 'planned', 'Prepare launch', 1000, {
    description: 'Write and review launch materials',
    priority: 'high',
    startDate: '2099-10-10',
    dueDate: '2099-10-12',
    labels: ['Release'],
    assignee: 'AM',
    subtasks: [{ id: 'subtask-1', title: 'Draft copy', completed: false }],
  });
  const done = createWorkItem(project.id, 'done', 'Approve direction', 2000, { priority: 'low' });
  const websiteTask = createWorkItem(secondProject.id, 'backlog', 'Map pages', 1000);
  const file = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'launch-brief.pdf',
    title: 'Launch brief',
    kind: 'file' as const,
    relativePath: '.kanbanos/content/attachments/10000000-0000-4000-8000-000000000001/launch-brief.pdf',
    sizeBytes: 2048,
    fileCount: 1,
    createdAt: '2027-01-01T00:00:00.000Z',
  };
  first.attachmentIds = [file.id];
  return {
    ...document,
    projects: [project, secondProject],
    items: { [first.id]: first, [done.id]: done, [websiteTask.id]: websiteTask },
    modules: {
      ...document.modules,
      kanban: {
        version: 1,
        projects: {
          ...document.modules.kanban.projects,
          [secondProject.id]: createProjectSettings(),
        },
      },
      canvas: {
        version: 1,
        projects: {
          ...document.modules.canvas.projects,
          [secondProject.id]: createCanvasProject(),
        },
      },
    },
    resources: { attachments: { [file.id]: file } },
  };
}

function commonViewCallbacks() {
  return {
    onAction: vi.fn(),
    onOpenTask: vi.fn(),
    onSave: vi.fn(),
    onEditProject: vi.fn(),
  };
}

function startMouseDrag(target: Element, from = { x: 10, y: 10 }, to = { x: 20, y: 20 }) {
  fireEvent.mouseDown(target, { button: 0, buttons: 1, clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(document, { buttons: 1, clientX: to.x, clientY: to.y });
  fireEvent.mouseMove(document, { buttons: 1, clientX: to.x + 1, clientY: to.y + 1 });
}

function elementRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function stopMouseDrag(target: Element) {
  fireEvent.mouseUp(target);
  await new Promise((resolve) => window.setTimeout(resolve, 60));
}

function fireTouchPointer(target: Element, type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
    clientX: { value: clientX },
    clientY: { value: clientY },
    button: { value: 0 },
    buttons: { value: type === 'pointerup' ? 0 : 1 },
  });
  fireEvent(target, event);
}

describe('workspace navigation', () => {
  it('keeps a mobile save error visible and retryable', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const onSave = vi.fn();
    renderWithPreferences(
      <MobileNavigation
        activeView="board"
        activeProject={document.projects[0]}
        menuOpen={false}
        saveState="error"
        dirty={false}
        onOpenMenu={vi.fn()}
        onSave={onSave}
        onChangeView={vi.fn()}
      />,
    );

    const retry = screen.getByRole('button', { name: 'Sync needs attention' });
    expect(retry).not.toBeDisabled();
    await user.click(retry);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('navigates views, projects, and workspace actions from the sidebar', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = {
      onChangeView: vi.fn(),
      onSelectProject: vi.fn(),
      onAddProject: vi.fn(),
      onRenameProject: vi.fn(),
      onAddRemote: vi.fn(),
      onRetrySync: vi.fn(),
      onRevealRepository: vi.fn(),
      onOpenDiagnostics: vi.fn(),
      onDisconnect: vi.fn(),
    };
    renderWithPreferences(
      <Sidebar
        document={document}
        activeProject={document.projects[0]}
        repositoryName="Local repo"
        syncState="error"
        syncError="Network unavailable"
        activeView="board"
        hasRemote={false}
        {...callbacks}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    await user.click(screen.getByRole('button', { name: 'Canvas' }));
    await user.click(screen.getByRole('button', { name: 'Roadmap' }));
    await user.click(screen.getByRole('button', { name: /Files/ }));
    expect(callbacks.onChangeView.mock.calls.map(([view]) => view)).toEqual(['timeline', 'canvas', 'roadmap', 'files']);

    const websiteButton = screen.getByText('Website').closest('button')!;
    await user.click(websiteButton);
    expect(callbacks.onSelectProject).toHaveBeenCalledWith(document.projects[1].id);
    await user.dblClick(websiteButton);
    expect(callbacks.onRenameProject).toHaveBeenCalledWith(document.projects[1].id);

    await user.click(screen.getByRole('button', { name: /Local repo/ }));
    await user.click(screen.getByRole('button', { name: 'Add remote repository' }));
    expect(callbacks.onAddRemote).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Local repo/ }));
    await user.click(screen.getByRole('button', { name: 'Diagnostics & logs' }));
    expect(callbacks.onOpenDiagnostics).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: /Retry sync/ }));
    expect(callbacks.onRetrySync).toHaveBeenCalledTimes(1);
  });

  it('opens the keyboard shortcut reference from the sidebar and question mark key', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <Sidebar
        document={document}
        activeProject={document.projects[0]}
        repositoryName="Shortcut repo"
        syncState="synced"
        syncError=""
        activeView="board"
        hasRemote={false}
        onChangeView={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRenameProject={vi.fn()}
        onAddRemote={vi.fn()}
        onRetrySync={vi.fn()}
        onRevealRepository={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    const helpButton = screen.getByRole('button', { name: /Help & shortcuts/ });
    await user.click(helpButton);

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Quick-create a task')).toBeInTheDocument();
    expect(within(dialog).getByText('Save workspace')).toBeInTheDocument();
    expect(within(dialog).getByText('Duplicate selected item')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    expect(helpButton).toHaveFocus();

    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('reassures people that offline web sync does not interrupt local saving', () => {
    const document = featureWorkspace();
    const callbacks = {
      onChangeView: vi.fn(),
      onSelectProject: vi.fn(),
      onAddProject: vi.fn(),
      onRenameProject: vi.fn(),
      onAddRemote: vi.fn(),
      onRetrySync: vi.fn(),
      onRevealRepository: vi.fn(),
      onDisconnect: vi.fn(),
    };
    renderWithPreferences(
      <Sidebar
        document={document}
        activeProject={document.projects[0]}
        repositoryName="Remote repo"
        syncState="error"
        syncError="The repository is offline. Your work is still safe on this device."
        syncIssue="offline"
        activeView="board"
        hasRemote
        {...callbacks}
      />,
    );

    const offlineStatus = screen.getByText('Offline — saved locally').closest('.sync-indicator')!;
    expect(offlineStatus).toHaveClass('sync-issue-offline');
    expect(screen.getByText('Online sync is unavailable because you are not connected to the internet. Your work is still saved on this device.')).toBeInTheDocument();
    expect(screen.queryByText('The repository is offline. Your work is still safe on this device.')).not.toBeInTheDocument();
  });

  it('reserves the red sync status for simultaneous local and online failures', () => {
    const document = featureWorkspace();
    renderWithPreferences(
      <Sidebar
        document={document}
        activeProject={document.projects[0]}
        repositoryName="Remote repo"
        syncState="error"
        syncError="Disk and connection unavailable"
        syncIssue="both"
        activeView="board"
        hasRemote
        onChangeView={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRenameProject={vi.fn()}
        onAddRemote={vi.fn()}
        onRetrySync={vi.fn()}
        onRevealRepository={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByText('Saving needs attention').closest('.sync-indicator')).toHaveClass('sync-issue-both');
  });

  it('keeps language and theme controls available inside the mobile drawer', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <Sidebar
        mobile
        mobileOpen
        document={document}
        activeProject={document.projects[0]}
        repositoryName="Mobile repo"
        syncState="synced"
        syncError=""
        activeView="board"
        hasRemote={false}
        onChangeView={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRenameProject={vi.fn()}
        onAddRemote={vi.fn()}
        onRetrySync={vi.fn()}
        onRevealRepository={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Display preferences')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hebrew' }));
    expect(window.document.documentElement).toHaveAttribute('dir', 'rtl');

    await user.click(screen.getByRole('button', { name: /עזרה וקיצורי דרך/ }));
    const shortcuts = screen.getByRole('dialog', { name: 'קיצורי מקלדת' });
    expect(within(shortcuts).getByText('שמירת סביבת העבודה')).toBeInTheDocument();
    expect(within(shortcuts).getByText('שכפול הפריט הנבחר')).toBeInTheDocument();
  });
});

describe('board and list task management', () => {
  it('automatically directs mixed Hebrew and English text on Kanban and timeline cards', () => {
    const document = createEmptyWorkspace('Mixed direction workspace');
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const scheduledDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    const task = createWorkItem(project.id, 'planned', 'משימה release', 1000, {
      description: 'תיאור English details',
      startDate: scheduledDate,
      dueDate: scheduledDate,
      labels: ['חשוב launch'],
      subtasks: [{ id: 'mixed-subtask', title: 'בדיקה QA', completed: false }],
    });
    document.items = { [task.id]: task };

    const board = renderWithPreferences(
      <KanbanBoard
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const card = screen.getByText('משימה release').closest<HTMLElement>('.task-card')!;
    expect(within(card).getByText('משימה release')).toHaveAttribute('dir', 'auto');
    expect(within(card).getByText('תיאור English details')).toHaveAttribute('dir', 'auto');
    expect(within(card).getByText('חשוב launch').closest('span')).toHaveAttribute('dir', 'auto');
    expect(within(card).getByText('בדיקה QA')).toHaveAttribute('dir', 'auto');
    board.unmount();

    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );
    expect(screen.getByText('משימה release')).toHaveAttribute('dir', 'auto');
  });

  it('fits every desktop Kanban column and card into the available width without horizontal scrolling', () => {
    const style = window.document.createElement('style');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const layoutRules = ['board-scroll', 'board-columns', 'board-column', 'task-card'].map((className) =>
      globalStyles.match(new RegExp(`\\.${className} \\{[^}]+\\}`))?.[0],
    );
    expect(layoutRules).not.toContain(undefined);
    style.textContent = layoutRules.join('\n');
    window.document.head.append(style);
    const document = featureWorkspace();
    document.modules.kanban.projects[document.projects[0].id].columns.push({
      id: 'review',
      title: 'Review',
      color: '#4c84e8',
    });
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const boardScroll = window.document.querySelector<HTMLElement>('.board-scroll')!;
    const boardToolbar = window.document.querySelector<HTMLElement>('.board-toolbar')!;
    const boardColumns = window.document.querySelector<HTMLElement>('.board-columns')!;
    const addColumnButton = within(boardToolbar).getByRole('button', { name: 'Add column' });
    const columns = Array.from(boardColumns.querySelectorAll<HTMLElement>(':scope > .board-column'));
    const cards = Array.from(boardColumns.querySelectorAll<HTMLElement>('.task-card'));
    expect(columns).toHaveLength(5);
    expect(addColumnButton).toBeVisible();
    expect(boardColumns).not.toContainElement(addColumnButton);
    expect(window.getComputedStyle(boardScroll).overflowX).toBe('hidden');
    expect(window.getComputedStyle(boardColumns).display).toBe('grid');
    expect(boardColumns.style.getPropertyValue('--board-column-count')).toBe('5');
    columns.forEach((column) => {
      expect(window.getComputedStyle(column).minWidth).toBe('0px');
      expect(window.getComputedStyle(column).width).toBe('100%');
    });
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => {
      expect(window.getComputedStyle(card).minWidth).toBe('0px');
      expect(window.getComputedStyle(card).width).toBe('100%');
    });
    style.remove();
  });

  it('keeps Add task visible in every column header as well as at the bottom', async () => {
    const user = userEvent.setup();
    const style = window.document.createElement('style');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const addTaskButtonRule = globalStyles.match(/\.column-actions \.column-add-task-button \{[^}]+\}/)?.[0];
    expect(addTaskButtonRule).toContain('background: transparent');
    style.textContent = [
      globalStyles.match(/:root \{[^}]+\}/)?.[0],
      globalStyles.match(/\.column-actions \{[^}]+\}/)?.[0],
      globalStyles.match(/\.quick-add \{[^}]+\}/)?.[0],
      globalStyles.match(/\.quick-add > textarea \{[^}]+\}/)?.[0],
      globalStyles.match(/\.quick-add-actions \{[^}]+\}/)?.[0],
      addTaskButtonRule,
    ].filter(Boolean).join('\n');
    window.document.head.append(style);
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const backlogColumn = screen.getByRole('heading', { name: 'Backlog' }).closest<HTMLElement>('.board-column')!;
    const header = backlogColumn.querySelector<HTMLElement>('.column-header')!;
    const headerActions = header.querySelector<HTMLElement>('.column-actions')!;
    const headerAddTask = within(header).getByRole('button', { name: 'Add task to Backlog' });
    expect(headerAddTask).toBeInTheDocument();
    expect(within(backlogColumn).getByRole('button', { name: 'Add task' })).toBeInTheDocument();
    expect(window.getComputedStyle(headerActions).opacity).toBe('1');
    expect(window.getComputedStyle(headerAddTask).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await user.click(headerAddTask);
    const titleField = within(backlogColumn).getByPlaceholderText('What needs to be done?');
    const composer = titleField.closest<HTMLElement>('.quick-add')!;
    const taskList = backlogColumn.querySelector<HTMLElement>('.task-list')!;
    expect(titleField).toHaveFocus();
    expect(titleField.tagName).toBe('TEXTAREA');
    expect(composer.compareDocumentPosition(taskList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(composer).getByRole('combobox', { name: 'Search or create labels' })).toBeInTheDocument();
    expect(within(composer).queryByText('Ctrl+Enter to add · Enter for a new line')).not.toBeInTheDocument();
    expect(window.getComputedStyle(composer).boxShadow).toBe('none');
    expect(window.getComputedStyle(titleField).resize).toBe('none');
    expect(window.getComputedStyle(titleField).minHeight).toBe('44px');
    const actions = composer.querySelector<HTMLElement>('.quick-add-actions')!;
    expect(actions).toContainElement(within(composer).getByRole('button', { name: 'Cancel' }));
    expect(actions).toContainElement(within(composer).getByRole('button', { name: 'Add task' }));
    expect(window.getComputedStyle(actions).display).toBe('flex');
    expect(window.getComputedStyle(actions).flexWrap).toBe('nowrap');
    style.remove();
  });

  it('places a task created in a Kanban column at the top of that column', async () => {
    const user = userEvent.setup();
    const initialDocument = featureWorkspace();

    function BoardHarness() {
      const [document, dispatch] = useReducer(workspaceReducer, initialDocument);
      return (
        <KanbanBoard
          document={document}
          project={document.projects[0]}
          saveState="idle"
          dirty={false}
          onAction={dispatch}
          onOpenTask={vi.fn()}
          onSave={vi.fn()}
          onEditProject={vi.fn()}
          onChangeView={vi.fn()}
        />
      );
    }

    renderWithPreferences(<BoardHarness />);
    const column = screen.getByRole('heading', { name: 'Stuck' }).closest<HTMLElement>('.board-column')!;
    await user.click(within(column).getByRole('button', { name: 'Add task to Stuck' }));
    const composer = column.querySelector<HTMLElement>('.quick-add')!;
    await user.click(within(composer).getByRole('combobox', { name: 'Search or create labels' }));
    await user.click(within(composer).getByRole('option', { name: /Release/ }));
    const titleField = within(composer).getByPlaceholderText('What needs to be done?');
    Object.defineProperty(titleField, 'scrollHeight', { configurable: true, value: 96 });
    await user.type(titleField, 'Newest task{Enter}with context');
    expect(titleField).toHaveValue('Newest task\nwith context');
    expect(titleField).toHaveStyle({ height: '96px' });
    await user.keyboard('{Control>}{Enter}{/Control}');

    const cards = Array.from(column.querySelectorAll<HTMLElement>('.task-card'));
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Newest task\nwith context', 'Prepare launch']);
    expect(cards[0].querySelector('.card-labels')).toHaveTextContent('Release');

    const style = window.document.createElement('style');
    style.textContent = readFileSync('src/styles/global.css', 'utf8').match(/\.task-card h3 \{[^}]+\}/)?.[0] ?? '';
    window.document.head.append(style);
    expect(window.getComputedStyle(cards[0].querySelector('h3')!).whiteSpace).toBe('pre-wrap');
    style.remove();
  });

  it('checks a Kanban card into Done and deletes it without opening task details', async () => {
    const user = userEvent.setup();
    const initialDocument = featureWorkspace();
    const task = Object.values(initialDocument.items).find((item) => item.title === 'Prepare launch')!;
    const onOpenTask = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    function BoardHarness() {
      const [document, dispatch] = useReducer(workspaceReducer, initialDocument);
      return (
        <KanbanBoard
          document={document}
          project={document.projects[0]}
          saveState="idle"
          dirty={false}
          onAction={dispatch}
          onOpenTask={onOpenTask}
          onSave={vi.fn()}
          onEditProject={vi.fn()}
          onChangeView={vi.fn()}
        />
      );
    }

    renderWithPreferences(<BoardHarness />);
    const sourceCard = screen.getByRole('heading', { name: task.title }).closest<HTMLElement>('.task-card')!;
    const sourceActions = sourceCard.querySelector<HTMLElement>('.task-card-quick-actions')!;
    const sourceHeading = sourceCard.querySelector<HTMLElement>('.task-card-heading')!;
    const sourceLabelLine = sourceCard.querySelector<HTMLElement>('.task-card-label-line')!;
    expect(sourceLabelLine.querySelector('.card-labels')).toHaveTextContent('Release');
    expect(within(sourceHeading).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(sourceHeading).queryByRole('button', { name: `Delete ${task.title}` })).not.toBeInTheDocument();
    expect(within(sourceActions).getByRole('button', { name: 'Add a subtask' })).toBeInTheDocument();
    expect(within(sourceActions).getByRole('button', { name: `Delete ${task.title}` })).toBeInTheDocument();
    expect(within(sourceActions).queryByRole('checkbox')).not.toBeInTheDocument();
    const complete = within(sourceLabelLine).getByRole('checkbox', { name: `Mark ${task.title} as complete` });
    expect(sourceLabelLine.lastElementChild).toBe(complete);
    const noLabelCard = screen.getByRole('heading', { name: 'Approve direction' }).closest<HTMLElement>('.task-card')!;
    const noLabelLine = noLabelCard.querySelector<HTMLElement>('.task-card-label-line')!;
    expect(noLabelLine.querySelector('.card-labels')).not.toBeInTheDocument();
    expect(within(noLabelLine).getByRole('checkbox', { name: 'Mark Approve direction as not complete' })).toBeInTheDocument();
    expect(complete).toHaveAttribute('aria-checked', 'false');

    await user.click(complete);

    const doneColumn = screen.getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const completedCard = within(doneColumn).getByRole('heading', { name: task.title }).closest<HTMLElement>('.task-card')!;
    const completedControl = within(completedCard.querySelector<HTMLElement>('.task-card-label-line')!).getByRole('checkbox', { name: `Mark ${task.title} as not complete` });
    expect(completedControl).toHaveAttribute('aria-checked', 'true');
    expect(completedControl.querySelector('svg')).toHaveAttribute('width', '11');
    expect(onOpenTask).not.toHaveBeenCalled();

    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const quickActionRule = globalStyles.match(/\.task-complete-control, \.task-delete-control \{[^}]+\}/)?.[0];
    expect(quickActionRule).toContain('width: 28px');
    expect(quickActionRule).toContain('height: 28px');
    const labelLineRule = globalStyles.match(/\.task-card-label-line \{[^}]+\}/)?.[0];
    expect(labelLineRule).toContain('display: flex');
    const labelLineCheckboxRule = globalStyles.match(/\.task-card-label-line > \.task-card-complete \{[^}]+\}/)?.[0];
    expect(labelLineCheckboxRule).toContain('width: 22px');
    expect(labelLineCheckboxRule).toContain('height: 22px');
    expect(labelLineCheckboxRule).toContain('margin-inline-start: auto');
    const checkboxRule = globalStyles.match(/\.task-complete-control > span \{[^}]+\}/)?.[0];
    expect(checkboxRule).toContain('width: 17px');
    expect(checkboxRule).toContain('height: 17px');
    expect(checkboxRule).toContain('background: transparent');
    const completedRule = globalStyles.match(/\.task-complete-control\.completed > span \{[^}]+\}/)?.[0];
    expect(completedRule).toContain('background: transparent');
    expect(completedRule).toContain('box-shadow: none');
    const deleteHoverRule = globalStyles.match(/\.task-delete-control:hover \{[^}]+\}/)?.[0];
    expect(deleteHoverRule).toContain('background: transparent');
    expect(globalStyles).toContain('.task-card:hover .task-card-delete');
    expect(globalStyles.match(/\.task-card-delete \{[^}]+\}/)?.[0]).toContain('opacity: 0');
    const deleteControl = within(completedCard.querySelector<HTMLElement>('.task-card-quick-actions')!).getByRole('button', { name: `Delete ${task.title}` });
    expect(deleteControl.querySelector('svg')).toHaveAttribute('width', '14');
    await user.click(deleteControl);

    expect(confirm).toHaveBeenCalledWith('Delete this task? This cannot be undone after the workspace is saved.');
    expect(screen.queryByRole('heading', { name: task.title })).not.toBeInTheDocument();
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('types spaces in the inline subtask composer without activating card dragging', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const taskCard = screen.getByText('Prepare launch').closest<HTMLElement>('.task-card')!;
    await user.click(within(taskCard).getByRole('button', { name: 'Add a subtask' }));
    const input = within(taskCard).getByRole('textbox', { name: 'Add a subtask' });
    await user.type(input, 'Write launch copy');

    expect(input).toHaveValue('Write launch copy');
    expect(input).toHaveFocus();
    expect(taskCard).not.toHaveClass('dragging');
  });

  it('keeps the first card clear of the sticky column header when it lifts on hover', () => {
    const style = window.document.createElement('style');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const cardRule = globalStyles.match(/\.task-card \{[^}]+\}/)?.[0];
    const cardHoverRule = globalStyles.match(/\.task-card:hover \{[^}]+\}/)?.[0];
    expect(cardRule).toContain('--card-hover-tilt: -.75deg');
    expect(cardHoverRule).toContain('rotate(var(--card-hover-tilt)) scale(1.012)');
    style.textContent = globalStyles.match(/\.task-list \{[^}]+\}/)?.[0] ?? '';
    window.document.head.append(style);
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const plannedColumn = screen.getByRole('heading', { name: 'Stuck' }).closest<HTMLElement>('.board-column')!;
    const taskList = plannedColumn.querySelector<HTMLElement>('.task-list')!;
    expect(taskList.firstElementChild).toHaveClass('task-card');
    expect(window.getComputedStyle(taskList).paddingBlockStart).toBe('6px');
    style.remove();
  });

  it('searches, filters, opens tasks, changes view, and adds a custom board column', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const onChangeView = vi.fn();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={onChangeView}
        {...callbacks}
      />,
    );

    const taskCard = screen.getByText('Prepare launch').closest<HTMLElement>('.task-card')!;
    expect(taskCard).toHaveAttribute('role', 'button');
    expect(taskCard).toHaveAttribute('aria-label', 'Move Prepare launch');
    expect(within(taskCard).queryByRole('button', { name: 'Move Prepare launch' })).not.toBeInTheDocument();
    const boardScroll = window.document.querySelector<HTMLElement>('.board-scroll')!;
    const columns = Array.from(window.document.querySelectorAll<HTMLElement>('.board-column'));
    columns.forEach((column, index) => {
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(elementRect(index * 320, 0, 286, 700));
    });
    vi.spyOn(taskCard, 'getBoundingClientRect').mockReturnValue(elementRect(330, 90, 276, 190));
    boardScroll.scrollTop = 48;
    startMouseDrag(within(taskCard).getByRole('heading', { name: 'Prepare launch' }), { x: 350, y: 110 }, { x: 360, y: 120 });
    expect(taskCard).toHaveClass('dragging');
    expect(window.document.querySelector('.task-drop-preview')).not.toBeInTheDocument();
    expect(boardScroll.scrollTop).toBe(48);
    await stopMouseDrag(taskCard);
    await user.type(screen.getByPlaceholderText('Search this project'), 'missing');
    expect(screen.queryByText('Prepare launch')).not.toBeInTheDocument();
    expect(screen.getByText('0 matching tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(onChangeView).toHaveBeenCalledWith('list');

    await user.click(screen.getByRole('button', { name: 'Add column' }));
    const addColumnDialog = screen.getByRole('dialog', { name: 'Add column' });
    await user.type(within(addColumnDialog).getByPlaceholderText('Column name'), 'Review');
    await user.click(within(addColumnDialog).getByRole('button', { name: 'Add column' }));
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'addColumn',
      projectId: document.projects[0].id,
      column: expect.objectContaining({ title: 'Review' }),
    }));
  });

  it('lists existing labels and filters the Kanban board by label', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const done = Object.values(document.items).find((item) => item.title === 'Approve direction')!;
    done.labels = ['Research'];
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const filterMenu = screen.getByRole('menu');
    expect(within(filterMenu).getByText('Show labels')).toBeInTheDocument();
    expect(within(filterMenu).getByRole('button', { name: /Release/ })).toBeInTheDocument();
    expect(within(filterMenu).getByRole('button', { name: /Research/ })).toBeInTheDocument();

    const labelSearch = within(filterMenu).getByRole('textbox', { name: 'Search labels' });
    await user.type(labelSearch, 'rel');
    expect(within(filterMenu).getByRole('button', { name: /Release/ })).toBeInTheDocument();
    expect(within(filterMenu).queryByRole('button', { name: /Research/ })).not.toBeInTheDocument();
    await user.click(within(filterMenu).getByRole('button', { name: /Release/ }));

    expect(screen.getByText('Prepare launch')).toBeInTheDocument();
    expect(screen.queryByText('Approve direction')).not.toBeInTheDocument();
    expect(screen.getByText('1 matching task')).toBeInTheDocument();

    await user.click(within(filterMenu).getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Approve direction')).toBeInTheDocument();
  });

  it('sets and removes a WIP limit from the in-app column editor', async () => {
    const user = userEvent.setup();
    const initialDocument = featureWorkspace();
    const project = initialDocument.projects[0];

    function BoardHarness() {
      const [currentDocument, onAction] = useReducer(workspaceReducer, initialDocument);
      return (
        <KanbanBoard
          document={currentDocument}
          project={project}
          saveState="idle"
          dirty
          onAction={onAction}
          onOpenTask={vi.fn()}
          onSave={vi.fn()}
          onEditProject={vi.fn()}
          onChangeView={vi.fn()}
        />
      );
    }

    renderWithPreferences(<BoardHarness />);
    const plannedColumn = screen.getByRole('heading', { name: 'Stuck' }).closest<HTMLElement>('.board-column')!;

    await user.click(within(plannedColumn).getByRole('button', { name: 'Column options' }));
    await user.click(screen.getByRole('button', { name: 'Set WIP limit' }));
    const editor = screen.getByRole('form', { name: 'Set WIP limit' });
    const limitInput = within(editor).getByRole('spinbutton', { name: 'Work-in-progress limit (leave empty for none)' });
    expect(limitInput).toHaveValue(null);
    expect(within(editor).queryByRole('button', { name: 'Disable WIP limit' })).not.toBeInTheDocument();

    await user.type(limitInput, '0');
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(within(editor).getByRole('alert')).toHaveTextContent('Enter a whole number of at least 1.');
    expect(plannedColumn.querySelector('.column-heading small')).not.toBeInTheDocument();

    await user.clear(limitInput);
    await user.type(limitInput, '2');
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(within(plannedColumn).getByText('1/2')).toBeInTheDocument();

    await user.click(within(plannedColumn).getByRole('button', { name: 'Column options' }));
    await user.click(screen.getByRole('button', { name: 'Set WIP limit' }));
    const updatedEditor = screen.getByRole('form', { name: 'Set WIP limit' });
    await user.click(within(updatedEditor).getByRole('button', { name: 'Disable WIP limit' }));
    expect(plannedColumn.querySelector('.column-heading small')).not.toBeInTheDocument();

    await user.click(within(plannedColumn).getByRole('button', { name: 'Column options' }));
    await user.click(screen.getByRole('button', { name: 'Set WIP limit' }));
    const disabledEditor = screen.getByRole('form', { name: 'Set WIP limit' });
    expect(within(disabledEditor).getByRole('spinbutton')).toHaveValue(null);
    expect(within(disabledEditor).queryByRole('button', { name: 'Disable WIP limit' })).not.toBeInTheDocument();
  });

  it('keeps the column dropdown outside clipped board containers', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const backlogColumn = screen.getByRole('heading', { name: 'Backlog' }).closest<HTMLElement>('.board-column')!;
    const columnOptions = within(backlogColumn).getByRole('button', { name: 'Column options' });
    vi.spyOn(columnOptions, 'getBoundingClientRect').mockReturnValue(elementRect(459, 100, 34, 34));

    await user.click(columnOptions);

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(window.document.body);
    expect(menu).toHaveStyle({ position: 'fixed', top: '139px', left: '153px' });
  });

  it('dismisses board dropdowns outside their controls', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const doneColumn = screen.getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const columnOptions = within(doneColumn).getByRole('button', { name: 'Column options' });
    await user.click(columnOptions);
    expect(screen.getByRole('button', { name: 'Rename column' })).toBeInTheDocument();

    fireEvent.pointerDown(window.document.body);
    expect(screen.queryByRole('button', { name: 'Rename column' })).not.toBeInTheDocument();

    await user.click(columnOptions);
    await user.click(screen.getByPlaceholderText('Search this project'));
    expect(screen.queryByRole('button', { name: 'Rename column' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByText('Show priority')).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText('Search this project'));
    expect(screen.queryByText('Show priority')).not.toBeInTheDocument();
  });

  it('assigns durable column rules and warns before moving them during deletion', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...callbacks}
      />,
    );

    const doneColumn = screen.getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    await user.click(within(doneColumn).getByRole('button', { name: 'Column options' }));
    expect(screen.getByText('Column behavior')).toBeInTheDocument();
    expect(screen.getByText('Tell Kanbanos what this column means. Each behavior can be assigned to one column.')).toBeInTheDocument();
    expect(screen.getByText('Tasks here count as completed in List and Roadmap progress.')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Count tasks as complete' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Default home for new tasks' }));
    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'setColumnRule',
      projectId: document.projects[0].id,
      columnId: 'done',
      rule: 'new-task',
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Count tasks as complete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete column' }));
    expect(confirm).toHaveBeenCalledWith('Delete “Done”? Its cards and column rules will move to “Backlog”.');
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deleteColumn',
      columnId: 'done',
      moveToColumnId: 'backlog',
    }));
  });

  it('shows the complete dragged card at the exact target position and smoothly opens room for it', async () => {
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...callbacks}
      />,
    );

    const sourceItem = Object.values(document.items).find((item) => item.title === 'Prepare launch')!;
    const sourceCard = screen.getByText('Prepare launch').closest<HTMLElement>('.task-card')!;
    const emptyColumn = screen.getByRole('heading', { name: 'Backlog' }).closest<HTMLElement>('.board-column')!;
    const targetColumn = screen.getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const targetCard = screen.getByText('Approve direction').closest<HTMLElement>('.task-card')!;
    const columns = Array.from(window.document.querySelectorAll<HTMLElement>('.board-column'));

    columns.forEach((column, index) => {
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(elementRect(index * 320, 0, 286, 700));
    });
    vi.spyOn(sourceCard, 'getBoundingClientRect').mockReturnValue(elementRect(330, 90, 276, 190));
    vi.spyOn(targetCard, 'getBoundingClientRect').mockReturnValue(elementRect(970, 90, 276, 110));

    startMouseDrag(sourceCard, { x: 350, y: 110 }, { x: 360, y: 120 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 30, clientY: 120 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 31, clientY: 121 });

    let preview = emptyColumn.querySelector<HTMLElement>('.task-drop-preview');
    expect(preview).not.toBeNull();
    expect(emptyColumn.querySelector('.empty-column')).not.toBeInTheDocument();
    expect(emptyColumn.querySelector('.task-list')?.firstElementChild).toContainElement(preview);

    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 990, clientY: 175 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 991, clientY: 176 });

    preview = targetColumn.querySelector<HTMLElement>('.task-drop-preview');
    expect(preview).not.toBeNull();
    expect(preview).toHaveTextContent('Prepare launch');
    expect(preview).toHaveTextContent('Write and review launch materials');
    expect(preview?.querySelector('.card-labels')).toHaveTextContent('Release');
    expect(preview?.querySelector('.card-subtask-section')).toHaveTextContent('Draft copy');
    expect(targetCard.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const previewSlot = preview!.parentElement!;
    expect(previewSlot).toHaveClass('task-drop-slot', 'kanban-task-drop-slot');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const slotRule = globalStyles.match(/\.task-drop-slot\.kanban-task-drop-slot \{[^}]+\}/)?.[0];
    expect(slotRule).toContain('height: var(--task-drop-slot-height)');
    expect(slotRule).toContain('animation: taskDropSlotOpen 260ms cubic-bezier(.2,.8,.2,1) both');
    expect(globalStyles).toContain('@keyframes taskDropSlotOpen { from { height: 0; margin-block-end: calc(-1 * var(--task-list-gap)); opacity: 0; } to { height: var(--task-drop-slot-height); margin-block-end: 0; opacity: 1; } }');

    await stopMouseDrag(targetCard);
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'moveItem',
      itemId: sourceItem.id,
      columnId: 'done',
      index: 1,
    }));
  });

  it('keeps a top-of-column preview stable under the pointer', async () => {
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...callbacks}
      />,
    );

    const sourceCard = screen.getByText('Prepare launch').closest<HTMLElement>('.task-card')!;
    const targetColumn = screen.getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const targetCard = screen.getByText('Approve direction').closest<HTMLElement>('.task-card')!;
    const columns = Array.from(window.document.querySelectorAll<HTMLElement>('.board-column'));

    columns.forEach((column, index) => {
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(elementRect(index * 320, 0, 286, 700));
    });
    const defaultElementRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('task-drop-slot')
        ? elementRect(970, 90, 276, 190)
        : defaultElementRect.call(this);
    });
    vi.spyOn(sourceCard, 'getBoundingClientRect').mockReturnValue(elementRect(330, 90, 276, 190));
    vi.spyOn(targetCard, 'getBoundingClientRect').mockImplementation(() => (
      targetColumn.querySelector('.task-drop-preview')
        ? elementRect(970, 289, 276, 110)
        : elementRect(970, 90, 276, 110)
    ));

    startMouseDrag(sourceCard, { x: 350, y: 110 }, { x: 360, y: 120 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 990, clientY: 105 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 991, clientY: 106 });

    const preview = targetColumn.querySelector<HTMLElement>('.task-drop-preview')!;
    expect(preview).toBeInTheDocument();
    const previewSlot = preview.parentElement!;
    expect(previewSlot).toHaveClass('task-drop-slot');

    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 990, clientY: 106 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 991, clientY: 107 });

    expect(targetColumn.querySelector('.task-drop-preview')).toBe(preview);
    expect(previewSlot.compareDocumentPosition(targetCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await stopMouseDrag(preview);
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'moveItem',
      columnId: 'done',
      index: 0,
    }));
  });

  it('shares the all-projects selection with the timeline and restores it after reload', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const view = renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onChangeView={vi.fn()}
        {...callbacks}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mission scope' }));
    await user.click(screen.getByRole('option', { name: /All projects/ }));
    expect(callbacks.onAction).toHaveBeenCalledWith({ type: 'setProjectScope', scope: 'all' });

    const saved = workspaceReducer(document, { type: 'setProjectScope', scope: 'all' });
    const reloaded = normalizeWorkspaceDocument(JSON.parse(JSON.stringify(saved)) as WorkspaceDocument);
    view.unmount();
    renderWithPreferences(
      <TimelineView
        document={reloaded}
        project={reloaded.projects[0]}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mission scope' })).toHaveTextContent('All projects');
    expect(screen.getByText('Map pages')).toBeInTheDocument();
  });

  it('keeps mobile board controls compact and can switch to horizontal columns', async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: '(max-width: 900px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const document = featureWorkspace();
    renderWithPreferences(
      <KanbanBoard
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onChangeView={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const toolbar = window.document.querySelector<HTMLElement>('.board-toolbar')!;
    expect(within(toolbar).getByPlaceholderText('Search this project')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Mission scope' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Add column' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show columns horizontally' }));
    expect(window.document.querySelector('.workspace-main')).toHaveClass('mobile-board-horizontal');
    await user.click(screen.getByRole('button', { name: 'Stack columns vertically' }));
    expect(window.document.querySelector('.workspace-main')).not.toHaveClass('mobile-board-horizontal');
  });

  it('searches list content, opens tasks, toggles completion, and presets new tasks', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const onCreateTask = vi.fn();
    const onChangeView = vi.fn();
    renderWithPreferences(
      <ListView
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onCreateTask={onCreateTask}
        onChangeView={onChangeView}
        {...callbacks}
      />,
    );

    const row = screen.getByText('Prepare launch').closest<HTMLElement>('.task-table-row')!;
    await user.click(within(row).getAllByRole('button')[0]);
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'moveItem', columnId: 'done' }));
    await user.click(screen.getByText('Prepare launch'));
    expect(callbacks.onOpenTask).toHaveBeenCalledWith(document.items[Object.keys(document.items)[0]]);

    await user.type(screen.getByPlaceholderText('Search tasks'), 'not present');
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Search tasks'));
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onCreateTask).toHaveBeenCalledWith({ columnId: 'backlog' });

    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(onChangeView).toHaveBeenCalledWith('board');
  });
});

describe('timeline, roadmap, canvas, and files', () => {
  it('uses assigned rules after columns are renamed or repurposed', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const projectId = document.projects[0].id;
    const columns = document.modules.kanban.projects[projectId].columns.map((column) => ({
      ...column,
      title: column.id === 'progress' ? 'Released' : column.title,
      rules: column.id === 'progress' ? ['completed' as const] : column.id === 'done' ? ['new-task' as const] : [],
    }));
    const repurposed: WorkspaceDocument = {
      ...document,
      items: Object.fromEntries(Object.entries(document.items).map(([itemId, item]) => [
        itemId,
        item.projectId === projectId && item.moduleData.kanban.columnId === 'done'
          ? { ...item, moduleData: { ...item.moduleData, kanban: { ...item.moduleData.kanban, columnId: 'progress' } } }
          : item,
      ])),
      modules: {
        ...document.modules,
        kanban: {
          ...document.modules.kanban,
          projects: {
            ...document.modules.kanban.projects,
            [projectId]: { columns },
          },
        },
      },
    };
    const callbacks = commonViewCallbacks();
    const onCreateTask = vi.fn();
    const listView = renderWithPreferences(
      <ListView
        document={repurposed}
        project={repurposed.projects[0]}
        saveState="idle"
        dirty
        onCreateTask={onCreateTask}
        onChangeView={vi.fn()}
        {...callbacks}
      />,
    );

    const plannedRow = screen.getByText('Prepare launch').closest<HTMLElement>('.task-table-row')!;
    await user.click(within(plannedRow).getAllByRole('button')[0]);
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'moveItem', columnId: 'progress' }));
    expect(screen.getByText('Approve direction')).toHaveClass('completed');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onCreateTask).toHaveBeenCalledWith({ columnId: 'done' });

    listView.unmount();
    renderWithPreferences(
      <RoadmapView
        document={repurposed}
        saveState="idle"
        dirty
        onSave={vi.fn()}
        onAddProject={vi.fn()}
        onAddTask={vi.fn()}
        onEditProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenTask={vi.fn()}
        onMoveProject={vi.fn()}
        onReorderHorizons={vi.fn()}
      />,
    );
    expect(screen.getByText('2 open tasks')).toBeInTheDocument();
  });

  it('changes timeline scale/layout and offers minimalist task creation in both headers', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const onCreateTask = vi.fn();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onCreateTask={onCreateTask}
        {...callbacks}
      />,
    );

    const timelineHeading = window.document.querySelector<HTMLElement>('.timeline-heading')!;
    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    const unscheduledHeader = unscheduledSection.querySelector<HTMLElement>(':scope > header')!;
    const headingAddTask = within(timelineHeading).getByRole('button', { name: 'Add task' });
    const unscheduledAddTask = within(unscheduledHeader).getByRole('button', { name: 'Add task' });
    expect(headingAddTask).toHaveClass('timeline-add-task-button');
    expect(unscheduledAddTask).toHaveClass('timeline-add-task-button');

    const styles = readFileSync('src/styles/global.css', 'utf8');
    const minimalistRule = styles.match(/\.timeline-add-task-button \{[^}]+\}/)?.[0];
    expect(minimalistRule).toContain('background: transparent');
    expect(minimalistRule).toContain('box-shadow: none');
    expect(minimalistRule).toContain('font-size: 14px');

    await user.click(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByRole('button', { name: '4 weeks' })).toHaveClass('active');
    await user.click(screen.getByRole('button', { name: 'Compact lanes' }));
    expect(callbacks.onAction).toHaveBeenCalledWith({ type: 'setTimelineLayout', layout: 'compact' });
    await user.click(headingAddTask);
    expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'backlog',
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    await user.click(unscheduledAddTask);
    expect(onCreateTask).toHaveBeenLastCalledWith({ columnId: 'backlog' });
  });

  it('keeps completion and delete quick actions off scheduled and unscheduled timeline cards', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Timeline card actions');
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const scheduledDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    const scheduledTask = createWorkItem(project.id, 'planned', 'Finish timeline mission', 1000, { startDate: scheduledDate, dueDate: scheduledDate });
    const unscheduledTask = createWorkItem(project.id, 'planned', 'Plan another mission', 1001);
    document.items = { [scheduledTask.id]: scheduledTask, [unscheduledTask.id]: unscheduledTask };
    const onOpenTask = vi.fn();

    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onAction={vi.fn()}
        onOpenTask={onOpenTask}
        onCreateTask={vi.fn()}
        onSave={vi.fn()}
        onEditProject={vi.fn()}
      />,
    );

    const scheduledSlot = window.document.querySelector<HTMLElement>(`[data-timeline-task-id="${scheduledTask.id}"]`)!;
    const unscheduledCard = screen.getByRole('heading', { name: unscheduledTask.title }).closest<HTMLElement>('.task-card')!;
    expect(within(scheduledSlot).queryByRole('checkbox', { name: /Mark .* as complete/ })).not.toBeInTheDocument();
    expect(within(scheduledSlot).queryByRole('button', { name: `Delete ${scheduledTask.title}` })).not.toBeInTheDocument();
    expect(within(unscheduledCard).queryByRole('checkbox', { name: /Mark .* as complete/ })).not.toBeInTheDocument();
    expect(within(unscheduledCard).queryByRole('button', { name: `Delete ${unscheduledTask.title}` })).not.toBeInTheDocument();

    await user.click(scheduledSlot.querySelector<HTMLElement>('.timeline-bar')!);
    await user.click(within(unscheduledCard).getByRole('heading', { name: unscheduledTask.title }));
    expect(onOpenTask).toHaveBeenNthCalledWith(1, scheduledTask);
    expect(onOpenTask).toHaveBeenNthCalledWith(2, unscheduledTask);
  });

  it('starts two-week sprints on the current Sunday and remembers each timeline position', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const currentWeekDate = new Date(sunday);
    currentWeekDate.setDate(currentWeekDate.getDate() + 1);
    const followingWeekDate = new Date(sunday);
    followingWeekDate.setDate(followingWeekDate.getDate() + 8);
    const currentTask = createWorkItem(project.id, 'planned', 'Current-week timeline task', 1000, { startDate: localDate(currentWeekDate), dueDate: localDate(currentWeekDate) });
    const followingTask = createWorkItem(project.id, 'planned', 'Following-week timeline task', 2000, { startDate: localDate(followingWeekDate), dueDate: localDate(followingWeekDate) });
    document.items = { [currentTask.id]: currentTask, [followingTask.id]: followingTask };
    const callbacks = commonViewCallbacks();

    const view = renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    const firstVisibleDate = () => window.document.querySelector<HTMLElement>('.timeline-days > div')?.dataset.date;
    expect(screen.getByText('Current-week timeline task')).toBeInTheDocument();
    expect(screen.getByText('Following-week timeline task')).toBeInTheDocument();
    expect(firstVisibleDate()).toBe(localDate(sunday));

    await user.click(screen.getByRole('button', { name: 'Next range' }));
    const nextSunday = new Date(sunday);
    nextSunday.setDate(nextSunday.getDate() + 7);
    expect(firstVisibleDate()).toBe(localDate(nextSunday));
    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'setTimelineWindowStart',
      zoom: 'two-weeks',
      startDate: localDate(nextSunday),
    });

    await user.click(screen.getByRole('button', { name: '4 weeks' }));
    expect(firstVisibleDate()).toBe(localDate(sunday));
    await user.click(screen.getByRole('button', { name: '2 weeks' }));
    expect(firstVisibleDate()).toBe(localDate(nextSunday));

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(firstVisibleDate()).toBe(localDate(sunday));

    view.unmount();
    document.preferences.timelineWindowStarts = { 'two-weeks': localDate(nextSunday) };
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );
    expect(firstVisibleDate()).toBe(localDate(nextSunday));
  });

  it('alternates exactly two week shades across 2-week, 4-week, and year timelines', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const localIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const spanningStart = new Date(sunday);
    spanningStart.setDate(spanningStart.getDate() + 13);
    const spanningDue = new Date(sunday);
    spanningDue.setDate(spanningDue.getDate() + 15);
    const spanningTask = createWorkItem(document.projects[0].id, 'planned', 'Cross-band timeline task', 4000, {
      startDate: localIso(spanningStart),
      dueDate: localIso(spanningDue),
    });
    const dependentStart = new Date(sunday);
    dependentStart.setDate(dependentStart.getDate() + 16);
    const dependentDue = new Date(sunday);
    dependentDue.setDate(dependentDue.getDate() + 18);
    const dependentTask = createWorkItem(document.projects[0].id, 'planned', 'Second-band dependent task', 5000, {
      startDate: localIso(dependentStart),
      dueDate: localIso(dependentDue),
      dependencyIds: [spanningTask.id],
    });
    document.items[spanningTask.id] = spanningTask;
    document.items[dependentTask.id] = dependentTask;
    document.preferences.timelineLayout = 'compact';
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    const shadeOf = (cell: Element) => ['week-shade-a', 'week-shade-b'].find((shade) => cell.classList.contains(shade));
    const expectFullWeeksToAlternate = (cells: Element[]) => {
      expect(cells.length % 7).toBe(0);
      const weekShades = Array.from({ length: cells.length / 7 }, (_, weekIndex) => {
        const shades = cells.slice(weekIndex * 7, weekIndex * 7 + 7).map(shadeOf);
        expect(new Set(shades)).toHaveLength(1);
        return shades[0];
      });
      expect(new Set(weekShades)).toEqual(new Set(['week-shade-a', 'week-shade-b']));
      weekShades.slice(1).forEach((shade, index) => expect(shade).not.toBe(weekShades[index]));
    };

    const twoWeekCells = Array.from(window.document.querySelectorAll<HTMLElement>('.timeline-days > div'));
    expect(new Date(`${twoWeekCells[0].dataset.date}T12:00:00`).getDay()).toBe(0);
    expect(twoWeekCells[0]).toHaveClass('week-start');
    expectFullWeeksToAlternate(twoWeekCells);
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const style = window.document.createElement('style');
    style.textContent = globalStyles
      .split('\n')
      .filter((line) => line.includes('week-shade'))
      .join('\n');
    window.document.head.append(style);
    const shadePairs = (['light', 'dark'] as const).flatMap((theme) => (['ltr', 'rtl'] as const).map((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      const backgroundsFor = (cells: HTMLElement[]) => (['week-shade-a', 'week-shade-b'] as const).map((shade) => {
        const cell = cells.find((candidate) => candidate.classList.contains(shade) && !candidate.classList.contains('today'));
        expect(cell, `${theme} ${direction} ${shade}`).toBeDefined();
        return window.getComputedStyle(cell!).backgroundColor;
      });
      const backgrounds = backgroundsFor(twoWeekCells);
      const stageBackgrounds = backgroundsFor(Array.from(window.document.querySelectorAll<HTMLElement>('.timeline-day-drop-zone')));
      expect(backgrounds[0], `${theme} ${direction} header`).not.toBe(backgrounds[1]);
      expect(stageBackgrounds[0], `${theme} ${direction} stage`).not.toBe(stageBackgrounds[1]);
      return { theme, direction, backgrounds, stageBackgrounds };
    }));
    expect(shadePairs.find((pair) => pair.theme === 'light')?.backgrounds).not.toEqual(shadePairs.find((pair) => pair.theme === 'dark')?.backgrounds);
    expect(shadePairs.filter((pair) => pair.direction === 'ltr').map((pair) => pair.backgrounds)).toEqual(shadePairs.filter((pair) => pair.direction === 'rtl').map((pair) => pair.backgrounds));
    style.remove();

    await user.click(screen.getByRole('button', { name: '4 weeks' }));
    const fourWeekBoard = window.document.querySelector<HTMLElement>('.timeline-four-week-board')!;
    const fourWeekBands = Array.from(fourWeekBoard?.querySelectorAll<HTMLElement>(':scope > .timeline-chart') ?? []);
    expect(fourWeekBoard).toBeInTheDocument();
    expect(fourWeekBands).toHaveLength(2);
    expect(window.document.querySelector('.timeline-content')).toHaveClass('four-week-active');
    expect(window.document.querySelector('.timeline-content')).not.toHaveClass('unscheduled-collapsed');
    expect(window.document.querySelector('.timeline-chart-scroll')).not.toBeInTheDocument();
    fourWeekBands.forEach((band) => {
      const bandDays = Array.from(band.querySelectorAll<HTMLElement>('.timeline-days > div'));
      expect(bandDays).toHaveLength(14);
      expect(new Date(`${bandDays[0].dataset.date}T12:00:00`).getDay()).toBe(0);
      expectFullWeeksToAlternate(bandDays);
    });
    expect(fourWeekBands[0].querySelector(`[data-timeline-task-id="${spanningTask.id}"]`)).toBeInTheDocument();
    expect(fourWeekBands[1].querySelector('.year-continuation-slot')).toHaveTextContent('Cross-band timeline task');
    expect(fourWeekBands[1].querySelector(`[data-timeline-task-id="${dependentTask.id}"]`)).toBeInTheDocument();
    const fourWeekDependencies = fourWeekBoard.querySelector<SVGElement>('.timeline-four-week-dependencies');
    expect(fourWeekDependencies).toBeInTheDocument();
    expect(fourWeekBoard.querySelectorAll('.timeline-dependency-connector')).toHaveLength(1);
    expect(fourWeekDependencies?.parentElement).toHaveClass('timeline-rows');
    const fourWeekConnector = fourWeekDependencies?.querySelector<SVGGElement>('.timeline-dependency-connector');
    expect(fourWeekConnector).toHaveTextContent('Second-band dependent task depends on Cross-band timeline task');
    expect(fourWeekConnector?.querySelector('.dependency-visual-path')?.getAttribute('d')).not.toContain(' Q ');
    expect(fourWeekConnector?.dataset.routeLane).toBe(fourWeekConnector?.querySelector('.dependency-source-knot')?.getAttribute('cy'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel dependency from Cross-band timeline task to Second-band dependent task' }));
    expect(callbacks.onAction).toHaveBeenCalledWith({ type: 'updateItem', itemId: dependentTask.id, changes: { dependencyIds: [] } });
    expect(Array.from(window.document.querySelectorAll('.timeline-day-drop-zone')).every((cell) => Boolean(shadeOf(cell)))).toBe(true);
    const layoutStyle = window.document.createElement('style');
    layoutStyle.textContent = [
      globalStyles.match(/\.timeline-four-week-board \{[^}]+\}/)?.[0],
      globalStyles.match(/\.timeline-four-week-board > \.timeline-chart \{[^}]+\}/)?.[0],
      globalStyles.match(/\.timeline-content\.four-week-active \{[^}]+\}/)?.[0],
      globalStyles.match(/\.timeline-content\.four-week-active \.timeline-planner-sticky \{[^}]+\}/)?.[0],
    ].filter(Boolean).join('\n');
    window.document.head.append(layoutStyle);
    (['light', 'dark'] as const).forEach((theme) => (['ltr', 'rtl'] as const).forEach((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      expect(window.getComputedStyle(fourWeekBoard).display, `${theme} ${direction}`).toBe('grid');
      expect(window.getComputedStyle(fourWeekBoard).overflowX, `${theme} ${direction}`).toBe('hidden');
      expect(window.getComputedStyle(window.document.querySelector('.timeline-content')!).overflowY, `${theme} ${direction}`).toBe('auto');
      expect(window.getComputedStyle(window.document.querySelector('.timeline-planner-sticky')!).overflowY, `${theme} ${direction}`).toBe('visible');
      fourWeekBands.forEach((band) => expect(window.getComputedStyle(band).width, `${theme} ${direction}`).toBe('100%'));
    }));
    layoutStyle.remove();

    await user.click(screen.getByRole('button', { name: 'Year' }));
    const yearDays = Array.from(window.document.querySelectorAll<HTMLElement>('.timeline-year-days > div[data-date]'));
    expect(yearDays.length).toBeGreaterThanOrEqual(365);
    yearDays.slice(1).forEach((cell, index) => {
      const previous = yearDays[index];
      const startsWeek = new Date(`${cell.dataset.date}T12:00:00`).getDay() === 0;
      if (startsWeek) expect(shadeOf(cell)).not.toBe(shadeOf(previous));
      else expect(shadeOf(cell)).toBe(shadeOf(previous));
    });
    expect(new Set(yearDays.map(shadeOf))).toEqual(new Set(['week-shade-a', 'week-shade-b']));
    const weekStartRules = globalStyles.split('}').filter((rule) => rule.includes('week-start'));
    expect(weekStartRules.every((rule) => !rule.includes('border-inline-start'))).toBe(true);
  });

  it('keeps timeline cards compact and floats subtasks above the row', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Compact timeline cards');
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const scheduledDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    const task = createWorkItem(project.id, 'planned', 'Compact timeline task', 1000, {
      startDate: scheduledDate,
      dueDate: scheduledDate,
      subtasks: [
        { id: 'finished-step', title: 'Finished step', completed: true },
        { id: 'next-step', title: 'Next step', completed: false },
      ],
      dependencyIds: ['linked-task'],
    });
    document.items = { [task.id]: task };
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const slot = window.document.querySelector<HTMLElement>(`[data-timeline-task-id="${task.id}"]`)!;
    const trigger = screen.getByRole('button', { name: 'Subtasks: Compact timeline task' });
    expect(within(trigger).getByText('Subtasks')).toBeInTheDocument();
    expect(within(trigger).getByText('1/2')).toBeInTheDocument();

    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const style = window.document.createElement('style');
    style.textContent = [
      globalStyles.match(/(?:^|\n)\.timeline-row \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-bar-slot \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-bar \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-dependency-count \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-subtask-trigger \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-subtask-panel \{[^}]+\}/)?.[0],
    ].filter(Boolean).join('\n');
    window.document.head.append(style);
    const row = slot.closest<HTMLElement>('.timeline-row')!;
    const dependencyBadge = within(slot).getByTitle('1 dependencies');
    expect(Number.parseFloat(window.getComputedStyle(row).minHeight)).toBeLessThan(112);
    expect(Number.parseFloat(window.getComputedStyle(slot.querySelector('.timeline-bar')!).minHeight)).toBeLessThan(98);
    expect(dependencyBadge.querySelector('svg')).toHaveAttribute('width', '10');

    await user.click(trigger);
    const panel = screen.getByRole('region', { name: 'Subtasks' });
    expect(slot.querySelector('.timeline-subtask-panel')).not.toBeInTheDocument();
    expect(panel.parentElement).toBe(window.document.body);
    (['light', 'dark'] as const).forEach((theme) => (['ltr', 'rtl'] as const).forEach((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      const panelStyle = window.getComputedStyle(panel);
      const barStyle = window.getComputedStyle(slot.querySelector('.timeline-bar')!);
      expect(panelStyle.position, `${theme} ${direction}`).toBe('fixed');
      expect(panelStyle.zIndex, `${theme} ${direction}`).toBe('980');
      expect(panelStyle.visibility, `${theme} ${direction}`).toBe('visible');
      expect(panelStyle.top, `${theme} ${direction}`).toBe('12px');
      expect(panelStyle.marginTop, `${theme} ${direction}`).toBe('0px');
      expect(panelStyle.boxShadow, `${theme} ${direction}`).not.toBe('none');
      expect(panelStyle.borderRadius, `${theme} ${direction}`).toBe('10px');
      expect(panelStyle.maxHeight, `${theme} ${direction}`).toBe('210px');
      expect(panelStyle.overflowY, `${theme} ${direction}`).toBe('auto');
      expect(barStyle.borderBottomLeftRadius, `${theme} ${direction}`).toBe('10px');
      expect(window.getComputedStyle(row).minHeight, `${theme} ${direction}`).toBe('90px');
      expect(window.getComputedStyle(dependencyBadge).height, `${theme} ${direction}`).toBe('16px');
      expect(window.getComputedStyle(dependencyBadge).boxShadow, `${theme} ${direction}`).toBe('none');
    }));
    style.remove();
  });

  it('reorders same-day tasks in normal timeline mode without a separate toggle', async () => {
    const document = createEmptyWorkspace('Direct timeline ordering');
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const scheduledDate = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
    const first = createWorkItem(project.id, 'planned', 'First same-day task', 1000, { startDate: scheduledDate, dueDate: scheduledDate });
    const second = createWorkItem(project.id, 'planned', 'Second same-day task', 2000, { startDate: scheduledDate, dueDate: scheduledDate });
    document.items = { [first.id]: first, [second.id]: second };
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reorder tasks' })).not.toBeInTheDocument();
    expect(screen.getByText('Drag a task onto a same-day task to reorder, or onto a date to reschedule')).toBeInTheDocument();

    const firstSlot = window.document.querySelector<HTMLElement>(`[data-timeline-task-id="${first.id}"]`)!;
    const secondSlot = window.document.querySelector<HTMLElement>(`[data-timeline-task-id="${second.id}"]`)!;
    const firstBar = firstSlot.querySelector<HTMLElement>('.timeline-bar')!;
    const secondBar = secondSlot.querySelector<HTMLElement>('.timeline-bar')!;
    vi.spyOn(firstSlot, 'getBoundingClientRect').mockReturnValue(elementRect(20, 100, 60, 98));
    vi.spyOn(secondSlot, 'getBoundingClientRect').mockReturnValue(elementRect(20, 220, 60, 98));
    const firstDayZone = window.document.querySelector<HTMLElement>('.timeline-day-drop-zone')!;
    vi.spyOn(firstDayZone, 'getBoundingClientRect').mockReturnValue(elementRect(0, 68, 72, 300));

    startMouseDrag(secondBar, { x: 35, y: 240 }, { x: 45, y: 250 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 40, clientY: 130 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 41, clientY: 131 });
    expect(firstSlot).toHaveClass('reorder-target-over');
    await stopMouseDrag(firstBar);

    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'reorderKanbanItems',
      projectId: project.id,
      itemIds: [second.id, first.id],
    });
    expect(callbacks.onAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'updateItem' }));
  });

  it('presents unscheduled work as full Kanban columns while the timeline stays pinned', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const project = document.projects[0];
    const planned = createWorkItem(project.id, 'planned', 'Refine launch brief', 3000, {
      description: 'Turn the rough notes into a clear handoff',
      labels: ['Content'],
      subtasks: [
        { id: 'outline-brief', title: 'Outline the brief', completed: false },
        { id: 'review-brief', title: 'Review with product', completed: true },
      ],
    });
    document.items[planned.id] = planned;
    const callbacks = commonViewCallbacks();
    const onCreateTask = vi.fn();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty
        onCreateTask={onCreateTask}
        {...callbacks}
      />,
    );

    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    const columnNames = within(unscheduledSection).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(columnNames).toEqual(['Backlog', 'Stuck', 'In progress', 'Done']);
    const plannedColumn = within(unscheduledSection).getByRole('heading', { name: 'Stuck' }).closest<HTMLElement>('.board-column')!;
    const plannedCard = within(plannedColumn).getByRole('heading', { name: 'Refine launch brief' }).closest<HTMLElement>('.task-card')!;
    expect(plannedCard).toHaveClass('timeline-task-card-compact');
    expect(plannedCard).not.toHaveTextContent('Turn the rough notes into a clear handoff');
    expect(plannedCard).not.toHaveTextContent('Outline the brief');
    const compactSubtaskTrigger = within(plannedCard).getByRole('button', { name: 'Subtasks: Refine launch brief' });
    expect(compactSubtaskTrigger).toHaveTextContent('1/2');
    expect(compactSubtaskTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(unscheduledSection).queryByText('Prepare launch')).not.toBeInTheDocument();

    await user.click(compactSubtaskTrigger);
    const compactSubtaskPanel = within(plannedCard).getByRole('region', { name: 'Subtasks: Refine launch brief' });
    expect(compactSubtaskTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(compactSubtaskPanel).getByText('Outline the brief')).toBeInTheDocument();
    await user.click(within(compactSubtaskPanel).getByRole('button', { name: 'Add a subtask' }));
    const compactSubtaskInput = within(compactSubtaskPanel).getByRole('textbox', { name: 'Add a subtask' });
    await user.type(compactSubtaskInput, 'Confirm launch copy{Enter}');
    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'updateItem',
      itemId: planned.id,
      changes: {
        subtasks: [
          ...planned.subtasks,
          expect.objectContaining({ title: 'Confirm launch copy', completed: false }),
        ],
      },
    });
    await user.click(compactSubtaskTrigger);
    expect(within(plannedCard).queryByRole('region', { name: 'Subtasks: Refine launch brief' })).not.toBeInTheDocument();

    const doneColumn = within(unscheduledSection).getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const noSubtaskCard = within(doneColumn).getByRole('heading', { name: 'Approve direction' }).closest<HTMLElement>('.task-card')!;
    const addFirstSubtask = within(noSubtaskCard).getByRole('button', { name: 'Subtasks: Approve direction' });
    expect(addFirstSubtask).not.toHaveTextContent('0/0');
    expect(addFirstSubtask).toHaveClass('empty');
    await user.click(addFirstSubtask);
    expect(within(noSubtaskCard).getByRole('textbox', { name: 'Add a subtask' })).toHaveFocus();
    await user.click(addFirstSubtask);

    await user.click(plannedCard);
    expect(callbacks.onOpenTask).toHaveBeenCalledWith(planned);
    await user.click(within(plannedColumn).getByRole('button', { name: 'Add task to Stuck' }));
    expect(onCreateTask).toHaveBeenCalledWith({ columnId: 'planned' });

    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const style = window.document.createElement('style');
    const kanbanScrollRule = globalStyles.match(/\.unscheduled-kanban-scroll \{[^}]+\}/)?.[0];
    expect(kanbanScrollRule).toContain('overscroll-behavior-y: auto');
    style.textContent = [
      globalStyles.match(/\.timeline-content \{[^}]+\}/)?.[0],
      globalStyles.match(/\.timeline-planner-sticky \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-tasks \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-tasks > header \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-tasks > header strong \{[^}]+\}/)?.[0],
      kanbanScrollRule,
      globalStyles.match(/\.unscheduled-kanban-column \.column-header \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-kanban-column \.column-heading h2 \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-kanban-column \.task-card\.timeline-task-card-compact \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-kanban-column \.timeline-task-card-compact h3 \{[^}]+\}/)?.[0],
      globalStyles.match(/button\.compact-task-subtasks \{[^}]+\}/)?.[0],
      globalStyles.match(/button\.compact-task-subtasks\.empty \{[^}]+\}/)?.[0],
    ].filter(Boolean).join('\n');
    window.document.head.append(style);
    const timelineContent = window.document.querySelector<HTMLElement>('.timeline-content')!;
    const sectionHeader = unscheduledSection.querySelector<HTMLElement>(':scope > header')!;
    const kanbanScroll = unscheduledSection.querySelector<HTMLElement>('.unscheduled-kanban-scroll')!;
    const columnHeader = plannedColumn.querySelector<HTMLElement>('.column-header')!;
    expect(window.getComputedStyle(timelineContent).overflowY).toBe('hidden');
    expect(window.getComputedStyle(unscheduledSection).display).toBe('flex');
    expect(window.getComputedStyle(sectionHeader).position).toBe('sticky');
    expect(window.getComputedStyle(sectionHeader).minHeight).toBe('40px');
    expect(window.getComputedStyle(within(sectionHeader).getByText('Unscheduled work')).fontSize).toBe('13px');
    expect(window.getComputedStyle(kanbanScroll).overflowY).toBe('auto');
    expect(window.getComputedStyle(kanbanScroll).overscrollBehaviorY).toBe('auto');
    expect(window.getComputedStyle(kanbanScroll).scrollbarGutter).toBe('stable');
    expect(window.getComputedStyle(columnHeader).minHeight).toBe('42px');
    expect(window.getComputedStyle(within(plannedColumn).getByRole('heading', { name: 'Stuck' })).fontSize).toBe('12px');
    expect(window.getComputedStyle(plannedCard).minHeight).toBe('42px');
    expect(window.getComputedStyle(plannedCard).display).toBe('flex');
    const plannedTitle = within(plannedCard).getByRole('heading', { name: 'Refine launch brief' });
    expect(window.getComputedStyle(plannedTitle).whiteSpace).toBe('pre-wrap');
    expect(window.getComputedStyle(plannedTitle).overflow).toBe('visible');
    expect(window.getComputedStyle(plannedTitle).textOverflow).toBe('clip');
    expect(window.getComputedStyle(compactSubtaskTrigger).minWidth).toBe('0px');
    expect(window.getComputedStyle(addFirstSubtask).width).toBe('30px');
    expect(window.getComputedStyle(addFirstSubtask).borderStyle).toBe('none');
    const planner = window.document.querySelector<HTMLElement>('.timeline-planner-sticky')!;
    (['light', 'dark'] as const).forEach((theme) => (['ltr', 'rtl'] as const).forEach((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      expect(window.getComputedStyle(planner).position, `${theme} ${direction}`).toBe('sticky');
      expect(window.getComputedStyle(planner).overflowY, `${theme} ${direction}`).toBe('auto');
    }));
    style.remove();
  });

  it('resizes and collapses the unscheduled pane without hiding the timeline', async () => {
    const user = userEvent.setup();
    const document = createEmptyWorkspace('Resizable timeline');
    const project = document.projects[0];
    document.items = {
      task: createWorkItem(project.id, 'planned', 'Resizable pane task', 1000),
    };
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const timelineContent = window.document.querySelector<HTMLElement>('.timeline-content')!;
    const separator = screen.getByRole('separator', { name: 'Resize timeline and unscheduled work' });
    expect(separator).toHaveAttribute('aria-valuenow', '300');
    expect(timelineContent.style.getPropertyValue('--timeline-unscheduled-height')).toBe('300px');

    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(separator).toHaveAttribute('aria-valuenow', '324');
    expect(timelineContent.style.getPropertyValue('--timeline-unscheduled-height')).toBe('324px');

    vi.spyOn(timelineContent, 'getBoundingClientRect').mockReturnValue(elementRect(0, 100, 1000, 600));
    fireEvent.pointerDown(separator, { button: 0, clientY: 376 });
    fireEvent.pointerMove(window, { buttons: 1, clientY: 350 });
    fireEvent.pointerUp(window, { clientY: 350 });
    expect(separator).toHaveAttribute('aria-valuenow', '350');
    expect(timelineContent.style.getPropertyValue('--timeline-unscheduled-height')).toBe('350px');

    await user.click(screen.getByRole('button', { name: 'Collapse unscheduled work' }));
    expect(screen.queryByRole('region', { name: 'Unscheduled work drop area' })).not.toBeInTheDocument();
    expect(separator).toHaveAttribute('aria-disabled', 'true');
    expect(window.document.querySelector('.timeline-chart')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand unscheduled work' }));
    expect(screen.getByRole('region', { name: 'Unscheduled work drop area' })).toBeInTheDocument();
    expect(separator).toHaveAttribute('aria-disabled', 'false');
    expect(timelineContent.style.getPropertyValue('--timeline-unscheduled-height')).toBe('350px');
  });

  it('drags a full unscheduled Kanban card onto the timeline to schedule it', async () => {
    const document = createEmptyWorkspace('Scheduling board');
    const project = document.projects[0];
    const task = createWorkItem(project.id, 'planned', 'Choose a launch date', 1000, {
      description: 'Pick the date after reviewing the checklist',
      subtasks: [{ id: 'check-calendar', title: 'Check the calendar', completed: false }],
    });
    document.items = { [task.id]: task };
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    const taskCard = screen.getByRole('heading', { name: 'Choose a launch date' }).closest<HTMLElement>('.task-card')!;
    const dayZones = Array.from(window.document.querySelectorAll<HTMLElement>('.timeline-day-drop-zone'));
    expect(dayZones).toHaveLength(14);
    vi.spyOn(taskCard, 'getBoundingClientRect').mockReturnValue(elementRect(30, 520, 276, 180));
    dayZones.forEach((zone, index) => {
      vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue(elementRect(index * 72, 150, 72, 220));
    });

    startMouseDrag(taskCard, { x: 60, y: 550 }, { x: 70, y: 560 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 108, clientY: 210 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 109, clientY: 211 });
    await stopMouseDrag(dayZones[1]);

    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'updateItem',
      itemId: task.id,
      changes: {
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    });
  });

  it('shows an exact card preview when unscheduled work moves between Kanban columns', async () => {
    const document = createEmptyWorkspace('Unscheduled ordering');
    const project = document.projects[0];
    const source = createWorkItem(project.id, 'planned', 'Refine the mission', 1000, {
      description: 'Keep every planning detail visible while moving',
      labels: ['Strategy'],
      subtasks: [{ id: 'mission-step', title: 'Confirm the first step', completed: false }],
    });
    const target = createWorkItem(project.id, 'done', 'Published mission', 1000);
    document.items = { [source.id]: source, [target.id]: target };
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    const sourceCard = within(unscheduledSection).getByRole('heading', { name: 'Refine the mission' }).closest<HTMLElement>('.task-card')!;
    const targetCard = within(unscheduledSection).getByRole('heading', { name: 'Published mission' }).closest<HTMLElement>('.task-card')!;
    const targetColumn = within(unscheduledSection).getByRole('heading', { name: 'Done' }).closest<HTMLElement>('.board-column')!;
    const columns = Array.from(unscheduledSection.querySelectorAll<HTMLElement>('.board-column'));
    columns.forEach((column, index) => {
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(elementRect(index * 320, 420, 286, 600));
    });
    vi.spyOn(sourceCard, 'getBoundingClientRect').mockReturnValue(elementRect(330, 500, 276, 210));
    vi.spyOn(targetCard, 'getBoundingClientRect').mockReturnValue(elementRect(970, 500, 276, 120));

    startMouseDrag(sourceCard, { x: 360, y: 530 }, { x: 370, y: 540 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 990, clientY: 590 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 991, clientY: 591 });

    const preview = targetColumn.querySelector<HTMLElement>('.task-drop-preview')!;
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveClass('timeline-task-card-compact');
    expect(targetColumn).toHaveClass('column-over');
    expect(preview).toHaveTextContent('Refine the mission');
    expect(preview).not.toHaveTextContent('Keep every planning detail visible while moving');
    expect(within(preview).getByTitle('Subtasks: 0/1')).toHaveTextContent('0/1');
    expect(targetCard.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await stopMouseDrag(targetCard);
    expect(callbacks.onAction).toHaveBeenCalledWith({
      type: 'moveItem',
      itemId: source.id,
      columnId: 'done',
      index: 1,
    });
  });

  it('extends unscheduled columns through the pane and accepts drops at the bottom', async () => {
    const document = createEmptyWorkspace('Empty drop target');
    const project = document.projects[0];
    const source = createWorkItem(project.id, 'planned', 'Move into backlog', 1000);
    document.items = { [source.id]: source };
    const callbacks = commonViewCallbacks();
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty
        onCreateTask={vi.fn()}
        {...callbacks}
      />,
    );

    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    const sourceCard = within(unscheduledSection).getByRole('heading', { name: 'Move into backlog' }).closest<HTMLElement>('.task-card')!;
    const emptyColumn = within(unscheduledSection).getByRole('heading', { name: 'Backlog' }).closest<HTMLElement>('.board-column')!;
    const emptyTaskList = emptyColumn.querySelector<HTMLElement>('.task-list')!;
    const columnsGrid = unscheduledSection.querySelector<HTMLElement>('.unscheduled-kanban-columns')!;
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    const style = window.document.createElement('style');
    style.textContent = [
      globalStyles.match(/\.unscheduled-kanban-columns \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-kanban-column \{[^}]+\}/)?.[0],
      globalStyles.match(/\.unscheduled-kanban-column \.task-list \{[^}]+\}/)?.[0],
    ].filter(Boolean).join('\n');
    window.document.head.append(style);
    (['light', 'dark'] as const).forEach((theme) => (['ltr', 'rtl'] as const).forEach((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      expect(window.getComputedStyle(columnsGrid).minHeight, `${theme} ${direction}`).toBe('100%');
      expect(window.getComputedStyle(columnsGrid).alignItems, `${theme} ${direction}`).toBe('stretch');
      expect(window.getComputedStyle(emptyColumn).display, `${theme} ${direction}`).toBe('flex');
      expect(window.getComputedStyle(emptyColumn).flexDirection, `${theme} ${direction}`).toBe('column');
      expect(window.getComputedStyle(emptyTaskList).flexGrow, `${theme} ${direction}`).toBe('1');
    }));

    const columns = Array.from(unscheduledSection.querySelectorAll<HTMLElement>('.board-column'));
    columns.forEach((column, index) => {
      vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(elementRect(index * 320, 420, 286, 240));
    });
    vi.spyOn(unscheduledSection, 'getBoundingClientRect').mockReturnValue(elementRect(0, 400, 1280, 300));
    vi.spyOn(sourceCard, 'getBoundingClientRect').mockReturnValue(elementRect(330, 470, 276, 42));

    startMouseDrag(sourceCard, { x: 360, y: 490 }, { x: 370, y: 500 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 30, clientY: 640 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 31, clientY: 641 });
    const preview = emptyColumn.querySelector<HTMLElement>('.task-drop-preview')!;
    expect(preview).toBeInTheDocument();
    expect(emptyColumn).toHaveClass('column-over');

    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 32, clientY: 642 });
    fireEvent.mouseMove(window.document, { buttons: 1, clientX: 31, clientY: 641 });
    expect(emptyColumn.querySelector('.task-drop-preview')).toBe(preview);
    expect(emptyColumn).toHaveClass('column-over');

    await stopMouseDrag(preview);
    expect(callbacks.onAction).toHaveBeenCalledWith({ type: 'moveItem', itemId: source.id, columnId: 'backlog', index: 0 });
    style.remove();
  });

  it('keeps a middle task dependency handle above a connector spanning the compact lane', () => {
    const document = featureWorkspace();
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const dateAfter = (days: number) => {
      const date = new Date(sunday);
      date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const first = createWorkItem(project.id, 'planned', 'First lane task', 1000, { startDate: dateAfter(1), dueDate: dateAfter(1) });
    const middle = createWorkItem(project.id, 'planned', 'Middle lane task', 2000, { startDate: dateAfter(3), dueDate: dateAfter(3) });
    const last = createWorkItem(project.id, 'planned', 'Last lane task', 3000, { startDate: dateAfter(5), dueDate: dateAfter(5), dependencyIds: [first.id] });
    document.items = { [first.id]: first, [middle.id]: middle, [last.id]: last };
    document.preferences.timelineLayout = 'compact';

    const style = window.document.createElement('style');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    style.textContent = [
      globalStyles.match(/(?:^|\n)\.timeline-bar-slot \{[^}]+\}/)?.[0],
      globalStyles.match(/(?:^|\n)\.timeline-dependencies \{[^}]+\}/)?.[0],
    ].filter(Boolean).join('\n');
    window.document.head.append(style);
    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const compactRow = window.document.querySelector<HTMLElement>('.timeline-row.compact-row')!;
    expect(compactRow.querySelectorAll('.timeline-bar-slot')).toHaveLength(3);
    const middleSlot = compactRow.querySelector<HTMLElement>(`[data-timeline-task-id="${middle.id}"]`)!;
    expect(within(middleSlot).getByLabelText('Start a dependency from Middle lane task')).toBeInTheDocument();
    const connectors = window.document.querySelector<SVGElement>('.timeline-dependencies')!;
    const layerOrders = (['light', 'dark'] as const).flatMap((theme) => (['ltr', 'rtl'] as const).map((direction) => {
      window.document.documentElement.dataset.theme = theme;
      window.document.documentElement.dir = direction;
      return {
        theme,
        direction,
        middleTaskLayer: Number(window.getComputedStyle(middleSlot).zIndex),
        connectorLayer: Number(window.getComputedStyle(connectors).zIndex),
      };
    }));
    style.remove();

    layerOrders.forEach(({ theme, direction, middleTaskLayer, connectorLayer }) => {
      expect(middleTaskLayer, `${theme} ${direction}`).toBeGreaterThan(connectorLayer);
    });
  });

  it('draws distinct directional links when compact-lane dependencies share a source', () => {
    const document = featureWorkspace();
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const dateAfter = (days: number) => {
      const date = new Date(sunday);
      date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const first = createWorkItem(project.id, 'planned', 'Chain source', 1000, { startDate: dateAfter(1), dueDate: dateAfter(1) });
    const middle = createWorkItem(project.id, 'planned', 'Middle dependent', 2000, { startDate: dateAfter(3), dueDate: dateAfter(3), dependencyIds: [first.id] });
    const last = createWorkItem(project.id, 'planned', 'Last dependent', 3000, { startDate: dateAfter(6), dueDate: dateAfter(6), dependencyIds: [first.id] });
    document.items = { [first.id]: first, [middle.id]: middle, [last.id]: last };
    document.preferences.timelineLayout = 'compact';

    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const connectors = Array.from(window.document.querySelectorAll<SVGGElement>('.timeline-dependency-connector'));
    expect(connectors).toHaveLength(2);
    connectors.forEach((connector) => {
      expect(connector).toHaveAttribute('data-route-lane');
      expect(connector).toHaveAttribute('data-dependency-tone');
    });
    expect(new Set(connectors.map((connector) => connector.dataset.routeLane)).size).toBe(2);
    expect(new Set(connectors.map((connector) => connector.dataset.dependencyTone)).size).toBe(2);
    const routeLevels = connectors.map((connector) => {
      expect(connector.querySelector('.dependency-direction-indicator')).toBeInTheDocument();
      const visualPath = connector.querySelector<SVGPathElement>('.dependency-visual-path')!;
      expect(visualPath.getAttribute('d')).toContain(' Q ');
      expect(visualPath).toHaveTextContent('depends on Chain source');
      return Number(connector.dataset.routeLane);
    });
    const sourceCenter = Number(connectors[0].querySelector('.dependency-source-knot')?.getAttribute('cy'));
    expect(routeLevels.some((level) => level < sourceCenter)).toBe(true);
    expect(routeLevels.some((level) => level > sourceCenter)).toBe(true);
    expect(routeLevels.every((level) => Math.abs(level - sourceCenter) >= 24)).toBe(true);

    const style = window.document.createElement('style');
    const globalStyles = readFileSync('src/styles/global.css', 'utf8');
    style.textContent = globalStyles.match(/\.timeline-dependencies\.has-highlighted-dependency \.timeline-dependency-connector:not\(\.dependency-highlighted\) \{[^}]+\}/)?.[0] ?? '';
    window.document.head.append(style);
    fireEvent.pointerEnter(connectors[0]);
    expect(window.document.querySelector('.timeline-dependencies')).toHaveClass('has-highlighted-dependency');
    expect(connectors[0]).toHaveClass('dependency-highlighted');
    expect(Number(window.getComputedStyle(connectors[1]).opacity)).toBeLessThan(Number(window.getComputedStyle(connectors[0]).opacity));
    style.remove();
    expect(connectors[1]).not.toHaveClass('dependency-highlighted');
    expect(window.document.querySelector(`[data-timeline-task-id="${first.id}"]`)).toHaveClass('dependency-highlight-source');
    expect(window.document.querySelector(`[data-timeline-task-id="${middle.id}"]`)).toHaveClass('dependency-highlight-target');
    expect(window.document.querySelector(`[data-timeline-task-id="${last.id}"]`)).not.toHaveClass('dependency-highlight-target');
  });

  it('routes a dependency outside a task placed immediately after its source', () => {
    const document = featureWorkspace();
    const project = document.projects[0];
    const sunday = new Date();
    sunday.setHours(12, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const dateAfter = (days: number) => {
      const date = new Date(sunday);
      date.setDate(date.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const source = createWorkItem(project.id, 'planned', 'Adjacent source', 1000, { startDate: dateAfter(1), dueDate: dateAfter(1) });
    const blocker = createWorkItem(project.id, 'planned', 'Next-day task', 2000, { startDate: dateAfter(2), dueDate: dateAfter(2) });
    const target = createWorkItem(project.id, 'planned', 'Later dependent', 3000, { startDate: dateAfter(5), dueDate: dateAfter(5), dependencyIds: [source.id] });
    document.items = { [source.id]: source, [blocker.id]: blocker, [target.id]: target };
    document.preferences.timelineLayout = 'compact';

    renderWithPreferences(
      <TimelineView
        document={document}
        project={project}
        saveState="idle"
        dirty={false}
        onCreateTask={vi.fn()}
        {...commonViewCallbacks()}
      />,
    );

    const connector = window.document.querySelector<SVGGElement>('.timeline-dependency-connector')!;
    const routeLane = Number(connector.dataset.routeLane);
    const sourceDetourLane = Number(connector.dataset.sourceDetourLane);
    expect(connector.querySelector('.dependency-visual-path')).toHaveTextContent('Later dependent depends on Adjacent source');
    expect(sourceDetourLane <= 3 || sourceDetourLane >= 109).toBe(true);
    expect(routeLane > 3 && routeLane < 109).toBe(true);
  });

  it('shows roadmap progress and delegates initiative, project, and task actions', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const onAddProject = vi.fn();
    const onAddTask = vi.fn();
    const onEditProject = vi.fn();
    const onOpenProject = vi.fn();
    const onOpenTask = vi.fn();
    const onMoveProject = vi.fn();
    renderWithPreferences(
      <RoadmapView
        document={document}
        saveState="idle"
        dirty
        onSave={vi.fn()}
        onAddProject={onAddProject}
        onAddTask={onAddTask}
        onEditProject={onEditProject}
        onOpenProject={onOpenProject}
        onOpenTask={onOpenTask}
        onMoveProject={onMoveProject}
        onReorderHorizons={vi.fn()}
      />,
    );

    expect(screen.getByText('2 active initiatives')).toBeInTheDocument();
    expect(screen.getByText('2 open tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New initiative' }));
    expect(onAddProject).toHaveBeenCalledWith();
    await user.click(screen.getByRole('button', { name: 'Add initiative to Now' }));
    expect(onAddProject).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    const launchCard = screen.getByText(document.projects[0].name).closest<HTMLElement>('.roadmap-card')!;
    expect(launchCard).toHaveAttribute('role', 'button');
    expect(launchCard).toHaveAttribute('aria-label', `Move ${document.projects[0].name}`);
    expect(within(launchCard).queryByRole('button', { name: `Move ${document.projects[0].name}` })).not.toBeInTheDocument();
    await user.click(within(launchCard).getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith(document.projects[0].id, undefined);
    await user.click(within(launchCard).getByRole('button', { name: 'Open' }));
    expect(onOpenProject).toHaveBeenCalledWith(document.projects[0].id);
    await user.selectOptions(within(launchCard).getByLabelText('Planning horizon'), 'Next');
    expect(onMoveProject).toHaveBeenCalledWith(document.projects[0].id, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    const nextHorizon = screen.getByRole('heading', { name: 'Next' }).closest<HTMLElement>('.roadmap-column')!;
    vi.spyOn(launchCard, 'getBoundingClientRect').mockReturnValue(elementRect(800, 100, 330, 280));
    vi.spyOn(nextHorizon, 'getBoundingClientRect').mockReturnValue(elementRect(400, 0, 350, 700));
    startMouseDrag(within(launchCard).getByRole('heading', { name: document.projects[0].name }), { x: 820, y: 120 }, { x: 420, y: 120 });
    expect(launchCard).toHaveClass('dragging');
    const roadmapPreview = window.document.querySelector<HTMLElement>('.roadmap-drop-preview');
    expect(roadmapPreview).toHaveTextContent(document.projects[0].name);
    expect(nextHorizon).toContainElement(roadmapPreview);
    await stopMouseDrag(launchCard);
  });

  it('creates notes and places existing tasks and files on the canvas', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const callbacks = commonViewCallbacks();
    const onAddFiles = vi.fn();
    renderWithPreferences(
      <CanvasView
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty
        onCreateTask={vi.fn()}
        onAddFiles={onAddFiles}
        onPreviewAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        {...callbacks}
      />,
    );

    expect(screen.getByText('Start with a spark.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Write a note/ }));
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'canvasAddNode',
      node: expect.objectContaining({ type: 'note' }),
    }));

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await user.click(screen.getByRole('button', { name: /Prepare launch/ }));
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'canvasAddNode',
      node: expect.objectContaining({ type: 'task' }),
    }));

    await user.click(screen.getByRole('button', { name: 'Add file' }));
    await user.click(screen.getByRole('button', { name: /Import files/ }));
    expect(onAddFiles).toHaveBeenCalledWith('canvas-main', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), 'files');
  });

  it('creates, switches, renames, and deletes minimal canvas views without mixing their content', async () => {
    const user = userEvent.setup();
    const initialDocument = featureWorkspace();
    const project = initialDocument.projects[0];
    const primaryNote = createCanvasNode('note', { x: 120, y: 100 }, { content: 'Primary idea' });
    initialDocument.modules.canvas.projects[project.id].nodes[primaryNote.id] = primaryNote;

    function CanvasViewsHarness() {
      const [currentDocument, onAction] = useReducer(workspaceReducer, initialDocument);
      return (
        <CanvasView
          document={currentDocument}
          project={project}
          saveState="idle"
          dirty
          onAction={onAction}
          onSave={vi.fn()}
          onOpenTask={vi.fn()}
          onCreateTask={vi.fn()}
          onAddFiles={vi.fn()}
          onPreviewAttachment={vi.fn()}
          onOpenAttachment={vi.fn()}
        />
      );
    }

    renderWithPreferences(<CanvasViewsHarness />);
    expect(screen.getByDisplayValue('Primary idea')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Canvas views' }));
    const menu = screen.getByRole('dialog', { name: 'Canvas views' });
    expect(within(menu).getByText('1 canvas')).toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: 'New canvas' }));
    const nameInput = screen.getByLabelText('Name your canvas');
    await user.clear(nameInput);
    await user.type(nameInput, 'Launch map');
    await user.click(screen.getByRole('button', { name: 'Create canvas' }));

    expect(screen.getByRole('button', { name: 'Canvas views' })).toHaveTextContent('Launch map');
    expect(screen.queryByDisplayValue('Primary idea')).not.toBeInTheDocument();
    expect(screen.getByText('Start with a spark.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Canvas views' }));
    await user.click(screen.getByRole('button', { name: 'Open canvas Canvas 1' }));
    expect(screen.getByDisplayValue('Primary idea')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Canvas views' }));
    await user.click(screen.getByRole('button', { name: 'Open canvas Launch map' }));
    expect(screen.queryByDisplayValue('Primary idea')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Canvas views' }));
    await user.click(screen.getByRole('button', { name: 'Rename canvas Launch map' }));
    const renameInput = screen.getByLabelText('Canvas name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Release map');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('button', { name: 'Canvas views' })).toHaveTextContent('Release map');

    await user.click(screen.getByRole('button', { name: 'Canvas views' }));
    await user.click(screen.getByRole('button', { name: 'Delete canvas Release map' }));
    const confirmation = screen.getByRole('alert');
    expect(confirmation).toHaveTextContent('This canvas and everything on it will be deleted.');
    await user.click(within(confirmation).getByRole('button', { name: 'Delete' }));

    expect(screen.getByRole('button', { name: 'Canvas views' })).toHaveTextContent('Canvas 1');
    expect(screen.getByDisplayValue('Primary idea')).toBeInTheDocument();
  });

  it('keeps the minimal canvas switcher readable in Hebrew RTL and the soft-dark theme', async () => {
    localStorage.setItem('kanbanos.language', 'he');
    localStorage.setItem('kanbanos.theme', 'dark');
    const user = userEvent.setup();
    const document = featureWorkspace();
    renderWithPreferences(
      <CanvasView
        document={document}
        project={document.projects[0]}
        saveState="idle"
        dirty={false}
        onAction={vi.fn()}
        onSave={vi.fn()}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
        onAddFiles={vi.fn()}
        onPreviewAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
      />,
    );

    expect(window.document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(window.document.documentElement).toHaveAttribute('data-theme', 'dark');
    const switcher = screen.getByRole('button', { name: 'תצוגות קנבס' });
    expect(switcher).toHaveTextContent('קנבס 1');
    await user.click(switcher);
    expect(screen.getByRole('dialog', { name: 'תצוגות קנבס' })).toHaveTextContent('קנבס חדש');
  });

  it('pinches the mobile canvas and keeps selected-object actions onscreen', () => {
    const workspace = featureWorkspace();
    const project = workspace.projects[0];
    const note = createCanvasNode('note', { x: 120, y: 110 }, { content: 'Pinch me' });
    workspace.modules.canvas.projects[project.id].nodes[note.id] = note;
    renderWithPreferences(
      <CanvasView
        mobile
        nativeMobile={false}
        document={workspace}
        project={project}
        saveState="idle"
        dirty={false}
        onAction={vi.fn()}
        onSave={vi.fn()}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
        onAddFiles={vi.fn()}
        onPreviewAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
      />,
    );

    const stage = window.document.querySelector<HTMLElement>('.canvas-stage')!;
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(elementRect(0, 0, 360, 620));
    fireEvent.pointerDown(screen.getByLabelText('Note object'), { button: 0, pointerId: 3, clientX: 150, clientY: 140 });
    expect(screen.getByRole('toolbar', { name: 'Selected object actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    expect(screen.getByText('Add local file reference')).toBeInTheDocument();

    fireTouchPointer(stage, 'pointerdown', 1, 110, 200);
    fireTouchPointer(stage, 'pointerdown', 2, 210, 200);
    fireTouchPointer(stage, 'pointermove', 2, 280, 200);
    expect(screen.getByTitle('Reset zoom')).toHaveTextContent('170%');
    fireTouchPointer(stage, 'pointerup', 1, 110, 200);
    fireTouchPointer(stage, 'pointerup', 2, 280, 200);
  });

  it('searches workspace files and delegates preview, open, reveal, and task navigation', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const file = Object.values(document.resources.attachments)[0];
    const task = Object.values(document.items).find((item) => item.attachmentIds?.includes(file.id))!;
    const onOpenTask = vi.fn();
    const onPreviewAttachment = vi.fn();
    const onOpenAttachment = vi.fn();
    const onRevealAttachment = vi.fn();
    renderWithPreferences(
      <FilesView
        document={document}
        saveState="idle"
        dirty
        onSave={vi.fn()}
        onOpenTask={onOpenTask}
        onPreviewAttachment={onPreviewAttachment}
        onOpenAttachment={onOpenAttachment}
        onRevealAttachment={onRevealAttachment}
      />,
    );

    expect(screen.getByText('launch-brief.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Preview ${file.name}` }));
    expect(onPreviewAttachment).toHaveBeenCalledWith(file);
    await user.click(screen.getByRole('button', { name: `Open ${file.name}` }));
    expect(onOpenAttachment).toHaveBeenCalledWith(file);
    await user.click(screen.getByRole('button', { name: `Show ${file.name} in workspace folder` }));
    expect(onRevealAttachment).toHaveBeenCalledWith(file);
    await user.click(screen.getByRole('button', { name: task.title }));
    expect(onOpenTask).toHaveBeenCalledWith(task);

    await user.type(screen.getByPlaceholderText('Search files and tasks'), 'missing');
    expect(screen.getByText('No matching files')).toBeInTheDocument();
  });

  it('offers one clear share action instead of desktop folder actions on mobile', async () => {
    const user = userEvent.setup();
    const document = featureWorkspace();
    const file = Object.values(document.resources.attachments)[0];
    const onOpenAttachment = vi.fn();
    renderWithPreferences(
      <FilesView
        mobile
        document={document}
        saveState="idle"
        dirty={false}
        onSave={vi.fn()}
        onOpenTask={vi.fn()}
        onPreviewAttachment={vi.fn()}
        onOpenAttachment={onOpenAttachment}
        onRevealAttachment={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: `Share ${file.name}` }));
    expect(onOpenAttachment).toHaveBeenCalledWith(file);
    expect(screen.queryByRole('button', { name: `Show ${file.name} in workspace folder` })).not.toBeInTheDocument();
  });
});
