export type SyncIssue = 'offline' | 'remote' | 'local' | 'both';

type SyncFailure = {
  message: string;
  localSave?: 'available' | 'unavailable';
  remoteSync?: 'available' | 'unavailable';
};

export function isOfflineSyncError(message: string): boolean {
  return /\boffline\b|\bnetwork\b|not connected to the internet|failed to fetch|could not resolve|timed out|timeout/i.test(message);
}

export function syncIssueForFailure({ message, localSave = 'unavailable', remoteSync = 'unavailable' }: SyncFailure): SyncIssue {
  if (localSave === 'unavailable' && remoteSync === 'unavailable') return 'both';
  if (localSave === 'unavailable') return 'local';
  return isOfflineSyncError(message) ? 'offline' : 'remote';
}

export function syncIssueForThrownError(message: string, operation: 'save' | 'sync'): SyncIssue {
  if (isOfflineSyncError(message)) return 'offline';
  return operation === 'save' ? 'local' : 'remote';
}
