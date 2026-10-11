import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyByContent, classifyByFileName } from '../src/extraction/classify.js';
import { UnsupportedFileError, extractDocument } from '../src/extraction/index.js';
import { parseInvoiceRows } from '../src/extraction/invoiceParser.js';
import type { TextRow } from '../src/extraction/pdfText.js';
import { documentFromTranscription } from '../src/extraction/transcription.js';

const pdf = (name: string) => new Uint8Array(readFileSync(new URL(`../../sample-docs/${name}`, import.meta.url)));

describe('text-layer extraction of the sample commercial invoice', async () => {
  const d = await extractDocument('KBAS-NB-26-0912_Commercial_Invoice.pdf', pdf('KBAS-NB-26-0912_Commercial_Invoice.pdf'));

  it('classifies by content and reads both pages', () => {
    expect(d).toMatchObject({ docType: 'commercial_invoice', docTypeSource: 'content', method: 'text_layer', pageCount: 2 });
    expect(d.warnings).toEqual([]);
  });
  it('extracts header fields exactly as printed, with page and quote', () => {
    const v = (k: string) => d.fields[k]?.value;
    expect(v('invoiceNumber')).toBe('KBAS/NB/26-0912');
    expect(v('invoiceDate')).toBe('12/09/2026');
    expect(v('currency')).toBe('USD');
    expect(v('incoterms')).toBe('CIF TACOMA, WA (INCOTERMS 2020)');
    expect(v('vesselName')).toBe('PACIFIC ARGOS');
    expect(v('voyageNumber')).toBe('041E');
    expect(v('subtotal')).toBe('21,975.00');
    expect(v('totalGoodsValue')).toBe('23,235.00');
    expect(v('freight')).toBe('3,850.00');
    expect(v('insurance')).toBe('185.00');
    expect(v('totalInvoiceValue')).toBe('27,270.00');
    expect(v('soldTo')).toBe('NORTHBOUND OUTFITTERS, INC.');
    expect(v('shipTo')).toBe('CASCADE FULFILLMENT PARTNERS LLC');
    expect(d.fields.freight.page).toBe(2);
    expect(d.fields.invoiceNumber.quote).toContain('Invoice No.:');
  });
  it('extracts all 5 lines without correcting any value', () => {
    expect(d.lines).toHaveLength(5);
    const cell = (i: number, k: string) => d.lines[i].cells[k]?.value;
    expect(cell(0, 'amount')).toBe('6,480.00'); // printed value preserved (C-1)
    expect(cell(1, 'quantity')).toBe('1,200');
    expect(cell(3, 'unitPrice')).toBe('2.10 *');
    expect(cell(4, 'unitPrice')).toBe('(1.00)');
    expect(cell(4, 'origin')).toBe('Bangladesh');
    expect(cell(1, 'description')).toContain('60% Cotton 40% Polyester');
    expect(d.lines.map((l) => l.cells.hsCode?.value)).toEqual(['6109.10', '6110.20', '6203.42', '6206.40', '6106.10']);
  });
  it('keeps notes and declarations as text lines for the review rules', () => {
    expect(d.textLines.some((t) => t.text.includes('value USD 4,180.00'))).toBe(true);
    expect(d.textLines.some((t) => /Vietnam/.test(t.text) && /origin/.test(t.text))).toBe(true);
  });
});

// Scanned PDFs are read by OCR: see ocr.test.ts. Without OCR (sample loader), a scan is reported as not read:
describe('scanned PDFs with OCR switched off', () => {
  it.each(['SPG-PL-2609-117_Packing_List.pdf', 'BMLVHCM26090418_House_BL.pdf'])('%s is reported as not read, type guessed from file name', async (name) => {
    const d = await extractDocument(name, pdf(name), { ocr: false });
    expect(d.method).toBe('unavailable');
    expect(d.docTypeSource).toBe('file_name_guess');
    expect(Object.keys(d.fields)).toHaveLength(0);
    expect(d.warnings.join(' ')).toMatch(/OCR was not requested/);
  });
});

