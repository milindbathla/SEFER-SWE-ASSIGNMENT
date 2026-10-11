import { createHash } from 'node:crypto';
import { ExtractedDocument, type ContainerReading, type DocType, type SourceField } from '@sefer/shared';
import { classifyByContent, classifyByFileName } from './classify.js';
import { parseBillOfLading, parsePackingList } from './documentParsers.js';
import { parseInvoiceRows } from './invoiceParser.js';
import { confidenceOf, norm } from './layout.js';
import { MAX_OCR_PAGES, OcrError, ocrPage, ocrRows } from './ocr.js';
import { PdfReadError, readPdfText, type TextRow } from './pdfText.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Below this many characters per page we treat the page as having no usable text layer. */
const MIN_TEXT_CHARS = 20;
/** OCR readings below this confidence are not offered as values; the OCR text stays as evidence. */
export const MIN_OCR_CONFIDENCE = 50;

export class UnsupportedFileError extends Error {}

export interface ExtractOptions {
  /** OCR scanned pages (default true). The sample loader turns it off where a reviewed transcription replaces the scan. */
  ocr?: boolean;
}

export async function extractDocument(fileName: string, data: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractedDocument> {
  if (data.byteLength === 0) throw new UnsupportedFileError(`"${fileName}" is empty.`);
  if (data.byteLength > MAX_FILE_BYTES) throw new UnsupportedFileError(`"${fileName}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const header = new TextDecoder().decode(data.subarray(0, 5));
  if (header !== '%PDF-') throw new UnsupportedFileError(`"${fileName}" is not a PDF file. Only PDF documents are supported.`);

  let pdf;
  try {
    pdf = await readPdfText(data);
  } catch (err) {
    if (err instanceof PdfReadError) throw new UnsupportedFileError(`"${fileName}": ${err.message}`);
    throw err;
  }

  const sha256 = createHash('sha256').update(data).digest('hex');
  const allText = pdf.rows.map((r) => r.text).join('\n');
  const textPages = pdf.charsPerPage.filter((c) => c >= MIN_TEXT_CHARS).length;
  const hasText = textPages > 0;
  const warnings: string[] = [];

  let docType: DocType = 'unknown';
  let docTypeSource: ExtractedDocument['docTypeSource'] = 'file_name_guess';
  const byContent = hasText ? classifyByContent(allText) : null;
  if (byContent) {
    docType = byContent;
    docTypeSource = 'content';
  } else {
    const guess = classifyByFileName(fileName);
    if (guess) {
      docType = guess;
      warnings.push('Document type was guessed from the file name only. Please confirm it.');
    } else {
      warnings.push('Document type could not be determined. Please select it.');
    }
  }
  if (hasText && textPages < pdf.pageCount) {
    warnings.push(`${pdf.pageCount - textPages} of ${pdf.pageCount} page(s) have no text layer; their content must be entered manually.`);
  }

  const base = {
    // Deterministic id: the same file always gets the same id (stable issue ids and acknowledgements).
    id: `doc-${sha256.slice(0, 16)}`,
    fileName,
    sha256,
    docType,
    docTypeSource,
    pageCount: pdf.pageCount,
    fields: {},
    lines: [],
    containers: [],
    textLines: [],
  };

  if (!hasText && opts.ocr === false) {
    warnings.push('No text layer (scanned document); OCR was not requested for this run. Enter the values manually or import a transcription file.');
    return ExtractedDocument.parse({ ...base, method: 'unavailable', warnings });
  }
  if (!hasText) return extractScanned(fileName, pdf.proxy, base, warnings);

  if (docType === 'commercial_invoice') {
    const parsed = parseInvoiceRows(pdf.rows);
    return ExtractedDocument.parse({
      ...base,
      method: 'text_layer',
      fields: parsed.fields,
      lines: parsed.lines,
      textLines: parsed.textLines,
      warnings: [...warnings, ...parsed.warnings],
    });
  }

  if (docType === 'packing_list' || docType === 'bill_of_lading') {
    const parsed = docType === 'packing_list' ? parsePackingList(pdf.rows) : parseBillOfLading(pdf.rows);
    return ExtractedDocument.parse({
      ...base,
      method: 'text_layer',
      fields: parsed.fields,
      lines: parsed.lines ?? [],
      containers: parsed.containers,
      textLines: pdf.rows.map((r) => ({ page: r.page, text: r.text })),
      warnings: [...warnings, ...parsed.warnings],
    });
  }

  warnings.push('Text was read, but the document type is unknown, so no fields were extracted. Select the type to continue; the raw text is kept for the review rules.');
  return ExtractedDocument.parse({
    ...base,
    method: 'text_layer',
    textLines: pdf.rows.map((r) => ({ page: r.page, text: r.text })),
    warnings,
  });
}

type Base = Omit<ExtractedDocument, 'method' | 'warnings'>;

/**
 * Scanned PDF: local OCR, then the same document readers as for text-layer PDFs. Every OCR value is marked
 * "unverified" with its confidence; low-confidence readings are left empty with the OCR text kept as evidence.
 * If OCR fails, the document is reported as not read (with the reason), never as an empty successful read.
 */
async function extractScanned(fileName: string, proxy: Parameters<typeof ocrPage>[0], base: Base, warnings: string[]): Promise<ExtractedDocument> {
  const pages = Math.min(base.pageCount, MAX_OCR_PAGES);
  const rows: TextRow[] = [];
  const pageConfidence: number[] = [];
  try {
    for (let page = 1; page <= pages; page++) {
      const r = await ocrPage(proxy, page);
      rows.push(...ocrRows(r.lines));
      pageConfidence.push(r.confidence);
    }
  } catch (err) {
    const reason = err instanceof OcrError ? err.message : 'unexpected OCR error';
    warnings.push(`No text layer, and OCR failed: ${reason} Enter the values manually from the page.`);
    return ExtractedDocument.parse({ ...base, method: 'unavailable', warnings });
  }
  if (base.pageCount > pages) warnings.push(`Only the first ${pages} of ${base.pageCount} pages were read by OCR (limit). Enter values from the remaining pages manually.`);
  if (!rows.length) {
    warnings.push('No text layer, and OCR found no text on the page image. Enter the values manually from the page.');
    return ExtractedDocument.parse({ ...base, method: 'unavailable', warnings });
  }

  let { docType, docTypeSource } = base;
  const byContent = classifyByContent(rows.map((r) => r.text).join('\n'));
  if (byContent) {
    docType = byContent;
    docTypeSource = 'content';
    const i = warnings.findIndex((w) => /guessed from the file name|could not be determined/.test(w));
    if (i >= 0) warnings.splice(i, 1);
  }
  warnings.push(`Read by OCR (no text layer; page confidence ${pageConfidence.join(', ')}%). OCR readings are not facts: each value stays "unverified" and out of the XML until you confirm or correct it.`);

  let fields: Record<string, SourceField> = {};
  let lines: ExtractedDocument['lines'] = [];
  let containers: ContainerReading[] = [];
  if (docType === 'commercial_invoice') {
    const parsed = parseInvoiceRows(rows);
    ({ fields, lines } = parsed);
    warnings.push(...parsed.warnings);
  } else if (docType === 'packing_list') {
    // Ruled goods tables lose most number cells in the page-layout OCR pass, so the table is read in a second pass
    // with the ruling lines removed (see ocrPage). Its failure only costs the table, never the fields already read.
    let tableRows: TextRow[] = [];
    try {
      for (let page = 1; page <= pages; page++) tableRows.push(...ocrRows((await ocrPage(proxy, page, 'table')).lines));
    } catch (err) {
      tableRows = [];
      warnings.push(`The goods table could not be OCR-read (${err instanceof OcrError ? err.message : 'unexpected OCR error'}). Enter the lines from the page.`);
    }
    const parsed = parsePackingList(rows, tableRows);
    ({ fields, containers } = parsed);
    lines = (parsed.lines ?? []).map((l) => ({ cells: Object.fromEntries(Object.entries(l.cells).map(([k, f]) => [k, { ...f, note: [f.note, 'Read by a second OCR pass with the table lines removed.'].filter(Boolean).join('. ') }])) }));
    warnings.push(...parsed.warnings);
  } else if (docType === 'bill_of_lading') {
    const parsed = parseBillOfLading(rows);
    ({ fields, containers } = parsed);
    warnings.push(...parsed.warnings);
  } else {
    warnings.push('The document type could not be recognised from the OCR text. Select it; the OCR text is kept for the review rules.');
  }

  const mark = (f: SourceField): SourceField => {
    const confidence = f.confidence ?? rowConfidence(rows, f);
    if (f.value !== null && confidence !== undefined && confidence < MIN_OCR_CONFIDENCE) {
      return { ...f, value: null, confidence, verification: 'unverified', note: `OCR reading "${f.value}" is below ${MIN_OCR_CONFIDENCE}% confidence and was not used. Read the value from the page.` };
    }
    return { ...f, ...(confidence !== undefined ? { confidence } : {}), verification: 'unverified' };
  };
  return ExtractedDocument.parse({
    ...base,
    docType,
    docTypeSource,
    method: 'ocr',
    fields: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, mark(f)])),
    lines: lines.map((l) => ({ cells: Object.fromEntries(Object.entries(l.cells).map(([k, f]) => [k, mark(f)])) })),
    containers: containers.map((c) => ({ ...c, number: mark(c.number), ...(c.seal ? { seal: mark(c.seal) } : {}) })),
    textLines: rows.map((r) => ({ page: r.page, text: norm(r.text), ...(r.confidence !== undefined ? { confidence: r.confidence } : {}) })),
    warnings,
  });
}

/** Confidence for a value whose reader did not record one: the OCR row its quote came from. */
function rowConfidence(rows: TextRow[], f: SourceField): number | undefined {
  if (!f.quote || f.value === null) return undefined;
  const q = norm(f.quote);
  const row = rows.find((r) => r.page === f.page && (norm(r.text).includes(q) || q.includes(norm(r.text))));
  return row ? confidenceOf(row, f.value) : undefined;
}
