import { app, safeStorage } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DATA_DIRECTORY = '.kanbanos';
const WORKSPACE_FILE = `${DATA_DIRECTORY}/workspace.json`;
const ATTACHMENTS_DIRECTORY = `${DATA_DIRECTORY}/content/attachments`;
const SETTINGS_FILE = 'connection.json';
const CREDENTIALS_FILE = 'credentials.json';

type GitResult = { stdout: string; stderr: string; code: number };

export type GitCredentials = {
  username: string;
  token: string;
};

export type RepositoryConnection = {
  repositoryPath: string;
  remoteUrl?: string;
  displayName: string;
};

type ConnectionSettings = {
  version: 1;
  active: RepositoryConnection | null;
  recent: RepositoryConnection[];
};

type CredentialSettings = {
  version: 1;
  credentials: Record<string, string>;
};

export type GitConflict = {
  path: string;
  localContent: string;
  remoteContent: string;
};

export type SaveResult = {
  status: 'synced' | 'local-only' | 'conflict' | 'error';
  message: string;
  commit?: string;
  conflicts?: GitConflict[];
  document?: unknown;
};

export type ImportedAttachment = {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  relativePath: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
};

type AttachmentStats = Pick<ImportedAttachment, 'kind' | 'sizeBytes' | 'fileCount'>;

function runGit(
  cwd: string,
  args: string[],
  allowFailure = false,
  credentials?: GitCredentials,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_MERGE_AUTOEDIT: 'no',
    };

    if (credentials?.token) {
      const configuredCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
      const configIndex = Number.isFinite(configuredCount) ? configuredCount : 0;
      env.GIT_CONFIG_COUNT = String(configIndex + 1);
      env[`GIT_CONFIG_KEY_${configIndex}`] = 'http.extraHeader';
      env[`GIT_CONFIG_VALUE_${configIndex}`] = `Authorization: Basic ${Buffer.from(
        `${credentials.username}:${credentials.token}`,
        'utf8',
      ).toString('base64')}`;
    }

    const child = spawn('git', args, {
      cwd,
      env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 };
      if (result.code !== 0 && !allowFailure) {
        reject(new Error(result.stderr || result.stdout || `Git exited with code ${result.code}`));
      } else {
        resolve(result);
      }
    });
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function attachmentName(value: string): string {
  const clean = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+$/, '_')
    .trim()
    .slice(0, 160);
  return clean || 'attachment';
}

async function inspectAttachmentSource(source: string): Promise<AttachmentStats> {
  const stats = await fs.lstat(source);
  if (stats.isSymbolicLink()) throw new Error('Symbolic links cannot be attached.');
  if (stats.isFile()) return { kind: 'file', sizeBytes: stats.size, fileCount: 1 };
  if (!stats.isDirectory()) throw new Error('Only files and folders can be attached.');

  let sizeBytes = 0;
  let fileCount = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const file = await fs.stat(target);
        sizeBytes += file.size;
        fileCount += 1;
      }
    }
  };
  await visit(source);
  return { kind: 'folder', sizeBytes, fileCount };
}

function normalizeCredentials(credentials?: GitCredentials): GitCredentials | undefined {
  const token = credentials?.token.trim();
  if (!token) return undefined;
  return {
    username: credentials?.username.trim() || 'oauth2',
    token,
  };
}

function prepareRemote(
  remoteUrl: string,
  suppliedCredentials?: GitCredentials,
): { url: string; credentials?: GitCredentials } {
  let url = remoteUrl.trim();
  let credentials = normalizeCredentials(suppliedCredentials);

  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol) && parsed.password) {
      if (!credentials) {
        credentials = normalizeCredentials({
          username: decodeURIComponent(parsed.username) || 'oauth2',
          token: decodeURIComponent(parsed.password),
        });
      }
      parsed.username = '';
      parsed.password = '';
      url = parsed.toString();
    }
  } catch {
    // SCP-style SSH remotes (git@host:path) are valid without URL parsing.
  }

  return { url, credentials };
}

function credentialKey(remoteUrl: string): string {
  return createHash('sha256').update(remoteUrl).digest('hex');
}

