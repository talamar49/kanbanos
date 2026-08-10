import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import kanbanosLogo from './assets/kanbanos-logo.png';
import { ConflictDialog } from './components/ConflictDialog';
import { KanbanBoard } from './components/KanbanBoard';
import { ListView } from './components/ListView';
import { Onboarding } from './components/Onboarding';
import { ProjectModal } from './components/ProjectModal';
import { RemoteModal } from './components/RemoteModal';
import { RoadmapView } from './components/RoadmapView';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { TimelineView } from './components/TimelineView';
import type { WorkspaceAction, WorkspaceDocument, WorkspaceView } from './domain/types';
import { createEmptyWorkspace, isWorkspaceDocument, workspaceReducer } from './domain/workspace';

type BootState = 'loading' | 'onboarding' | 'ready';
type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type Toast = { kind: 'success' | 'error'; message: string };

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
  const [bootState, setBootState] = useState<BootState>('loading');
  const [connection, setConnection] = useState<RepositoryConnection | null>(null);
  const [document, setDocument] = useState<WorkspaceDocument>(() => createEmptyWorkspace());
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [activeView, setActiveView] = useState<WorkspaceView>('board');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'edit'; projectId?: string } | null>(null);
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RepositoryConnection[]>([]);
  const [conflicts, setConflicts] = useState<GitConflict[] | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const revisionRef = useRef(0);
  const saveInFlightRef = useRef(false);

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  const loadWorkspace = useCallback(async (nextConnection: RepositoryConnection) => {
    setConnection(nextConnection);
    setActiveView('board');
    const stored = window.kanbanos ? await window.kanbanos.workspace.load() : null;
    revisionRef.current = 0;
    if (isWorkspaceDocument(stored)) {
      setDocument(stored);
      setDirty(false);
      setSaveState('synced');
    } else {
      setDocument(createEmptyWorkspace(nextConnection.displayName));
      setDirty(true);
      setSaveState('idle');
    }
    setBootState('ready');
  }, []);

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
  }, [loadWorkspace]);

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
        notify('Workspace saved in preview mode.');
        return;
      }
      const result = await window.kanbanos.workspace.save(documentToSave);
      const unchanged = revisionRef.current === savedRevision;
      if (result.status === 'conflict') {
        setConflicts(result.conflicts ?? []);
        setDirty(!unchanged);
        setSaveState('error');
        notify(result.message, 'error');
        return;
      }
      if (unchanged && isWorkspaceDocument(result.document)) setDocument(result.document);
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
      notify(result.message, result.status === 'error' ? 'error' : 'success');
    } catch (error) {
      setSaveState(revisionRef.current === savedRevision ? 'error' : 'idle');
      notify(error instanceof Error ? error.message : 'Could not save the workspace.', 'error');
    } finally {
      saveInFlightRef.current = false;
    }
  }, [document, notify]);

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

  const createLocal = async (name: string) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.createLocal(name)
      : { repositoryPath: 'browser-demo', displayName: name };
    if (nextConnection) await loadWorkspace(nextConnection);
  };

  const connectRemote = async (url: string) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.connectRemote(url)
      : { repositoryPath: 'browser-demo', remoteUrl: url, displayName: 'Demo workspace' };
    await loadWorkspace(nextConnection);
  };

  const chooseLocal = async () => {
    if (!window.kanbanos) {
      await loadWorkspace({ repositoryPath: 'browser-demo', displayName: 'Local demo' });
      return;
    }
    const nextConnection = await window.kanbanos.repository.chooseLocal();
    if (nextConnection) await loadWorkspace(nextConnection);
  };

  const openRecent = async (repositoryPath: string) => {
    if (!window.kanbanos) return;
    await loadWorkspace(await window.kanbanos.repository.openRecent(repositoryPath));
  };

  const removeRecent = async (repositoryPath: string) => {
    await window.kanbanos?.repository.removeRecent(repositoryPath);
    setRecentWorkspaces((current) => current.filter((workspace) => workspace.repositoryPath !== repositoryPath));
  };

  const addRemote = async (url: string) => {
    const nextConnection = window.kanbanos
      ? await window.kanbanos.repository.addRemote(url)
      : { ...connection!, remoteUrl: url };
    setConnection(nextConnection);
    setDirty(true);
    setSaveState('idle');
    notify('Remote added. Save when you are ready to sync this workspace.');
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect this workspace? Your repository and all of its data will remain untouched.')) return;
    await window.kanbanos?.repository.disconnect();
    setConnection(null);
    if (window.kanbanos) setRecentWorkspaces(await window.kanbanos.repository.listRecent());
    setBootState('onboarding');
    setSaveState('idle');
    setDirty(false);
  };

  const resolveConflict = async (strategy: 'local' | 'remote') => {
    if (!window.kanbanos) return;
    const result = await window.kanbanos.workspace.resolveConflicts(strategy);
    if (isWorkspaceDocument(result.document)) {
      revisionRef.current += 1;
      setDocument(result.document);
    }
    if (result.status === 'synced') {
      setConflicts(null);
      setDirty(false);
      setSaveState('synced');
      notify(result.message);
    } else {
      setSaveState('error');
      notify(result.message, 'error');
    }
  };

  const activeProject = useMemo(() => {
    return document.projects.find((project) => project.id === document.preferences.activeProjectId)
      ?? document.projects[0];
  }, [document.preferences.activeProjectId, document.projects]);
  const openTask = openTaskId ? document.items[openTaskId] : undefined;

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
        activeView={activeView}
        onChangeView={setActiveView}
        onSelectProject={(projectId) => applyAction({ type: 'selectProject', projectId })}
        onAddProject={() => setProjectModal({ mode: 'create' })}
        onRenameProject={(projectId) => setProjectModal({ mode: 'edit', projectId })}
        hasRemote={Boolean(connection.remoteUrl)}
        onAddRemote={() => setRemoteModalOpen(true)}
        onRevealRepository={() => void window.kanbanos?.repository.reveal()}
        onDisconnect={() => void disconnect()}
      />
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
          onSave={() => void save()}
          onEditProject={() => setProjectModal({ mode: 'edit', projectId: activeProject.id })}
        />
      )}
      {activeView === 'roadmap' && (
        <RoadmapView
          document={document}
          saveState={saveState}
          dirty={dirty}
          onSave={() => void save()}
          onAddProject={() => setProjectModal({ mode: 'create' })}
          onEditProject={(projectId) => setProjectModal({ mode: 'edit', projectId })}
          onOpenProject={(projectId) => {
            applyAction({ type: 'selectProject', projectId });
            setActiveView('board');
          }}
        />
      )}

      {openTask && (
        <TaskModal
          item={openTask}
          columns={document.modules.kanban.projects[openTask.projectId]?.columns ?? []}
          onAction={applyAction}
          onClose={() => setOpenTaskId(null)}
        />
      )}
      {remoteModalOpen && (
        <RemoteModal
          currentUrl={connection.remoteUrl}
          onConnect={addRemote}
          onClose={() => setRemoteModalOpen(false)}
        />
      )}
      {projectModal && (
        <ProjectModal
          project={projectModal.mode === 'edit'
            ? document.projects.find((project) => project.id === projectModal.projectId)
            : undefined}
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
