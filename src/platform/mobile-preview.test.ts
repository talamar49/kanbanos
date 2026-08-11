import 'fake-indexeddb/auto';
import LightningFS from '@isomorphic-git/lightning-fs';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileAttachmentPreview } from './mobile-preview';

type MobileFs = InstanceType<typeof LightningFS>['promises'];

async function createFileSystem(): Promise<MobileFs> {
  const fs = new LightningFS(`mobile-preview-${crypto.randomUUID()}`, { wipe: true }).promises;
  await fs.mkdir('/files');
  return fs;
}

async function writeZip(fs: MobileFs, name: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip();
  build(zip);
  const path = `/files/${name}`;
  await fs.writeFile(path, await zip.generateAsync({ type: 'uint8array' }));
  return path;
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mobile-preview') });
});

describe('mobile attachment previews', () => {
  it('previews Markdown and extensionless text and truncates oversized files', async () => {
    const fs = await createFileSystem();
    await fs.writeFile('/files/notes.md', '\uFEFF# Launch\n- Ready', 'utf8');
    await fs.writeFile('/files/LICENSE', 'local first', 'utf8');
    await fs.writeFile('/files/large.log', new Uint8Array(2 * 1024 * 1024 + 10).fill(97));

    await expect(createMobileAttachmentPreview(fs, '/files/notes.md', '.kanbanos/notes.md')).resolves.toEqual({
      type: 'markdown',
      name: 'notes.md',
      content: '# Launch\n- Ready',
      truncated: false,
    });
    await expect(createMobileAttachmentPreview(fs, '/files/LICENSE', '.kanbanos/LICENSE')).resolves.toMatchObject({
      type: 'text',
      content: 'local first',
    });
    const large = await createMobileAttachmentPreview(fs, '/files/large.log', '.kanbanos/large.log');
    expect(large).toMatchObject({ type: 'text', truncated: true });
    if (large.type === 'text') expect(large.content).toHaveLength(2 * 1024 * 1024);
  });

  it('creates local media URLs and reports unsupported binary formats', async () => {
    const fs = await createFileSystem();
    for (const name of ['photo.PNG', 'brief.pdf', 'clip.mp4', 'voice.mp3', 'archive.bin']) {
      await fs.writeFile(`/files/${name}`, new Uint8Array([0, 1, 2]));
    }

    await expect(createMobileAttachmentPreview(fs, '/files/photo.PNG', 'photo.PNG')).resolves.toEqual({
      type: 'image',
      name: 'photo.PNG',
      mimeType: 'image/png',
      url: 'blob:mobile-preview',
    });
    await expect(createMobileAttachmentPreview(fs, '/files/brief.pdf', 'brief.pdf')).resolves.toMatchObject({ type: 'pdf', mimeType: 'application/pdf' });
    await expect(createMobileAttachmentPreview(fs, '/files/clip.mp4', 'clip.mp4')).resolves.toMatchObject({ type: 'video', mimeType: 'video/mp4' });
    await expect(createMobileAttachmentPreview(fs, '/files/voice.mp3', 'voice.mp3')).resolves.toMatchObject({ type: 'audio', mimeType: 'audio/mpeg' });
    await expect(createMobileAttachmentPreview(fs, '/files/archive.bin', 'archive.bin')).resolves.toEqual({ type: 'unsupported', name: 'archive.bin', extension: '.bin' });
  });

  it('lists nested folders in stable order and hides empty-folder markers', async () => {
    const fs = await createFileSystem();
    await fs.mkdir('/files/references');
    await fs.mkdir('/files/references/design');
    await fs.writeFile('/files/references/z-last.txt', 'z', 'utf8');
    await fs.writeFile('/files/references/design/brief.txt', 'brief', 'utf8');
    await fs.writeFile('/files/references/a-first.txt', 'a', 'utf8');
    const preview = await createMobileAttachmentPreview(fs, '/files/references', '.kanbanos/content/references');
    expect(preview.type).toBe('folder');
    if (preview.type === 'folder') {
      expect(preview.entries.map((entry) => entry.name)).toEqual(['a-first.txt', 'design', 'design/brief.txt', 'z-last.txt']);
    }

    await fs.mkdir('/files/empty');
    await fs.writeFile('/files/empty/.kanbanos-folder', new Uint8Array());
    await expect(createMobileAttachmentPreview(fs, '/files/empty', '.kanbanos/content/empty')).resolves.toMatchObject({ type: 'folder', entries: [] });
  });

  it('extracts Word, presentation, and spreadsheet content on-device', async () => {
    const fs = await createFileSystem();
    const documentPath = await writeZip(fs, 'brief.docx', (zip) => {
      zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Launch &amp; learn</w:t></w:r></w:p><w:p><w:r><w:t>Ready &#x2713;</w:t></w:r></w:p></w:body></w:document>');
    });
    const presentationPath = await writeZip(fs, 'deck.pptx', (zip) => {
      zip.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>');
      zip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p><a:p><a:r><a:t>Details</a:t></a:r></a:p></p:sld>');
    });
    const spreadsheetPath = await writeZip(fs, 'plan.xlsx', (zip) => {
      zip.file('xl/sharedStrings.xml', '<sst><si><t>Task</t></si><si><t>Launch</t></si></sst>');
      zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Plan &amp; dates" sheetId="1"/></sheets></workbook>');
      zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>');
    });

    await expect(createMobileAttachmentPreview(fs, documentPath, 'brief.docx')).resolves.toEqual({
      type: 'word',
      name: 'brief.docx',
      paragraphs: ['Launch & learn', 'Ready ✓'],
      truncated: false,
    });
    await expect(createMobileAttachmentPreview(fs, presentationPath, 'deck.pptx')).resolves.toMatchObject({
      type: 'presentation',
      slides: [{ title: 'Second', lines: ['Details'] }, { title: 'Tenth', lines: [] }],
    });
    await expect(createMobileAttachmentPreview(fs, spreadsheetPath, 'plan.xlsx')).resolves.toEqual({
      type: 'spreadsheet',
      name: 'plan.xlsx',
      sheets: [{ name: 'Plan & dates', rows: [['Task', '', 'Launch'], ['TRUE', '42']] }],
      truncated: false,
    });
  });
});