function repositoryName(value: string): string {
  let source = value.trim();
  try {
    source = new URL(source).pathname;
  } catch {
    source = source.split(/[?#]/, 1)[0];
  }
  const clean = source.replace(/[\\/]$/, '').split(/[\\/]/).pop() ?? 'Workspace';
  const name = clean
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
  return name || 'Workspace';
}

function friendlyGitError(error: unknown, operation: 'read' | 'write' = 'read'): string {
  const value = error instanceof Error ? error.message : String(error);
  if (/authentication|authorization|could not read (Username|Password)|access denied|HTTP 401/i.test(value)) {
    return 'Git could not authenticate. Check the username, token, or SSH key.';
  }
  if (/not allowed to push|write access.*not granted|protected branch|pre-receive hook declined/i.test(value)
    || (operation === 'write' && /HTTP 403|requested URL returned error: 403/i.test(value))) {
    return 'The repository was reached, but you do not have permission to push. Use a token with write access and check that the branch is not protected.';
  }
  if (/permission denied/i.test(value)) {
    return 'Git could not authenticate. Check the username, token, or SSH key.';
  }
  if (/not found|does not appear to be a git repository/i.test(value)) {
    return 'That Git repository could not be found or is not accessible.';
  }
  if (/could not resolve|unable to access|connection/i.test(value)) {
    return 'The repository is offline. Your work is still safe on this device.';
  }
  return value;
}

export class GitWorkspaceService {
  private connection: RepositoryConnection | null = null;
  private sessionCredentials = new Map<string, GitCredentials>();

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE);
  }

  private get credentialsPath(): string {
    return path.join(app.getPath('userData'), CREDENTIALS_FILE);
  }

  async restoreConnection(): Promise<RepositoryConnection | null> {
    const settings = await this.readSettings();
    const saved = settings.active;
    if (!saved || !(await exists(path.join(saved.repositoryPath, '.git')))) return null;
    const connection = await this.sanitizeConnection(saved);
    if (connection.remoteUrl !== saved.remoteUrl) return this.remember(connection);
    this.connection = connection;
    return connection;
  }

  async listRecentConnections(): Promise<RepositoryConnection[]> {
    const settings = await this.readSettings();
    const available: RepositoryConnection[] = [];
    for (const connection of settings.recent) {
      if (await exists(path.join(connection.repositoryPath, '.git'))) {
        available.push(await this.sanitizeConnection(connection));
      }
    }
    const active = settings.active
      ? available.find((item) => item.repositoryPath === settings.active?.repositoryPath) ?? null
      : null;
    if (available.length !== settings.recent.length
      || active?.remoteUrl !== settings.active?.remoteUrl
      || available.some((item, index) => item.remoteUrl !== settings.recent[index]?.remoteUrl)) {
      await this.writeSettings({ ...settings, active, recent: available });
    }
    return available;
  }

  async openRecentConnection(repositoryPath: string): Promise<RepositoryConnection> {
    const settings = await this.readSettings();
    const connection = settings.recent.find((item) => item.repositoryPath === repositoryPath);
    if (!connection || !(await exists(path.join(repositoryPath, '.git')))) {
      throw new Error('This workspace folder was moved or is no longer available.');
    }
    return this.remember(await this.sanitizeConnection(connection));
  }

  async removeRecentConnection(repositoryPath: string): Promise<void> {
    const settings = await this.readSettings();
    if (this.connection?.repositoryPath === repositoryPath) this.connection = null;
    await this.writeSettings({
      ...settings,
      active: settings.active?.repositoryPath === repositoryPath ? null : settings.active,
      recent: settings.recent.filter((item) => item.repositoryPath !== repositoryPath),
    });
  }

  async createLocal(displayName: string, parentDirectory?: string): Promise<RepositoryConnection> {
    const name = displayName.trim();
    if (!name) throw new Error('Give your workspace a name.');

    const root = parentDirectory ?? path.join(app.getPath('documents'), 'Kanbanos');
    const folderName = repositoryName(name);
    let repositoryPath = path.join(root, folderName);
    let suffix = 2;
    while (await exists(repositoryPath)) {
      repositoryPath = path.join(root, `${folderName}-${suffix}`);
      suffix += 1;
    }

    await fs.mkdir(repositoryPath, { recursive: true });
    const initialized = await runGit(repositoryPath, ['init', '-b', 'main'], true);
    if (initialized.code !== 0) {
      await runGit(repositoryPath, ['init']);
      await runGit(repositoryPath, ['branch', '-m', 'main'], true);
    }
    return this.remember({ repositoryPath, displayName: name });
  }

  async connectRemote(remoteUrl: string, suppliedCredentials?: GitCredentials): Promise<RepositoryConnection> {
    const prepared = prepareRemote(remoteUrl, suppliedCredentials);
    const url = prepared.url;
    if (!url) throw new Error('Enter a Git repository URL.');
    const credentials = prepared.credentials ?? await this.getCredentials(url);

    const key = createHash('sha256').update(url).digest('hex').slice(0, 12);
    const root = path.join(app.getPath('userData'), 'repositories');
    const repositoryPath = path.join(root, `${repositoryName(url)}-${key}`);
    await fs.mkdir(root, { recursive: true });
    const repositoryAlreadyExists = await exists(path.join(repositoryPath, '.git'));

    try {
      if (repositoryAlreadyExists) {
        await runGit(repositoryPath, ['remote', 'set-url', 'origin', url]);
        const fetched = await runGit(repositoryPath, ['fetch', 'origin'], true, credentials);
        if (fetched.code !== 0) throw new Error(fetched.stderr || fetched.stdout);
      } else {
        if (await exists(repositoryPath)) await fs.rm(repositoryPath, { recursive: true, force: true });
        await runGit(root, ['clone', '--', url, repositoryPath], false, credentials);
      }
    } catch (error) {
      if (!repositoryAlreadyExists && await exists(repositoryPath)) {
        await fs.rm(repositoryPath, { recursive: true, force: true });
      }
      throw new Error(friendlyGitError(error));
    }

    if (prepared.credentials) await this.storeCredentials(url, prepared.credentials);
    return this.remember({ repositoryPath, remoteUrl: url, displayName: repositoryName(url) });
  }

  async addRemote(remoteUrl: string, suppliedCredentials?: GitCredentials): Promise<RepositoryConnection> {
    const repository = this.requireConnection();
    const prepared = prepareRemote(remoteUrl, suppliedCredentials);
    const url = prepared.url;
    if (!url) throw new Error('Enter a Git repository URL.');

    try {
      const credentials = prepared.credentials ?? await this.getCredentials(url);
      const reachable = await runGit(repository.repositoryPath, ['ls-remote', '--', url], true, credentials);
      if (reachable.code !== 0) throw new Error(reachable.stderr || reachable.stdout);

      const current = await runGit(repository.repositoryPath, ['remote', 'get-url', 'origin'], true);
      if (current.code === 0) {
        await runGit(repository.repositoryPath, ['remote', 'set-url', 'origin', url]);
      } else {
        await runGit(repository.repositoryPath, ['remote', 'add', 'origin', url]);
      }
    } catch (error) {
      throw new Error(friendlyGitError(error));
    }
    if (prepared.credentials) await this.storeCredentials(url, prepared.credentials);
    return this.remember({ ...repository, remoteUrl: url });
  }

  async connectLocal(repositoryPath: string): Promise<RepositoryConnection> {
    if (!(await exists(path.join(repositoryPath, '.git')))) {
      throw new Error('Choose a folder that contains a Git repository.');
    }
    const remote = await this.getRemoteAccess(repositoryPath);
    return this.remember({
      repositoryPath,
      remoteUrl: remote?.url,
      displayName: repositoryName(repositoryPath),
    });
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    const settings = await this.readSettings();
    await this.writeSettings({ ...settings, active: null });
  }

  async loadWorkspace(): Promise<unknown | null> {
    const repository = this.requireConnection();
    return readJson(path.join(repository.repositoryPath, WORKSPACE_FILE));
  }

  async saveWorkspace(document: unknown): Promise<SaveResult> {
    const repository = this.requireConnection();
    const cwd = repository.repositoryPath;

    const unresolved = await this.listConflicts(cwd);
    if (unresolved.length > 0) {
      return {
        status: 'conflict',
        message: 'Choose which version to keep before saving again.',
        conflicts: await this.describeConflicts(cwd, unresolved),
      };
    }

    const dataDirectory = path.join(cwd, DATA_DIRECTORY);
    const destination = path.join(cwd, WORKSPACE_FILE);
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = `${destination}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);

    try {
      await runGit(cwd, ['add', '-A', '--', DATA_DIRECTORY]);
      const changed = await runGit(cwd, ['diff', '--cached', '--quiet', '--', DATA_DIRECTORY], true);
      if (changed.code !== 0) {
        await this.commit(
          cwd,
          `Update workspace · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          [DATA_DIRECTORY],
        );
      }

      const branch = await this.currentBranch(cwd);
      const remote = await this.getRemoteAccess(cwd);
      if (!remote) {
        return {
          status: 'local-only',
          message: 'Saved to the local Git repository.',
          commit: await this.head(cwd),
          document: await this.loadWorkspace(),
        };
      }

      const fetched = await runGit(cwd, ['fetch', 'origin'], true, remote.credentials);
      if (fetched.code !== 0) {
        return {
          status: 'error',
          message: friendlyGitError(new Error(fetched.stderr || fetched.stdout)),
          commit: await this.head(cwd),
          document: await this.loadWorkspace(),
        };
      }

      await runGit(cwd, ['remote', 'set-head', 'origin', '--auto'], true, remote.credentials);
      const remoteBranch = await this.findRemoteBranch(cwd, branch);
      if (remoteBranch) {
        const merged = await runGit(
          cwd,
          ['merge', '--no-edit', '--allow-unrelated-histories', `origin/${remoteBranch}`],
          true,
        );
        if (merged.code !== 0) {
          const conflicts = await this.listConflicts(cwd);
          if (conflicts.length > 0) {
            return {
              status: 'conflict',
              message: 'This workspace was changed somewhere else. Pick the version to keep.',
              conflicts: await this.describeConflicts(cwd, conflicts),
            };
          }
          throw new Error(merged.stderr || merged.stdout);
        }
      }

      const pushRef = remoteBranch && remoteBranch !== branch ? `${branch}:${remoteBranch}` : branch;
      const pushed = await runGit(cwd, ['push', '-u', 'origin', pushRef], true, remote.credentials);
      if (pushed.code !== 0) {
        return {
          status: 'error',
          message: friendlyGitError(new Error(pushed.stderr || pushed.stdout), 'write'),
          commit: await this.head(cwd),
          document: await this.loadWorkspace(),
        };
      }

      return {
        status: 'synced',
        message: 'Everything is saved and in sync.',
        commit: await this.head(cwd),
        document: await this.loadWorkspace(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: friendlyGitError(error),
        document,
      };
    }
  }

  async resolveConflicts(strategy: 'local' | 'remote'): Promise<SaveResult> {
    const repository = this.requireConnection();
    const cwd = repository.repositoryPath;
    const conflicts = await this.listConflicts(cwd);
    if (conflicts.length === 0) throw new Error('There are no conflicts to resolve.');

    const checkoutFlag = strategy === 'local' ? '--ours' : '--theirs';
    for (const file of conflicts) {
      await runGit(cwd, ['checkout', checkoutFlag, '--', file]);
      await runGit(cwd, ['add', '--', file]);
    }
    await this.commit(cwd, `Resolve workspace conflict · keep ${strategy} version`);

    const branch = await this.currentBranch(cwd);
    const remoteBranch = await this.findRemoteBranch(cwd, branch);
    const pushRef = remoteBranch && remoteBranch !== branch ? `${branch}:${remoteBranch}` : branch;
    const remote = await this.getRemoteAccess(cwd);
    const pushed = await runGit(cwd, ['push', '-u', 'origin', pushRef], true, remote?.credentials);
    if (pushed.code !== 0) {
      return {
        status: 'error',
        message: friendlyGitError(new Error(pushed.stderr || pushed.stdout), 'write'),
        commit: await this.head(cwd),
        document: await this.loadWorkspace(),
      };
    }

    return {
      status: 'synced',
      message: 'Conflict resolved. Your workspace is in sync.',
      commit: await this.head(cwd),
      document: await this.loadWorkspace(),
    };
  }

  async importAttachments(sourcePaths: string[]): Promise<ImportedAttachment[]> {
    const repository = this.requireConnection();
    const cwd = repository.repositoryPath;
    const root = path.join(cwd, ATTACHMENTS_DIRECTORY);
    await fs.mkdir(root, { recursive: true });

    const imported: ImportedAttachment[] = [];
    try {
      for (const source of sourcePaths) {
        const stats = await inspectAttachmentSource(source);
        const id = randomUUID();
        const name = attachmentName(path.basename(source));
        const attachmentDirectory = path.join(root, id);
        const destination = path.join(attachmentDirectory, name);
        await fs.mkdir(attachmentDirectory, { recursive: true });
        try {
          await fs.cp(source, destination, {
            recursive: stats.kind === 'folder',
            errorOnExist: true,
            force: false,
            filter: async (candidate) => !(await fs.lstat(candidate)).isSymbolicLink(),
          });
          imported.push({
            id,
            name,
            kind: stats.kind,
            relativePath: path.relative(cwd, destination).split(path.sep).join('/'),
            sizeBytes: stats.sizeBytes,
            fileCount: stats.fileCount,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          await fs.rm(attachmentDirectory, { recursive: true, force: true });
          throw error;
        }
      }
      return imported;
    } catch (error) {
      await Promise.all(imported.map((attachment) => fs.rm(path.join(root, attachment.id), { recursive: true, force: true })));
      throw error;
    }
  }

  async resolveAttachmentPath(relativePath: string): Promise<string> {
    const repository = this.requireConnection();
    const root = path.resolve(repository.repositoryPath, ATTACHMENTS_DIRECTORY);
    const target = path.resolve(repository.repositoryPath, relativePath);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) {
      throw new Error('That attachment path is outside the workspace attachment store.');
    }
    if (!(await exists(target))) throw new Error('That attachment is no longer available.');
    return target;
  }

  async removeAttachment(attachmentId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(attachmentId)) throw new Error('That attachment identifier is invalid.');
    const repository = this.requireConnection();
    const root = path.resolve(repository.repositoryPath, ATTACHMENTS_DIRECTORY);
    const target = path.resolve(root, attachmentId);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('That attachment path is invalid.');
    await fs.rm(target, { recursive: true, force: true });
  }

  private async sanitizeConnection(connection: RepositoryConnection): Promise<RepositoryConnection> {
    if (!connection.remoteUrl) return connection;
    const prepared = prepareRemote(connection.remoteUrl);
    if (prepared.url === connection.remoteUrl) return connection;

    if (prepared.credentials) await this.storeCredentials(prepared.url, prepared.credentials);
    await runGit(connection.repositoryPath, ['remote', 'set-url', 'origin', prepared.url], true);
    return { ...connection, remoteUrl: prepared.url };
  }

  private async getRemoteAccess(
    repositoryPath: string,
  ): Promise<{ url: string; credentials?: GitCredentials } | null> {
    const remote = await runGit(repositoryPath, ['remote', 'get-url', 'origin'], true);
    if (remote.code !== 0 || !remote.stdout) return null;

    const prepared = prepareRemote(remote.stdout);
    if (prepared.url !== remote.stdout) {
      await runGit(repositoryPath, ['remote', 'set-url', 'origin', prepared.url]);
    }
    if (prepared.credentials) await this.storeCredentials(prepared.url, prepared.credentials);

    return {
      url: prepared.url,
      credentials: prepared.credentials ?? await this.getCredentials(prepared.url),
    };
  }

  private async readCredentialSettings(): Promise<CredentialSettings> {
    const raw = await readJson(this.credentialsPath);
    if (!raw || typeof raw !== 'object') return { version: 1, credentials: {} };
    const candidate = raw as Partial<CredentialSettings>;
    if (candidate.version !== 1 || !candidate.credentials || typeof candidate.credentials !== 'object') {
      return { version: 1, credentials: {} };
    }
    const credentials = Object.fromEntries(
      Object.entries(candidate.credentials).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    return { version: 1, credentials };
  }

  private async getCredentials(remoteUrl: string): Promise<GitCredentials | undefined> {
    const key = credentialKey(remoteUrl);
    const active = this.sessionCredentials.get(key);
    if (active) return active;
    if (!safeStorage.isEncryptionAvailable()) return undefined;

    try {
      const settings = await this.readCredentialSettings();
      const encrypted = settings.credentials[key];
      if (!encrypted) return undefined;
      const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as GitCredentials;
      const credentials = normalizeCredentials(parsed);
      if (credentials) this.sessionCredentials.set(key, credentials);
      return credentials;
    } catch {
      return undefined;
    }
  }

  private async storeCredentials(remoteUrl: string, suppliedCredentials: GitCredentials): Promise<void> {
    const credentials = normalizeCredentials(suppliedCredentials);
    if (!credentials) return;
    const key = credentialKey(remoteUrl);
    this.sessionCredentials.set(key, credentials);
    if (!safeStorage.isEncryptionAvailable()) return;

    try {
      const settings = await this.readCredentialSettings();
      settings.credentials[key] = safeStorage
        .encryptString(JSON.stringify(credentials))
        .toString('base64');
      await fs.mkdir(path.dirname(this.credentialsPath), { recursive: true });
      await fs.writeFile(this.credentialsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Keep the credential in memory when secure persistence is unavailable.
    }
  }

  private async readSettings(): Promise<ConnectionSettings> {
    const raw = await readJson(this.settingsPath);
    if (!raw || typeof raw !== 'object') return { version: 1, active: null, recent: [] };

    const candidate = raw as Partial<ConnectionSettings> & Partial<RepositoryConnection>;
    if (candidate.version === 1 && Array.isArray(candidate.recent)) {
      return {
        version: 1,
        active: candidate.active ?? null,
        recent: candidate.recent.filter((item) =>
          Boolean(item?.repositoryPath && item?.displayName),
        ),
      };
    }

    // Migrate the original single-workspace settings format.
    if (candidate.repositoryPath && candidate.displayName) {
      const connection: RepositoryConnection = {
        repositoryPath: candidate.repositoryPath,
        displayName: candidate.displayName,
        remoteUrl: candidate.remoteUrl,
      };
      return { version: 1, active: connection, recent: [connection] };
    }
    return { version: 1, active: null, recent: [] };
  }

  private async writeSettings(settings: ConnectionSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  private async remember(connection: RepositoryConnection): Promise<RepositoryConnection> {
    this.connection = connection;
    const settings = await this.readSettings();
    const recent = [
      connection,
      ...settings.recent.filter((item) => item.repositoryPath !== connection.repositoryPath),
    ].slice(0, 10);
    await this.writeSettings({ version: 1, active: connection, recent });
    return connection;
  }

  private requireConnection(): RepositoryConnection {
    if (!this.connection) throw new Error('Connect a Git repository first.');
    return this.connection;
  }

  private async commit(cwd: string, message: string, files?: string[]): Promise<void> {
    const args = [
      '-c',
      'user.name=Kanbanos',
      '-c',
      'user.email=workspace@kanbanos.app',
      'commit',
    ];
    if (files?.length) args.push('--only');
    args.push('-m', message);
    if (files?.length) args.push('--', ...files);
    await runGit(cwd, args);
  }

  private async currentBranch(cwd: string): Promise<string> {
    const branch = await runGit(cwd, ['symbolic-ref', '--short', 'HEAD'], true);
    if (branch.code === 0 && branch.stdout) return branch.stdout;
    await runGit(cwd, ['checkout', '-b', 'main']);
    return 'main';
  }

  private async findRemoteBranch(cwd: string, localBranch: string): Promise<string | null> {
    const matching = await runGit(
      cwd,
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${localBranch}`],
      true,
    );
    if (matching.code === 0) return localBranch;

    const remoteHead = await runGit(
      cwd,
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      true,
    );
    if (remoteHead.code === 0 && remoteHead.stdout.startsWith('origin/')) {
      return remoteHead.stdout.slice('origin/'.length);
    }

    const branches = await runGit(
      cwd,
      ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'],
      true,
    );
    const names = branches.stdout
      .split(/\r?\n/)
      .filter((name) => name && name !== 'origin/HEAD')
      .map((name) => name.replace(/^origin\//, ''));
    return names.length === 1 ? names[0] : null;
  }

  private async head(cwd: string): Promise<string | undefined> {
    const result = await runGit(cwd, ['rev-parse', '--short', 'HEAD'], true);
    return result.code === 0 ? result.stdout : undefined;
  }

  private async listConflicts(cwd: string): Promise<string[]> {
    const result = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U'], true);
    return result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
  }

  private async describeConflicts(cwd: string, files: string[]): Promise<GitConflict[]> {
    return Promise.all(
      files.map(async (file) => {
        const [local, remote] = await Promise.all([
          runGit(cwd, ['show', `:2:${file}`], true),
          runGit(cwd, ['show', `:3:${file}`], true),
        ]);
        return { path: file, localContent: local.stdout, remoteContent: remote.stdout };
      }),
    );
  }
}
