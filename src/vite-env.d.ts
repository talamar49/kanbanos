/// <reference types="vite/client" />

type RepositoryConnection = {
  repositoryPath: string;
  remoteUrl?: string;
  displayName: string;
};

type GitConflict = {
  path: string;
  localContent: string;
  remoteContent: string;
};

type SaveResult = {
  status: 'synced' | 'local-only' | 'conflict' | 'error';
  message: string;
  commit?: string;
  conflicts?: GitConflict[];
  document?: unknown;
};

interface Window {
  kanbanos?: {
    repository: {
      status: () => Promise<RepositoryConnection | null>;
      listRecent: () => Promise<RepositoryConnection[]>;
      openRecent: (repositoryPath: string) => Promise<RepositoryConnection>;
      removeRecent: (repositoryPath: string) => Promise<void>;
      createLocal: (displayName: string) => Promise<RepositoryConnection | null>;
      connectRemote: (remoteUrl: string) => Promise<RepositoryConnection>;
      chooseLocal: () => Promise<RepositoryConnection | null>;
      addRemote: (remoteUrl: string) => Promise<RepositoryConnection>;
      disconnect: () => Promise<void>;
      reveal: () => Promise<void>;
    };
    workspace: {
      load: () => Promise<unknown | null>;
      save: (document: unknown) => Promise<SaveResult>;
      resolveConflicts: (strategy: 'local' | 'remote') => Promise<SaveResult>;
    };
  };
}
