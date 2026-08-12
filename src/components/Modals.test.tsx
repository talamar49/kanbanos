import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAction } from '../domain/types';
import { createEmptyWorkspace, createProject, createWorkItem } from '../domain/workspace';
import { renderWithPreferences } from '../test/render';
import { ConflictDialog } from './ConflictDialog';
import { ProjectModal } from './ProjectModal';
import { RemoteModal } from './RemoteModal';
import { TaskComposerModal } from './TaskComposerModal';
import { TaskModal } from './TaskModal';

describe('project and task creation', () => {
  it('creates projects with trimmed details, selected color, and roadmap target date', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderWithPreferences(<ProjectModal initialTargetDate="2027-05-20" onAction={onAction} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('e.g. Mobile app launch'), '  Mobile launch  ');
    await user.type(screen.getByPlaceholderText('What does success look like?'), '  Ship a calm release  ');
    await user.click(screen.getByRole('button', { name: 'Use color #1f9d78' }));
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    const action = onAction.mock.calls[0][0] as WorkspaceAction;
    expect(action.type).toBe('addProject');
    if (action.type === 'addProject') {
      expect(action.project).toMatchObject({
        name: 'Mobile launch',
        description: 'Ship a calm release',
        color: '#1f9d78',
        targetDate: '2027-05-20',
      });
      expect(action.settings.columns).toHaveLength(4);
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('autosaves edited project details when the dialog closes', async () => {
    const user = userEvent.setup();
    const project = createProject('Original', '#6c5ce7', 'Old description');
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderWithPreferences(<ProjectModal project={project} onAction={onAction} onClose={onClose} />);

    const name = screen.getByDisplayValue('Original');
    await user.clear(name);
    await user.type(name, 'Renamed project');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'updateProject',
      projectId: project.id,
      changes: expect.objectContaining({ name: 'Renamed project' }),
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a task with status, priority, dates, and an estimate converted to minutes', async () => {
    const user = userEvent.setup();
    const workspace = createEmptyWorkspace();
    const project = workspace.projects[0];
    const columns = workspace.modules.kanban.projects[project.id].columns;
    const onCreate = vi.fn();
    renderWithPreferences(<TaskComposerModal project={project} columns={columns} onCreate={onCreate} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('What needs to happen?'), '  Prepare release notes  ');
    await user.selectOptions(screen.getByLabelText('Status'), 'progress');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    const dates = document.querySelectorAll<HTMLInputElement>('.task-composer-properties input[type="date"]');
    fireEvent.change(dates[0], { target: { value: '2027-04-01' } });
    fireEvent.change(dates[1], { target: { value: '2027-04-03' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1.5' } });
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Prepare release notes',
      columnId: 'progress',
      priority: 'high',
      startDate: '2027-04-01',
      dueDate: '2027-04-03',
      estimateMinutes: 90,
    });
  });
});

describe('remote and conflict workflows', () => {
  it('validates private remote credentials and can clear credentials for a public remote', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderWithPreferences(<RemoteModal onConnect={onConnect} onClose={onClose} />);

    await user.type(screen.getByLabelText('Git repository URL'), 'https://example.com/work.git');
    await user.click(screen.getByRole('checkbox', { name: /Private HTTPS repository/ }));
    await user.click(screen.getByRole('button', { name: /Add remote/ }));
    expect(screen.getByText('Enter a personal access token or password to continue.')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Private HTTPS repository/ }));
    await user.click(screen.getByRole('button', { name: /Add remote/ }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('https://example.com/work.git', null));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reuses stored private credentials when the remote URL is unchanged', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderWithPreferences(
      <RemoteModal
        currentUrl="https://example.com/private.git"
        privateRepository
        hasStoredCredentials
        onConnect={onConnect}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Update remote/ }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('https://example.com/private.git', undefined));
  });

  it('summarizes both conflict versions and resolves the selected one', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    renderWithPreferences(
      <ConflictDialog
        conflicts={[
          {
            path: '.kanbanos/content/attachments/file/brief.pdf',
            localContent: '',
            remoteContent: '',
            contentOmitted: true,
          },
          {
            path: '.kanbanos/workspace.json',
            localContent: JSON.stringify({ projects: [{ id: 1 }], items: { one: {}, two: {} }, workspace: { updatedAt: '2027-01-01T10:00:00.000Z' } }),
            remoteContent: JSON.stringify({ projects: [{ id: 1 }, { id: 2 }], items: { one: {} }, workspace: { updatedAt: '2027-01-02T10:00:00.000Z' } }),
          },
        ]}
        onResolve={onResolve}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect(screen.getByText('2 projects')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(document.querySelector('.conflict-modal footer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use repository version' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('remote'));
  });
});

describe('rich task details', () => {
  it('persists task properties, subtasks, labels, dependencies, and safe web links', async () => {
    const user = userEvent.setup();
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const dependency = createWorkItem(projectId, 'planned', 'Foundation', 1000);
    const item = createWorkItem(projectId, 'planned', 'Launch', 2000);
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderWithPreferences(
      <TaskModal
        item={item}
        columns={workspace.modules.kanban.projects[projectId].columns}
        projectTasks={[dependency, item]}
        attachments={[]}
        onAction={onAction}
        onAddAttachments={vi.fn().mockResolvedValue([])}
        onPreviewAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        onRevealAttachment={vi.fn()}
        onRemoveAttachment={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(true)}
        onClose={onClose}
      />,
    );

    const title = screen.getByLabelText('Task title');
    await user.clear(title);
    await user.type(title, 'Ship release');
    await user.type(screen.getByPlaceholderText('Add context, intent, or a useful note…'), 'Release context');
    await user.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    await user.selectOptions(screen.getByText('Depends on').closest('.dependency-property')!.querySelector('select')!, dependency.id);
    await user.type(screen.getByPlaceholderText('Initials'), 'alex');
    await user.type(screen.getByPlaceholderText('Add label…'), 'Release{Enter}');
    await user.type(screen.getByPlaceholderText('Add a subtask'), 'Run QA{Enter}');

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByPlaceholderText('Paste a web address…'), 'example.com/release');
    const addLinkButtons = screen.getAllByRole('button', { name: 'Add link' });
    await user.click(addLinkButtons[addLinkButtons.length - 1]);
    expect(screen.getByText('example.com/release')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done editing' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close task' }));

    const update = onAction.mock.calls.map(([action]) => action).filter((action) => action.type === 'updateItem').at(-1);
    expect(update).toEqual(expect.objectContaining({
      type: 'updateItem',
      itemId: item.id,
      changes: expect.objectContaining({
        title: 'Ship release',
        description: 'Release context',
        priority: 'urgent',
        dependencyIds: [dependency.id],
        assignee: 'ALE',
        labels: ['Release'],
        subtasks: [expect.objectContaining({ title: 'Run QA', completed: false })],
        links: [expect.objectContaining({ url: 'https://example.com/release' })],
      }),
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe links and delegates attachment and delete actions', async () => {
    const user = userEvent.setup();
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const item = createWorkItem(projectId, 'planned', 'Review', 1000);
    const file = {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'brief.pdf',
      kind: 'file' as const,
      relativePath: '.kanbanos/content/attachments/10000000-0000-4000-8000-000000000001/brief.pdf',
      sizeBytes: 1000,
      fileCount: 1,
      createdAt: '2027-01-01T00:00:00.000Z',
    };
    const onPreviewAttachment = vi.fn();
    const onAddAttachments = vi.fn().mockResolvedValue([]);
    const onRemoveAttachment = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithPreferences(
      <TaskModal
        item={{ ...item, attachmentIds: [file.id] }}
        columns={workspace.modules.kanban.projects[projectId].columns}
        projectTasks={[item]}
        attachments={[file]}
        onAction={vi.fn()}
        onAddAttachments={onAddAttachments}
        onPreviewAttachment={onPreviewAttachment}
        onOpenAttachment={vi.fn()}
        onRevealAttachment={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Attachments are limited to 100 MiB so they can sync reliably. For larger files, add a local file reference. The file stays on this computer and is not backed up to the remote repository.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add local file reference' }));
    await waitFor(() => expect(onAddAttachments).toHaveBeenCalledWith('references'));

    await user.click(screen.getByTitle('Preview brief.pdf'));
    expect(onPreviewAttachment).toHaveBeenCalledWith(file);
    await user.click(screen.getByRole('button', { name: 'Remove brief.pdf' }));
    await waitFor(() => expect(onRemoveAttachment).toHaveBeenCalledWith(file));

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByPlaceholderText('Paste a web address…'), 'javascript:alert(1)');
    const addLinkButtons = screen.getAllByRole('button', { name: 'Add link' });
    await user.click(addLinkButtons[addLinkButtons.length - 1]);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid web address.');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
