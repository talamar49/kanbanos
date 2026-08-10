import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DATA_DIRECTORY = '.kanbanos';
const WORKSPACE_FILE = `${DATA_DIRECTORY}/workspace.json`;
const SETTINGS_FILE = 'connection.json';

type GitResult = { stdout: string; stderr: string; code: number };

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

function runGit(cwd: string, args: string[], allowFailure = false): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_MERGE_AUTOEDIT: 'no',
      },
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

function friendlyGitError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  if (/authentication|could not read Username|permission denied/i.test(value)) {
    return 'Git could not authenticate. Check your repository credentials or SSH key.';
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

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), SETTINGS_FILE);
  }

  async restoreConnection(): Promise<RepositoryConnection | null> {
    const settings = await this.readSettings();
    const saved = settings.active;
    if (!saved || !(await exists(path.join(saved.repositoryPath, '.git')))) return null;
    this.connection = saved;
    return saved;
  }

  async listRecentConnections(): Promise<RepositoryConnection[]> {
    const settings = await this.readSettings();
    const available: RepositoryConnection[] = [];
    for (const connection of settings.recent) {
      if (await exists(path.join(connection.repositoryPath, '.git'))) available.push(connection);
    }
    if (available.length !== settings.recent.length) {
      await this.writeSettings({
        ...settings,
        active: settings.active && available.some((item) => item.repositoryPath === settings.active?.repositoryPath)
          ? settings.active
          : null,
        recent: available,
      });
    }
    return available;
  }

  async openRecentConnection(repositoryPath: string): Promise<RepositoryConnection> {
    const settings = await this.readSettings();
    const connection = settings.recent.find((item) => item.repositoryPath === repositoryPath);
    if (!connection || !(await exists(path.join(repositoryPath, '.git')))) {
      throw new Error('This workspace folder was moved or is no longer available.');
    }
    return this.remember(connection);
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

  async connectRemote(remoteUrl: string): Promise<RepositoryConnection> {
    const url = remoteUrl.trim();
    if (!url) throw new Error('Enter a Git repository URL.');

    const key = createHash('sha256').update(url).digest('hex').slice(0, 12);
    const root = path.join(app.getPath('userData'), 'repositories');
    const repositoryPath = path.join(root, `${repositoryName(url)}-${key}`);
    await fs.mkdir(root, { recursive: true });

    if (await exists(path.join(repositoryPath, '.git'))) {
      await runGit(repositoryPath, ['remote', 'set-url', 'origin', url], true);
      await runGit(repositoryPath, ['fetch', 'origin'], true);
    } else {
      if (await exists(repositoryPath)) await fs.rm(repositoryPath, { recursive: true, force: true });
      await runGit(root, ['clone', '--', url, repositoryPath]);
    }

    return this.remember({ repositoryPath, remoteUrl: url, displayName: repositoryName(url) });
  }

  async addRemote(remoteUrl: string): Promise<RepositoryConnection> {
    const repository = this.requireConnection();
    const url = remoteUrl.trim();
    if (!url) throw new Error('Enter a Git repository URL.');

    const current = await runGit(repository.repositoryPath, ['remote', 'get-url', 'origin'], true);
    if (current.code === 0) {
      await runGit(repository.repositoryPath, ['remote', 'set-url', 'origin', url]);
    } else {
      await runGit(repository.repositoryPath, ['remote', 'add', 'origin', url]);
    }
    return this.remember({ ...repository, remoteUrl: url });
  }

  async connectLocal(repositoryPath: string): Promise<RepositoryConnection> {
    if (!(await exists(path.join(repositoryPath, '.git')))) {
      throw new Error('Choose a folder that contains a Git repository.');
    }
    const remote = await runGit(repositoryPath, ['remote', 'get-url', 'origin'], true);
    return this.remember({
      repositoryPath,
      remoteUrl: remote.code === 0 ? remote.stdout : undefined,
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
      await runGit(cwd, ['add', '--', WORKSPACE_FILE]);
      const changed = await runGit(cwd, ['diff', '--cached', '--quiet', '--', WORKSPACE_FILE], true);
      if (changed.code !== 0) {
        await this.commit(
          cwd,
          `Update workspace · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          [WORKSPACE_FILE],
        );
      }

      const branch = await this.currentBranch(cwd);
      const remote = await runGit(cwd, ['remote', 'get-url', 'origin'], true);
      if (remote.code !== 0 || !remote.stdout) {
        return {
          status: 'local-only',
          message: 'Saved to the local Git repository.',
          commit: await this.head(cwd),
          document: await this.loadWorkspace(),
        };
      }

      const fetched = await runGit(cwd, ['fetch', 'origin'], true);
      if (fetched.code !== 0) {
        return {
          status: 'error',
          message: friendlyGitError(new Error(fetched.stderr || fetched.stdout)),
          commit: await this.head(cwd),
          document: await this.loadWorkspace(),
        };
      }

      await runGit(cwd, ['remote', 'set-head', 'origin', '--auto'], true);
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
      const pushed = await runGit(cwd, ['push', '-u', 'origin', pushRef], true);
      if (pushed.code !== 0) {
        return {
          status: 'error',
          message: friendlyGitError(new Error(pushed.stderr || pushed.stdout)),
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
    const pushed = await runGit(cwd, ['push', '-u', 'origin', pushRef], true);
    if (pushed.code !== 0) {
      return {
        status: 'error',
        message: friendlyGitError(new Error(pushed.stderr || pushed.stdout)),
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
