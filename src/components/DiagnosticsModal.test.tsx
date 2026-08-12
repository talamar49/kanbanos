import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithPreferences } from '../test/render';
import { DiagnosticsModal } from './DiagnosticsModal';

describe('diagnostics modal', () => {
  it('shows retained activity and exports or clears it on request', async () => {
    const user = userEvent.setup();
    const diagnostics = {
      list: vi.fn().mockResolvedValue([{
        timestamp: '2027-02-03T04:05:06.000Z',
        level: 'error' as const,
        scope: 'git',
        message: 'Saving workspace failed.',
        details: 'remote: File exceeds 100 MiB',
      }]),
      record: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue('/tmp/kanbanos-diagnostics.log'),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    window.kanbanos = { diagnostics } as unknown as Window['kanbanos'];
    const onNotify = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithPreferences(<DiagnosticsModal onClose={vi.fn()} onNotify={onNotify} />);

    expect(await screen.findByText('remote: File exceeds 100 MiB')).toBeInTheDocument();
    expect(screen.getByText('Saving workspace failed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export log' }));
    await waitFor(() => expect(diagnostics.export).toHaveBeenCalledWith('en'));
    expect(onNotify).toHaveBeenCalledWith('Diagnostic log exported.');

    await user.click(screen.getByRole('button', { name: 'Clear logs' }));
    await waitFor(() => expect(diagnostics.clear).toHaveBeenCalled());
    expect(screen.getByText('No diagnostic events yet')).toBeInTheDocument();
  });
});
