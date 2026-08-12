import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticsLog } from './diagnostics';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('persistent diagnostics log', () => {
  it('retains recent, redacted events and exports them for analysis', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbanos-diagnostics-'));
    temporaryDirectories.push(directory);
    const diagnostics = new DiagnosticsLog(directory, { maxBytes: 500, maxEntries: 3 });

    await diagnostics.record({ scope: 'sync', message: 'Saving workspace.' });
    await diagnostics.record({
      level: 'error',
      scope: 'git',
      message: 'Remote rejected https://alex:secret@example.com/workspace.git?access_token=abc',
      details: 'Authorization: Basic secret',
    });
    await diagnostics.record({ scope: 'workspace', message: 'Workspace action applied.', details: 'addItem' });
    await diagnostics.record({ scope: 'workspace', message: 'Workspace opened.' });

    const entries = await diagnostics.list();
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.message)).toEqual([
      expect.stringContaining('Remote rejected'),
      'Workspace action applied.',
      'Workspace opened.',
    ]);
    expect(entries[0]).toMatchObject({
      level: 'error',
      message: expect.not.stringContaining('secret'),
      details: 'Authorization: [redacted]',
    });

    const destination = path.join(directory, 'exported.log');
    await diagnostics.export(destination);
    await expect(fs.readFile(destination, 'utf8')).resolves.toContain('Workspace opened.');
    await diagnostics.clear();
    await expect(diagnostics.list()).resolves.toEqual([]);
  });
});
