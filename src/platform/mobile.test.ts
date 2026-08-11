import 'fake-indexeddb/auto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import LightningFS from '@isomorphic-git/lightning-fs';
import JSZip from 'jszip';
import type { HttpOptions } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MobileGitWorkspaceService,
  createCapacitorGitHttp,
  mobileStatusBarAppearance,
  normalizeMobileRemoteUrl,
  pickBrowserFolder,
  type ConnectionSettings,
  type MobileCredentialStore,
  type MobileNativeFiles,
  type MobileSettingsStore,
} from './mobile';

class MemorySettings implements MobileSettingsStore {
  value: ConnectionSettings | null = null;
  async read() { return this.value ? structuredClone(this.value) : null; }
  async write(value: ConnectionSettings) { this.value = structuredClone(value); }
}

class MemoryCredentials implements MobileCredentialStore {
  values = new Map<string, GitCredentials>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: GitCredentials) { this.values.set(key, value); }
  async remove(key: string) { this.values.delete(key); }
}

class MemoryNativeFiles implements MobileNativeFiles {
  files: Array<{ name: string; size: number; bytes: Uint8Array }> = [];
  folder: Awaited<ReturnType<MobileNativeFiles['pickFolder']>> = null;
  workspacePackage: Awaited<ReturnType<MobileNativeFiles['pickWorkspacePackage']>> = null;
  shared: Array<{ name: string; bytes: Uint8Array; title: string }> = [];
  async pickFiles() { return this.files; }
  async pickFolder() { return this.folder; }
  async pickWorkspacePackage() { return this.workspacePackage; }
  async share(name: string, bytes: Uint8Array, title: string) { this.shared.push({ name, bytes, title }); }
}

function exec(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (value: Buffer) => { stdout += value.toString(); });
    child.stderr.on('data', (value: Buffer) => { stderr += value.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || stdout)));
  });
}

function nativeGitHttpThroughFetch() {
  return createCapacitorGitHttp({
    request: async (options: HttpOptions) => {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: typeof options.data === 'string' ? Buffer.from(options.data, 'base64') : undefined,
      });
      return {
        url: response.url,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data: Buffer.from(await response.arrayBuffer()).toString('base64'),
      };
    },
  }, 'ios');
}

async function startGitServer(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const target = new URL(request.url ?? '/', 'http://127.0.0.1');
    const child = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: decodeURIComponent(target.pathname),
        QUERY_STRING: target.search.slice(1),
        REQUEST_METHOD: request.method ?? 'GET',
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        CONTENT_LENGTH: request.headers['content-length'] ?? '',
        REMOTE_ADDR: request.socket.remoteAddress ?? '127.0.0.1',
      },
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', () => undefined);
    child.on('close', (code) => {
      if (code !== 0) {
        response.writeHead(500).end('Git backend failed');
        return;
      }
      const output = Buffer.concat(chunks);
      const crlfIndex = output.indexOf('\r\n\r\n');
      const lfIndex = output.indexOf('\n\n');
      const separator = crlfIndex >= 0 ? crlfIndex : lfIndex;
      const separatorLength = crlfIndex >= 0 ? 4 : 2;
      const headers = output.subarray(0, separator).toString().split(/\r?\n/);
      let status = 200;
      for (const header of headers) {
        const index = header.indexOf(':');
        if (index < 0) continue;
        const name = header.slice(0, index);
        const value = header.slice(index + 1).trim();
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else response.setHeader(name, value);
      }
      response.writeHead(status);
      response.end(output.subarray(separator + separatorLength));
    });
    request.pipe(child.stdin);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Git server did not start');
  return { server, url: `http://127.0.0.1:${address.port}/workspace.git` };
}

