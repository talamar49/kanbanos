import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocument } from '../domain/types';
import {
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

describe('workspace navigation', () => {
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
    await user.click(screen.getByRole('button', { name: /Retry sync/ }));
    expect(callbacks.onRetrySync).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText('Prepare launch')).toBeInTheDocument();
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
        onMoveProject={vi.fn()}
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
    await user.click(within(launchCard).getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith(document.projects[0].id, undefined);
    await user.click(within(launchCard).getByRole('button', { name: 'Open' }));
    expect(onOpenProject).toHaveBeenCalledWith(document.projects[0].id);
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
});
