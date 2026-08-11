import LightningFS from '@isomorphic-git/lightning-fs';
import { Buffer as BrowserBuffer } from 'buffer';
import git, { Errors, type HttpClient } from 'isomorphic-git';
import webHttp from 'isomorphic-git/http/web';
import JSZip from 'jszip';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor, CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { createMobileAttachmentPreview } from './mobile-preview';

const SETTINGS_KEY = 'kanbanos.mobile.connections.v1';
const FILE_SYSTEM_NAME = 'kanbanos-mobile-v1';
const DATA_DIRECTORY = '.kanbanos';
const WORKSPACE_FILE = `${DATA_DIRECTORY}/workspace.json`;
const ATTACHMENTS_DIRECTORY = `${DATA_DIRECTORY}/content/attachments`;
const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const MAX_IMPORT_FILES = 10_000;
const EMPTY_FOLDER_MARKER = '.kanbanos-folder';
const AUTHOR = { name: 'Kanbanos Mobile', email: 'workspace@kanbanos.app' };

type MobileFs = InstanceType<typeof LightningFS>;
type MobileFsPromises = MobileFs['promises'];

type PendingConflict = {
  repositoryPath: string;
  branch: string;
  remoteBranch: string;
  localOid: string;
  remoteOid: string;
  files: string[];
};

export type ConnectionSettings = {
  version: 1;
  active: RepositoryConnection | null;
  recent: RepositoryConnection[];
  pendingConflicts?: Record<string, PendingConflict>;
};

export interface MobileSettingsStore {
  read(): Promise<ConnectionSettings | null>;
  write(settings: ConnectionSettings): Promise<void>;
}

export interface MobileCredentialStore {
  get(key: string): Promise<GitCredentials | null>;
  set(key: string, credentials: GitCredentials): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface MobileNativeFiles {
  pickFiles(): Promise<Array<{ name: string; size: number; bytes: Uint8Array }>>;
  pickFolder(): Promise<{ name: string; files: Array<{ relativePath: string; size: number; bytes: Uint8Array }> } | null>;
  pickWorkspacePackage(): Promise<{ name: string; bytes: Uint8Array } | null>;
  share(name: string, bytes: Uint8Array, title: string): Promise<void>;
}

export type MobileServiceOptions = {
  fs?: MobileFs;
  settings?: MobileSettingsStore;
  credentials?: MobileCredentialStore;
  http?: HttpClient;
  nativeFiles?: MobileNativeFiles;
};

class CapacitorSettingsStore implements MobileSettingsStore {
  async read(): Promise<ConnectionSettings | null> {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (!value) return null;
    try {
      return JSON.parse(value) as ConnectionSettings;
    } catch {
      return null;
    }
  }

  async write(settings: ConnectionSettings): Promise<void> {
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
  }
}

class SecureCredentialStore implements MobileCredentialStore {
  async get(key: string): Promise<GitCredentials | null> {
    const value = await SecureStorage.get(key);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.token === 'string' && typeof candidate.username === 'string'
      ? { username: candidate.username, token: candidate.token }
      : null;
  }

  async set(key: string, credentials: GitCredentials): Promise<void> {
    await SecureStorage.set(key, credentials);
  }

