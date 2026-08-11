import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import kanbanosLogo from './assets/kanbanos-mascot.png';
import { CanvasView } from './components/CanvasView';
import { ConflictDialog } from './components/ConflictDialog';
import { FilesView } from './components/FilesView';
import { KanbanBoard } from './components/KanbanBoard';
import { ListView } from './components/ListView';
import { MobileNavigation } from './components/MobileNavigation';
import { Onboarding } from './components/Onboarding';
import { ProjectModal } from './components/ProjectModal';
import { RemoteModal } from './components/RemoteModal';
import { RoadmapView } from './components/RoadmapView';
import { Sidebar } from './components/Sidebar';
import { TaskComposerModal } from './components/TaskComposerModal';
import { TaskModal } from './components/TaskModal';
import { TimelineView } from './components/TimelineView';
import type { CanvasPoint, TaskDraft, WorkspaceAction, WorkspaceAttachment, WorkspaceDocument, WorkspaceView } from './domain/types';
import { createCanvasNode, createEmptyWorkspace, createWorkItem, isWorkspaceDocument, normalizeWorkspaceDocument, workspaceReducer } from './domain/workspace';
import { useI18n } from './i18n';
import { isNativeMobile } from './platform/runtime';
import { useCompactLayout } from './platform/useCompactLayout';

type BootState = 'loading' | 'onboarding' | 'ready';
type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type Toast = { kind: 'success' | 'error'; message: string };

const AttachmentPreviewModal = lazy(() => import('./components/AttachmentPreviewModal').then((module) => ({ default: module.AttachmentPreviewModal })));

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <span className="loading-logo"><img src={kanbanosLogo} alt="" /></span>
      <strong>Kanbanos</strong>
      <div className="loading-line"><span /></div>
    </div>
  );
}

