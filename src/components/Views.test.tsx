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
  });
});

describe('board and list task management', () => {
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
    startMouseDrag(within(taskCard).getByRole('heading', { name: 'Prepare launch' }));
    expect(taskCard).toHaveClass('dragging');
    expect(window.document.querySelector('.task-drop-preview')).toHaveTextContent('Prepare launch');
    await stopMouseDrag(taskCard);
    await user.type(screen.getByPlaceholderText('Search this project'), 'missing');
    expect(screen.queryByText('Prepare launch')).not.toBeInTheDocument();
    expect(screen.getByText('0 matching tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(onChangeView).toHaveBeenCalledWith('list');

    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await user.type(screen.getByPlaceholderText('Column name'), 'Review');
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    expect(callbacks.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'addColumn',
      projectId: document.projects[0].id,
      column: expect.objectContaining({ title: 'Review' }),
    }));
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
  it('changes timeline scale/layout and creates a task on the selected range', async () => {
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

    await user.click(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByRole('button', { name: '4 weeks' })).toHaveClass('active');
    await user.click(screen.getByRole('button', { name: 'Compact lanes' }));
    expect(callbacks.onAction).toHaveBeenCalledWith({ type: 'setTimelineLayout', layout: 'compact' });
    await user.click(screen.getAllByRole('button', { name: 'Add task' })[0]);
    expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'planned',
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
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
    expect(onAddFiles).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), 'files');
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
