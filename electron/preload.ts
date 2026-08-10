import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kanbanos', {
  repository: {
    status: () => ipcRenderer.invoke('repository:status'),
    listRecent: () => ipcRenderer.invoke('repository:list-recent'),
    openRecent: (repositoryPath: string) => ipcRenderer.invoke('repository:open-recent', repositoryPath),
    removeRecent: (repositoryPath: string) => ipcRenderer.invoke('repository:remove-recent', repositoryPath),
    createLocal: (displayName: string) =>
      ipcRenderer.invoke('repository:create-local', displayName),
    connectRemote: (remoteUrl: string) =>
      ipcRenderer.invoke('repository:connect-remote', remoteUrl),
    chooseLocal: () => ipcRenderer.invoke('repository:choose-local'),
    addRemote: (remoteUrl: string) => ipcRenderer.invoke('repository:add-remote', remoteUrl),
    disconnect: () => ipcRenderer.invoke('repository:disconnect'),
    reveal: () => ipcRenderer.invoke('repository:reveal'),
  },
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    save: (document: unknown) => ipcRenderer.invoke('workspace:save', document),
    resolveConflicts: (strategy: 'local' | 'remote') =>
      ipcRenderer.invoke('workspace:resolve-conflicts', strategy),
  },
});
