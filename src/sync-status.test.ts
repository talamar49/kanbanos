import { describe, expect, it } from 'vitest';
import { syncIssueForFailure } from './sync-status';

describe('sync issue presentation', () => {
  it('keeps an offline remote sync reassuring when the local save is available', () => {
    expect(syncIssueForFailure({
      message: 'The repository is offline. Your work is still safe on this device.',
      localSave: 'available',
      remoteSync: 'unavailable',
    })).toBe('offline');
  });

  it('uses red only when both local saving and online sync are unavailable', () => {
    expect(syncIssueForFailure({
      message: 'Disk and connection unavailable',
      localSave: 'available',
      remoteSync: 'unavailable',
    })).toBe('remote');
    expect(syncIssueForFailure({
      message: 'Disk unavailable',
      localSave: 'unavailable',
      remoteSync: 'available',
    })).toBe('local');
    expect(syncIssueForFailure({
      message: 'Disk and connection unavailable',
      localSave: 'unavailable',
      remoteSync: 'unavailable',
    })).toBe('both');
  });
});
