import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export type PreviewEntry = {
  name: string;
  relativePath: string;
  kind: 'file' | 'folder';
  sizeBytes: number;
};

export type AttachmentPreview =
  | { type: 'image' | 'pdf' | 'video' | 'audio'; name: string; mimeType: string; url: string }
  | { type: 'text' | 'markdown'; name: string; content: string; truncated: boolean }
  | { type: 'word'; name: string; paragraphs: string[]; truncated: boolean }
  | { type: 'presentation'; name: string; slides: Array<{ title: string; lines: string[] }>; truncated: boolean }
  | { type: 'spreadsheet'; name: string; sheets: Array<{ name: string; rows: string[][] }>; truncated: boolean }
  | { type: 'folder'; name: string; entries: PreviewEntry[]; truncated: boolean }
  | { type: 'unsupported'; name: string; extension: string };

const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.htm', '.sql', '.sh', '.bash', '.zsh', '.py',
  '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.env', '.gitignore', '.rtf',
]);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const MIME_TYPES: Record<string, { type: 'image' | 'pdf' | 'video' | 'audio'; mimeType: string }> = {
  '.png': { type: 'image', mimeType: 'image/png' },
  '.jpg': { type: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { type: 'image', mimeType: 'image/jpeg' },
  '.gif': { type: 'image', mimeType: 'image/gif' },
  '.webp': { type: 'image', mimeType: 'image/webp' },
  '.bmp': { type: 'image', mimeType: 'image/bmp' },
  '.svg': { type: 'image', mimeType: 'image/svg+xml' },
  '.avif': { type: 'image', mimeType: 'image/avif' },
  '.pdf': { type: 'pdf', mimeType: 'application/pdf' },
  '.mp4': { type: 'video', mimeType: 'video/mp4' },
  '.webm': { type: 'video', mimeType: 'video/webm' },
  '.ogv': { type: 'video', mimeType: 'video/ogg' },
  '.mov': { type: 'video', mimeType: 'video/quicktime' },
  '.mp3': { type: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { type: 'audio', mimeType: 'audio/wav' },
  '.ogg': { type: 'audio', mimeType: 'audio/ogg' },
  '.m4a': { type: 'audio', mimeType: 'audio/mp4' },
  '.flac': { type: 'audio', mimeType: 'audio/flac' },
};
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_OFFICE_BYTES = 75 * 1024 * 1024;
const MAX_FOLDER_ENTRIES = 500;

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textNodes(xml: string, tag = '(?:w|a):t'): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g')))
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

async function readTextPreview(filePath: string): Promise<{ content: string; truncated: boolean }> {
  const handle = await fs.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.min(stats.size, MAX_TEXT_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { content: buffer.toString('utf8').replace(/^\uFEFF/, ''), truncated: stats.size > length };
  } finally {
    await handle.close();
  }
}

async function readOfficeZip(filePath: string): Promise<JSZip> {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_OFFICE_BYTES) throw new Error('This Office file is too large to preview.');
  return JSZip.loadAsync(await fs.readFile(filePath));
}

async function previewWord(filePath: string, name: string): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(filePath);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return { type: 'unsupported', name, extension: '.docx' };
  const xml = await documentFile.async('string');
  const paragraphs = Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g))
    .map((match) => textNodes(match[1], 'w:t').join(' '))
    .filter(Boolean)
    .slice(0, 1000);
  return { type: 'word', name, paragraphs, truncated: paragraphs.length >= 1000 };
}

async function previewPresentation(filePath: string, name: string): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(filePath);
  const slideFiles = Object.keys(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const slides = await Promise.all(slideFiles.slice(0, 200).map(async (entry) => {
    const xml = await zip.file(entry)!.async('string');
    const lines = Array.from(xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g))
      .map((match) => textNodes(match[1], 'a:t').join(' '))
      .filter(Boolean);
    return { title: lines[0] ?? '', lines: lines.slice(1) };
  }));
  return { type: 'presentation', name, slides, truncated: slideFiles.length > slides.length };
}

function columnIndex(reference: string): number {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function previewSpreadsheet(filePath: string, name: string): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(filePath);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedXml
    ? Array.from(sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)).map((match) => textNodes(match[1], '(?:t|r:t)').join(' '))
    : [];
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const sheetNames = workbookXml
    ? Array.from(workbookXml.matchAll(/<sheet\s[^>]*name="([^"]+)"/g)).map((match) => decodeXml(match[1]))
    : [];
  const worksheetFiles = Object.keys(zip.files)
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const sheets = await Promise.all(worksheetFiles.slice(0, 20).map(async (entry, sheetIndex) => {
    const xml = await zip.file(entry)!.async('string');
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 200) break;
      const row: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
        const reference = cellMatch[1].match(/\br="([^"]+)"/)?.[1] ?? 'A1';
        const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1];
        const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
          ?? textNodes(cellMatch[2], 't').join(' ');
        const value = type === 's' ? sharedStrings[Number(raw)] ?? raw : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : decodeXml(raw);
        const index = Math.min(columnIndex(reference), 49);
        while (row.length < index) row.push('');
        row[index] = value;
      }
      rows.push(row);
    }
    return { name: sheetNames[sheetIndex] ?? `Sheet ${sheetIndex + 1}`, rows };
  }));
  return { type: 'spreadsheet', name, sheets, truncated: worksheetFiles.length > sheets.length || sheets.some((sheet) => sheet.rows.length >= 200) };
}

async function previewFolder(absolutePath: string, relativePath: string, name: string): Promise<AttachmentPreview> {
  const entries: PreviewEntry[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= MAX_FOLDER_ENTRIES) return;
      const absoluteChild = path.join(directory, child.name);
      const childStats = await fs.lstat(absoluteChild);
      if (childStats.isSymbolicLink()) continue;
      const childRelativePath = path.posix.join(relativeDirectory.split(path.sep).join('/'), child.name);
      const kind = childStats.isDirectory() ? 'folder' : 'file';
      entries.push({ name: path.relative(absolutePath, absoluteChild).split(path.sep).join('/'), relativePath: childRelativePath, kind, sizeBytes: childStats.isFile() ? childStats.size : 0 });
      if (childStats.isDirectory()) await visit(absoluteChild, childRelativePath);
    }
  };
  await visit(absolutePath, relativePath);
  return { type: 'folder', name, entries, truncated: entries.length >= MAX_FOLDER_ENTRIES };
}

export async function createAttachmentPreview(
  absolutePath: string,
  relativePath: string,
  previewUrl: string,
): Promise<AttachmentPreview> {
  const stats = await fs.lstat(absolutePath);
  if (stats.isSymbolicLink()) throw new Error('Symbolic-link attachments cannot be previewed.');
  const name = path.basename(absolutePath);
  if (stats.isDirectory()) return previewFolder(absolutePath, relativePath, name);
  const extension = path.extname(name).toLowerCase();
  const media = MIME_TYPES[extension];
  if (media) return { ...media, name, url: previewUrl };
  if (MARKDOWN_EXTENSIONS.has(extension)) return { type: 'markdown', name, ...await readTextPreview(absolutePath) };
  if (TEXT_EXTENSIONS.has(extension) || stats.size <= 256 * 1024 && extension === '') return { type: 'text', name, ...await readTextPreview(absolutePath) };
  if (extension === '.docx') return previewWord(absolutePath, name);
  if (extension === '.pptx') return previewPresentation(absolutePath, name);
  if (extension === '.xlsx') return previewSpreadsheet(absolutePath, name);
  return { type: 'unsupported', name, extension: extension || 'unknown' };
}
