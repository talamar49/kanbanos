import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import kanbanosLogo from './assets/kanbanos-mascot.png';
import { CanvasView } from './components/CanvasView';
import { ConflictDialog } from './components/ConflictDialog';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { FilesView } from './components/FilesView';
import { KanbanBoard } from './components/KanbanBoard';
import { ListView } from './components/ListView';
import { MobileNavigation } from './components/MobileNavigation';
import { MobileTimelineView } from './components/MobileTimelineView';
import { Onboarding } from './components/Onboarding';
import { ProjectModal } from './components/ProjectModal';
import { RemoteModal } from './components/RemoteModal';
import { RoadmapView } from './components/RoadmapView';
import { Sidebar } from './components/Sidebar';
import { TaskComposerModal } from './components/TaskComposerModal';
import { TaskModal } from './components/TaskModal';
import { TimelineView } from './components/TimelineView';
import type { CanvasPoint, TaskDraft, WorkspaceAction, WorkspaceAttachment, WorkspaceDocument, WorkspaceView } from './domain/types';
import { canvasViewsForProject, columnForRule, createCanvasNode, createEmptyWorkspace, createWorkItem, isWorkspaceDocument, normalizeWorkspaceDocument, workspaceReducer } from './domain/workspace';
import { useI18n } from './i18n';
import { isNativeMobile } from './platform/runtime';
import { useCompactLayout } from './platform/useCompactLayout';
import { syncIssueForFailure, syncIssueForThrownError, type SyncIssue } from './sync-status';

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
  const [syncIssue, setSyncIssue] = useState<SyncIssue | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('board');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<WorkspaceAttachment | null>(null);
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'edit'; projectId?: string; targetDate?: string } | null>(null);
  const [taskComposer, setTaskComposer] = useState<{ projectId: string; preset?: Partial<TaskDraft> } | null>(null);
  const [pendingCanvasTask, setPendingCanvasTask] = useState<{ projectId: string; canvasViewId: string; point: CanvasPoint } | null>(null);
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RepositoryConnection[]>([]);
  const [conflicts, setConflicts] = useState<GitConflict[] | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const revisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const syncInFlightRef = useRef(false);

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const recordDiagnostic = useCallback((scope: string, message: string, level: 'info' | 'error' = 'info', details?: string) => {
    void window.kanbanos?.diagnostics?.record({ scope, message, level, details });
  }, []);

  const sync = useCallback(async (quiet = false) => {
    if (syncInFlightRef.current || !window.kanbanos) return;
    syncInFlightRef.current = true;
    const syncedRevision = revisionRef.current;
    recordDiagnostic('sync', 'Checking for remote workspace updates.');
    setSaveState('saving');
    try {
      const result = await window.kanbanos.workspace.sync();
      const unchanged = revisionRef.current === syncedRevision;
      if (result.status === 'conflict') {
        setConflicts(result.conflicts ?? []);
        setDirty(!unchanged);
        setSaveState('error');
        setSyncError(result.message);
        setSyncIssue('local');
        if (!quiet) notify(t(result.message), 'error');
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
      setSyncIssue(result.status === 'error' ? syncIssueForFailure(result) : null);
      recordDiagnostic('sync', 'Remote update check finished.', result.status === 'error' ? 'error' : 'info', `${result.status}: ${result.message}`);
      if (result.status === 'error' && !quiet) notify(t(result.message), 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sync the workspace.';
      setSaveState(revisionRef.current === syncedRevision ? 'error' : 'idle');
      setSyncError(message);
      setSyncIssue(syncIssueForThrownError(message, 'sync'));
      recordDiagnostic('sync', 'Remote update check failed.', 'error', message);
      if (!quiet) notify(t(message), 'error');
    } finally {
      syncInFlightRef.current = false;
    }
  }, [notify, recordDiagnostic, t]);

  const loadWorkspace = useCallback(async (nextConnection: RepositoryConnection) => {
    recordDiagnostic('workspace', 'Opening workspace.');
    setConnection(nextConnection);
    setSyncError('');
    setSyncIssue(null);
    setConflicts(null);
    setActiveView('board');
    const loaded = window.kanbanos ? await window.kanbanos.workspace.load() : { document: null };
    const stored = loaded.document;
    revisionRef.current = 0;
    if (isWorkspaceDocument(stored)) {
      let loadedDocument = normalizeWorkspaceDocument(stored);
      let loadedSaveState: SaveState = 'synced';
      let loadedSyncError = '';
      let loadedSyncIssue: SyncIssue | null = null;
      if (window.kanbanos && nextConnection.remoteUrl) {
        try {
          const result = await window.kanbanos.workspace.sync();
          if (result.status === 'conflict') {
            setConflicts(result.conflicts ?? []);
            loadedSaveState = 'error';
            loadedSyncError = result.message;
            loadedSyncIssue = 'local';
          } else {
            if (isWorkspaceDocument(result.document)) loadedDocument = normalizeWorkspaceDocument(result.document);
            loadedSaveState = result.status === 'synced'
              ? 'synced'
              : result.status === 'local-only'
                ? 'local'
                : 'error';
            loadedSyncError = result.status === 'error' ? result.message : '';
            loadedSyncIssue = result.status === 'error' ? syncIssueForFailure(result) : null;
          }
        } catch (error) {
          loadedSaveState = 'error';
          loadedSyncError = error instanceof Error ? error.message : 'Git sync failed. Check the remote and try again.';
          loadedSyncIssue = syncIssueForThrownError(loadedSyncError, 'sync');
        }
      }
      setDocument(loadedDocument);
      setDirty(false);
      setSaveState(loadedSaveState);
      setSyncError(loadedSyncError);
      setSyncIssue(loadedSyncIssue);
    } else {
      setDocument(createEmptyWorkspace(nextConnection.displayName, {
        projectName: t('My first project'),
        projectDescription: t('A focused space for what matters next'),
      }));
      setDirty(true);
      setSaveState('idle');
      setSyncIssue(null);
    }
    setBootState('ready');
    if (loaded.recovery) {
      const repairedCount = loaded.recovery.repairedPaths?.length ?? 0;
      const backupPath = loaded.recovery.backupPath ?? '.kanbanos/recovery';
      const message = repairedCount > 0
        ? loaded.recovery.backupPath
          ? t(
            repairedCount === 1
              ? 'We repaired {{count}} damaged workspace file from the last saved version. A backup was kept at {{path}}.'
              : 'We repaired {{count}} damaged workspace files from the last saved version. Backups were kept at {{path}}.',
            { count: repairedCount, path: backupPath },
          )
          : t(
            repairedCount === 1
              ? 'We repaired {{count}} damaged workspace file from the last saved version.'
              : 'We repaired {{count}} damaged workspace files from the last saved version.',
            { count: repairedCount },
          )
        : t(
          loaded.recovery.restored
            ? 'We found damaged workspace data and restored your last saved version. A backup was kept at {{path}}.'
            : 'We found damaged workspace data. A backup was kept at {{path}} and a new workspace was started.',
          { path: backupPath },
        );
      notify(message, 'error');
    }
    recordDiagnostic('workspace', 'Workspace opened.');
  }, [notify, recordDiagnostic, t]);

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
    recordDiagnostic('workspace', 'Workspace action applied.', 'info', action.type);
    setDocument((current) => workspaceReducer(current, action));
    setDirty(true);
    if (saveState !== 'saving') {
      setSaveState('idle');
      setSyncError('');
      setSyncIssue(null);
    }
  }, [recordDiagnostic, saveState]);

  const save = useCallback(async (quiet = false) => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const savedRevision = revisionRef.current;
    const documentToSave = document;
    recordDiagnostic('sync', 'Saving workspace.');
    setSaveState('saving');
    try {
      if (!window.kanbanos) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const unchanged = revisionRef.current === savedRevision;
        setDirty(!unchanged);
        setSaveState(unchanged ? 'synced' : 'idle');
        if (!quiet) notify(t('Workspace saved in preview mode.'));
        return;
      }
      const result = await window.kanbanos.workspace.save(documentToSave);
      const unchanged = revisionRef.current === savedRevision;
      if (result.status === 'conflict') {
        setConflicts(result.conflicts ?? []);
        setDirty(!unchanged);
        setSaveState('error');
        setSyncError(result.message);
        setSyncIssue('local');
        notify(t(result.message), 'error');
        return;
      }
      if (unchanged && isWorkspaceDocument(result.document)) setDocument(normalizeWorkspaceDocument(result.document));
      setDirty(!unchanged || (result.status === 'error' && result.localSave === 'unavailable'));
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
      setSyncIssue(result.status === 'error' ? syncIssueForFailure(result) : null);
      recordDiagnostic('sync', 'Save finished.', result.status === 'error' ? 'error' : 'info', `${result.status}: ${result.message}`);
      if (result.status === 'error') notify(t(result.message), 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the workspace.';
      setSaveState(revisionRef.current === savedRevision ? 'error' : 'idle');
      setSyncError(message);
      setSyncIssue(syncIssueForThrownError(message, 'save'));
      recordDiagnostic('sync', 'Saving workspace failed.', 'error', message);
      notify(t(message), 'error');
    } finally {
      saveInFlightRef.current = false;
    }
  }, [document, notify, recordDiagnostic, t]);

  useEffect(() => {
    if (bootState !== 'ready' || !connection || !dirty || saveState === 'saving' || saveState === 'error') return;
    const timer = window.setTimeout(() => void save(true), 700);
    return () => window.clearTimeout(timer);
  }, [bootState, connection, dirty, document, save, saveState]);

  useEffect(() => {
    const syncWhenActive = () => {
      if (window.document.visibilityState !== 'hidden' && bootState === 'ready' && connection?.remoteUrl && !dirty && saveState !== 'saving' && saveState !== 'error') void sync(true);
    };
    window.addEventListener('focus', syncWhenActive);
    window.document.addEventListener('visibilitychange', syncWhenActive);
    return () => {
      window.removeEventListener('focus', syncWhenActive);
      window.document.removeEventListener('visibilitychange', syncWhenActive);
    };
  }, [bootState, connection?.remoteUrl, dirty, saveState, sync]);

  useEffect(() => {
    if (bootState !== 'ready' || !connection?.remoteUrl || dirty || saveState === 'saving' || saveState === 'error') return;
    const timer = window.setInterval(() => {
      if (window.document.visibilityState !== 'hidden') void sync(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [bootState, connection?.remoteUrl, dirty, saveState, sync]);

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
    setSyncIssue(null);
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
      setSyncIssue(null);
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
      setSyncIssue(null);
      notify(t(result.message));
    } else {
      setSaveState('error');
      setSyncError(result.message);
      setSyncIssue(syncIssueForFailure(result));
      notify(t(result.message), 'error');
    }
  };

  const addTaskAttachments = async (itemId: string, kind: 'files' | 'folders' | 'references'): Promise<WorkspaceAttachment[]> => {
    const api = window.kanbanos?.attachments;
    if (!api) {
      notify(t('Attachments are available in the desktop app.'), 'error');
      return [];
    }
    try {
      const attachments = await (kind === 'files' ? api.pickFiles(language) : kind === 'folders' ? api.pickFolders(language) : api.pickReferences(language));
      if (attachments.length === 0) return [];
      applyAction({ type: 'addAttachments', itemId, attachments });
      notify(t(kind === 'references'
        ? attachments.length === 1 ? 'Local file reference added to the task.' : '{{count}} local file references added to the task.'
        : attachments.length === 1 ? 'Attachment added to the task.' : '{{count}} attachments added to the task.', { count: attachments.length }));
      return attachments;
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not attach that item.'), 'error');
      return [];
    }
  };

  const addCanvasAttachments = async (projectId: string, canvasViewId: string, point: CanvasPoint, kind: 'files' | 'folders' | 'references') => {
    const api = window.kanbanos?.attachments;
    if (!api) {
      notify(t('Attachments are available in the desktop app.'), 'error');
      return;
    }
    try {
      const attachments = await (kind === 'files' ? api.pickFiles(language) : kind === 'folders' ? api.pickFolders(language) : api.pickReferences(language));
      if (attachments.length === 0) return;
      const canvasSettings = document.modules.canvas.projects[projectId];
      const canvasView = canvasSettings && canvasViewsForProject(canvasSettings).find((view) => view.id === canvasViewId);
      const canvasNodes = Object.values(canvasView?.nodes ?? {});
      const topZIndex = Math.max(0, ...canvasNodes.map((node) => node.zIndex));
      const nodes = attachments.map((attachment, index) => createCanvasNode('file', {
        x: point.x + index * 28,
        y: point.y + index * 28,
      }, {
        attachmentId: attachment.id,
        zIndex: topZIndex + index + 1,
      }));
      applyAction({ type: 'canvasAddAttachments', projectId, canvasViewId, attachments, nodes });
      notify(t(attachments.length === 1 ? 'File added to the canvas.' : '{{count}} files added to the canvas.', { count: attachments.length }));
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not add files to the canvas.'), 'error');
    }
  };

  const openAttachment = async (attachment: WorkspaceAttachment) => {
    try {
      const api = window.kanbanos?.attachments;
      if (!api) throw new Error('Attachments are available in the desktop app.');
      if (attachment.kind === 'reference') {
        if (isNativeMobile() || !attachment.localPath) throw new Error('This local file reference is only available on the computer where it was added.');
        await api.openReference(attachment.localPath);
      } else {
        await api.open(attachment.relativePath);
      }
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not open that attachment.'), 'error');
    }
  };

  const revealAttachment = async (attachment: WorkspaceAttachment) => {
    try {
      const api = window.kanbanos?.attachments;
      if (!api) throw new Error('Attachments are available in the desktop app.');
      if (attachment.kind === 'reference') {
        if (isNativeMobile() || !attachment.localPath) throw new Error('This local file reference is only available on the computer where it was added.');
        await api.revealReference(attachment.localPath);
      } else {
        await api.reveal(attachment.relativePath);
      }
    } catch (error) {
      notify(error instanceof Error ? t(error.message) : t('Could not show that attachment.'), 'error');
    }
  };

  const requestAttachmentPreview = (attachment: WorkspaceAttachment) => {
    if (attachment.kind === 'reference') {
      void openAttachment(attachment);
      return;
    }
    setPreviewAttachment(attachment);
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

  const openCanvasTaskComposer = (projectId: string, canvasViewId: string, point: CanvasPoint) => {
    const columns = document.modules.kanban.projects[projectId]?.columns ?? [];
    setPendingCanvasTask({ projectId, canvasViewId, point });
    setTaskComposer({
      projectId,
      preset: { columnId: columnForRule(columns, 'new-task')?.id },
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
      const canvasSettings = document.modules.canvas.projects[task.projectId];
      const canvasView = canvasSettings && canvasViewsForProject(canvasSettings).find((view) => view.id === pendingCanvasTask.canvasViewId);
      const canvasNodes = Object.values(canvasView?.nodes ?? {});
      applyAction({
        type: 'canvasAddNode',
        projectId: task.projectId,
        canvasViewId: pendingCanvasTask.canvasViewId,
        node: createCanvasNode('task', pendingCanvasTask.point, {
          taskId: task.id,
          color: document.projects.find((project) => project.id === task.projectId)?.color,
          zIndex: Math.max(0, ...canvasNodes.map((node) => node.zIndex)) + 1,
        }),
      });
    }
    setPendingCanvasTask(null);
    setTaskComposer(null);
    if (!compactLayout) setOpenTaskId(task.id);
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
      openTaskComposer(activeProject.id, { columnId: columnForRule(columns, 'new-task')?.id });
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
          if (isActive && connection?.remoteUrl && !dirty && saveState !== 'saving' && saveState !== 'error') void sync(true);
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
          if (connected && connection?.remoteUrl && !dirty && saveState !== 'saving' && saveState !== 'error') void sync(true);
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
  }, [activeView, conflicts, connection?.remoteUrl, dirty, mobileMenuOpen, openTaskId, previewAttachment, projectModal, remoteModalOpen, save, saveState, sync, taskComposer]);

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
        syncIssue={syncIssue ?? undefined}
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
        onOpenDiagnostics={() => setDiagnosticsOpen(true)}
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
          saveState={saveState}
          dirty={dirty}
          onOpenMenu={() => setMobileMenuOpen((open) => !open)}
          onSave={() => void save()}
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
          onCreateTask={(preset) => openTaskComposer(activeProject.id, preset)}
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
      {activeView === 'timeline' && (compactLayout ? (
        <MobileTimelineView
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
      ) : (
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
      ))}
      {activeView === 'canvas' && (
        <CanvasView
          document={document}
          project={activeProject}
          saveState={saveState}
          dirty={dirty}
          onAction={applyAction}
          onSave={() => void save()}
          onOpenTask={(item) => setOpenTaskId(item.id)}
          onCreateTask={(canvasViewId, point) => openCanvasTaskComposer(activeProject.id, canvasViewId, point)}
          onAddFiles={(canvasViewId, point, kind) => void addCanvasAttachments(activeProject.id, canvasViewId, point, kind)}
          onPreviewAttachment={requestAttachmentPreview}
          onOpenAttachment={(attachment) => void openAttachment(attachment)}
          mobile={compactLayout}
          nativeMobile={isNativeMobile()}
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
          onPreviewAttachment={requestAttachmentPreview}
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
          onPreviewAttachment={requestAttachmentPreview}
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
      {diagnosticsOpen && (
        <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} onNotify={notify} />
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
        <div className={`toast toast-${toast.kind} slide-up`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
