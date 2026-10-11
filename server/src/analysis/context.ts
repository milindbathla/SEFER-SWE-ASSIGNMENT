import { isUnverifiedOcr, type DocumentLine, type Evidence, type ExtractedDocument, type SourceField } from '@sefer/shared';
import { normalizeKey, parseNumber, type ParsedNumber } from '../normalize.js';

/** Builds an Evidence record from a document field. */
export function evidence(doc: ExtractedDocument, f: SourceField | undefined, label?: string): Evidence {
  return {
    documentId: doc.id,
    fileName: doc.fileName,
    docType: doc.docType,
    page: f?.page ?? null,
    value: f?.value ?? null,
    quote: f?.quote ?? null,
    ...(label ? { label } : {}),
    ...(doc.method === 'ocr' && f ? { ocr: { confidence: f.confidence ?? null, verified: !isUnverifiedOcr(doc.method, f) } } : {}),
  };
}

export function textEvidence(doc: ExtractedDocument, page: number | null, text: string, label?: string): Evidence {
  return { documentId: doc.id, fileName: doc.fileName, docType: doc.docType, page, value: null, quote: text, ...(label ? { label } : {}) };
}

export interface InvoiceLineView {
  invoiceIndex: number;
  lineNo: string;
  /** Field-path prefix, e.g. "invoice[1]/line[2]". */
  path: string;
  doc: ExtractedDocument;
  cells: DocumentLine['cells'];
  style: string;
  quantity: ParsedNumber | null;
  unitPrice: ParsedNumber | null;
  amount: ParsedNumber | null;
}

export interface InvoiceView {
  index: number;
  doc: ExtractedDocument;
  path: string;
  lines: InvoiceLineView[];
}

export interface PackingRowView {
  doc: ExtractedDocument;
  cells: DocumentLine['cells'];
  style: string;
  quantity: ParsedNumber | null;
}

export interface ShipmentContext {
  documents: ExtractedDocument[];
  invoices: InvoiceView[];
  packingLists: ExtractedDocument[];
  billsOfLading: ExtractedDocument[];
  packingRows: PackingRowView[];
  /** The B/L used for manifest data (the first one). */
  bol: ExtractedDocument | null;
}

export function buildContext(documents: ExtractedDocument[]): ShipmentContext {
  const invoiceDocs = documents.filter((d) => d.docType === 'commercial_invoice');
  const invoices: InvoiceView[] = invoiceDocs.map((doc, i) => {
    const index = i + 1;
    const path = `invoice[${index}]`;
    const lines = doc.lines.map((line, li) => {
      const lineNo = line.cells.lineNo?.value?.trim() || String(li + 1);
      return {
        invoiceIndex: index,
        lineNo,
        path: `${path}/line[${lineNo}]`,
        doc,
        cells: line.cells,
        style: normalizeKey(line.cells.style?.value),
        quantity: parseNumber(line.cells.quantity?.value),
        unitPrice: parseNumber(line.cells.unitPrice?.value),
        amount: parseNumber(line.cells.amount?.value),
      };
    });
    return { index, doc, path, lines };
  });
  const packingLists = documents.filter((d) => d.docType === 'packing_list');
  const billsOfLading = documents.filter((d) => d.docType === 'bill_of_lading');
  const packingRows = packingLists.flatMap((doc) =>
    doc.lines.map((line) => ({ doc, cells: line.cells, style: normalizeKey(line.cells.style?.value), quantity: parseNumber(line.cells.quantity?.value) })),
  );
  return { documents, invoices, packingLists, billsOfLading, packingRows, bol: billsOfLading[0] ?? null };
}

export function allLines(ctx: ShipmentContext): InvoiceLineView[] {
  return ctx.invoices.flatMap((i) => i.lines);
}

/** Every text snippet of a document that rules may scan (fields, line descriptions, notes). */
export function scanTexts(doc: ExtractedDocument): { page: number | null; text: string }[] {
  const out: { page: number | null; text: string }[] = [];
  for (const t of doc.textLines) out.push({ page: t.page, text: t.text });
  for (const line of doc.lines) {
    const d = line.cells.description;
    if (d?.value) out.push({ page: d.page, text: d.value.replace(/\n/g, ' ') });
  }
  for (const f of Object.values(doc.fields)) {
    if (f.value) out.push({ page: f.page, text: f.quote ?? f.value });
  }
  return out;
}
