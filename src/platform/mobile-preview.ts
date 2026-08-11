import JSZip from 'jszip';

export type MobilePreviewFileSystem = {
  lstat(path: string): Promise<{ size: number; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Uint8Array>;
};

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
const EMPTY_FOLDER_MARKER = '.kanbanos-folder';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '';
const extensionOf = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
};
const joinPath = (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/');

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

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function text(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

async function readTextPreview(fs: MobilePreviewFileSystem, path: string, size: number) {
  const content = text(await fs.readFile(path)).slice(0, MAX_TEXT_BYTES).replace(/^\uFEFF/, '');
  return { content, truncated: size > MAX_TEXT_BYTES };
}

async function readOfficeZip(fs: MobilePreviewFileSystem, path: string, size: number): Promise<JSZip> {
  if (size > MAX_OFFICE_BYTES) throw new Error('This Office file is too large to preview.');
  return JSZip.loadAsync(Uint8Array.from(bytes(await fs.readFile(path))));
}

async function previewWord(fs: MobilePreviewFileSystem, path: string, name: string, size: number): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(fs, path, size);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return { type: 'unsupported', name, extension: '.docx' };
  const xml = await documentFile.async('string');
  const paragraphs = Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g))
    .map((match) => textNodes(match[1], 'w:t').join(' '))
    .filter(Boolean)
    .slice(0, 1000);
  return { type: 'word', name, paragraphs, truncated: paragraphs.length >= 1000 };
}

async function previewPresentation(fs: MobilePreviewFileSystem, path: string, name: string, size: number): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(fs, path, size);
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

async function previewSpreadsheet(fs: MobilePreviewFileSystem, path: string, name: string, size: number): Promise<AttachmentPreview> {
  const zip = await readOfficeZip(fs, path, size);
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
        const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? textNodes(cellMatch[2], 't').join(' ');
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

async function previewFolder(fs: MobilePreviewFileSystem, path: string, relativePath: string, name: string): Promise<AttachmentPreview> {
  const entries: AttachmentPreviewEntry[] = [];
  const visit = async (directory: string, relativeDirectory: string, displayDirectory: string): Promise<void> => {
    const children = (await fs.readdir(directory)).sort((left, right) => left.localeCompare(right));
    for (const child of children) {
      if (directory === path && children.length === 1 && child === EMPTY_FOLDER_MARKER) continue;
      if (entries.length >= MAX_FOLDER_ENTRIES) return;
      const childPath = joinPath(directory, child);
      const stats = await fs.lstat(childPath);
      if (stats.isSymbolicLink()) continue;
      const childRelativePath = joinPath(relativeDirectory, child);
      const displayName = joinPath(displayDirectory, child).replace(/^\//, '');
      entries.push({ name: displayName, relativePath: childRelativePath, kind: stats.isDirectory() ? 'folder' : 'file', sizeBytes: stats.isDirectory() ? 0 : stats.size });
      if (stats.isDirectory()) await visit(childPath, childRelativePath, displayName);
    }
  };
  await visit(path, relativePath, '');
  return { type: 'folder', name, entries, truncated: entries.length >= MAX_FOLDER_ENTRIES };
}

export async function createMobileAttachmentPreview(
  fs: MobilePreviewFileSystem,
  absolutePath: string,
  relativePath: string,
): Promise<AttachmentPreview> {
  const stats = await fs.lstat(absolutePath);
  if (stats.isSymbolicLink()) throw new Error('Symbolic-link attachments cannot be previewed.');
  const name = basename(absolutePath);
  if (stats.isDirectory()) return previewFolder(fs, absolutePath, relativePath, name);
  const extension = extensionOf(name);
  const media = MIME_TYPES[extension];
  if (media) {
    const content = Uint8Array.from(bytes(await fs.readFile(absolutePath)));
    const blob = new Blob([content.buffer], { type: media.mimeType });
    return { ...media, name, url: URL.createObjectURL(blob) };
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) return { type: 'markdown', name, ...await readTextPreview(fs, absolutePath, stats.size) };
  if (TEXT_EXTENSIONS.has(extension) || stats.size <= 256 * 1024 && extension === '') return { type: 'text', name, ...await readTextPreview(fs, absolutePath, stats.size) };
  if (extension === '.docx') return previewWord(fs, absolutePath, name, stats.size);
  if (extension === '.pptx') return previewPresentation(fs, absolutePath, name, stats.size);
  if (extension === '.xlsx') return previewSpreadsheet(fs, absolutePath, name, stats.size);
  return { type: 'unsupported', name, extension: extension || 'unknown' };
}