  async remove(key: string): Promise<void> {
    await SecureStorage.remove(key);
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let output = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < value.length; index += chunkSize) {
    output += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }
  return btoa(output);
}

type NativeHttpRequester = Pick<typeof CapacitorHttp, 'request'>;

async function collectRequestBody(body?: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array | null> {
  if (!body) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function nativeResponseBytes(response: HttpResponse, platform: string): Uint8Array {
  if (response.data instanceof ArrayBuffer) return new Uint8Array(response.data);
  if (ArrayBuffer.isView(response.data)) {
    return new Uint8Array(response.data.buffer, response.data.byteOffset, response.data.byteLength);
  }
  if (typeof response.data !== 'string') return new TextEncoder().encode(JSON.stringify(response.data ?? ''));
  return platform === 'android' && response.status >= 400 ? new TextEncoder().encode(response.data) : base64ToBytes(response.data);
}

export function createCapacitorGitHttp(
  nativeHttp: NativeHttpRequester = CapacitorHttp,
  platform = Capacitor.getPlatform(),
): HttpClient {
  return {
    request: async (request) => {
      const signal = request.signal as AbortSignal | undefined;
      if (signal?.aborted) throw new DOMException('The Git request was cancelled.', 'AbortError');
      const requestBody = await collectRequestBody(request.body);
      const headers = { ...request.headers };
      if (requestBody && !Object.keys(headers).some((name) => name.toLocaleLowerCase('en-US') === 'content-type')) {
        headers['Content-Type'] = 'application/octet-stream';
      }
      const options: HttpOptions = {
        url: request.url,
        method: request.method ?? 'GET',
        headers,
        responseType: 'arraybuffer',
        connectTimeout: 300_000,
        readTimeout: 300_000,
        ...(requestBody ? { data: bytesToBase64(requestBody), dataType: 'file' as const } : {}),
      };
      const response = await nativeHttp.request(options);
      if (signal?.aborted) throw new DOMException('The Git request was cancelled.', 'AbortError');
      const bytes = nativeResponseBytes(response, platform);
      async function* body() {
        if (bytes.length > 0) yield bytes;
      }
      return {
        url: response.url || request.url,
        method: request.method,
        headers: Object.fromEntries(Object.entries(response.headers ?? {}).map(([name, value]) => [name.toLocaleLowerCase('en-US'), String(value)])),
        body: body(),
        statusCode: response.status,
        statusMessage: `HTTP ${response.status}`,
      };
    },
  };
}

async function pickedFileBytes(file: PickedFile): Promise<Uint8Array> {
  if (file.blob) return new Uint8Array(await file.blob.arrayBuffer());
  if (file.data) return base64ToBytes(file.data);
  if (!file.path) throw new Error('The selected file is no longer available.');
  const result = await Filesystem.readFile({ path: file.path });
  if (result.data instanceof Blob) return new Uint8Array(await result.data.arrayBuffer());
  return base64ToBytes(result.data);
}

export async function pickBrowserFolder(): Promise<{ name: string; files: Array<{ relativePath: string; size: number; bytes: Uint8Array }> } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.hidden = true;
    document.body.append(input);
    let settled = false;
    const finish = (value: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      if (!value?.length) {
        resolve(null);
        return;
      }
      const firstPath = value[0].webkitRelativePath || value[0].name;
      const rootName = firstPath.split('/').filter(Boolean)[0] || 'folder';
      void Promise.all(value.map(async (file) => {
        const sourcePath = file.webkitRelativePath || file.name;
        const segments = sourcePath.split('/').filter(Boolean);
        const relativePath = (segments[0] === rootName ? segments.slice(1) : segments).join('/') || file.name;
        return { relativePath, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
      })).then((files) => resolve({ name: rootName, files }));
    };
    const onFocus = () => window.setTimeout(() => finish(null), 650);
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

class CapacitorNativeFiles implements MobileNativeFiles {
  async pickFiles(): Promise<Array<{ name: string; size: number; bytes: Uint8Array }>> {
    try {
      const result = await FilePicker.pickFiles({ limit: 0, readData: false });
      return Promise.all(result.files.map(async (file) => ({
        name: file.name,
        size: file.size,
        bytes: await pickedFileBytes(file),
      })));
    } catch (error) {
      if (/cancel/i.test(error instanceof Error ? error.message : String(error))) return [];
      throw error;
    }
  }

  async pickFolder(): Promise<{ name: string; files: Array<{ relativePath: string; size: number; bytes: Uint8Array }> } | null> {
    return pickBrowserFolder();
  }

  async pickWorkspacePackage(): Promise<{ name: string; bytes: Uint8Array } | null> {
    try {
      const result = await FilePicker.pickFiles({
        limit: 1,
        readData: false,
        types: ['application/zip', 'application/json', 'application/octet-stream'],
      });
      const file = result.files[0];
      return file ? { name: file.name, bytes: await pickedFileBytes(file) } : null;
    } catch (error) {
      if (/cancel/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
  }

  async share(name: string, bytes: Uint8Array, title: string): Promise<void> {
    const result = await Filesystem.writeFile({
      path: `kanbanos-exports/${name}`,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    });
    try {
      await Share.share({ title, files: [result.uri], dialogTitle: title });
    } finally {
      await Filesystem.deleteFile({ path: `kanbanos-exports/${name}`, directory: Directory.Cache }).catch(() => undefined);
    }
  }
}

function emptySettings(): ConnectionSettings {
  return { version: 1, active: null, recent: [] };
}

function normalizeCredentials(credentials?: GitCredentials | null): GitCredentials | undefined {
  const token = credentials?.token.trim();
  if (!token) return undefined;
  return { username: credentials?.username.trim() || 'oauth2', token };
}

export function normalizeMobileRemoteUrl(remoteUrl: string, allowLoopback = !Capacitor.isNativePlatform()): string {
  const source = remoteUrl.trim();
  if (!source) throw new Error('Enter a Git repository URL.');
  const scp = source.includes('://') ? null : source.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
  const candidate = scp ? `https://${scp[1]}/${scp[2].replace(/^\/+/, '')}` : source;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'ssh:') {
      const pathname = parsed.pathname.replace(/^\/+/, '');
      return `https://${parsed.hostname}/${pathname}`;
    }
    const loopbackHttp = allowLoopback && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !loopbackHttp) throw new Error('Mobile sync requires an HTTPS Git repository URL.');
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message === 'Mobile sync requires an HTTPS Git repository URL.') throw error;
    throw new Error('Mobile sync requires an HTTPS Git repository URL.');
  }
}

function prepareRemote(remoteUrl: string, suppliedCredentials?: GitCredentials | null): { url: string; credentials?: GitCredentials } {
  const source = remoteUrl.trim();
  let credentials = normalizeCredentials(suppliedCredentials);
  const url = normalizeMobileRemoteUrl(source);
  try {
    const supplied = new URL(source);
    if (supplied.password && !credentials) {
      credentials = normalizeCredentials({
        username: decodeURIComponent(supplied.username) || 'oauth2',
        token: decodeURIComponent(supplied.password),
      });
    }
  } catch {
    // SCP-style SSH remotes are normalized to HTTPS and authenticate with a token when needed.
  }
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  return { url: parsed.toString(), credentials };
}

function repositoryName(value: string): string {
  let source = value.trim();
  try {
    source = new URL(source).pathname;
  } catch {
    source = source.split(/[?#]/, 1)[0];
  }
  const clean = source.replace(/[\\/]$/, '').split(/[\\/]/).pop() ?? 'Workspace';
  const name = clean.replace(/\.git$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^\.+|\.+$/g, '').slice(0, 64);
  return name || 'Workspace';
}

async function digestKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function credentialKey(repositoryPath: string, remoteUrl: string): Promise<string> {
  return `kanbanos.git.${await digestKey(`${repositoryPath}\u0000${remoteUrl}`)}`;
}

function announcedZipSize(entry: JSZip.JSZipObject): number {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0;
}

function cleanAttachmentName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').trim().slice(0, 160);
  return clean || 'attachment';
}

function uniqueAttachmentPath(relativePath: string, usedPaths: Set<string>): string {
  const key = relativePath.toLocaleLowerCase('en-US');
  if (!usedPaths.has(key)) {
    usedPaths.add(key);
    return relativePath;
  }
  const directory = pathDirname(relativePath);
  const filename = relativePath.split('/').at(-1) ?? 'attachment';
  const extensionIndex = filename.lastIndexOf('.');
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : '';
  for (let index = 2; ; index += 1) {
    const candidate = pathJoin(directory, `${stem}-${index}${extension}`);
    const candidateKey = candidate.toLocaleLowerCase('en-US');
    if (!usedPaths.has(candidateKey)) {
      usedPaths.add(candidateKey);
      return candidate;
    }
  }
}

function friendlyGitError(error: unknown, operation: 'read' | 'write' = 'read'): string {
  const value = error instanceof Error ? error.message : String(error);
  if (/authentication|authorization|401|invalid.*credential/i.test(value)) {
    return 'Git could not authenticate. Check the username or token.';
  }
  if (/403|not allowed to push|write access|protected branch/i.test(value) && operation === 'write') {
    return 'The repository was reached, but you do not have permission to push. Use a token with write access and check that the branch is not protected.';
  }
  if (/not found|404|NotFoundError/i.test(value)) return 'That Git repository could not be found or is not accessible.';
  if (/network|fetch|offline|connection|resolve|timed out|timeout/i.test(value)) {
    return 'The repository is offline. Your work is still safe on this device.';
  }
  return value;
}

function isMissing(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  return value?.code === 'ENOENT' || /no such file|not found/i.test(value?.message ?? '');
}

function pathJoin(...parts: string[]): string {
  const absolute = parts[0]?.startsWith('/');
  const segments = parts.join('/').split('/').filter((part) => part && part !== '.');
  const output: string[] = [];
  for (const segment of segments) {
    if (segment === '..') output.pop();
    else output.push(segment);
  }
  return `${absolute ? '/' : ''}${output.join('/')}`;
}

function pathDirname(value: string): string {
  const parts = value.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function managedRelativePath(value: string): string {
  const normalized = pathJoin('/', value).slice(1);
  if (normalized !== DATA_DIRECTORY && !normalized.startsWith(`${DATA_DIRECTORY}/`)) {
    throw new Error('That attachment path is outside this workspace.');
  }
  return normalized;
}

async function exists(fs: MobileFsPromises, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function mkdirp(fs: MobileFsPromises, path: string): Promise<void> {
  const absolute = path.startsWith('/');
  const segments = path.split('/').filter(Boolean);
  let current = absolute ? '' : '.';
  for (const segment of segments) {
    current = `${current}/${segment}`;
    if (!(await exists(fs, current))) await fs.mkdir(current);
  }
}

async function removeTree(fs: MobileFsPromises, path: string): Promise<void> {
  if (!(await exists(fs, path))) return;
  const stats = await fs.lstat(path);
  if (!stats.isDirectory()) {
    await fs.unlink(path);
    return;
  }
  for (const child of await fs.readdir(path)) await removeTree(fs, pathJoin(path, child));
  await fs.rmdir(path);
}

async function listTree(fs: MobileFsPromises, root: string): Promise<string[]> {
  if (!(await exists(fs, root))) return [];
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const stats = await fs.lstat(path);
    if (!stats.isDirectory()) {
      files.push(path);
      return;
    }
    for (const child of await fs.readdir(path)) await visit(pathJoin(path, child));
  };
  await visit(root);
  return files;
}

async function readBlobAt(fs: MobileFs, dir: string, oid: string, filepath: string): Promise<Uint8Array | null> {
  try {
    return (await git.readBlob({ fs, dir, oid, filepath })).blob;
  } catch (error) {
    if (isMissing(error) || /Could not find|not found/i.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}

async function writeOrRemove(fs: MobileFsPromises, absolutePath: string, value: Uint8Array | null): Promise<void> {
  if (value === null) {
    if (await exists(fs, absolutePath)) await removeTree(fs, absolutePath);
    return;
  }
  await mkdirp(fs, pathDirname(absolutePath));
  await fs.writeFile(absolutePath, value);
}

function bytesToPreview(value: Uint8Array | null): { content: string; omitted?: boolean; truncated?: boolean } {
  if (!value) return { content: '' };
  const max = 1024 * 1024;
  const source = value.subarray(0, max);
  const content = new TextDecoder().decode(source);
  if (/\u0000/.test(content)) return { content: '', omitted: true };
  return { content, truncated: value.length > max || undefined };
}

export class MobileGitWorkspaceService {
  readonly fs: MobileFs;
  private readonly settingsStore: MobileSettingsStore;
  private readonly credentialStore: MobileCredentialStore;
  private readonly http: HttpClient;
  private readonly nativeFiles: MobileNativeFiles;
  private connection: RepositoryConnection | null = null;
  private previewObjectUrl: string | null = null;

  constructor(options: MobileServiceOptions = {}) {
    globalThis.Buffer ??= BrowserBuffer;
    this.fs = options.fs ?? new LightningFS(FILE_SYSTEM_NAME);
    this.settingsStore = options.settings ?? new CapacitorSettingsStore();
    this.credentialStore = options.credentials ?? new SecureCredentialStore();
    this.http = options.http ?? (Capacitor.isNativePlatform() ? createCapacitorGitHttp() : webHttp);
    this.nativeFiles = options.nativeFiles ?? new CapacitorNativeFiles();
  }

  private async readSettings(): Promise<ConnectionSettings> {
    const stored = await this.settingsStore.read();
    return stored?.version === 1 ? stored : emptySettings();
  }

  private async writeSettings(settings: ConnectionSettings): Promise<void> {
    await this.settingsStore.write(settings);
  }

  private async remember(connection: RepositoryConnection): Promise<RepositoryConnection> {
    this.connection = connection;
    const settings = await this.readSettings();
    await this.writeSettings({
      ...settings,
      active: connection,
      recent: [connection, ...settings.recent.filter((item) => item.repositoryPath !== connection.repositoryPath)].slice(0, 12),
    });
    return connection;
  }

  private requireConnection(): RepositoryConnection {
    if (!this.connection) throw new Error('No workspace is connected.');
    return this.connection;
  }

  private async flush(): Promise<void> {
    await this.fs.promises.flush();
  }

  private async credentialsFor(connection: RepositoryConnection): Promise<GitCredentials | null> {
    return connection.remoteUrl
      ? this.credentialStore.get(await credentialKey(connection.repositoryPath, connection.remoteUrl))
      : null;
  }

  private auth(credentials: GitCredentials | null | undefined) {
    return credentials ? () => ({ username: credentials.username || 'oauth2', password: credentials.token }) : undefined;
  }

  private async remoteBranch(branch: string, fetchDefault?: string | null): Promise<string> {
    const candidate = fetchDefault?.replace(/^refs\/heads\//, '');
    if (candidate) return candidate;
    return branch;
  }

  async restoreConnection(): Promise<RepositoryConnection | null> {
    const settings = await this.readSettings();
    if (!settings.active || !(await exists(this.fs.promises, pathJoin(settings.active.repositoryPath, '.git')))) {
      this.connection = null;
      if (settings.active) await this.writeSettings({ ...settings, active: null });
      return null;
    }
    this.connection = settings.active;
    return settings.active;
  }

  async listRecentConnections(): Promise<RepositoryConnection[]> {
    const settings = await this.readSettings();
    const available: RepositoryConnection[] = [];
    for (const connection of settings.recent) {
      if (await exists(this.fs.promises, pathJoin(connection.repositoryPath, '.git'))) available.push(connection);
    }
    if (available.length !== settings.recent.length) {
      await this.writeSettings({
        ...settings,
        active: settings.active && available.some((item) => item.repositoryPath === settings.active?.repositoryPath) ? settings.active : null,
        recent: available,
      });
    }
    return available;
  }

  async openRecentConnection(repositoryPath: string): Promise<RepositoryConnection> {
    const settings = await this.readSettings();
    const connection = settings.recent.find((item) => item.repositoryPath === repositoryPath);
    if (!connection || !(await exists(this.fs.promises, pathJoin(repositoryPath, '.git')))) {
      throw new Error('This workspace folder was moved or is no longer available.');
    }
    return this.remember(connection);
  }

  async removeRecentConnection(repositoryPath: string): Promise<void> {
    const settings = await this.readSettings();
    const removed = settings.recent.find((item) => item.repositoryPath === repositoryPath);
    if (removed?.remoteUrl) await this.credentialStore.remove(await credentialKey(repositoryPath, removed.remoteUrl));
    await removeTree(this.fs.promises, repositoryPath);
    if (this.connection?.repositoryPath === repositoryPath) this.connection = null;
    await this.writeSettings({
      ...settings,
      active: settings.active?.repositoryPath === repositoryPath ? null : settings.active,
      recent: settings.recent.filter((item) => item.repositoryPath !== repositoryPath),
      pendingConflicts: Object.fromEntries(
        Object.entries(settings.pendingConflicts ?? {}).filter(([path]) => path !== repositoryPath),
      ),
    });
  }

  async createLocal(displayName: string): Promise<RepositoryConnection> {
    const name = displayName.trim();
    if (!name) throw new Error('Give your workspace a name.');
    const repositoryPath = `/workspaces/${crypto.randomUUID()}`;
    await mkdirp(this.fs.promises, repositoryPath);
    await git.init({ fs: this.fs, dir: repositoryPath, defaultBranch: 'main' });
    await mkdirp(this.fs.promises, pathJoin(repositoryPath, DATA_DIRECTORY));
    await this.fs.promises.writeFile(pathJoin(repositoryPath, DATA_DIRECTORY, '.gitignore'), '/credentials.json\n', 'utf8');
    await this.flush();
    return this.remember({ repositoryPath, displayName: name });
  }

  async connectRemote(remoteUrl: string, suppliedCredentials?: GitCredentials | null): Promise<RepositoryConnection> {
    const clearCredentials = suppliedCredentials === null;
    const prepared = prepareRemote(remoteUrl, suppliedCredentials);
    const repositoryPath = `/workspaces/${repositoryName(prepared.url)}-${(await digestKey(prepared.url)).slice(0, 16)}`;
    const savedCredentials = await this.credentialStore.get(await credentialKey(repositoryPath, prepared.url));
    const credentials = clearCredentials ? null : prepared.credentials ?? savedCredentials;
    const alreadyExists = await exists(this.fs.promises, pathJoin(repositoryPath, '.git'));
    try {
      if (alreadyExists) {
        await git.addRemote({ fs: this.fs, dir: repositoryPath, remote: 'origin', url: prepared.url, force: true });
        await git.fetch({ fs: this.fs, http: this.http, dir: repositoryPath, remote: 'origin', onAuth: this.auth(credentials) });
      } else {
        if (await exists(this.fs.promises, repositoryPath)) await removeTree(this.fs.promises, repositoryPath);
        await mkdirp(this.fs.promises, pathDirname(repositoryPath));
        await git.clone({
          fs: this.fs,
          http: this.http,
          dir: repositoryPath,
          url: prepared.url,
          remote: 'origin',
          onAuth: this.auth(credentials),
          nonBlocking: true,
          batchSize: 50,
        });
      }
      await this.flush();
    } catch (error) {
      if (!alreadyExists && await exists(this.fs.promises, repositoryPath)) await removeTree(this.fs.promises, repositoryPath);
      throw new Error(friendlyGitError(error));
    }
    const key = await credentialKey(repositoryPath, prepared.url);
    if (clearCredentials) await this.credentialStore.remove(key);
    else if (credentials) await this.credentialStore.set(key, credentials);
    return this.remember({
      repositoryPath,
      remoteUrl: prepared.url,
      displayName: repositoryName(prepared.url),
      privateRemote: Boolean(credentials),
      hasStoredCredentials: Boolean(credentials),
    });
  }

  async importWorkspacePackage(): Promise<RepositoryConnection | null> {
    const selected = await this.nativeFiles.pickWorkspacePackage();
    if (!selected) return null;
    if (selected.bytes.length > MAX_IMPORT_BYTES) throw new Error('That workspace package is too large to import.');
    const displayName = repositoryName(selected.name.replace(/\.(kanbanos\.)?zip$|\.json$/i, ''));
    const connection = await this.createLocal(displayName);
    const dir = connection.repositoryPath;
    try {
      if (/\.json$/i.test(selected.name)) {
        JSON.parse(new TextDecoder().decode(selected.bytes));
        await mkdirp(this.fs.promises, pathJoin(dir, DATA_DIRECTORY));
        await this.fs.promises.writeFile(pathJoin(dir, WORKSPACE_FILE), selected.bytes);
      } else {
        const zip = await JSZip.loadAsync(selected.bytes);
        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        if (entries.length > MAX_IMPORT_FILES) throw new Error('That workspace package contains too many files.');
        if (entries.reduce((total, entry) => total + announcedZipSize(entry), 0) > MAX_IMPORT_BYTES) {
          throw new Error('That workspace package is too large to import.');
        }
        let total = 0;
        for (const entry of entries) {
          const normalized = entry.name.replace(/^\/+/, '').replace(/^\.\//, '');
          const managed = normalized.startsWith(`${DATA_DIRECTORY}/`)
            ? normalized
            : normalized.includes(`/${DATA_DIRECTORY}/`)
              ? normalized.slice(normalized.indexOf(`/${DATA_DIRECTORY}/`) + 1)
              : '';
          const managedLower = managed.toLocaleLowerCase('en-US');
          if (
            !managed
            || managed.includes('..')
            || managedLower === `${DATA_DIRECTORY}/credentials.json`
            || managedLower.startsWith(`${DATA_DIRECTORY}/credentials.json/`)
            || managedLower === `${DATA_DIRECTORY}/.gitignore`
          ) continue;
          const content = await entry.async('uint8array');
          total += content.length;
          if (total > MAX_IMPORT_BYTES) throw new Error('That workspace package is too large to import.');
          const destination = pathJoin(dir, managed);
          await mkdirp(this.fs.promises, pathDirname(destination));
          await this.fs.promises.writeFile(destination, content);
        }
      }
      if (!(await exists(this.fs.promises, pathJoin(dir, WORKSPACE_FILE)))) throw new Error('The package does not contain a Kanbanos workspace.');
      await this.fs.promises.writeFile(pathJoin(dir, DATA_DIRECTORY, '.gitignore'), '/credentials.json\n', 'utf8');
      await this.stageManaged(dir);
      await this.commitIfChanged(dir, 'Import workspace package');
      await this.flush();
      return connection;
    } catch (error) {
      await removeTree(this.fs.promises, dir);
      await this.removeRecentConnection(dir);
      throw error;
    }
  }

  async addRemote(remoteUrl: string, suppliedCredentials?: GitCredentials | null): Promise<RepositoryConnection> {
    const repository = this.requireConnection();
    const clearCredentials = suppliedCredentials === null;
    const prepared = prepareRemote(remoteUrl, suppliedCredentials);
    const oldKey = repository.remoteUrl ? await credentialKey(repository.repositoryPath, repository.remoteUrl) : null;
    const newKey = await credentialKey(repository.repositoryPath, prepared.url);
    const credentials = clearCredentials ? null : prepared.credentials ?? await this.credentialStore.get(newKey);
    try {
      await git.getRemoteInfo({ http: this.http, url: prepared.url, onAuth: this.auth(credentials) });
      await git.addRemote({ fs: this.fs, dir: repository.repositoryPath, remote: 'origin', url: prepared.url, force: true });
    } catch (error) {
      throw new Error(friendlyGitError(error));
    }
    if (oldKey && oldKey !== newKey) await this.credentialStore.remove(oldKey);
    if (clearCredentials) await this.credentialStore.remove(newKey);
    else if (credentials) await this.credentialStore.set(newKey, credentials);
    await this.flush();
    return this.remember({
      ...repository,
      remoteUrl: prepared.url,
      privateRemote: Boolean(credentials),
      hasStoredCredentials: Boolean(credentials),
    });
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    const settings = await this.readSettings();
    await this.writeSettings({ ...settings, active: null });
  }

  async loadWorkspace(): Promise<unknown | null> {
    const repository = this.requireConnection();
    try {
      const value = await this.fs.promises.readFile(pathJoin(repository.repositoryPath, WORKSPACE_FILE), 'utf8');
      return JSON.parse(value);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async stageManaged(dir: string): Promise<void> {
    const matrix = await git.statusMatrix({ fs: this.fs, dir, filepaths: [DATA_DIRECTORY] });
    for (const [filepath, head, workdir] of matrix) {
      if (workdir === 0 && head !== 0) await git.remove({ fs: this.fs, dir, filepath });
      else if (workdir !== 0) await git.add({ fs: this.fs, dir, filepath });
    }
  }

  private async commitIfChanged(dir: string, message: string, parents?: string[]): Promise<string | undefined> {
    const matrix = await git.statusMatrix({ fs: this.fs, dir, filepaths: [DATA_DIRECTORY] });
    if (!matrix.some(([, head, , stage]) => head !== stage)) return undefined;
    return git.commit({ fs: this.fs, dir, message, author: AUTHOR, committer: AUTHOR, parent: parents });
  }

  private async describeConflicts(dir: string, pending: PendingConflict): Promise<GitConflict[]> {
    return Promise.all(pending.files.map(async (filepath) => {
      const [local, remote] = await Promise.all([
        readBlobAt(this.fs, dir, pending.localOid, filepath),
        readBlobAt(this.fs, dir, pending.remoteOid, filepath),
      ]);
      const localPreview = bytesToPreview(local);
      const remotePreview = bytesToPreview(remote);
      return {
        path: filepath,
        localContent: localPreview.content,
        remoteContent: remotePreview.content,
        contentOmitted: localPreview.omitted || remotePreview.omitted,
        contentTruncated: localPreview.truncated || remotePreview.truncated,
      };
    }));
  }

  private async restoreConflictVersions(dir: string, pending: PendingConflict, strategy: 'local' | 'remote'): Promise<void> {
    for (const filepath of pending.files) {
      const oid = strategy === 'local' ? pending.localOid : pending.remoteOid;
      await writeOrRemove(this.fs.promises, pathJoin(dir, filepath), await readBlobAt(this.fs, dir, oid, filepath));
    }
  }

  async saveWorkspace(document: unknown): Promise<SaveResult> {
    const repository = this.requireConnection();
    const dir = repository.repositoryPath;
    const settings = await this.readSettings();
    const existingConflict = settings.pendingConflicts?.[dir];
    if (existingConflict) {
      return {
        status: 'conflict',
        message: 'Choose which version to keep before saving again.',
        conflicts: await this.describeConflicts(dir, existingConflict),
      };
    }

    const destination = pathJoin(dir, WORKSPACE_FILE);
    await mkdirp(this.fs.promises, pathDirname(destination));
    const temporary = `${destination}.tmp`;
    await this.fs.promises.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    if (await exists(this.fs.promises, destination)) await this.fs.promises.unlink(destination);
    await this.fs.promises.rename(temporary, destination);

    try {
      await this.stageManaged(dir);
      const commit = await this.commitIfChanged(dir, `Update workspace · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
      const branch = await git.currentBranch({ fs: this.fs, dir }) ?? 'main';
      const head = await git.resolveRef({ fs: this.fs, dir, ref: branch });
      if (!repository.remoteUrl) {
        await this.flush();
        return { status: 'local-only', message: 'Saved to the local Git repository.', commit: commit ?? head, document: await this.loadWorkspace() };
      }

      const credentials = await this.credentialsFor(repository);
      let fetched;
      try {
        fetched = await git.fetch({ fs: this.fs, http: this.http, dir, remote: 'origin', onAuth: this.auth(credentials), prune: true });
      } catch (error) {
        await this.flush();
        return { status: 'error', message: friendlyGitError(error), commit: head, document: await this.loadWorkspace() };
      }
      const remoteBranch = await this.remoteBranch(branch, fetched.defaultBranch);
      const remoteRef = `remotes/origin/${remoteBranch}`;
      let remoteOid: string;
      try {
        remoteOid = await git.resolveRef({ fs: this.fs, dir, ref: remoteRef });
      } catch {
        remoteOid = '';
      }
      if (remoteOid && remoteOid !== head) {
        try {
          await git.merge({
            fs: this.fs,
            dir,
            ours: branch,
            theirs: remoteRef,
            abortOnConflict: false,
            allowUnrelatedHistories: true,
            author: AUTHOR,
            committer: AUTHOR,
          });
        } catch (error) {
          if (error instanceof Errors.MergeConflictError) {
            const pending: PendingConflict = {
              repositoryPath: dir,
              branch,
              remoteBranch,
              localOid: head,
              remoteOid,
              files: error.data.filepaths.filter((filepath) => filepath === DATA_DIRECTORY || filepath.startsWith(`${DATA_DIRECTORY}/`)),
            };
            await this.restoreConflictVersions(dir, pending, 'local');
            const latestSettings = await this.readSettings();
            await this.writeSettings({
              ...latestSettings,
              pendingConflicts: { ...latestSettings.pendingConflicts, [dir]: pending },
            });
            await this.flush();
            return {
              status: 'conflict',
              message: 'This workspace was changed somewhere else. Pick the version to keep.',
              conflicts: await this.describeConflicts(dir, pending),
            };
          }
          throw error;
        }
      }

      try {
        await git.push({ fs: this.fs, http: this.http, dir, remote: 'origin', ref: branch, remoteRef: remoteBranch, onAuth: this.auth(credentials) });
      } catch (error) {
        await this.flush();
        const latest = await git.resolveRef({ fs: this.fs, dir, ref: branch });
        return { status: 'error', message: friendlyGitError(error, 'write'), commit: latest, document: await this.loadWorkspace() };
      }
      await this.flush();
      const latest = await git.resolveRef({ fs: this.fs, dir, ref: branch });
      return { status: 'synced', message: 'Everything is saved and in sync.', commit: latest, document: await this.loadWorkspace() };
    } catch (error) {
      await this.flush();
      return { status: 'error', message: friendlyGitError(error), document };
    }
  }

  async resolveConflicts(strategy: 'local' | 'remote'): Promise<SaveResult> {
    const repository = this.requireConnection();
    const settings = await this.readSettings();
    const pending = settings.pendingConflicts?.[repository.repositoryPath];
    if (!pending) throw new Error('There are no conflicts to resolve.');
    const dir = repository.repositoryPath;
    await this.restoreConflictVersions(dir, pending, strategy);
    await this.stageManaged(dir);
    await git.commit({
      fs: this.fs,
      dir,
      message: `Resolve workspace conflict · keep ${strategy} version`,
      author: AUTHOR,
      committer: AUTHOR,
      parent: [pending.localOid, pending.remoteOid],
    });
    const pendingConflicts = { ...settings.pendingConflicts };
    delete pendingConflicts[repository.repositoryPath];
    await this.writeSettings({ ...settings, pendingConflicts });
    const credentials = await this.credentialsFor(repository);
    try {
      await git.push({
        fs: this.fs,
        http: this.http,
        dir,
        remote: 'origin',
        ref: pending.branch,
        remoteRef: pending.remoteBranch,
        onAuth: this.auth(credentials),
      });
    } catch (error) {
      await this.flush();
      return {
        status: 'error',
        message: friendlyGitError(error, 'write'),
        commit: await git.resolveRef({ fs: this.fs, dir, ref: pending.branch }),
        document: await this.loadWorkspace(),
      };
    }
    await this.flush();
    return {
      status: 'synced',
      message: 'Conflict resolved. Your workspace is in sync.',
      commit: await git.resolveRef({ fs: this.fs, dir, ref: pending.branch }),
      document: await this.loadWorkspace(),
    };
  }

  private async importFileAttachment(source: { name: string; size: number; bytes: Uint8Array }): Promise<ImportedAttachment> {
    const repository = this.requireConnection();
    const id = crypto.randomUUID();
    const name = cleanAttachmentName(source.name);
    const relativePath = pathJoin(ATTACHMENTS_DIRECTORY, id, name);
    const destination = pathJoin(repository.repositoryPath, relativePath);
    await mkdirp(this.fs.promises, pathDirname(destination));
    await this.fs.promises.writeFile(destination, source.bytes);
    return { id, name, kind: 'file', relativePath, sizeBytes: source.bytes.length, fileCount: 1, createdAt: new Date().toISOString() };
  }

  async importFiles(): Promise<ImportedAttachment[]> {
    const sources = await this.nativeFiles.pickFiles();
    if (sources.length > MAX_IMPORT_FILES) throw new Error('That attachment selection contains too many files.');
    if (sources.reduce((total, source) => total + source.bytes.length, 0) > MAX_IMPORT_BYTES) {
      throw new Error('That attachment selection is too large to import.');
    }
    const imported: ImportedAttachment[] = [];
    try {
      for (const source of sources) imported.push(await this.importFileAttachment(source));
      await this.flush();
      return imported;
    } catch (error) {
      await Promise.all(imported.map((attachment) => this.removeAttachment(attachment.id)));
      throw error;
    }
  }

  async importFolder(): Promise<ImportedAttachment[]> {
    const repository = this.requireConnection();
    const source = await this.nativeFiles.pickFolder();
    if (!source) return [];
    if (source.files.length > MAX_IMPORT_FILES) throw new Error('That attachment selection contains too many files.');
    if (source.files.reduce((total, file) => total + file.bytes.length, 0) > MAX_IMPORT_BYTES) {
      throw new Error('That attachment selection is too large to import.');
    }
    const id = crypto.randomUUID();
    const name = cleanAttachmentName(source.name);
    const root = pathJoin(repository.repositoryPath, ATTACHMENTS_DIRECTORY, id, name);
    let sizeBytes = 0;
    const usedPaths = new Set<string>();
    try {
      await mkdirp(this.fs.promises, root);
      for (const file of source.files) {
        const safeSegments = file.relativePath.split('/').filter((segment) => segment && segment !== '.' && segment !== '..').map(cleanAttachmentName);
        const safeRelativePath = uniqueAttachmentPath(pathJoin(...safeSegments), usedPaths);
        const destination = pathJoin(root, safeRelativePath);
        await mkdirp(this.fs.promises, pathDirname(destination));
        await this.fs.promises.writeFile(destination, file.bytes);
        sizeBytes += file.bytes.length;
      }
      if (source.files.length === 0) await this.fs.promises.writeFile(pathJoin(root, EMPTY_FOLDER_MARKER), new Uint8Array());
      await this.flush();
      return [{
        id,
        name,
        kind: 'folder',
        relativePath: pathJoin(ATTACHMENTS_DIRECTORY, id, name),
        sizeBytes,
        fileCount: source.files.length,
        createdAt: new Date().toISOString(),
      }];
    } catch (error) {
      await removeTree(this.fs.promises, pathJoin(repository.repositoryPath, ATTACHMENTS_DIRECTORY, id));
      throw error;
    }
  }

  private attachmentPath(relativePath: string): string {
    const repository = this.requireConnection();
    const safe = managedRelativePath(relativePath);
    if (!safe.startsWith(`${ATTACHMENTS_DIRECTORY}/`)) throw new Error('That attachment path is outside this workspace.');
    return pathJoin(repository.repositoryPath, safe);
  }

  async previewAttachment(relativePath: string): Promise<AttachmentPreview> {
    const absolutePath = this.attachmentPath(relativePath);
    if (!(await exists(this.fs.promises, absolutePath))) throw new Error('That attachment is no longer available.');
    if (this.previewObjectUrl) {
      URL.revokeObjectURL?.(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    const preview = await createMobileAttachmentPreview(this.fs.promises, absolutePath, managedRelativePath(relativePath));
    if ('url' in preview && preview.url.startsWith('blob:')) this.previewObjectUrl = preview.url;
    return preview;
  }

  private async packagePath(relativePath: string): Promise<{ name: string; bytes: Uint8Array }> {
    const absolute = this.attachmentPath(relativePath);
    const stats = await this.fs.promises.lstat(absolute);
    const name = absolute.split('/').at(-1) ?? 'attachment';
    if (!stats.isDirectory()) return { name, bytes: await this.fs.promises.readFile(absolute) };
    const zip = new JSZip();
    for (const file of await listTree(this.fs.promises, absolute)) {
      if (file === pathJoin(absolute, EMPTY_FOLDER_MARKER)) continue;
      zip.file(file.slice(absolute.length + 1), Uint8Array.from(await this.fs.promises.readFile(file)).buffer);
    }
    return { name: `${name}.zip`, bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
  }

  async shareAttachment(relativePath: string): Promise<void> {
    const packaged = await this.packagePath(relativePath);
    await this.nativeFiles.share(packaged.name, packaged.bytes, `Kanbanos · ${packaged.name}`);
  }

  async removeAttachment(attachmentId: string): Promise<void> {
    if (!/^[\w-]+$/.test(attachmentId)) throw new Error('That attachment could not be removed.');
    const repository = this.requireConnection();
    await removeTree(this.fs.promises, pathJoin(repository.repositoryPath, ATTACHMENTS_DIRECTORY, attachmentId));
    await this.flush();
  }

  async exportWorkspace(): Promise<void> {
    const repository = this.requireConnection();
    const root = pathJoin(repository.repositoryPath, DATA_DIRECTORY);
    const zip = new JSZip();
    for (const file of await listTree(this.fs.promises, root)) {
      const relative = file.slice(repository.repositoryPath.length + 1);
      if (relative.toLocaleLowerCase('en-US') === `${DATA_DIRECTORY}/credentials.json`) continue;
      zip.file(relative, Uint8Array.from(await this.fs.promises.readFile(file)).buffer);
    }
    const value = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const name = `${repositoryName(repository.displayName)}.kanbanos.zip`;
    await this.nativeFiles.share(
      name,
      value,
      document.documentElement.lang === 'he' ? 'ייצוא סביבת העבודה של Kanbanos' : 'Export Kanbanos workspace',
    );
  }
}

let mobileService: MobileGitWorkspaceService | null = null;

export function mobileStatusBarAppearance(theme: 'light' | 'dark', platform = Capacitor.getPlatform()) {
  const android = platform === 'android';
  return {
    style: !android && theme === 'dark' ? Style.Dark : Style.Light,
    backgroundColor: android || theme === 'light' ? '#f5f6f8' : '#343943',
  };
}

export function createMobileBridge(service = new MobileGitWorkspaceService()): NonNullable<Window['kanbanos']> {
  return {
    appearance: {
      setTheme: (theme) => {
        document.documentElement.style.colorScheme = theme;
        const appearance = mobileStatusBarAppearance(theme);
        void StatusBar.setStyle({ style: appearance.style }).catch(() => undefined);
        void StatusBar.setBackgroundColor({ color: appearance.backgroundColor }).catch(() => undefined);
      },
    },
    repository: {
      status: () => service.restoreConnection(),
      listRecent: () => service.listRecentConnections(),
      openRecent: (repositoryPath) => service.openRecentConnection(repositoryPath),
      removeRecent: (repositoryPath) => service.removeRecentConnection(repositoryPath),
      createLocal: (displayName) => service.createLocal(displayName),
      connectRemote: (remoteUrl, credentials) => service.connectRemote(remoteUrl, credentials),
      chooseLocal: () => service.importWorkspacePackage(),
      addRemote: (remoteUrl, credentials) => service.addRemote(remoteUrl, credentials),
      disconnect: () => service.disconnect(),
      reveal: () => service.exportWorkspace(),
    },
    attachments: {
      pickFiles: () => service.importFiles(),
      pickFolders: () => service.importFolder(),
      open: (relativePath) => service.shareAttachment(relativePath),
      reveal: (relativePath) => service.shareAttachment(relativePath),
      preview: (relativePath) => service.previewAttachment(relativePath),
      remove: (attachmentId) => service.removeAttachment(attachmentId),
    },
    workspace: {
      load: () => service.loadWorkspace(),
      save: (workspace) => service.saveWorkspace(workspace),
      resolveConflicts: (strategy) => service.resolveConflicts(strategy),
    },
  };
}

export function installMobileBridge(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  document.documentElement.classList.add('native-mobile', `platform-${Capacitor.getPlatform()}`);
  mobileService ??= new MobileGitWorkspaceService();
  window.kanbanos ??= createMobileBridge(mobileService);
  return true;
}

export function isMobilePlatform(): boolean {
  return Capacitor.isNativePlatform() || document.documentElement.classList.contains('native-mobile');
}
