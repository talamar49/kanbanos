import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronPaths = vi.hoisted(() => ({ userData: '', documents: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'documents' ? electronPaths.documents : electronPaths.userData,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { GitWorkspaceService, MAX_SYNCED_ATTACHMENT_BYTES } from './git-service';

const exec = promisify(execFile);
let temporaryDirectory = '';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd });
  return result.stdout.trim();
}

async function createBareRemote(name = 'remote.git'): Promise<string> {
  const remote = path.join(temporaryDirectory, name);
  await fs.mkdir(remote, { recursive: true });
  const initialized = await exec('git', ['init', '--bare', '-b', 'main'], { cwd: remote }).catch(async () => {
    await exec('git', ['init', '--bare'], { cwd: remote });
    return null;
  });
  void initialized;
  return remote;
}

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbanos-git-'));
  electronPaths.userData = path.join(temporaryDirectory, 'user-data');
  electronPaths.documents = path.join(temporaryDirectory, 'documents');
  await fs.mkdir(electronPaths.userData, { recursive: true });
  await fs.mkdir(electronPaths.documents, { recursive: true });
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe('Git workspace persistence', () => {
  it('requires a connection for repository-bound operations', async () => {
    const service = new GitWorkspaceService();

    await expect(service.loadWorkspace()).rejects.toThrow('Connect a Git repository first.');
    await expect(service.saveWorkspace({})).rejects.toThrow('Connect a Git repository first.');
    await expect(service.importAttachments([])).rejects.toThrow('Connect a Git repository first.');
  });

  it('creates, remembers, restores, lists, and disconnects local workspaces', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('  Product planning  ');

    expect(connection.displayName).toBe('Product planning');
    expect(connection.repositoryPath).toContain(path.join('documents', 'Kanbanos', 'Product-planning'));
    await expect(fs.stat(path.join(connection.repositoryPath, '.git'))).resolves.toBeDefined();
    expect(await git(connection.repositoryPath, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    await expect(service.listRecentConnections()).resolves.toEqual([
      expect.objectContaining(connection),
    ]);

    const restored = new GitWorkspaceService();
    await expect(restored.restoreConnection()).resolves.toEqual(expect.objectContaining(connection));
    await restored.disconnect();
    await expect(restored.restoreConnection()).resolves.toBeNull();
    await expect(restored.openRecentConnection(connection.repositoryPath)).resolves.toEqual(expect.objectContaining(connection));
    await restored.removeRecentConnection(connection.repositoryPath);
    await expect(restored.listRecentConnections()).resolves.toEqual([]);
  });

  it('connects existing repositories and reports invalid folder choices', async () => {
    const repository = path.join(temporaryDirectory, 'existing');
    await fs.mkdir(repository);
    await git(repository, 'init');
    const service = new GitWorkspaceService();

    const connection = await service.connectLocal(repository);
    expect(connection).toMatchObject({ repositoryPath: repository, displayName: 'existing' });
    await expect(service.connectLocal(path.join(temporaryDirectory, 'missing'))).rejects.toThrow('Choose a folder that contains a Git repository.');
  });

  it('writes workspace JSON atomically and commits every local change', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Local commits');
    const firstDocument = { schemaVersion: 1, workspace: { name: 'First' } };
    const secondDocument = { schemaVersion: 1, workspace: { name: 'Second' } };

    const first = await service.saveWorkspace(firstDocument);
    const second = await service.saveWorkspace(secondDocument);

    expect(first).toMatchObject({ status: 'local-only', message: 'Saved to the local Git repository.' });
    expect(second.status).toBe('local-only');
    expect(second.commit).not.toBe(first.commit);
    await expect(service.loadWorkspace()).resolves.toEqual(secondDocument);
    expect(await git(connection.repositoryPath, 'log', '--format=%s')).toContain('Update workspace');
    await expect(fs.access(path.join(connection.repositoryPath, '.kanbanos', 'workspace.json.tmp'))).rejects.toThrow();
  });

  it('backs up malformed workspace JSON and restores the last valid saved version', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Workspace JSON recovery');
    const savedDocument = { schemaVersion: 1, workspace: { name: 'Safe version' }, projects: [], items: {} };
    await service.saveWorkspace(savedDocument);
    const damaged = '{\n  "schemaVersion": 1,\n  "workspace": { "name": "Damaged" },\n}';
    await fs.writeFile(path.join(connection.repositoryPath, '.kanbanos', 'workspace.json'), damaged, 'utf8');

    const recovered = await service.loadWorkspaceForApp();

    expect(recovered).toMatchObject({ document: savedDocument, recovery: { restored: true } });
    expect(recovered.recovery?.backupPath).toMatch(/^\.kanbanos\/recovery\/workspace-.+\.json$/);
    await expect(fs.readFile(path.join(connection.repositoryPath, ...recovered.recovery!.backupPath.split('/')), 'utf8')).resolves.toBe(damaged);
    await expect(service.loadWorkspace()).resolves.toEqual(savedDocument);

    await service.saveWorkspace(savedDocument);
    expect(await git(connection.repositoryPath, 'ls-files', '--', '.kanbanos/recovery')).toBe('');
    await expect(fs.readFile(path.join(connection.repositoryPath, '.kanbanos', '.gitignore'), 'utf8')).resolves.toContain('/recovery/');
  });

  it('keeps malformed workspace JSON recoverable when there is no saved version yet', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Unsaved workspace JSON recovery');
    const damaged = '{\n  "schemaVersion": 1,\n  "workspace": { "name": "Damaged" },\n}';
    await fs.mkdir(path.join(connection.repositoryPath, '.kanbanos'), { recursive: true });
    await fs.writeFile(path.join(connection.repositoryPath, '.kanbanos', 'workspace.json'), damaged, 'utf8');

    const recovered = await service.loadWorkspaceForApp();

    expect(recovered).toMatchObject({ document: null, recovery: { restored: false } });
    await expect(fs.readFile(path.join(connection.repositoryPath, ...recovered.recovery!.backupPath.split('/')), 'utf8')).resolves.toBe(damaged);
    await expect(fs.access(path.join(connection.repositoryPath, '.kanbanos', 'workspace.json'))).rejects.toThrow();
  });

  it('serializes concurrent workspace saves so Git operations cannot race', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Serialized saves');
    const first = { schemaVersion: 1, workspace: { name: 'First queued save' }, projects: [], items: {} };
    const second = { schemaVersion: 1, workspace: { name: 'Second queued save' }, projects: [], items: {} };

    const [firstResult, secondResult] = await Promise.all([service.saveWorkspace(first), service.saveWorkspace(second)]);

    expect(firstResult.status).toBe('local-only');
    expect(secondResult.status).toBe('local-only');
    await expect(service.loadWorkspace()).resolves.toEqual(second);
    expect(await git(connection.repositoryPath, 'rev-list', '--count', 'HEAD')).toBe('2');
  });

  it('fast-forwards clean workspaces from the remote without creating a new commit', async () => {
    const remote = await createBareRemote('fetch-only.git');
    const publisher = new GitWorkspaceService();
    await publisher.createLocal('Fetch publisher');
    await publisher.addRemote(remote);
    const first = { schemaVersion: 1, workspace: { name: 'Initial' }, projects: [], items: {} };
    const updated = { ...first, workspace: { name: 'Fetched update' } };
    await expect(publisher.saveWorkspace(first)).resolves.toMatchObject({ status: 'synced' });

    const reader = new GitWorkspaceService();
    const readerConnection = await reader.connectRemote(remote);
    await expect(publisher.saveWorkspace(updated)).resolves.toMatchObject({ status: 'synced' });
    const remoteHead = await git(remote, 'rev-parse', 'main');

    const synced = await reader.syncWorkspace();

    expect(synced).toMatchObject({ status: 'synced', document: updated });
    expect(await git(readerConnection.repositoryPath, 'rev-parse', 'HEAD')).toBe(remoteHead);
    expect(await git(readerConnection.repositoryPath, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(await git(remote, 'rev-parse', 'main')).toBe(remoteHead);
  });

  it('imports files and folders, resolves only managed paths, and removes stored copies', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Attachments');
    const sourceFile = path.join(temporaryDirectory, 'brief?.txt');
    const sourceFolder = path.join(temporaryDirectory, 'assets');
    await fs.writeFile(sourceFile, 'brief');
    await fs.mkdir(path.join(sourceFolder, 'nested'), { recursive: true });
    await fs.writeFile(path.join(sourceFolder, 'one.txt'), 'one');
    await fs.writeFile(path.join(sourceFolder, 'nested', 'two.txt'), 'second');
    try {
      await fs.symlink(path.join(sourceFolder, 'one.txt'), path.join(sourceFolder, 'linked.txt'));
    } catch {
      // Symlinks can require elevated permissions on Windows.
    }

    const imported = await service.importAttachments([sourceFile, sourceFolder]);

    expect(imported[0]).toMatchObject({ name: 'brief_.txt', kind: 'file', sizeBytes: 5, fileCount: 1 });
    expect(imported[1]).toMatchObject({ name: 'assets', kind: 'folder', sizeBytes: 9, fileCount: 2 });
    const resolved = await service.resolveAttachmentPath(imported[0].relativePath);
    expect(resolved).toBe(path.join(connection.repositoryPath, ...imported[0].relativePath.split('/')));
    await expect(fs.readFile(resolved, 'utf8')).resolves.toBe('brief');
    await expect(service.resolveAttachmentPath('../outside.txt')).rejects.toThrow('outside the workspace attachment store');
    await expect(service.resolveAttachmentPath('.kanbanos/content/attachments/missing/file.txt')).rejects.toThrow('no longer available');
    await expect(service.removeAttachment('not-an-id')).rejects.toThrow('identifier is invalid');

    await service.removeAttachment(imported[0].id);
    await expect(fs.access(resolved)).rejects.toThrow();
  });

  it('keeps oversized attachments local, ignores them, and recovers sync history', async () => {
    const remote = await createBareRemote('attachment-limit.git');
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Attachment limit');
    await service.addRemote(remote);
    const document = { schemaVersion: 1, workspace: { name: 'Attachment limit' }, projects: [], items: {} };
    await expect(service.saveWorkspace(document)).resolves.toMatchObject({ status: 'synced' });

    const source = path.join(temporaryDirectory, 'large-video.mp4');
    const file = await fs.open(source, 'w');
    await file.truncate(MAX_SYNCED_ATTACHMENT_BYTES + 1);
    await file.close();

    await expect(service.importAttachments([source])).rejects.toThrow('Attachments are limited to 100 MiB');
    await expect(fs.readdir(path.join(connection.repositoryPath, '.kanbanos', 'content', 'attachments'))).resolves.toEqual([]);

    const [reference] = await service.createLocalFileReferences([source]);
    expect(reference).toMatchObject({
      name: 'large-video.mp4',
      kind: 'reference',
      localPath: source,
      sizeBytes: MAX_SYNCED_ATTACHMENT_BYTES + 1,
    });
    const referenceDocument = {
      ...document,
      resources: { attachments: { [reference.id]: reference } },
    };
    await expect(service.saveWorkspace(referenceDocument)).resolves.toMatchObject({ status: 'synced' });
    await expect(service.loadWorkspace()).resolves.toEqual(referenceDocument);

    const legacyId = '20000000-0000-4000-8000-000000000001';
    const legacyRelativePath = `.kanbanos/content/attachments/${legacyId}/large-video.mp4`;
    const storedOversized = path.join(connection.repositoryPath, ...legacyRelativePath.split('/'));
    await fs.mkdir(path.dirname(storedOversized), { recursive: true });
    await fs.copyFile(source, storedOversized);
    await git(connection.repositoryPath, 'add', '-f', '--', legacyRelativePath);
    await git(connection.repositoryPath, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Legacy oversized attachment');

    const recovered = await service.saveWorkspace({
      ...referenceDocument,
      resources: {
        attachments: {
          [reference.id]: reference,
          [legacyId]: {
            id: legacyId,
            name: 'large-video.mp4',
            kind: 'file',
            relativePath: legacyRelativePath,
            sizeBytes: MAX_SYNCED_ATTACHMENT_BYTES + 1,
            fileCount: 1,
            createdAt: '2027-01-01T00:00:00.000Z',
          },
        },
      },
    });
    expect(recovered).toMatchObject({ status: 'synced', message: expect.stringContaining('kept locally and excluded') });
    await expect(fs.access(storedOversized)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(connection.repositoryPath, '.kanbanos', '.gitignore'), 'utf8')).resolves.toContain(`/content/attachments/${legacyId}/large-video.mp4`);
    expect(await git(remote, 'ls-tree', '-r', '--name-only', 'main', '--', '.kanbanos/content/attachments'))
      .not.toContain(legacyRelativePath);
    expect((await service.loadWorkspace() as { resources: { attachments: Record<string, { kind: string; localPath?: string }> } }).resources.attachments[legacyId])
      .toMatchObject({ kind: 'reference', localPath: storedOversized });
    expect(await git(remote, 'rev-list', '--count', 'main')).toBe('3');
  });

  it.skipIf(process.platform === 'win32')('rejects attachment paths that escape through repository symlinks', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Symlink containment');
    const attachmentRoot = path.join(connection.repositoryPath, '.kanbanos', 'content', 'attachments');
    const attachmentDirectory = path.join(attachmentRoot, '10000000-0000-4000-8000-000000000001');
    const outsideDirectory = path.join(temporaryDirectory, 'outside-secrets');
    await fs.mkdir(attachmentDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, 'secret.txt'), 'must not be exposed');
    await fs.symlink(outsideDirectory, path.join(attachmentDirectory, 'escaped'));

    await expect(service.resolveAttachmentPath(
      '.kanbanos/content/attachments/10000000-0000-4000-8000-000000000001/escaped/secret.txt',
    )).rejects.toThrow('outside the workspace attachment store');
  });

  it('syncs local commits to a remote and clones them into another workspace', async () => {
    const remote = await createBareRemote();
    const publisher = new GitWorkspaceService();
    const local = await publisher.createLocal('Publisher');
    const connected = await publisher.addRemote(remote);
    expect(connected.remoteUrl).toBe(remote);
    const emptyFolder = path.join(temporaryDirectory, 'empty-reference');
    await fs.mkdir(emptyFolder);
    const [emptyAttachment] = await publisher.importAttachments([emptyFolder]);

    const document = { schemaVersion: 1, workspace: { name: 'Shared' }, projects: [], items: {} };
    const saved = await publisher.saveWorkspace(document);
    expect(saved).toMatchObject({ status: 'synced', message: 'Everything is saved and in sync.' });
    expect(await git(local.repositoryPath, 'remote', 'get-url', 'origin')).toBe(remote);

    const clone = new GitWorkspaceService();
    const cloneConnection = await clone.connectRemote(remote);
    expect(cloneConnection.remoteUrl).toBe(remote);
    await expect(clone.loadWorkspace()).resolves.toEqual(document);
    const clonedEmptyFolder = await clone.resolveAttachmentPath(emptyAttachment.relativePath);
    await expect(fs.readdir(clonedEmptyFolder)).resolves.toContain('.kanbanos-folder');
  });

  it('commits every managed workspace file while excluding credentials and unrelated repository files', async () => {
    const remote = await createBareRemote('private-files.git');
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Managed files');
    await service.addRemote(remote, { username: 'alice', token: 'top-secret-token' });
    const source = path.join(temporaryDirectory, 'design.txt');
    await fs.writeFile(source, 'managed attachment');
    const [imported] = await service.importAttachments([source]);
    const moduleFile = path.join(connection.repositoryPath, '.kanbanos', 'content', 'modules', 'roadmap.json');
    await fs.mkdir(path.dirname(moduleFile), { recursive: true });
    await fs.writeFile(moduleFile, '{"horizon":"Now"}\n');
    await fs.writeFile(path.join(connection.repositoryPath, 'README.local.md'), 'must remain outside Kanbanos commits');

    const document = { schemaVersion: 1, workspace: { name: 'All files' }, projects: [], items: {} };
    expect((await service.saveWorkspace(document)).status).toBe('synced');
    const tracked = (await git(connection.repositoryPath, 'ls-files')).split('\n');

    expect(tracked).toEqual(expect.arrayContaining([
      '.kanbanos/.gitignore',
      '.kanbanos/workspace.json',
      '.kanbanos/content/modules/roadmap.json',
      imported.relativePath,
    ]));
    expect(tracked).not.toContain('.kanbanos/credentials.json');
    expect(tracked).not.toContain('README.local.md');
    await expect(fs.readFile(path.join(connection.repositoryPath, '.kanbanos', '.gitignore'), 'utf8')).resolves.toContain('/credentials.json');
    await expect(fs.readFile(path.join(connection.repositoryPath, '.git', 'info', 'exclude'), 'utf8')).resolves.toContain('/.kanbanos/credentials.json');
    await expect(fs.readFile(path.join(connection.repositoryPath, '.kanbanos', 'credentials.json'), 'utf8')).resolves.not.toContain('top-secret-token');
    expect(await git(connection.repositoryPath, 'remote', 'get-url', 'origin')).toBe(remote);
    await expect(exec('git', ['show', 'HEAD:.kanbanos/credentials.json'], { cwd: connection.repositoryPath })).rejects.toThrow();

    const publicRemote = await createBareRemote('public-files.git');
    const changed = await service.addRemote(publicRemote);
    expect(changed).toMatchObject({ remoteUrl: publicRemote, privateRemote: false, hasStoredCredentials: false });
    await expect(fs.access(path.join(connection.repositoryPath, '.kanbanos', 'credentials.json'))).rejects.toThrow();
  });

  it('commits modifications and deletions for nested workspace content', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Workspace file lifecycle');
    const source = path.join(temporaryDirectory, 'notes.txt');
    await fs.writeFile(source, 'version one');
    const [imported] = await service.importAttachments([source]);
    const document = { schemaVersion: 1, workspace: { name: 'Lifecycle' }, projects: [], items: {} };
    const first = await service.saveWorkspace(document);
    const attachmentPath = await service.resolveAttachmentPath(imported.relativePath);

    await fs.writeFile(attachmentPath, 'version two');
    const second = await service.saveWorkspace(document);
    expect(second.commit).not.toBe(first.commit);
    expect(await git(connection.repositoryPath, 'show', `HEAD:${imported.relativePath}`)).toBe('version two');

    await service.removeAttachment(imported.id);
    const third = await service.saveWorkspace(document);
    expect(third.commit).not.toBe(second.commit);
    expect((await git(connection.repositoryPath, 'ls-files')).split('\n')).not.toContain(imported.relativePath);
    expect(await git(connection.repositoryPath, 'show', '--name-status', '--format=', 'HEAD')).toContain(`D\t${imported.relativePath}`);
  });

  it('does not create empty commits when no managed workspace file changed', async () => {
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('No-op saves');
    const document = { schemaVersion: 1, workspace: { name: 'Stable' }, projects: [], items: {} };

    const first = await service.saveWorkspace(document);
    const second = await service.saveWorkspace(document);

    expect(second.commit).toBe(first.commit);
    expect(await git(connection.repositoryPath, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('auto-merges disjoint workspace files from two devices and pushes the combined tree', async () => {
    const remote = await createBareRemote('disjoint.git');
    const firstDevice = new GitWorkspaceService();
    const firstConnection = await firstDevice.createLocal('Disjoint first');
    await firstDevice.addRemote(remote);
    const document = { schemaVersion: 1, workspace: { name: 'Shared' }, projects: [], items: {} };
    expect((await firstDevice.saveWorkspace(document)).status).toBe('synced');

    const secondDevice = new GitWorkspaceService();
    const secondConnection = await secondDevice.connectRemote(remote);
    const firstOnly = path.join(firstConnection.repositoryPath, '.kanbanos', 'content', 'first-device.txt');
    const secondOnly = path.join(secondConnection.repositoryPath, '.kanbanos', 'content', 'second-device.txt');
    await fs.mkdir(path.dirname(firstOnly), { recursive: true });
    await fs.mkdir(path.dirname(secondOnly), { recursive: true });
    await fs.writeFile(firstOnly, 'from first');
    await fs.writeFile(secondOnly, 'from second');
    expect((await firstDevice.saveWorkspace(document)).status).toBe('synced');

    const originalHome = process.env.HOME;
    const isolatedHome = path.join(temporaryDirectory, 'git-without-global-identity');
    await fs.mkdir(isolatedHome);
    process.env.HOME = isolatedHome;
    let merged;
    try {
      merged = await secondDevice.saveWorkspace(document);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
    expect(merged.status).toBe('synced');
    await expect(fs.readFile(path.join(secondConnection.repositoryPath, '.kanbanos', 'content', 'first-device.txt'), 'utf8')).resolves.toBe('from first');
    await expect(fs.readFile(secondOnly, 'utf8')).resolves.toBe('from second');

    const verificationClone = path.join(temporaryDirectory, 'disjoint-verification');
    await exec('git', ['clone', '--', remote, verificationClone], { cwd: temporaryDirectory });
    await expect(fs.readFile(path.join(verificationClone, '.kanbanos', 'content', 'first-device.txt'), 'utf8')).resolves.toBe('from first');
    await expect(fs.readFile(path.join(verificationClone, '.kanbanos', 'content', 'second-device.txt'), 'utf8')).resolves.toBe('from second');
    expect(await git(verificationClone, 'diff', '--name-only', '--diff-filter=U')).toBe('');
  });

  it('keeps local commits recoverable when a configured remote becomes unavailable', async () => {
    const remote = await createBareRemote('offline.git');
    const service = new GitWorkspaceService();
    const connection = await service.createLocal('Offline safety');
    await service.addRemote(remote);
    const initial = { schemaVersion: 1, workspace: { name: 'Online' }, projects: [], items: {} };
    const synced = await service.saveWorkspace(initial);
    await fs.rm(remote, { recursive: true, force: true });

    const offlineDocument = { ...initial, workspace: { name: 'Safe offline edit' } };
    const offline = await service.saveWorkspace(offlineDocument);

    expect(offline.status).toBe('error');
    expect(offline.commit).not.toBe(synced.commit);
    await expect(service.loadWorkspace()).resolves.toEqual(offlineDocument);
    expect(await git(connection.repositoryPath, 'show', 'HEAD:.kanbanos/workspace.json')).toContain('Safe offline edit');
    expect(await git(connection.repositoryPath, 'status', '--short', '--', '.kanbanos')).toBe('');
  });

  it('reports and resolves simultaneous conflicts across workspace JSON and attachment files', async () => {
    const remote = await createBareRemote('multi-file-conflicts.git');
    const firstDevice = new GitWorkspaceService();
    const firstConnection = await firstDevice.createLocal('Conflict first');
    await firstDevice.addRemote(remote);
    const source = path.join(temporaryDirectory, 'shared-notes.txt');
    await fs.writeFile(source, 'initial attachment');
    const [imported] = await firstDevice.importAttachments([source]);
    const initial = { schemaVersion: 1, workspace: { name: 'Initial' }, projects: [], items: {} };
    expect((await firstDevice.saveWorkspace(initial)).status).toBe('synced');

    const secondDevice = new GitWorkspaceService();
    const secondConnection = await secondDevice.connectRemote(remote);
    const firstAttachmentPath = await firstDevice.resolveAttachmentPath(imported.relativePath);
    const secondAttachmentPath = await secondDevice.resolveAttachmentPath(imported.relativePath);
    await fs.writeFile(firstAttachmentPath, 'attachment from first device');
    await fs.writeFile(secondAttachmentPath, 'attachment from second device');
    const firstEdit = { ...initial, workspace: { name: 'First device version' } };
    const secondEdit = { ...initial, workspace: { name: 'Second device version' } };
    expect((await firstDevice.saveWorkspace(firstEdit)).status).toBe('synced');

    const conflict = await secondDevice.saveWorkspace(secondEdit);
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicts).toHaveLength(2);
    expect(conflict.conflicts?.map((value) => value.path)).toEqual([
      '.kanbanos/workspace.json',
      imported.relativePath,
    ]);
    expect(conflict.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '.kanbanos/workspace.json',
        localContent: expect.stringContaining('Second device version'),
        remoteContent: expect.stringContaining('First device version'),
      }),
      expect.objectContaining({
        path: imported.relativePath,
        localContent: '',
        remoteContent: '',
        contentOmitted: true,
      }),
    ]));
    expect((await git(secondConnection.repositoryPath, 'diff', '--name-only', '--diff-filter=U')).split('\n')).toEqual(expect.arrayContaining([
      '.kanbanos/workspace.json',
      imported.relativePath,
    ]));

    const blockedSave = await secondDevice.saveWorkspace({ ...secondEdit, workspace: { name: 'Must not overwrite conflicts' } });
    expect(blockedSave).toMatchObject({ status: 'conflict', message: 'Choose which version to keep before saving again.' });
    const remoteHead = await git(remote, 'rev-parse', 'main');
    const resolved = await secondDevice.resolveConflicts('remote');

    expect(resolved).toMatchObject({ status: 'synced', message: 'Repository version selected and workspace synced.' });
    expect(await git(remote, 'rev-parse', 'main')).toBe(remoteHead);
    await expect(secondDevice.loadWorkspace()).resolves.toEqual(firstEdit);
    await expect(fs.readFile(secondAttachmentPath, 'utf8')).resolves.toBe('attachment from first device');
    expect(await git(secondConnection.repositoryPath, 'diff', '--name-only', '--diff-filter=U')).toBe('');
    expect(await git(secondConnection.repositoryPath, 'status', '--short', '--', '.kanbanos')).toBe('');
  });

  it('caps oversized workspace conflict previews before returning them over IPC', async () => {
    const remote = await createBareRemote('large-conflict.git');
    const firstDevice = new GitWorkspaceService();
    await firstDevice.createLocal('Large conflict first');
    await firstDevice.addRemote(remote);
    const initial = { schemaVersion: 1, workspace: { name: 'Initial', notes: 'base' }, projects: [], items: {} };
    expect((await firstDevice.saveWorkspace(initial)).status).toBe('synced');

    const secondDevice = new GitWorkspaceService();
    await secondDevice.connectRemote(remote);
    const firstEdit = { ...initial, workspace: { name: 'First large edit', notes: 'a'.repeat(1_200_000) } };
    const secondEdit = { ...initial, workspace: { name: 'Second large edit', notes: 'b'.repeat(1_200_000) } };
    expect((await firstDevice.saveWorkspace(firstEdit)).status).toBe('synced');

    const conflict = await secondDevice.saveWorkspace(secondEdit);
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({
        path: '.kanbanos/workspace.json',
        contentTruncated: true,
      }),
    ]);
    expect(conflict.conflicts![0].localContent.length).toBeLessThanOrEqual(1024 * 1024);
    expect(conflict.conflicts![0].remoteContent.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it.each([
    { label: 'remote deletion', publisherAction: 'delete', resolverAction: 'modify', strategy: 'remote' },
    { label: 'local deletion', publisherAction: 'modify', resolverAction: 'delete', strategy: 'local' },
  ] as const)('resolves modify/delete conflicts when keeping the $label', async ({ publisherAction, resolverAction, strategy }) => {
    const remote = await createBareRemote(`modify-delete-${strategy}.git`);
    const publisher = new GitWorkspaceService();
    await publisher.createLocal(`Publisher ${strategy}`);
    await publisher.addRemote(remote);
    const source = path.join(temporaryDirectory, `shared-${strategy}.txt`);
    await fs.writeFile(source, 'base version');
    const [imported] = await publisher.importAttachments([source]);
    const document = { schemaVersion: 1, workspace: { name: 'Modify delete' }, projects: [], items: {} };
    expect((await publisher.saveWorkspace(document)).status).toBe('synced');

    const resolver = new GitWorkspaceService();
    const resolverConnection = await resolver.connectRemote(remote);
    const publisherPath = await publisher.resolveAttachmentPath(imported.relativePath);
    const resolverPath = await resolver.resolveAttachmentPath(imported.relativePath);
    if (publisherAction === 'delete') await publisher.removeAttachment(imported.id);
    else await fs.writeFile(publisherPath, 'publisher modification');
    if (resolverAction === 'delete') await resolver.removeAttachment(imported.id);
    else await fs.writeFile(resolverPath, 'resolver modification');
    expect((await publisher.saveWorkspace(document)).status).toBe('synced');

    const conflict = await resolver.saveWorkspace(document);
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({ path: imported.relativePath }),
    ]);

    const resolved = await resolver.resolveConflicts(strategy);
    expect(resolved.status).toBe('synced');
    await expect(fs.access(resolverPath)).rejects.toThrow();
    expect((await git(resolverConnection.repositoryPath, 'ls-files')).split('\n')).not.toContain(imported.relativePath);
    expect(await git(resolverConnection.repositoryPath, 'diff', '--name-only', '--diff-filter=U')).toBe('');
  });

  it('detects divergent workspace edits and resolves the chosen complete version', async () => {
    const remote = await createBareRemote('conflicts.git');
    const firstDevice = new GitWorkspaceService();
    await firstDevice.createLocal('First device');
    await firstDevice.addRemote(remote);
    const initial = { schemaVersion: 1, workspace: { name: 'Initial' }, projects: [], items: {} };
    expect((await firstDevice.saveWorkspace(initial)).status).toBe('synced');

    const secondDevice = new GitWorkspaceService();
    await secondDevice.connectRemote(remote);
    const firstEdit = { ...initial, workspace: { name: 'First edit' } };
    const secondEdit = { ...initial, workspace: { name: 'Second edit' } };
    expect((await firstDevice.saveWorkspace(firstEdit)).status).toBe('synced');

    const conflict = await secondDevice.saveWorkspace(secondEdit);
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({
        path: '.kanbanos/workspace.json',
        localContent: expect.stringContaining('Second edit'),
        remoteContent: expect.stringContaining('First edit'),
      }),
    ]);

    const resolved = await secondDevice.resolveConflicts('local');
    expect(resolved.status).toBe('synced');
    await expect(secondDevice.loadWorkspace()).resolves.toEqual(secondEdit);
  });
});
