import { getDocumentProxy } from 'unpdf';

export interface TextItem {
  x: number;
  /** Right edge, when known (OCR word box; text-layer item width). */
  x1?: number;
  text: string;
  /** OCR only: word confidence 0-100. */
  confidence?: number;
}

/** A visual row of text: items that share (approximately) the same baseline. */
export interface TextRow {
  page: number;
  y: number;
  items: TextItem[];
  text: string;
  /** OCR only: line confidence 0-100. */
  confidence?: number;
}

export interface PdfText {
  pageCount: number;
  rows: TextRow[];
  /** Non-whitespace characters per page; 0 means the page has no text layer (e.g. a scan). */
  charsPerPage: number[];
  /** The open pdf.js document (reused for OCR of scanned pages). */
  proxy: Awaited<ReturnType<typeof getDocumentProxy>>;
}

export class PdfReadError extends Error {}

const ROW_TOLERANCE = 2;

/**
 * Reads the embedded text layer of a PDF with pdf.js (via unpdf), keeping x/y positions so
 * table rows can be rebuilt. No OCR: scanned pages simply return no rows.
 */
export async function readPdfText(data: Uint8Array): Promise<PdfText> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message)) throw new PdfReadError('The PDF is password-protected and cannot be read.');
    throw new PdfReadError(`The file could not be parsed as a PDF (${message}).`);
  }

  const rows: TextRow[] = [];
  const charsPerPage: number[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const pageRows: { y: number; items: TextItem[] }[] = [];
    let chars = 0;
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const text = raw.str;
      if (!text.trim()) continue;
      chars += text.replace(/\s/g, '').length;
      const x = raw.transform[4];
      const y = raw.transform[5];
      let row = pageRows.find((r) => Math.abs(r.y - y) <= ROW_TOLERANCE);
      if (!row) {
        row = { y, items: [] };
        pageRows.push(row);
      }
      row.items.push({ x, ...(raw.width ? { x1: x + raw.width } : {}), text });
    }
    charsPerPage.push(chars);
    pageRows.sort((a, b) => b.y - a.y); // top of page first
    for (const r of pageRows) {
      r.items.sort((a, b) => a.x - b.x);
      rows.push({ page: pageNo, y: r.y, items: r.items, text: r.items.map((i) => i.text.trim()).join('  ') });
    }
  }
  return { pageCount: pdf.numPages, rows, charsPerPage, proxy: pdf };
}