async function seedRemote(root: string, document: unknown): Promise<void> {
  const seed = path.join(root, 'seed');
  const bare = path.join(root, 'workspace.git');
  await mkdir(path.join(seed, '.kanbanos'), { recursive: true });
  await exec('git', ['init', '-b', 'main'], seed);
  await writeFile(path.join(seed, '.kanbanos', 'workspace.json'), `${JSON.stringify(document, null, 2)}\n`);
  await exec('git', ['add', '.kanbanos'], seed);
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Seed'], seed);
  await exec('git', ['init', '--bare', bare]);
  await exec('git', ['config', 'http.receivepack', 'true'], bare);
  await exec('git', ['remote', 'add', 'origin', bare], seed);
  await exec('git', ['push', '-u', 'origin', 'main'], seed);
  await exec('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
}

function service(
  name: string,
  settings = new MemorySettings(),
  nativeFiles = new MemoryNativeFiles(),
  http?: ReturnType<typeof createCapacitorGitHttp>,
) {
  return {
    settings,
    nativeFiles,
    value: new MobileGitWorkspaceService({
      fs: new LightningFS(name, { wipe: true }),
      settings,
      credentials: new MemoryCredentials(),
      nativeFiles,
      ...(http ? { http } : {}),
    }),
  };
}

let temporaryDirectories: string[] = [];
let servers: Server[] = [];

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('mobile Git workspace', () => {
  it('keeps system status-bar content readable in every mobile theme', () => {
    expect(mobileStatusBarAppearance('dark', 'android')).toMatchObject({ style: 'LIGHT', backgroundColor: '#f5f6f8' });
    expect(mobileStatusBarAppearance('light', 'android')).toMatchObject({ style: 'LIGHT', backgroundColor: '#f5f6f8' });
    expect(mobileStatusBarAppearance('dark', 'ios')).toMatchObject({ style: 'DARK', backgroundColor: '#343943' });
  });

  it('preserves binary Git request and response bytes through Capacitor HTTP', async () => {
    const request = vi.fn().mockResolvedValue({
      url: 'https://example.com/workspace.git/git-receive-pack',
      status: 200,
      headers: { 'Content-Type': 'application/x-git-receive-pack-result' },
      data: btoa(String.fromCharCode(0, 255, 1, 128)),
    });
    const client = createCapacitorGitHttp({ request });
    async function* requestBody() {
      yield new Uint8Array([0, 255]);
      yield new Uint8Array([1, 128]);
    }

    const response = await client.request({
      url: 'https://example.com/workspace.git/git-receive-pack',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-git-receive-pack-request' },
      body: requestBody(),
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: btoa(String.fromCharCode(0, 255, 1, 128)),
      dataType: 'file',
      responseType: 'arraybuffer',
    }));
    const responseBytes: number[] = [];
    for await (const chunk of response.body!) responseBytes.push(...chunk);
    expect(responseBytes).toEqual([0, 255, 1, 128]);
  });

  it('commits successfully in a WebView without a built-in Node Buffer global', async () => {
    const originalBuffer = globalThis.Buffer;
    Reflect.deleteProperty(globalThis, 'Buffer');
    try {
      const current = service(`mobile-buffer-${crypto.randomUUID()}`).value;
      await current.createLocal('WebView runtime');
      await expect(current.saveWorkspace({ version: 4, marker: 'buffer polyfilled' })).resolves.toMatchObject({ status: 'local-only' });
      expect(globalThis.Buffer).toBeDefined();
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it('reads a selected directory while the mobile picker still grants access', async () => {
    const selection = pickBrowserFolder();
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
    expect(input).not.toBeNull();
    const file = new File(['mobile brief'], 'brief.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'references/nested/brief.txt' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input!.dispatchEvent(new Event('change'));

    await expect(selection).resolves.toMatchObject({
      name: 'references',
      files: [{ relativePath: 'nested/brief.txt', size: 12 }],
    });
    expect(document.querySelector('input[webkitdirectory]')).not.toBeInTheDocument();
  });

  it('persists a local commit and reloads it after reopening the app', async () => {
    const settings = new MemorySettings();
    const fs = new LightningFS(`mobile-local-${crypto.randomUUID()}`, { wipe: true });
    const first = new MobileGitWorkspaceService({ fs, settings, credentials: new MemoryCredentials(), nativeFiles: new MemoryNativeFiles() });
    const connection = await first.createLocal('Phone plans');
    const result = await first.saveWorkspace({ version: 4, workspace: { name: 'Phone plans' }, items: { one: { title: 'Durable task' } } });

    expect(result).toMatchObject({ status: 'local-only', message: 'Saved to the local Git repository.' });
    await first.disconnect();

    settings.value = { ...settings.value!, active: connection };
    const reopened = new MobileGitWorkspaceService({ fs, settings, credentials: new MemoryCredentials(), nativeFiles: new MemoryNativeFiles() });
    await expect(reopened.restoreConnection()).resolves.toMatchObject({ displayName: 'Phone plans' });
    await expect(reopened.loadWorkspace()).resolves.toMatchObject({ items: { one: { title: 'Durable task' } } });

    await reopened.removeRecentConnection(connection.repositoryPath);
    await expect(reopened.listRecentConnections()).resolves.toEqual([]);
    await expect(reopened.openRecentConnection(connection.repositoryPath)).rejects.toThrow('moved or is no longer available');
    await expect(reopened.fs.promises.stat(connection.repositoryPath)).rejects.toThrow();
  });

  it('imports, previews, exports, and removes mobile attachments', async () => {
    const nativeFiles = new MemoryNativeFiles();
    nativeFiles.files = [
      { name: 'notes.md', size: 16, bytes: new TextEncoder().encode('# Mobile notes\n') },
      { name: 'photo.png', size: 4, bytes: new Uint8Array([137, 80, 78, 71]) },
    ];
    nativeFiles.folder = {
      name: 'references',
      files: [
        { relativePath: 'brief.txt', size: 5, bytes: new TextEncoder().encode('brief') },
        { relativePath: 'brief?.txt', size: 3, bytes: new TextEncoder().encode('one') },
        { relativePath: 'brief*.txt', size: 3, bytes: new TextEncoder().encode('two') },
      ],
    };
    const current = service(`mobile-files-${crypto.randomUUID()}`, new MemorySettings(), nativeFiles).value;
    await current.createLocal('Files');

    const [file, image] = await current.importFiles();
    const [folder] = await current.importFolder();
    await expect(current.previewAttachment(image.relativePath)).resolves.toMatchObject({ type: 'image', url: 'blob:preview' });
    await expect(current.previewAttachment(file.relativePath)).resolves.toMatchObject({ type: 'markdown', content: '# Mobile notes\n' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    await expect(current.previewAttachment(folder.relativePath)).resolves.toMatchObject({
      type: 'folder',
      entries: expect.arrayContaining([
        expect.objectContaining({ name: 'brief.txt', kind: 'file' }),
        expect.objectContaining({ name: 'brief_.txt', kind: 'file' }),
        expect.objectContaining({ name: 'brief_-2.txt', kind: 'file' }),
      ]),
    });

    await current.shareAttachment(folder.relativePath);
    expect(nativeFiles.shared[0]).toMatchObject({ name: 'references.zip' });
    await current.removeAttachment(file.id);
    await expect(current.previewAttachment(file.relativePath)).rejects.toThrow('no longer available');

    nativeFiles.files = Array.from({ length: 10_001 }, (_, index) => ({
      name: `file-${index}.txt`,
      size: 0,
      bytes: new Uint8Array(),
    }));
    await expect(current.importFiles()).rejects.toThrow('contains too many files');
  });

  it('round-trips an exported workspace package into a new mobile repository', async () => {
    const exporter = new MemoryNativeFiles();
    const source = service(`mobile-export-${crypto.randomUUID()}`, new MemorySettings(), exporter).value;
    await source.createLocal('Portable');
    await source.saveWorkspace({ version: 4, workspace: { name: 'Portable' }, marker: 'kept' });
    await source.exportWorkspace();
    const packageZip = await JSZip.loadAsync(exporter.shared[0].bytes);
    packageZip.file('.kanbanos/credentials.json', '{"token":"must-not-import"}');
    packageZip.file('.kanbanos/.gitignore', '*\n');
    const hardenedPackage = await packageZip.generateAsync({ type: 'uint8array' });

    const importer = new MemoryNativeFiles();
    importer.workspacePackage = { name: exporter.shared[0].name, bytes: hardenedPackage };
    const target = service(`mobile-import-${crypto.randomUUID()}`, new MemorySettings(), importer).value;
    const imported = await target.importWorkspacePackage();
    expect(imported).toMatchObject({ displayName: 'Portable' });
    await expect(target.loadWorkspace()).resolves.toMatchObject({ marker: 'kept' });
    await expect(target.fs.promises.readFile(`${imported!.repositoryPath}/.kanbanos/.gitignore`, 'utf8')).resolves.toBe('/credentials.json\n');
    await expect(target.fs.promises.stat(`${imported!.repositoryPath}/.kanbanos/credentials.json`)).rejects.toThrow();
  });

  it('clones, pushes, detects a competing edit, and resolves it on mobile', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kanbanos-mobile-git-'));
    temporaryDirectories.push(root);
    await seedRemote(root, { version: 4, marker: 'base' });
    const remote = await startGitServer(root);
    servers.push(remote.server);

    const firstFiles = new MemoryNativeFiles();
    firstFiles.files = [{ name: 'synced.md', size: 14, bytes: new TextEncoder().encode('# Synced file\n') }];
    firstFiles.folder = { name: 'empty-reference', files: [] };
    const nativeHttp = nativeGitHttpThroughFetch();
    const first = service(`mobile-remote-a-${crypto.randomUUID()}`, new MemorySettings(), firstFiles, nativeHttp).value;
    const second = service(`mobile-remote-b-${crypto.randomUUID()}`, new MemorySettings(), new MemoryNativeFiles(), nativeHttp).value;
    await first.connectRemote(remote.url);
    await second.connectRemote(remote.url);
    const [syncedAttachment] = await first.importFiles();
    const [emptyAttachment] = await first.importFolder();

    await expect(first.saveWorkspace({ version: 4, marker: 'first device' })).resolves.toMatchObject({ status: 'synced' });
    const conflict = await second.saveWorkspace({ version: 4, marker: 'second device' });
    expect(conflict).toMatchObject({ status: 'conflict' });
    expect(conflict.conflicts?.map((entry) => entry.path)).toContain('.kanbanos/workspace.json');

    await expect(second.resolveConflicts('remote')).resolves.toMatchObject({ status: 'synced' });
    await expect(second.loadWorkspace()).resolves.toMatchObject({ marker: 'first device' });
    await expect(second.previewAttachment(syncedAttachment.relativePath)).resolves.toMatchObject({ type: 'markdown', content: '# Synced file\n' });
    await expect(second.previewAttachment(emptyAttachment.relativePath)).resolves.toMatchObject({ type: 'folder', entries: [] });

    const third = service(`mobile-remote-c-${crypto.randomUUID()}`).value;
    const fourth = service(`mobile-remote-d-${crypto.randomUUID()}`).value;
    await third.connectRemote(remote.url);
    await fourth.connectRemote(remote.url);
    await expect(third.saveWorkspace({ version: 4, marker: 'third device' })).resolves.toMatchObject({ status: 'synced' });
    await expect(fourth.saveWorkspace({ version: 4, marker: 'kept locally' })).resolves.toMatchObject({ status: 'conflict' });
    await expect(fourth.resolveConflicts('local')).resolves.toMatchObject({ status: 'synced' });
    await expect(fourth.loadWorkspace()).resolves.toMatchObject({ marker: 'kept locally' });
  }, 30_000);

  it('keeps binary attachment conflicts resolvable without exposing binary contents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kanbanos-mobile-binary-'));
    temporaryDirectories.push(root);
    await seedRemote(root, { version: 4, marker: 'base' });
    const remote = await startGitServer(root);
    servers.push(remote.server);
    const first = service(`mobile-binary-a-${crypto.randomUUID()}`).value;
    const second = service(`mobile-binary-b-${crypto.randomUUID()}`).value;
    const firstConnection = await first.connectRemote(remote.url);
    const secondConnection = await second.connectRemote(remote.url);
    const relativePath = '.kanbanos/content/attachments/shared/photo.bin';
    const prepare = async (current: MobileGitWorkspaceService, repositoryPath: string, value: Uint8Array) => {
      const fs = current.fs.promises;
      await fs.mkdir(`${repositoryPath}/.kanbanos/content`);
      await fs.mkdir(`${repositoryPath}/.kanbanos/content/attachments`);
      await fs.mkdir(`${repositoryPath}/.kanbanos/content/attachments/shared`);
      await fs.writeFile(`${repositoryPath}/${relativePath}`, value);
    };
    await prepare(first, firstConnection.repositoryPath, new Uint8Array([0, 1, 2, 3]));
    await prepare(second, secondConnection.repositoryPath, new Uint8Array([0, 8, 9, 10]));

    await expect(first.saveWorkspace({ version: 4, marker: 'first binary' })).resolves.toMatchObject({ status: 'synced' });
    const conflict = await second.saveWorkspace({ version: 4, marker: 'second binary' });
    expect(conflict).toMatchObject({ status: 'conflict' });
    expect(conflict.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: relativePath, contentOmitted: true }),
    ]));
    await expect(second.resolveConflicts('remote')).resolves.toMatchObject({ status: 'synced' });
    await expect(second.fs.promises.readFile(`${secondConnection.repositoryPath}/${relativePath}`).then(Array.from)).resolves.toEqual([0, 1, 2, 3]);
  }, 30_000);

  it('converts common SSH remotes to mobile-compatible HTTPS without changing desktop support', () => {
    expect(normalizeMobileRemoteUrl('git@example.com:team/workspace.git')).toBe('https://example.com/team/workspace.git');
    expect(normalizeMobileRemoteUrl('ssh://git@example.com/team/workspace.git')).toBe('https://example.com/team/workspace.git');
    expect(() => normalizeMobileRemoteUrl('ftp://example.com/workspace.git')).toThrow('HTTPS Git repository URL');
    expect(() => normalizeMobileRemoteUrl('http://127.0.0.1/workspace.git', false)).toThrow('HTTPS Git repository URL');
  });
});
