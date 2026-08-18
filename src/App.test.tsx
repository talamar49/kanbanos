import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createEmptyWorkspace, createWorkItem, itemsForColumn } from './domain/workspace';
import { PreferencesProvider } from './i18n';

function desktopApi(options: {
  stored?: unknown;
  loadResult?: WorkspaceLoadResult;
  recent?: RepositoryConnection[];
  connection?: RepositoryConnection;
  saveResult?: SaveResult;
  syncResult?: SaveResult;
  attachments?: ImportedAttachment[];
} = {}) {
  const connection: RepositoryConnection = options.connection ?? { repositoryPath: '/work/demo', displayName: 'Demo workspace' };
  const api = {
    appearance: { setTheme: vi.fn() },
    diagnostics: {
      list: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue('/tmp/kanbanos-diagnostics.log'),
    },
    repository: {
      status: vi.fn().mockResolvedValue(connection),
      listRecent: vi.fn().mockResolvedValue(options.recent ?? []),
      openRecent: vi.fn().mockResolvedValue(connection),
      removeRecent: vi.fn().mockResolvedValue(undefined),
      createLocal: vi.fn().mockResolvedValue(connection),
      connectRemote: vi.fn().mockResolvedValue(connection),
      chooseLocal: vi.fn().mockResolvedValue(connection),
      addRemote: vi.fn().mockResolvedValue(connection),
      disconnect: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
    },
    attachments: {
      pickFiles: vi.fn().mockResolvedValue(options.attachments ?? []),
      pickFolders: vi.fn().mockResolvedValue([]),
      pickReferences: vi.fn().mockResolvedValue([]),
      open: vi.fn().mockResolvedValue(undefined),
      reveal: vi.fn().mockResolvedValue(undefined),
      openReference: vi.fn().mockResolvedValue(undefined),
      revealReference: vi.fn().mockResolvedValue(undefined),
      preview: vi.fn().mockResolvedValue({ type: 'unsupported', name: 'file.bin', extension: '.bin' }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      load: vi.fn().mockResolvedValue(options.loadResult ?? { document: options.stored ?? null }),
      save: vi.fn().mockImplementation(async (document: unknown) => options.saveResult ?? ({
        status: 'local-only',
        message: 'Saved to the local Git repository.',
        document,
      })),
      sync: vi.fn().mockImplementation(async () => options.syncResult ?? ({
        status: 'synced',
        message: 'Everything is saved and in sync.',
        document: options.stored,
      })),
      resolveConflicts: vi.fn().mockImplementation(async () => ({
        status: 'synced',
        message: 'Conflict resolved. Your workspace is in sync.',
        document: options.stored,
      })),
    },
  };
  window.kanbanos = api as unknown as Window['kanbanos'];
  return { api, connection };
}

function renderApp() {
  return <PreferencesProvider><App /></PreferencesProvider>;
}

describe('Kanbanos app integration', () => {
  beforeEach(() => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('provides compact navigation and a mobile drawer without changing desktop workflows', async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: '(max-width: 760px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    desktopApi();
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click(await screen.findByRole('button', { name: 'Create a new workspace' }));
    await user.type(screen.getByLabelText('Workspace name'), 'Pocket plans');
    await user.click(screen.getByRole('button', { name: 'Choose location' }));

    const mobileNavigation = await screen.findByRole('navigation', { name: 'Mobile navigation' });
    const mobileAppBar = document.querySelector<HTMLElement>('.mobile-app-bar')!;
    expect(document.documentElement).toHaveClass('compact-layout');
    expect(within(mobileNavigation).getByRole('button', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
    expect(within(mobileAppBar).getByRole('button', { name: 'Save now' })).toBeInTheDocument();
    await waitFor(() => expect(within(mobileAppBar).getByRole('button', { name: 'Saved locally' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(document.querySelector('.sidebar')).toHaveClass('mobile-open');
    await user.click(screen.getByRole('button', { name: 'Close navigation', expanded: true }));
    expect(document.querySelector('.sidebar')).not.toHaveClass('mobile-open');

    await user.click(within(mobileNavigation).getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(document.querySelector('.mobile-timeline-view')).toBeInTheDocument();
    expect(document.querySelector('.timeline-chart')).toBeInTheDocument();
    expect(screen.getByText('Unscheduled work')).toBeInTheDocument();
  });

  it('opens a reliable task composer from the compact board and persists the created task', async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: '(max-width: 760px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const { api } = desktopApi();
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click(await screen.findByRole('button', { name: 'Create a new workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Mobile capture' } });
    await user.click(screen.getByRole('button', { name: 'Choose location' }));
    await user.click(await screen.findByRole('button', { name: 'Add task to Backlog' }));
    expect(await screen.findByRole('dialog', { name: 'Create task' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What needs to happen?'), { target: { value: 'Create from Android board' } });
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByText('Create from Android board')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add task to Backlog' }));
    fireEvent.change(screen.getByLabelText('What needs to happen?'), { target: { value: 'Newest Android task' } });
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    const backlogColumn = screen.getByRole('heading', { name: 'Backlog' }).closest<HTMLElement>('.board-column')!;
    const visibleTitles = Array.from(backlogColumn.querySelectorAll<HTMLElement>('.task-card h3')).map((heading) => heading.textContent);
    expect(visibleTitles).toEqual(['Newest Android task', 'Create from Android board']);
    await waitFor(() => {
      const savedDocument = api.workspace.save.mock.calls.at(-1)?.[0] as ReturnType<typeof createEmptyWorkspace> | undefined;
      expect(savedDocument && itemsForColumn(savedDocument, savedDocument.projects[0].id, 'backlog').map((item) => item.title))
        .toEqual(['Newest Android task', 'Create from Android board']);
    });
    expect(screen.queryByText('Saved to the local Git repository.')).not.toBeInTheDocument();
  }, 10_000);

  it('creates a workspace, captures a task, and persists it through the desktop bridge', async () => {
    const user = userEvent.setup();
    const { api } = desktopApi();
    const { render } = await import('@testing-library/react');
    render(renderApp());

    expect(await screen.findByRole('heading', { name: 'Start your first workspace' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a new workspace' }));
    await user.type(screen.getByLabelText('Workspace name'), 'Product team');
    await user.click(screen.getByRole('button', { name: 'Choose location' }));

    await waitFor(() => expect(api.repository.createLocal).toHaveBeenCalledWith('Product team', 'en'));
    expect(await screen.findByText('Demo workspace')).toBeInTheDocument();

    await user.keyboard('c');
    expect(await screen.findByRole('dialog', { name: 'Create task' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('What needs to happen?'), 'Regression task');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Regression task')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.getByText('Regression task')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /Save changes|Save now/ });
    await user.click(saveButton);
    await waitFor(() => expect(api.workspace.save).toHaveBeenCalled());
    const savedDocument = api.workspace.save.mock.calls.at(-1)?.[0] as ReturnType<typeof createEmptyWorkspace>;
    expect(Object.values(savedDocument.items).some((item) => item.title === 'Regression task' && item.priority === 'high')).toBe(true);
  });

  it('loads a recent workspace and routes attachment actions through Electron', async () => {
    const user = userEvent.setup();
    const stored = createEmptyWorkspace('Loaded workspace');
    const projectId = stored.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Review brief', 1000);
    stored.items[task.id] = task;
    const imported: ImportedAttachment = {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'brief.pdf',
      kind: 'file',
      relativePath: '.kanbanos/content/attachments/10000000-0000-4000-8000-000000000001/brief.pdf',
      sizeBytes: 1024,
      fileCount: 1,
      createdAt: '2027-01-01T00:00:00.000Z',
    };
    const recent = [{ repositoryPath: '/work/demo', displayName: 'Recent workspace' }];
    const { api } = desktopApi({ stored, recent, attachments: [imported] });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('Recent workspace')).closest('.recent-workspace-main')!);
    expect(await screen.findByText('Review brief')).toBeInTheDocument();
    await user.click(screen.getByText('Review brief'));
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    await waitFor(() => expect(api.attachments.pickFiles).toHaveBeenCalledWith('en'));
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Open brief.pdf' }));
    expect(api.attachments.open).toHaveBeenCalledWith(imported.relativePath);
    await user.click(screen.getByRole('button', { name: 'Show brief.pdf in workspace folder' }));
    expect(api.attachments.reveal).toHaveBeenCalledWith(imported.relativePath);
  });

  it('recovers an invalid workspace into its last saved version and tells the user where the backup is', async () => {
    const user = userEvent.setup();
    const restored = createEmptyWorkspace('Restored workspace');
    const recent = [{ repositoryPath: '/work/recovery', displayName: 'Recovery workspace' }];
    desktopApi({
      recent,
      loadResult: {
        document: restored,
        recovery: { restored: true, backupPath: '.kanbanos/recovery/workspace-2027-01-01.json' },
      },
    });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('Recovery workspace')).closest('.recent-workspace-main')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('restored your last saved version');
    expect(screen.getByRole('alert')).toHaveTextContent('.kanbanos/recovery/workspace-2027-01-01.json');
  });

  it('tells the user when managed attachments or module files were repaired', async () => {
    const user = userEvent.setup();
    const recent = [{ repositoryPath: '/work/file-recovery', displayName: 'File recovery workspace' }];
    desktopApi({
      recent,
      loadResult: {
        document: createEmptyWorkspace('File recovery workspace'),
        recovery: {
          restored: true,
          repairedPaths: ['.kanbanos/content/modules/layout.json', '.kanbanos/content/attachments/id/brief.pdf'],
          backupPath: '.kanbanos/recovery/2027-01-03',
        },
      },
    });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('File recovery workspace')).closest('.recent-workspace-main')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('repaired 2 damaged workspace files');
    expect(screen.getByRole('alert')).toHaveTextContent('.kanbanos/recovery/2027-01-03');
  });

  it('starts a fresh workspace and keeps the damaged backup when no valid version exists', async () => {
    const user = userEvent.setup();
    const recent = [{ repositoryPath: '/work/new-recovery', displayName: 'New recovery workspace' }];
    desktopApi({
      recent,
      loadResult: {
        document: null,
        recovery: { restored: false, backupPath: '.kanbanos/recovery/workspace-2027-01-02.json' },
      },
    });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('New recovery workspace')).closest('.recent-workspace-main')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('a new workspace was started');
    expect(screen.getByRole('alert')).toHaveTextContent('.kanbanos/recovery/workspace-2027-01-02.json');
  });

  it('opens a local file reference without trying to preview or sync its source file', async () => {
    const user = userEvent.setup();
    const stored = createEmptyWorkspace('Reference workspace');
    const projectId = stored.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Review recording', 1000);
    const reference: ImportedAttachment = {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'planning-recording.mp4',
      kind: 'reference',
      relativePath: '',
      localPath: '/home/alex/Videos/planning-recording.mp4',
      sizeBytes: 260 * 1024 * 1024,
      fileCount: 1,
      createdAt: '2027-01-01T00:00:00.000Z',
    };
    task.attachmentIds = [reference.id];
    stored.items[task.id] = task;
    stored.resources.attachments[reference.id] = reference;
    const recent = [{ repositoryPath: '/work/reference', displayName: 'Reference workspace' }];
    const { api } = desktopApi({ stored, recent });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('Reference workspace')).closest('.recent-workspace-main')!);
    await user.click(await screen.findByText('Review recording'));
    expect(await screen.findByText('Local file reference · not backed up')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open planning-recording.mp4' }));
    expect(api.attachments.openReference).toHaveBeenCalledWith(reference.localPath);
    expect(api.attachments.preview).not.toHaveBeenCalled();
  });

  it('synchronizes a remote workspace before marking the loaded document as current', async () => {
    const user = userEvent.setup();
    const stored = createEmptyWorkspace('Stale local workspace');
    const projectId = stored.projects[0].id;
    const remoteDocument = createEmptyWorkspace('Current remote workspace');
    remoteDocument.projects[0] = { ...stored.projects[0] };
    remoteDocument.preferences.activeProjectId = projectId;
    remoteDocument.modules.kanban.projects = { [projectId]: stored.modules.kanban.projects[projectId] };
    remoteDocument.modules.canvas.projects = { [projectId]: stored.modules.canvas.projects[projectId] };
    const remoteTask = createWorkItem(projectId, 'planned', 'Task fetched from remote', 1000);
    remoteDocument.items[remoteTask.id] = remoteTask;
    const connection = {
      repositoryPath: '/work/remote',
      displayName: 'Remote workspace',
      remoteUrl: 'https://example.com/workspace.git',
    };
    const { api } = desktopApi({
      stored,
      connection,
      recent: [connection],
      syncResult: {
        status: 'synced',
        message: 'Everything is saved and in sync.',
        document: remoteDocument,
      },
    });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('Remote workspace')).closest('.recent-workspace-main')!);

    await waitFor(() => expect(api.workspace.sync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Task fetched from remote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('shows save conflicts and resolves the chosen workspace version', async () => {
    const user = userEvent.setup();
    const stored = createEmptyWorkspace('Conflict workspace');
    const conflict: GitConflict = {
      path: '.kanbanos/workspace.json',
      localContent: JSON.stringify(stored),
      remoteContent: JSON.stringify(stored),
    };
    const { api } = desktopApi({
      stored,
      recent: [{ repositoryPath: '/work/demo', displayName: 'Conflict workspace' }],
      saveResult: {
        status: 'conflict',
        message: 'This workspace was changed somewhere else. Pick the version to keep.',
        conflicts: [conflict],
      },
    });
    const { render } = await import('@testing-library/react');
    render(renderApp());

    await user.click((await screen.findByText('Conflict workspace')).closest('.recent-workspace-main')!);
    await user.keyboard('c');
    await user.type(await screen.findByLabelText('What needs to happen?'), 'Conflicting change');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await user.click(await screen.findByRole('button', { name: 'Close task' }));
    await user.click(screen.getByRole('button', { name: /Save changes|Save now/ }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Keep my version/ }));
    await waitFor(() => expect(api.workspace.resolveConflicts).toHaveBeenCalledWith('local'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
