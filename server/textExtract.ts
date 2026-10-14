import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
import { normalizeContent } from '../shared/extract';
import { HttpError } from './store';

export interface ExtractedText {
  text: string;
  warning?: string;
}

interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PdfLine {
  y: number;
  h: number;
  items: PdfItem[];
}

/** Rekonstruiert Textzeilen aus den positionierten Textfragmenten einer PDF-Seite. */
function linesFromItems(items: PdfItem[]): string[] {
  const lines: PdfLine[] = [];
  for (const item of items) {
    const tolerance = Math.max(2, item.h * 0.5);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      line.h = Math.max(line.h, item.h);
    } else {
      lines.push({ y: item.y, h: item.h, items: [item] });
    }
  }
  lines.sort((a, b) => b.y - a.y);

  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 10;
  const out: string[] = [];
  let prevY: number | null = null;
  for (const line of lines) {
    if (prevY !== null && prevY - line.y > typical * 1.9) out.push('');
    prevY = line.y;
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd: number | null = null;
    for (const item of line.items) {
      const gap = prevEnd === null ? 0 : item.x - prevEnd;
      if (prevEnd !== null && gap > Math.max(1, item.h * 0.2) && !text.endsWith(' ') && !item.str.startsWith(' ')) {
        text += gap > item.h * 3 ? '   ' : ' ';
      }
      text += item.str;
      prevEnd = item.x + item.w;
    }
    out.push(text.replace(/\s+$/, ''));
  }
  return out;
}

async function extractPdf(data: Uint8Array): Promise<ExtractedText> {
  let pdf;
  try {
    // Kopie übergeben: PDF.js übernimmt den Puffer und macht ihn sonst unbrauchbar.
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch {
    throw new HttpError(400, 'Die PDF-Datei konnte nicht gelesen werden (beschädigt oder passwortgeschützt?)');
  }
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const raw of content.items as Array<Record<string, any>>) {
      if (typeof raw.str !== 'string' || raw.str.length === 0) continue;
      const t = raw.transform as number[];
      items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width ?? 0, h: raw.height || Math.abs(t[3]) || 10 });
    }
    pages.push(linesFromItems(items).join('\n'));
  }
  await pdf.loadingTask.destroy();
  const text = normalizeContent(pages.join('\n\n'));
  const warning =
    text.replace(/\s/g, '').length < 40 * pdf.numPages
      ? 'Es wurde kaum Text gefunden. Vermutlich handelt es sich um ein gescanntes PDF – bitte Text per OCR erzeugen oder manuell einfügen.'
      : undefined;
  return { text, warning };
}

async function extractDocx(data: Uint8Array): Promise<ExtractedText> {
  try {
    // Node.js liest „buffer“, der Browser-Build von mammoth „arrayBuffer“.
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const input = { buffer: data, arrayBuffer } as unknown as { buffer: Buffer };
    const result = await mammoth.extractRawText(input);
    return { text: normalizeContent(result.value) };
  } catch {
    throw new HttpError(400, 'Die Word-Datei konnte nicht gelesen werden');
  }
}

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'csv', 'html', 'htm'];

export async function extractTextFromFile(data: Uint8Array, fileName: string): Promise<ExtractedText> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'pdf':
      return extractPdf(data);
    case 'docx':
      return extractDocx(data);
    case 'txt':
    case 'md':
    case 'csv':
      return { text: normalizeContent(decodeText(data)) };
    case 'html':
    case 'htm':
      return { text: normalizeContent(stripHtml(decodeText(data))) };
    case 'doc':
      throw new HttpError(400, 'Das alte Word-Format (.doc) wird nicht unterstützt. Bitte als .docx oder PDF speichern.');
    default:
      throw new HttpError(400, `Dateityp „.${ext}“ wird nicht unterstützt. Erlaubt: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }
}
