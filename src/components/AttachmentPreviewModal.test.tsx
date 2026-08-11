import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '../domain/types';
import { renderWithPreferences } from '../test/render';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';

const attachment: WorkspaceAttachment = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'references',
  kind: 'folder',
  relativePath: '.kanbanos/content/attachments/id/references',
  sizeBytes: 100,
  fileCount: 1,
  createdAt: '2027-01-01T00:00:00.000Z',
};

function setPreviewApi(preview: (relativePath: string) => Promise<AttachmentPreview>) {
  window.kanbanos = {
    appearance: { setTheme: vi.fn() },
    attachments: { preview },
  } as unknown as Window['kanbanos'];
}

describe('attachment preview modal', () => {
  it('navigates folder entries, previews Markdown safely, and opens the active child', async () => {
    const user = userEvent.setup();
    const preview = vi.fn().mockImplementation(async (relativePath: string): Promise<AttachmentPreview> => {
      if (relativePath.endsWith('guide.md')) {
        return { type: 'markdown', name: 'guide.md', content: '# Guide\n\n- first\n- second\n\n<script>unsafe</script>', truncated: false };
      }
      return {
        type: 'folder',
        name: 'references',
        entries: [{ name: 'guide.md', relativePath: `${attachment.relativePath}/guide.md`, kind: 'file', sizeBytes: 42 }],
        truncated: false,
      };
    });
    setPreviewApi(preview);
    const onOpen = vi.fn();
    const onReveal = vi.fn();
    renderWithPreferences(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} onOpen={onOpen} onReveal={onReveal} />);

    expect(await screen.findByText('1 items')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /guide.md/ }));
    expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
    expect(screen.queryByText('unsafe')).not.toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(`${attachment.relativePath}/guide.md`);

    await user.click(screen.getByRole('button', { name: 'Open file' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
      name: 'guide.md',
      relativePath: `${attachment.relativePath}/guide.md`,
      kind: 'file',
    }));
    await user.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(onReveal).toHaveBeenCalledWith(expect.objectContaining({ name: 'guide.md' }));

    await user.click(screen.getByRole('button', { name: 'Back to folder' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Preview references' })).toBeInTheDocument());
  });

  it('shows preview errors and falls back to the system open action', async () => {
    const user = userEvent.setup();
    setPreviewApi(vi.fn().mockRejectedValue(new Error('Unreadable file')));
    const onOpen = vi.fn();
    renderWithPreferences(<AttachmentPreviewModal attachment={{ ...attachment, name: 'broken.bin', kind: 'file' }} onClose={vi.fn()} onOpen={onOpen} onReveal={vi.fn()} />);

    expect(await screen.findByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unreadable file')).toBeInTheDocument();
    const openButtons = screen.getAllByRole('button', { name: 'Open file' });
    await user.click(openButtons[openButtons.length - 1]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'broken.bin' }));
  });
});
