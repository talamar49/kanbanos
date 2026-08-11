/// <reference types="vite/client" />

type RepositoryConnection = {
  repositoryPath: string;
  remoteUrl?: string;
  displayName: string;
  privateRemote?: boolean;
  hasStoredCredentials?: boolean;
};

type GitCredentials = {
  username: string;
  token: string;
};

type GitConflict = {
  path: string;
  localContent: string;
  remoteContent: string;
  contentOmitted?: boolean;
  contentTruncated?: boolean;
};

type SaveResult = {
  status: 'synced' | 'local-only' | 'conflict' | 'error';
  message: string;
  commit?: string;
  conflicts?: GitConflict[];
  document?: unknown;
};

type ImportedAttachment = {
  id: string;
  name: string;
  kind: 'file' | 'folder' | 'reference';
  relativePath: string;
  localPath?: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
};

type AttachmentPreviewEntry = {
  name: string;
  relativePath: string;
  kind: 'file' | 'folder';
  sizeBytes: number;
};

type AttachmentPreview =
  | { type: 'image' | 'pdf' | 'video' | 'audio'; name: string; mimeType: string; url: string }
  | { type: 'text' | 'markdown'; name: string; content: string; truncated: boolean }
  | { type: 'word'; name: string; paragraphs: string[]; truncated: boolean }
  | { type: 'presentation'; name: string; slides: Array<{ title: string; lines: string[] }>; truncated: boolean }
  | { type: 'spreadsheet'; name: string; sheets: Array<{ name: string; rows: string[][] }>; truncated: boolean }
  | { type: 'folder'; name: string; entries: AttachmentPreviewEntry[]; truncated: boolean }
  | { type: 'unsupported'; name: string; extension: string };

interface Window {
  kanbanos?: {
    appearance: {
      setTheme: (theme: 'light' | 'dark') => void;
    };
    repository: {
      status: () => Promise<RepositoryConnection | null>;
      listRecent: () => Promise<RepositoryConnection[]>;
      openRecent: (repositoryPath: string) => Promise<RepositoryConnection>;
      removeRecent: (repositoryPath: string) => Promise<void>;
      createLocal: (displayName: string, language?: 'en' | 'he') => Promise<RepositoryConnection | null>;
      connectRemote: (remoteUrl: string, credentials?: GitCredentials | null) => Promise<RepositoryConnection>;
      chooseLocal: (language?: 'en' | 'he') => Promise<RepositoryConnection | null>;
      addRemote: (remoteUrl: string, credentials?: GitCredentials | null) => Promise<RepositoryConnection>;
      disconnect: () => Promise<void>;
      reveal: () => Promise<void>;
    };
    attachments: {
      pickFiles: (language?: 'en' | 'he') => Promise<ImportedAttachment[]>;
      pickFolders: (language?: 'en' | 'he') => Promise<ImportedAttachment[]>;
      pickReferences: (language?: 'en' | 'he') => Promise<ImportedAttachment[]>;
      open: (relativePath: string) => Promise<void>;
      reveal: (relativePath: string) => Promise<void>;
      openReference: (localPath: string) => Promise<void>;
      revealReference: (localPath: string) => Promise<void>;
      preview: (relativePath: string) => Promise<AttachmentPreview>;
      remove: (attachmentId: string) => Promise<void>;
    };
    workspace: {
      load: () => Promise<unknown | null>;
      save: (document: unknown) => Promise<SaveResult>;
      resolveConflicts: (strategy: 'local' | 'remote') => Promise<SaveResult>;
    };
  };
}