export default function App() {
  const { language, t } = useI18n();
  const compactLayout = useCompactLayout();
  const [bootState, setBootState] = useState<BootState>('loading');
  const [connection, setConnection] = useState<RepositoryConnection | null>(null);
  const [document, setDocument] = useState<WorkspaceDocument>(() => createEmptyWorkspace());
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [syncError, setSyncError] = useState('');
  const [activeView, setActiveView] = useState<WorkspaceView>('board');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<WorkspaceAttachment | null>(null);
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'edit'; projectId?: string; targetDate?: string } | null>(null);
  const [taskComposer, setTaskComposer] = useState<{ projectId: string; preset?: Partial<TaskDraft> } | null>(null);
  const [pendingCanvasTask, setPendingCanvasTask] = useState<{ projectId: string; point: CanvasPoint } | null>(null);
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RepositoryConnection[]>([]);
  const [conflicts, setConflicts] = useState<GitConflict[] | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const revisionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const loadWorkspace = useCallback(async (nextConnection: RepositoryConnection) => {
    setConnection(nextConnection);
    setSyncError('');
    setConflicts(null);
    setActiveView('board');
    const stored = window.kanbanos ? await window.kanbanos.workspace.load() : null;
    revisionRef.current = 0;
    if (isWorkspaceDocument(stored)) {
      let loadedDocument = normalizeWorkspaceDocument(stored);
      let loadedSaveState: SaveState = 'synced';
      let loadedSyncError = '';
      if (window.kanbanos && nextConnection.remoteUrl) {
        try {
          const result = await window.kanbanos.workspace.save(loadedDocument);
          if (result.status === 'conflict') {
            setConflicts(result.conflicts ?? []);
            loadedSaveState = 'error';
            loadedSyncError = result.message;
          } else {
            if (isWorkspaceDocument(result.document)) loadedDocument = normalizeWorkspaceDocument(result.document);
            loadedSaveState = result.status === 'synced'
              ? 'synced'
              : result.status === 'local-only'
                ? 'local'
                : 'error';
            loadedSyncError = result.status === 'error' ? result.message : '';
          }
        } catch (error) {
          loadedSaveState = 'error';
          loadedSyncError = error instanceof Error ? error.message : 'Git sync failed. Check the remote and try again.';
        }
      }
      setDocument(loadedDocument);
      setDirty(false);
      setSaveState(loadedSaveState);
      setSyncError(loadedSyncError);
    } else {
      setDocument(createEmptyWorkspace(nextConnection.displayName, {
        projectName: t('My first project'),
        projectDescription: t('A focused space for what matters next'),
      }));
      setDirty(true);
      setSaveState('idle');
    }
    setBootState('ready');
  }, [t]);

  useEffect(() => {
    const boot = async () => {
      try {
        if (!window.kanbanos) {
          setBootState('onboarding');
          return;
        }
        setRecentWorkspaces(await window.kanbanos.repository.listRecent());
        setBootState('onboarding');
      } catch (error) {
        console.error(error);
        setBootState('onboarding');
      }
    };
    void boot();
  }, []);

  const applyAction = useCallback((action: WorkspaceAction) => {
    revisionRef.current += 1;
    setDocument((current) => workspaceReducer(current, action));
    setDirty(true);
    if (saveState === 'synced') setSaveState('idle');
  }, [saveState]);

  const save = useCallback(async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const savedRevision = revisionRef.current;
    const documentToSave = document;
    setSaveState('saving');
    try {
      if (!window.kanbanos) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const unchanged = revisionRef.current === savedRevision;
        setDirty(!unchanged);
        setSaveState(unchanged ? 'synced' : 'idle');
        notify(t('Workspace saved in preview mode.'));
        return;
      }
      const result = await window.kanbanos.workspace.save(documentToSave);
      const unchanged = revisionRef.current === savedRevision;
      if (result.status === 'conflict') {
        setConflicts(result.conflicts ?? []);
        setDirty(!unchanged);
        setSaveState('error');
        setSyncError(result.message);
        notify(t(result.message), 'error');
        return;
      }
      if (unchanged && isWorkspaceDocument(result.document)) setDocument(normalizeWorkspaceDocument(result.document));
      setDirty(!unchanged);
      setSaveState(
        unchanged
          ? result.status === 'synced'
            ? 'synced'
            : result.status === 'local-only'
              ? 'local'
              : 'error'
          : 'idle',
      );
      setSyncError(result.status === 'error' ? result.message : '');
      notify(t(result.message), result.status === 'error' ? 'error' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the workspace.';
      setSaveState(revisionRef.current === savedRevision ? 'error' : 'idle');
      setSyncError(message);
      notify(t(message), 'error');
    } finally {
      saveInFlightRef.current = false;
    }
  }, [document, notify, t]);

  useEffect(() => {
    if (bootState !== 'ready' || !connection || !dirty || saveState === 'saving') return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [bootState, connection, dirty, document, save, saveState]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [save]);

  useEffect(() => {
    window.document.documentElement.classList.toggle('compact-layout', compactLayout);
    return () => window.document.documentElement.classList.remove('compact-layout');
  }, [compactLayout]);

  const createLocal = async (name: string) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.createLocal(name, language)
      : { repositoryPath: 'browser-demo', displayName: name };
    if (nextConnection) await loadWorkspace(nextConnection);
  };

  const connectRemote = async (url: string, credentials?: GitCredentials | null) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.connectRemote(url, credentials)
      : { repositoryPath: 'browser-demo', remoteUrl: url, displayName: t('Demo workspace'), privateRemote: Boolean(credentials), hasStoredCredentials: Boolean(credentials) };
    await loadWorkspace(nextConnection);
  };

  const chooseLocal = async () => {
    if (!window.kanbanos) {
      await loadWorkspace({ repositoryPath: 'browser-demo', displayName: t('Local demo') });
      return;
    }
    const nextConnection = await window.kanbanos.repository.chooseLocal(language);
    if (nextConnection) await loadWorkspace(nextConnection);
  };

  const openRecent = async (repositoryPath: string) => {
    if (!window.kanbanos) return;
    await loadWorkspace(await window.kanbanos.repository.openRecent(repositoryPath));
  };

  const removeRecent = async (repositoryPath: string) => {
    if (isNativeMobile() && !window.confirm(t('Remove this workspace and its on-device files? Export a workspace package first if you want to keep a portable copy.'))) return;
    try {
      await window.kanbanos?.repository.removeRecent(repositoryPath);
      setRecentWorkspaces((current) => current.filter((workspace) => workspace.repositoryPath !== repositoryPath));
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not remove this workspace.'), 'error');
    }
  };

  const addRemote = async (url: string, credentials?: GitCredentials | null) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.addRemote(url, credentials)
      : {
          ...connection!,
          remoteUrl: url,
          privateRemote: credentials === undefined ? connection?.privateRemote : Boolean(credentials),
          hasStoredCredentials: credentials === undefined ? connection?.hasStoredCredentials : Boolean(credentials),
        };
    setConnection(nextConnection);
    setDirty(true);
    setSaveState('idle');
    setSyncError('');
    notify(t('Remote added. Save when you are ready to sync this workspace.'));
  };

  const disconnect = async () => {
    if (!window.confirm(t('Disconnect this workspace? Your repository and all of its data will remain untouched.'))) return;
    try {
      await window.kanbanos?.repository.disconnect();
      setConnection(null);
      if (window.kanbanos) setRecentWorkspaces(await window.kanbanos.repository.listRecent());
      setBootState('onboarding');
      setSaveState('idle');
      setSyncError('');
      setDirty(false);
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not remove this workspace.'), 'error');
    }
  };

  const resolveConflict = async (strategy: 'local' | 'remote') => {
    if (!window.kanbanos) return;
    const result = await window.kanbanos.workspace.resolveConflicts(strategy);
    if (isWorkspaceDocument(result.document)) {
      revisionRef.current += 1;
      setDocument(normalizeWorkspaceDocument(result.document));
    }
    if (result.status === 'synced') {
      setConflicts(null);
      setDirty(false);
      setSaveState('synced');
      setSyncError('');
      notify(t(result.message));
    } else {
      setSaveState('error');
      setSyncError(result.message);
      notify(t(result.message), 'error');
    }
  };

  const addTaskAttachments = async (itemId: string, kind: 'files' | 'folders'): Promise<WorkspaceAttachment[]> => {
    const api = window.kanbanos?.attachments;
    if (!api) {
      notify(t('Attachments are available in the desktop app.'), 'error');
      return [];
    }
    try {
      const attachments = await (kind === 'files' ? api.pickFiles(language) : api.pickFolders(language));
      if (attachments.length === 0) return [];
      applyAction({ type: 'addAttachments', itemId, attachments });
      notify(t(attachments.length === 1 ? 'Attachment added to the task.' : '{{count}} attachments added to the task.', { count: attachments.length }));
      return attachments;
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not attach that item.'), 'error');
      return [];
    }
  };

  const addCanvasAttachments = async (projectId: string, point: CanvasPoint, kind: 'files' | 'folders') => {
    const api = window.kanbanos?.attachments;
    if (!api) {
      notify(t('Attachments are available in the desktop app.'), 'error');
      return;
    }
    try {
      const attachments = await (kind === 'files' ? api.pickFiles(language) : api.pickFolders(language));
      if (attachments.length === 0) return;
      const canvasNodes = Object.values(document.modules.canvas.projects[projectId]?.nodes ?? {});
      const topZIndex = Math.max(0, ...canvasNodes.map((node) => node.zIndex));
      const nodes = attachments.map((attachment, index) => createCanvasNode('file', {
        x: point.x + index * 28,
        y: point.y + index * 28,
      }, {
        attachmentId: attachment.id,
        zIndex: topZIndex + index + 1,
      }));
      applyAction({ type: 'canvasAddAttachments', projectId, attachments, nodes });
      notify(t(attachments.length === 1 ? 'File added to the canvas.' : '{{count}} files added to the canvas.', { count: attachments.length }));
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not add files to the canvas.'), 'error');
    }
  };

  const openAttachment = async (attachment: WorkspaceAttachment) => {
    try {
      if (!window.kanbanos?.attachments) throw new Error('Attachments are available in the desktop app.');
      await window.kanbanos.attachments.open(attachment.relativePath);
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not open that attachment.'), 'error');
    }
  };

  const revealAttachment = async (attachment: WorkspaceAttachment) => {
    try {
      if (!window.kanbanos?.attachments) throw new Error('Attachments are available in the desktop app.');
      await window.kanbanos.attachments.reveal(attachment.relativePath);
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not show that attachment.'), 'error');
    }
  };

  const removeTaskAttachment = async (attachment: WorkspaceAttachment) => {
    if (!window.confirm(t('Remove “{{name}}” from this task and delete its stored copy?', { name: attachment.name }))) return;
    try {
      await window.kanbanos?.attachments.remove(attachment.id);
      applyAction({ type: 'removeAttachment', attachmentId: attachment.id });
      notify(t('Attachment removed.'));
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not remove that attachment.'), 'error');
    }
  };

  const deleteTask = async (item: WorkspaceDocument['items'][string]): Promise<boolean> => {
    try {
      const attachmentIds = item.attachmentIds ?? [];
      if (window.kanbanos?.attachments && attachmentIds.length > 0) {
        const results = await Promise.allSettled(attachmentIds.map((attachmentId) => window.kanbanos!.attachments.remove(attachmentId)));
        const removedIds = attachmentIds.filter((_, index) => results[index].status === 'fulfilled');
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) {
          removedIds.forEach((attachmentId) => applyAction({ type: 'removeAttachment', attachmentId }));
          throw failure.reason;
        }
      }
      applyAction({ type: 'deleteItem', itemId: item.id });
      return true;
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not delete the task attachments.'), 'error');
      return false;
    }
  };

  const openTaskComposer = (projectId: string, preset?: Partial<TaskDraft>) => {
    setPendingCanvasTask(null);
    setTaskComposer({ projectId, preset });
  };

  const openCanvasTaskComposer = (projectId: string, point: CanvasPoint) => {
    const columns = document.modules.kanban.projects[projectId]?.columns ?? [];
    setPendingCanvasTask({ projectId, point });
    setTaskComposer({
      projectId,
      preset: { columnId: columns.find((column) => column.id === 'planned')?.id ?? columns[0]?.id },
    });
  };

  const createTaskFromDraft = (draft: TaskDraft) => {
    if (!taskComposer) return;
    const projectItems = Object.values(document.items).filter((item) => item.projectId === taskComposer.projectId);
    const rank = Math.max(0, ...projectItems.map((item) => item.moduleData.kanban.rank)) + 1000;
    const task = createWorkItem(taskComposer.projectId, draft.columnId, draft.title, rank, draft);
    if (document.preferences.activeProjectId !== taskComposer.projectId) {
      applyAction({ type: 'selectProject', projectId: taskComposer.projectId });
    }
    applyAction({ type: 'addItem', item: task });
    if (pendingCanvasTask?.projectId === task.projectId) {
      const canvasNodes = Object.values(document.modules.canvas.projects[task.projectId]?.nodes ?? {});
      applyAction({
        type: 'canvasAddNode',
        projectId: task.projectId,
        node: createCanvasNode('task', pendingCanvasTask.point, {
          taskId: task.id,
          color: document.projects.find((project) => project.id === task.projectId)?.color,
          zIndex: Math.max(0, ...canvasNodes.map((node) => node.zIndex)) + 1,
        }),
      });
    }
    setPendingCanvasTask(null);
    setTaskComposer(null);
    setOpenTaskId(task.id);
  };

  const activeProject = useMemo(() => {
    return document.projects.find((project) => project.id === document.preferences.activeProjectId)
      ?? document.projects[0];
  }, [document.preferences.activeProjectId, document.projects]);
  const openTask = openTaskId ? document.items[openTaskId] : undefined;

  useEffect(() => {
    const handleQuickCapture = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!activeProject || activeView === 'canvas' || event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      const columns = document.modules.kanban.projects[activeProject.id]?.columns ?? [];
      openTaskComposer(activeProject.id, { columnId: columns.find((column) => column.id === 'planned')?.id ?? columns[0]?.id });
    };
    window.addEventListener('keydown', handleQuickCapture);
    return () => window.removeEventListener('keydown', handleQuickCapture);
  }, [activeProject, activeView, document.modules.kanban.projects]);

  useEffect(() => {
    if (!isNativeMobile()) return;
    let disposed = false;
    const removers: Array<() => Promise<void>> = [];
    void Promise.all([import('@capacitor/app'), import('@capacitor/network')]).then(async ([{ App: NativeApp }, { Network }]) => {
      if (disposed) return;
      const handles = await Promise.all([
        NativeApp.addListener('appStateChange', ({ isActive }) => {
          if (!isActive && dirty) void save();
        }),
        NativeApp.addListener('backButton', () => {
          if (mobileMenuOpen) setMobileMenuOpen(false);
          else if (remoteModalOpen) setRemoteModalOpen(false);
          else if (projectModal) setProjectModal(null);
          else if (previewAttachment) setPreviewAttachment(null);
          else if (openTaskId) setOpenTaskId(null);
          else if (taskComposer) { setTaskComposer(null); setPendingCanvasTask(null); }
          else if (conflicts) setConflicts(null);
          else if (activeView !== 'board') setActiveView('board');
          else void NativeApp.minimizeApp();
        }),
        Network.addListener('networkStatusChange', ({ connected }) => {
          if (connected && connection?.remoteUrl && saveState === 'error') void save();
        }),
      ]);
      if (disposed) {
        for (const handle of handles) void handle.remove();
      } else {
        removers.push(...handles.map((handle) => () => handle.remove()));
      }
    }).catch((error: unknown) => {
      console.error('Could not initialize mobile lifecycle listeners.', error);
    });
    return () => {
      disposed = true;
      for (const remove of removers) void remove();
    };
  }, [activeView, conflicts, connection?.remoteUrl, dirty, mobileMenuOpen, openTaskId, previewAttachment, projectModal, remoteModalOpen, save, saveState, taskComposer]);

  if (bootState === 'loading') return <LoadingScreen />;
  if (bootState === 'onboarding' || !connection) {
    return (
      <>
        <div className="titlebar-drag" />
        <Onboarding
          recentWorkspaces={recentWorkspaces}
          onOpenRecent={openRecent}
          onRemoveRecent={removeRecent}
          onCreateLocal={createLocal}
          onConnectRemote={connectRemote}
          onChooseLocal={chooseLocal}
          mobile={isNativeMobile()}
        />
      </>
    );
  }

  if (!activeProject) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <div className="titlebar-drag" />
      <Sidebar
        document={document}
        activeProject={activeProject}
        repositoryName={connection.displayName}
        syncState={saveState}
        syncError={syncError}
        activeView={activeView}
        onChangeView={setActiveView}
        onSelectProject={(projectId) => applyAction({ type: 'selectProject', projectId })}
        onAddProject={() => setProjectModal({ mode: 'create' })}
        onRenameProject={(projectId) => setProjectModal({ mode: 'edit', projectId })}
        hasRemote={Boolean(connection.remoteUrl)}
        onAddRemote={() => setRemoteModalOpen(true)}
        onRetrySync={() => void save()}
        onRevealRepository={() => void window.kanbanos?.repository.reveal().catch((error: unknown) => {
          notify(error instanceof Error ? t(error.message) : t('Could not export or open this workspace.'), 'error');
        })}
        onDisconnect={() => void disconnect()}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        mobile={isNativeMobile()}
      />
      {compactLayout && (
        <MobileNavigation
          activeView={activeView}
          activeProject={activeProject}
          menuOpen={mobileMenuOpen}
          onOpenMenu={() => setMobileMenuOpen((open) => !open)}
          onChangeView={(view) => { setActiveView(view); setMobileMenuOpen(false); }}
        />
      )}
      {activeView === 'board' && (
        <KanbanBoard
          document={document}
          project={activeProject}
          saveState={saveState}
          dirty={dirty}
          onAction={applyAction}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onSave={() => void save()}
          onEditProject={() => setProjectModal({ mode: 'edit', projectId: activeProject.id })}
          onChangeView={setActiveView}
        />
      )}
      {activeView === 'list' && (
        <ListView
          document={document}
          project={activeProject}
          saveState={saveState}
          dirty={dirty}
          onAction={applyAction}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onCreateTask={(preset) => openTaskComposer(activeProject.id, preset)}
          onSave={() => void save()}
          onChangeView={setActiveView}
          onEditProject={() => setProjectModal({ mode: 'edit', projectId: activeProject.id })}
        />
      )}
      {activeView === 'timeline' && (
        <TimelineView
          document={document}
          project={activeProject}
          saveState={saveState}
          dirty={dirty}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onCreateTask={(preset) => openTaskComposer(activeProject.id, preset)}
          onAction={applyAction}
          onSave={() => void save()}
          onEditProject={() => setProjectModal({ mode: 'edit', projectId: activeProject.id })}
        />
      )}
      {activeView === 'canvas' && (
        <CanvasView
          document={document}
          project={activeProject}
          saveState={saveState}
          dirty={dirty}
          onAction={applyAction}
          onSave={() => void save()}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onCreateTask={(point) => openCanvasTaskComposer(activeProject.id, point)}
          onAddFiles={(point, kind) => void addCanvasAttachments(activeProject.id, point, kind)}
          onPreviewAttachment={setPreviewAttachment}
          onOpenAttachment={(attachment) => void openAttachment(attachment)}
        />
      )}
      {activeView === 'roadmap' && (
        <RoadmapView
          document={document}
          saveState={saveState}
          dirty={dirty}
          onSave={() => void save()}
          onAddProject={(targetDate) => setProjectModal({ mode: 'create', targetDate })}
          onAddTask={(projectId, preset) => openTaskComposer(projectId, preset)}
          onEditProject={(projectId) => setProjectModal({ mode: 'edit', projectId })}
          onMoveProject={(projectId, targetDate) => applyAction({ type: 'updateProject', projectId, changes: { targetDate } })}
          onReorderHorizons={(horizons) => applyAction({ type: 'reorderRoadmapColumns', horizons })}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onOpenProject={(projectId) => {
            applyAction({ type: 'selectProject', projectId });
            setActiveView('board');
          }}
        />
      )}
      {activeView === 'files' && (
        <FilesView
          document={document}
          saveState={saveState}
          dirty={dirty}
          onSave={() => void save()}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onPreviewAttachment={setPreviewAttachment}
          onOpenAttachment={(attachment) => void openAttachment(attachment)}
          onRevealAttachment={(attachment) => void revealAttachment(attachment)}
          mobile={isNativeMobile()}
        />
      )}

      {taskComposer && (() => {
        const taskProject = document.projects.find((project) => project.id === taskComposer.projectId);
        const taskColumns = document.modules.kanban.projects[taskComposer.projectId]?.columns ?? [];
        return taskProject ? (
          <TaskComposerModal
            project={taskProject}
            columns={taskColumns}
            preset={taskComposer.preset}
            onCreate={createTaskFromDraft}
            onClose={() => { setTaskComposer(null); setPendingCanvasTask(null); }}
          />
        ) : null;
      })()}
      {openTask && (
        <TaskModal
          item={openTask}
          columns={document.modules.kanban.projects[openTask.projectId]?.columns ?? []}
          projectTasks={Object.values(document.items).filter((item) => item.projectId === openTask.projectId)}
          attachments={(openTask.attachmentIds ?? []).map((attachmentId) => document.resources.attachments[attachmentId]).filter(Boolean)}
          onAction={applyAction}
          onAddAttachments={(kind) => addTaskAttachments(openTask.id, kind)}
          onPreviewAttachment={setPreviewAttachment}
          onOpenAttachment={(attachment) => void openAttachment(attachment)}
          onRevealAttachment={(attachment) => void revealAttachment(attachment)}
          onRemoveAttachment={removeTaskAttachment}
          onDelete={() => deleteTask(openTask)}
          onClose={() => setOpenTaskId(null)}
          mobile={isNativeMobile()}
        />
      )}
      {previewAttachment && (
        <Suspense fallback={<div className="modal-backdrop attachment-preview-backdrop"><div className="preview-loading-card"><span className="spinner spinner-dark" /> {t('Preparing preview…')}</div></div>}>
          <AttachmentPreviewModal
            attachment={previewAttachment}
            onClose={() => setPreviewAttachment(null)}
            onOpen={(attachment) => void openAttachment(attachment)}
            onReveal={(attachment) => void revealAttachment(attachment)}
            mobile={isNativeMobile()}
          />
        </Suspense>
      )}
      {remoteModalOpen && (
        <RemoteModal
          currentUrl={connection.remoteUrl}
          privateRepository={Boolean(connection.privateRemote)}
          hasStoredCredentials={Boolean(connection.hasStoredCredentials)}
          onConnect={addRemote}
          onClose={() => setRemoteModalOpen(false)}
          mobile={isNativeMobile()}
        />
      )}
      {projectModal && (
        <ProjectModal
          project={projectModal.mode === 'edit'
            ? document.projects.find((project) => project.id === projectModal.projectId)
            : undefined}
          initialTargetDate={projectModal.targetDate}
          onAction={applyAction}
          onClose={() => setProjectModal(null)}
        />
      )}
      {conflicts && conflicts.length > 0 && (
        <ConflictDialog conflicts={conflicts} onResolve={resolveConflict} onClose={() => setConflicts(null)} />
      )}
      {toast && (
        <div className={`toast toast-${toast.kind} slide-up`}>
          {toast.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
