import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAttachmentPreview } from './attachment-preview';

let temporaryDirectory = '';

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kanbanos-preview-'));
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

async function writeZip(name: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip();
  build(zip);
  const target = path.join(temporaryDirectory, name);
  await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }));
  return target;
}

describe('attachment previews', () => {
  it('previews text and Markdown, strips BOMs, and truncates oversized text safely', async () => {
    const markdownPath = path.join(temporaryDirectory, 'notes.md');
    await fs.writeFile(markdownPath, '\uFEFF# Launch\n- Ready', 'utf8');
    const markdown = await createAttachmentPreview(markdownPath, '.kanbanos/notes.md', 'kanbanos-attachment://notes');

    expect(markdown).toEqual({
      type: 'markdown',
      name: 'notes.md',
      content: '# Launch\n- Ready',
      truncated: false,
    });

    const largePath = path.join(temporaryDirectory, 'large.log');
    await fs.writeFile(largePath, Buffer.alloc(2 * 1024 * 1024 + 10, 97));
    const large = await createAttachmentPreview(largePath, '.kanbanos/large.log', 'unused');
    expect(large.type).toBe('text');
    if (large.type === 'text') {
      expect(large.content).toHaveLength(2 * 1024 * 1024);
      expect(large.truncated).toBe(true);
    }
  });

  it('maps media formats to secure preview URLs and falls back for unsupported files', async () => {
    const imagePath = path.join(temporaryDirectory, 'photo.PNG');
    const pdfPath = path.join(temporaryDirectory, 'brief.pdf');
    const binaryPath = path.join(temporaryDirectory, 'archive.bin');
    const extensionlessPath = path.join(temporaryDirectory, 'LICENSE');
    await Promise.all([
      fs.writeFile(imagePath, 'image'),
      fs.writeFile(pdfPath, 'pdf'),
      fs.writeFile(binaryPath, Buffer.from([0, 1, 2])),
      fs.writeFile(extensionlessPath, 'license text'),
    ]);

    await expect(createAttachmentPreview(imagePath, 'photo.PNG', 'kanbanos-attachment://photo')).resolves.toEqual({
      type: 'image',
      name: 'photo.PNG',
      mimeType: 'image/png',
      url: 'kanbanos-attachment://photo',
    });
    await expect(createAttachmentPreview(pdfPath, 'brief.pdf', 'kanbanos-attachment://pdf')).resolves.toMatchObject({ type: 'pdf', mimeType: 'application/pdf' });
    await expect(createAttachmentPreview(binaryPath, 'archive.bin', 'unused')).resolves.toEqual({ type: 'unsupported', name: 'archive.bin', extension: '.bin' });
    await expect(createAttachmentPreview(extensionlessPath, 'LICENSE', 'unused')).resolves.toMatchObject({ type: 'text', content: 'license text' });
  });

  it('lists nested folders in stable order and excludes symbolic links', async () => {
    const folder = path.join(temporaryDirectory, 'references');
    await fs.mkdir(path.join(folder, 'design'), { recursive: true });
    await fs.writeFile(path.join(folder, 'z-last.txt'), 'z');
    await fs.writeFile(path.join(folder, 'design', 'brief.txt'), 'brief');
    await fs.writeFile(path.join(folder, 'a-first.txt'), 'a');
    try {
      await fs.symlink(path.join(folder, 'a-first.txt'), path.join(folder, 'linked.txt'));
    } catch {
      // Some Windows test runners do not permit symlink creation.
    }

    const preview = await createAttachmentPreview(folder, '.kanbanos/content/references', 'unused');

    expect(preview.type).toBe('folder');
    if (preview.type === 'folder') {
      expect(preview.entries.map((entry) => entry.name)).toEqual([
        'a-first.txt',
        'design',
        'design/brief.txt',
        'z-last.txt',
      ]);
      expect(preview.entries.every((entry) => !entry.name.includes('linked'))).toBe(true);
      expect(preview.truncated).toBe(false);
    }

    const emptyFolder = path.join(temporaryDirectory, 'empty-reference');
    await fs.mkdir(emptyFolder);
    await fs.writeFile(path.join(emptyFolder, '.kanbanos-folder'), '');
    const emptyPreview = await createAttachmentPreview(emptyFolder, '.kanbanos/content/empty-reference', 'unused');
    expect(emptyPreview).toMatchObject({ type: 'folder', entries: [] });
  });

  it('extracts Word paragraphs and decodes XML entities', async () => {
    const documentPath = await writeZip('brief.docx', (zip) => {
      zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Launch &amp; learn</w:t></w:r></w:p><w:p><w:r><w:t>Ready &#x2713;</w:t></w:r></w:p></w:body></w:document>');
    });

    const preview = await createAttachmentPreview(documentPath, 'brief.docx', 'unused');

    expect(preview).toEqual({
      type: 'word',
      name: 'brief.docx',
      paragraphs: ['Launch & learn', 'Ready ✓'],
      truncated: false,
    });
  });

  it('extracts presentations in numeric slide order', async () => {
    const presentationPath = await writeZip('deck.pptx', (zip) => {
      zip.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>');
      zip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p><a:p><a:r><a:t>Details</a:t></a:r></a:p></p:sld>');
    });

    const preview = await createAttachmentPreview(presentationPath, 'deck.pptx', 'unused');

    expect(preview).toEqual({
      type: 'presentation',
      name: 'deck.pptx',
      slides: [
        { title: 'Second', lines: ['Details'] },
        { title: 'Tenth', lines: [] },
      ],
      truncated: false,
    });
  });

  it('extracts spreadsheet names, shared strings, booleans, numbers, and sparse columns', async () => {
    const spreadsheetPath = await writeZip('plan.xlsx', (zip) => {
      zip.file('xl/sharedStrings.xml', '<sst><si><t>Task</t></si><si><t>Launch</t></si></sst>');
      zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Plan &amp; dates" sheetId="1"/></sheets></workbook>');
      zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>');
    });

    const preview = await createAttachmentPreview(spreadsheetPath, 'plan.xlsx', 'unused');

    expect(preview).toEqual({
      type: 'spreadsheet',
      name: 'plan.xlsx',
      sheets: [{ name: 'Plan & dates', rows: [['Task', '', 'Launch'], ['TRUE', '42']] }],
      truncated: false,
    });
  });

  it('rejects symbolic-link roots and oversized Office archives', async () => {
    const textPath = path.join(temporaryDirectory, 'target.txt');
    const linkPath = path.join(temporaryDirectory, 'link.txt');
    await fs.writeFile(textPath, 'safe');
    try {
      await fs.symlink(textPath, linkPath);
      await expect(createAttachmentPreview(linkPath, 'link.txt', 'unused')).rejects.toThrow('Symbolic-link attachments cannot be previewed.');
    } catch (error) {
      if ((error as Error).message.includes('Symbolic-link attachments')) throw error;
    }

    const oversizedPath = path.join(temporaryDirectory, 'huge.docx');
    const handle = await fs.open(oversizedPath, 'w');
    await handle.truncate(75 * 1024 * 1024 + 1);
    await handle.close();
    await expect(createAttachmentPreview(oversizedPath, 'huge.docx', 'unused')).rejects.toThrow('This Office file is too large to preview.');
  });
});
