import { copyFile, mkdir, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

export type DiagnosticLevel = 'info' | 'error';

export type DiagnosticEntry = {
  timestamp: string;
  level: DiagnosticLevel;
  scope: string;
  message: string;
  details?: string;
};

type Options = {
  maxBytes?: number;
  maxEntries?: number;
};

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 25_000;
const RETAINED_BYTES = 20 * 1024 * 1024;

function bounded(value: string, maximum: number): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:token|password|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/authorization:\s*[^\r\n]+/gi, 'Authorization: [redacted]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maximum);
}

export class DiagnosticsLog {
  private pending = Promise.resolve();
  private entryCount: number | null = null;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(private readonly directory: string | (() => string), options: Options = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  private get filePath(): string {
    const directory = typeof this.directory === 'function' ? this.directory() : this.directory;
    return path.join(directory, 'diagnostics.log');
  }

  record(entry: Omit<DiagnosticEntry, 'timestamp'> & { timestamp?: string }): Promise<void> {
    const value: DiagnosticEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      level: entry.level === 'error' ? 'error' : 'info',
      scope: bounded(entry.scope || 'app', 80),
      message: bounded(entry.message || 'Operation completed.', 1_000),
      ...(entry.details ? { details: bounded(entry.details, 4_000) } : {}),
    };
    this.pending = this.pending.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      if (this.entryCount === null) this.entryCount = (await this.content()).split(/\r?\n/).filter(Boolean).length;
      await appendFile(this.filePath, `${JSON.stringify(value)}\n`, 'utf8');
      this.entryCount += 1;
      await this.trim();
    }).catch(() => undefined);
    return this.pending;
  }

  async list(limit = 2_000): Promise<DiagnosticEntry[]> {
    await this.pending;
    const content = await this.content();
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(limit, this.maxEntries)))
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as DiagnosticEntry;
          return typeof entry.timestamp === 'string' && typeof entry.message === 'string' ? [entry] : [];
        } catch {
          return [];
        }
      });
  }

  async export(destination: string): Promise<void> {
    await this.pending;
    try {
      await copyFile(this.filePath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFile(destination, '', 'utf8');
    }
  }

  clear(): Promise<void> {
    this.pending = this.pending.then(async () => {
      await rm(this.filePath, { force: true });
      this.entryCount = 0;
    }).catch(() => undefined);
    return this.pending;
  }

  private async content(): Promise<string> {
    try {
      return await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  private async trim(): Promise<void> {
    const size = await stat(this.filePath).then((value) => value.size).catch(() => 0);
    if (size <= this.maxBytes && (this.entryCount ?? 0) <= this.maxEntries) return;
    const lines = (await this.content()).split(/\r?\n/).filter(Boolean);
    const kept: string[] = [];
    let bytes = 0;
    for (const line of lines.slice(-this.maxEntries).reverse()) {
      const nextBytes = Buffer.byteLength(line, 'utf8') + 1;
      if (kept.length > 0 && bytes + nextBytes > Math.min(RETAINED_BYTES, this.maxBytes)) break;
      kept.push(line);
      bytes += nextBytes;
    }
    this.entryCount = kept.length;
    await writeFile(this.filePath, `${kept.reverse().join('\n')}\n`, 'utf8');
  }
}
