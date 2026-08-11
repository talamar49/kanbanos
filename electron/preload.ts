import { contextBridge, ipcRenderer } from 'electron';

type GitCredentials = { username: string; token: string };

contextBridge.exposeInMainWorld('kanbanos', {
  appearance: {
    setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('appearance:set-theme', theme),
  },
  repository: {
    status: () => ipcRenderer.invoke('repository:status'),
    listRecent: () => ipcRenderer.invoke('repository:list-recent'),
    openRecent: (repositoryPath: string) => ipcRenderer.invoke('repository:open-recent', repositoryPath),
    removeRecent: (repositoryPath: string) => ipcRenderer.invoke('repository:remove-recent', repositoryPath),
    createLocal: (displayName: string, language: 'en' | 'he' = 'en') =>
      ipcRenderer.invoke('repository:create-local', displayName, language),
    connectRemote: (remoteUrl: string, credentials?: GitCredentials | null) =>
      ipcRenderer.invoke('repository:connect-remote', remoteUrl, credentials),
    chooseLocal: (language: 'en' | 'he' = 'en') => ipcRenderer.invoke('repository:choose-local', language),
    addRemote: (remoteUrl: string, credentials?: GitCredentials | null) =>
      ipcRenderer.invoke('repository:add-remote', remoteUrl, credentials),
    disconnect: () => ipcRenderer.invoke('repository:disconnect'),
    reveal: () => ipcRenderer.invoke('repository:reveal'),
  },
  attachments: {
    pickFiles: (language: 'en' | 'he' = 'en') => ipcRenderer.invoke('attachments:pick-files', language),
    pickFolders: (language: 'en' | 'he' = 'en') => ipcRenderer.invoke('attachments:pick-folders', language),
    pickReferences: (language: 'en' | 'he' = 'en') => ipcRenderer.invoke('attachments:pick-references', language),
    open: (relativePath: string) => ipcRenderer.invoke('attachments:open', relativePath),
    reveal: (relativePath: string) => ipcRenderer.invoke('attachments:reveal', relativePath),
    openReference: (localPath: string) => ipcRenderer.invoke('attachments:open-reference', localPath),
    revealReference: (localPath: string) => ipcRenderer.invoke('attachments:reveal-reference', localPath),
    preview: (relativePath: string) => ipcRenderer.invoke('attachments:preview', relativePath),
    remove: (attachmentId: string) => ipcRenderer.invoke('attachments:remove', attachmentId),
  },
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    save: (document: unknown) => ipcRenderer.invoke('workspace:save', document),
    resolveConflicts: (strategy: 'local' | 'remote') =>
      ipcRenderer.invoke('workspace:resolve-conflicts', strategy),
  },
});