describe('invalid files', () => {
  it('rejects non-PDF, empty and corrupt files', async () => {
    await expect(extractDocument('a.txt', new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(UnsupportedFileError);
    await expect(extractDocument('empty.pdf', new Uint8Array())).rejects.toBeInstanceOf(UnsupportedFileError);
    await expect(extractDocument('broken.pdf', new TextEncoder().encode('%PDF-1.7 this is not a real pdf'))).rejects.toBeInstanceOf(UnsupportedFileError);
  });
});

describe('classification', () => {
  it('uses the earliest document title in the text', () => {
    expect(classifyByContent('COMMERCIAL INVOICE ... Factory packing list attached')).toBe('commercial_invoice');
    expect(classifyByContent('BILL OF LADING')).toBe('bill_of_lading');
    expect(classifyByContent('Quotation')).toBeNull();
  });
  it('guesses from file names only when unambiguous', () => {
    expect(classifyByFileName('SPG-PL-2609-117_Packing_List.pdf')).toBe('packing_list');
    expect(classifyByFileName('BMLVHCM26090418_House_BL.pdf')).toBe('bill_of_lading');
    expect(classifyByFileName('scan001.pdf')).toBeNull();
  });
});

describe('invoice parser on a different (synthetic) layout', () => {
  const row = (page: number, y: number, ...items: [number, string][]): TextRow => ({ page, y, items: items.map(([x, text]) => ({ x, text })), text: items.map((i) => i[1]).join('  ') });
  const rows: TextRow[] = [
    row(1, 800, [50, 'TEST EXPORTS SA DE CV']),
    row(1, 760, [50, 'Invoice Number:'], [150, 'MX-77'], [320, 'Terms of Delivery:'], [430, 'FOB MANZANILLO']),
    row(1, 745, [50, 'Date: 2026-03-05'], [320, 'Currency: USD']),
    row(1, 730, [50, 'Vessel:'], [150, 'TEST STAR'], [320, 'Voyage No.:'], [430, '12N']),
    row(1, 700, [40, 'No.'], [70, 'Item'], [200, 'Description'], [330, 'HS Code'], [380, 'Qty'], [420, 'Unit'], [450, 'Price'], [510, 'Amount']),
    row(1, 685, [45, '1'], [70, 'A-1'], [120, 'STEEL BRACKET'], [330, '7326.90'], [385, '10'], [420, 'PCS'], [455, '3.00'], [515, '30.00']),
    row(1, 676, [120, 'Origin: Mexico']),
    row(1, 640, [300, 'TOTAL FOB VALUE:'], [515, '30.00']),
  ];
  const r = parseInvoiceRows(rows);
  it('recognises alternative label wording', () => {
    expect(r.fields.invoiceNumber?.value).toBe('MX-77');
    expect(r.fields.incoterms?.value).toBe('FOB MANZANILLO');
    expect(r.fields.invoiceDate?.value).toBe('2026-03-05');
    expect(r.fields.vesselName?.value).toBe('TEST STAR');
    expect(r.fields.voyageNumber?.value).toBe('12N');
    expect(r.fields.totalGoodsValue?.value).toBe('30.00');
  });
  it('reads table rows and line-level origin', () => {
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].cells.amount?.value).toBe('30.00');
    expect(r.lines[0].cells.origin?.value).toBe('Mexico');
  });
  it('warns instead of guessing when no table is recognised', () => {
    const none = parseInvoiceRows([row(1, 800, [50, 'Invoice No.: X-1'])]);
    expect(none.lines).toHaveLength(0);
    expect(none.warnings.join(' ')).toMatch(/No goods-table rows/);
  });
});

describe('manual transcription', () => {
  it('refuses to attach a transcription to a different file', async () => {
    const bl = await extractDocument('BMLVHCM26090418_House_BL.pdf', pdf('BMLVHCM26090418_House_BL.pdf'), { ocr: false });
    const t = JSON.parse(readFileSync(new URL('../../fixtures/sample-transcriptions/SPG-PL-2609-117_Packing_List.transcription.json', import.meta.url), 'utf8'));
    expect(() => documentFromTranscription(t, bl)).toThrow(/different file/);
  });
  it('rejects a malformed transcription', () => {
    expect(() => documentFromTranscription({ format: 'sefer-transcription/v1', document: {} })).toThrow();
  });
});
