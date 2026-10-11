import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, ExtractedDocument } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { parsePackingList } from '../src/extraction/documentParsers.js';
import { removeRules } from '../src/extraction/ocr.js';
import { parsePackingTable } from '../src/extraction/packingListTable.js';
import type { TextRow } from '../src/extraction/pdfText.js';
import { loadSampleDocuments } from '../src/sample.js';

/**
 * Goods-table reader. The rows below copy the STRUCTURE of the sample packing list as the OCR table pass returns it
 * (word x positions in PDF points, two-line descriptions, colour/size column, 7 number columns, carton size), with the
 * values printed on the sample. Altered rows are labelled as such.
 */

const NOW = new Date('2026-10-11T00:00:00.000Z');
/** One OCR-style row: one item per word, right edge estimated from the word length. */
const ocrRow = (y: number, words: [number, string, number?][]): TextRow => ({
  page: 1, y: -y, confidence: 90,
  items: words.map(([x, text, c]) => ({ x, x1: x + text.length * 5.2, text, confidence: c ?? 95 })),
  text: words.map((w) => w[1]).join('  '),
});
const words = (x: number, s: string, step = 0): [number, string][] => s.split(' ').map((w, i, all) => [x + all.slice(0, i).reduce((n, p) => n + p.length * 5.2 + 4, 0) + step * i, w]);
const nums = (s: string): [number, string][] => {
  const xs = [475, 507, 536, 584, 624, 671, 723, 778];
  return s.split(' ').map((w, i) => [xs[i], w]);
};

/** The five goods rows of the sample packing list, as printed. */
const SAMPLE_TABLE: TextRow[] = [
  ocrRow(170, [[40, 'Carton'], [67, 'No.'], [97, 'Style'], [133, 'Description'], [311, 'Colour'], [475, 'Ctns']]),
  ocrRow(210, [[50, '1-48'], [92, 'NB-T101'], ...words(133, "MEN'S CREW NECK S/S TEE"), ...words(311, 'BLACK / WHITE / HTHR NAVY'), ...nums('48 50 2,400 9.00 10.00 432.00 480.00 60x40x35')]),
  ocrRow(222, [...words(133, '100% COTTON JERSEY 160GSM'), ...words(311, 'S1 M3 L3 XL2 XXL1 (x5 per size run)')]),
  ocrRow(236, [[47, '49-97'], [92, 'NB-H205'], ...words(134, 'LADIES PULLOVER HOODIE'), ...words(312, 'OATMEAL / SAGE'), ...nums('49 24 1,176 14.60 15.80 715.40 774.20 60x45x45')]),
  ocrRow(250, [...words(133, 'TC 65/35 FLEECE 280GSM'), ...words(312, 'XS2 S4 M6 L6 XL6')]),
  ocrRow(270, [[46, '98-127'], [93, 'NB-C330'], ...words(134, "MEN'S SLIM CHINO PANT"), ...words(312, 'KHAKI / OLIVE / NAVY'), ...nums('30 30 900 16.20 17.40 486.00 522.00 60x40x40')]),
  ocrRow(282, [...words(134, '98/2 COTTON/SPANDEX TWILL'), ...words(312, 'W30-3 W32-6 W34-9 W36-9 W38-3')]),
  ocrRow(299, [[45, '128'], [60, '-'], [66, '137'], [95, 'W-B220'], ...words(134, 'LADIES L/S V-NECK BLOUSE'), ...words(312, 'IVORY / BLACK'), ...nums('10 60 600 9.60 10.60 96.00 106.00 55x40x30')]),
  ocrRow(313, [...words(135, '100% POLY CREPE (BUYER FABRIC)'), ...words(313, 'XS6 S12 M18 L18 XL6')]),
  ocrRow(329, [[56, '138'], [92, 'NB-P118S'], ...words(135, 'LADIES POLO - SAMPLES (FOC)'), [313, 'ASSORTED'], ...nums('1 24 24 5.10 5.80 5.10 5.80 50x35x30')]),
  ocrRow(340, [...words(135, '100% COTTON PIQUE'), ...words(313, '1 PC PER COLOUR/SIZE **')]),
  ocrRow(358, [[42, 'GRAND'], [74, 'TOTAL'], [471, '138'], [535, '5,100'], [662, '1,734.50'], [714, '1,888.00'], [772, '13.58'], [798, 'CBM']]),
];
const val = (t: ReturnType<typeof parsePackingTable>, k: string) => t.lines.map((l) => l.cells[k]?.value ?? null);
const replaceRow = (i: number, row: TextRow) => SAMPLE_TABLE.map((r, j) => (j === i ? row : r));

describe('packing-list goods table reader', () => {
  it('reads all five rows of the sample structure, matching the reviewed transcription', () => {
    const t = parsePackingTable(SAMPLE_TABLE);
    expect(t.warnings).toEqual([]);
    expect(val(t, 'style')).toEqual(['NB-T101', 'NB-H205', 'NB-C330', 'W-B220', 'NB-P118S']);
    expect(val(t, 'cartonRange')).toEqual(['1-48', '49-97', '98-127', '128 - 137', '138']);
    expect(val(t, 'cartons')).toEqual(['48', '49', '30', '10', '1']);
    expect(val(t, 'pcsPerCarton')).toEqual(['50', '24', '30', '60', '24']);
    expect(val(t, 'quantity')).toEqual(['2,400', '1,176', '900', '600', '24']);
    expect(val(t, 'netWeight')).toEqual(['432.00', '715.40', '486.00', '96.00', '5.10']);
    expect(val(t, 'grossWeight')).toEqual(['480.00', '774.20', '522.00', '106.00', '5.80']);
    expect(val(t, 'description')).toEqual([
      "MEN'S CREW NECK S/S TEE\n100% COTTON JERSEY 160GSM", 'LADIES PULLOVER HOODIE\nTC 65/35 FLEECE 280GSM', "MEN'S SLIM CHINO PANT\n98/2 COTTON/SPANDEX TWILL",
      'LADIES L/S V-NECK BLOUSE\n100% POLY CREPE (BUYER FABRIC)', 'LADIES POLO - SAMPLES (FOC)\n100% COTTON PIQUE',
    ]);
    // Evidence: page, the row text as quote (both lines for a description), and the OCR confidence of the words used.
    expect(t.lines[0].cells.quantity).toMatchObject({ page: 1, confidence: 95, quote: expect.stringContaining('48 50 2,400'), note: expect.stringMatching(/48 × 50 = 2,400.*not a verification/) });
    expect(t.lines[0].cells.description.quote).toMatch(/NB-T101 .* \/ 100% COTTON JERSEY 160GSM/);
  });

  it('with all five rows readable, every invoice line is compared with the packing list (same result as the reviewed transcription)', async () => {
    const docs = await loadSampleDocuments();
    const pl = docs.find((d) => d.docType === 'packing_list')!;
    const lines = parsePackingTable(SAMPLE_TABLE).lines;
    const fromTable = await analyzeShipment(docs.map((d) => (d === pl ? { ...d, lines } : d)), emptyBrokerInput(), NOW);
    const fromTranscription = await analyzeShipment(docs, emptyBrokerInput(), NOW);
    const ids = (r: typeof fromTable) => r.issues.map((i) => i.id).filter((id) => /QUANTITY|FIBRE|STYLE_NOT|PACKING_|ROWS/.test(id)).sort();
    expect(ids(fromTable)).toEqual(['FIBRE_MISMATCH:invoice[1]/line[2]', 'QUANTITY_MISMATCH:invoice[1]/line[2]']);
    expect(ids(fromTable)).toEqual(ids(fromTranscription));
  });

  it('a misread number fails the arithmetic: the weights are left empty, never repaired (as on the real scan: 9.60 → 960)', () => {
    const t = parsePackingTable(replaceRow(7, ocrRow(299, [[45, '128-137'], [95, 'W-B220'], ...words(134, 'LADIES L/S V-NECK BLOUSE'), ...nums('10 60 600 960 10.60 96.00 106.00 55x40x30')])));
    expect(t.lines[3].cells).toMatchObject({ style: { value: 'W-B220' }, quantity: { value: '600' } });
    expect(t.lines[3].cells.netWeight).toBeUndefined();
    expect(t.lines[3].cells.grossWeight).toBeUndefined();
  });

  it('a row whose quantities do not check is not listed, and the warning names it (nothing is invented)', () => {
    // ALTERED: "2,400" misread as "2,40O" → no cartons × pcs = total among the numbers.
    const t = parsePackingTable(replaceRow(1, ocrRow(210, [[50, '1-48'], [92, 'NB-T101'], ...words(133, "MEN'S CREW NECK S/S TEE"), ...nums('48 50 2,40O 9.00 10.00 432.00 480.00 60x40x35')])));
    expect(val(t, 'style')).toEqual(['NB-H205', 'NB-C330', 'W-B220', 'NB-P118S']);
    expect(t.warnings.join(' ')).toMatch(/Goods row\(s\) for NB-T101 could not be read reliably/);
  });

  it('a stray mark between the columns does not shift the values; the carton range is never taken for the carton count', () => {
    // ALTERED: a stray "2" between the columns (as OCR produced once on the real scan) and a carton range "1 - 48".
    const t = parsePackingTable(replaceRow(1, ocrRow(210, [[50, '1'], [56, '-'], [60, '48'], [92, 'NB-T101'], ...words(133, "MEN'S CREW NECK S/S TEE"), [460, '2'], ...nums('48 50 2,400 9.00 10.00 432.00 480.00 60x40x35')])));
    expect(t.lines[0].cells).toMatchObject({ cartonRange: { value: '1 - 48' }, cartons: { value: '48' }, pcsPerCarton: { value: '50' }, quantity: { value: '2,400' } });
  });

  it('text-layer rows (one item per cell, with widths) are read the same way', () => {
    const item = (x: number, text: string, width: number) => ({ x, x1: x + width, text });
    const row: TextRow = {
      page: 1, y: 500, text: '',
      items: [item(50, '1 - 48', 22), item(92, 'NB-T101', 33), item(133, "MEN'S CREW NECK S/S TEE", 95), item(311, 'BLACK / WHITE', 60), item(475, '48', 9), item(507, '50', 9), item(536, '2,400', 22), item(584, '9.00', 18), item(624, '10.00', 22), item(671, '432.00', 27), item(723, '480.00', 27)],
    };
    const t = parsePackingTable([row]);
    expect(t.lines[0].cells).toMatchObject({ cartonRange: { value: '1 - 48' }, style: { value: 'NB-T101' }, description: { value: "MEN'S CREW NECK S/S TEE" }, quantity: { value: '2,400' }, grossWeight: { value: '480.00' } });
    expect(t.lines[0].cells.quantity.confidence).toBeUndefined(); // text layer: no OCR confidence
  });

  it('rows without a style code or without numbers are not goods rows; an empty table yields no rows and says so', () => {
    expect(parsePackingTable([SAMPLE_TABLE[0], SAMPLE_TABLE[2], SAMPLE_TABLE[11]]).lines).toEqual([]);
    const p = parsePackingList([ocrRow(100, [[40, 'PACKING'], [80, 'LIST']])]);
    expect(p.lines).toEqual([]);
    expect(p.warnings.join(' ')).toMatch(/No goods row of the packing list could be read/);
  });

  it('rows that do not add up to the grand total are reported at extraction', () => {
    const header = [ocrRow(100, [[40, 'GRAND'], [74, 'TOTAL'], [471, '138'], [535, '5,100']])];
    const p = parsePackingList([...header, ...SAMPLE_TABLE.slice(0, 4)], SAMPLE_TABLE.slice(0, 4));
    expect(p.lines).toHaveLength(2);
    expect(p.warnings.join(' ')).toMatch(/add up to 97 cartons and 3576 pieces; the grand total reads 138 cartons and 5,100 pieces/);
  });
});

describe('rules on packing-list rows: never skipped silently', async () => {
  const docs = await loadSampleDocuments();
  const pl = docs.find((d) => d.docType === 'packing_list')!;
  const withLines = (lines: ExtractedDocument['lines']) => docs.map((d) => (d === pl ? { ...d, lines } : d));

  it('a matched row without a readable quantity raises QUANTITY_NOT_COMPARED (blocking) instead of skipping the check', async () => {
    const lines = pl.lines.map((l, i) => (i === 1 ? { cells: { ...l.cells, quantity: { ...l.cells.quantity!, value: null } } } : l));
    const r = await analyzeShipment(withLines(lines), emptyBrokerInput(), NOW);
    expect(r.issues.find((i) => i.rule === 'QUANTITY_NOT_COMPARED')).toMatchObject({ id: 'QUANTITY_NOT_COMPARED:invoice[1]/line[2]', blocking: true, affects: ['invoice[1]/line[2]/invoice-quantity'] });
    expect(r.issues.some((i) => i.rule === 'QUANTITY_MISMATCH')).toBe(false);
  });

  it('rows that do not add up to the grand total raise PACKING_LIST_ROWS_TOTAL', async () => {
    const r = await analyzeShipment(withLines(pl.lines.slice(0, 4)), emptyBrokerInput(), NOW);
    expect(r.issues.find((i) => i.rule === 'PACKING_LIST_ROWS_TOTAL')).toMatchObject({ blocking: true, explanation: expect.stringMatching(/add up to 5076 pieces; .* reads 5,100/) });
  });

  it('a row without a readable style is pointed at from the unmatched invoice line', async () => {
    const lines = pl.lines.map((l, i) => (i === 3 ? { cells: { ...l.cells, style: { ...l.cells.style!, value: null } } } : l));
    const r = await analyzeShipment(withLines(lines), emptyBrokerInput(), NOW);
    const i = r.issues.find((x) => x.id === 'STYLE_NOT_ON_PACKING_LIST:invoice[1]/line[4]')!;
    expect(i.explanation).toMatch(/1 packing-list row\(s\) have no \(readable\) style number/);
    expect(i.evidence.map((e) => e.label)).toContain('packing-list row without a readable style');
  });
});

describe('ruling-line removal before table OCR', () => {
  it('erases long horizontal and vertical lines but keeps short strokes (text)', () => {
    const w = 200, h = 100, g = new Uint8Array(w * h).fill(255);
    for (let x = 10; x < 190; x++) g[50 * w + x] = 0; // horizontal rule, 180 px
    for (let y = 5; y < 95; y++) g[y * w + 100] = 0; // vertical rule, 90 px
    for (let x = 20; x < 30; x++) g[20 * w + x] = 0; // a 10 px stroke (part of a glyph)
    removeRules(g, w, h, 60);
    expect(g[50 * w + 60]).toBe(255);
    expect(g[30 * w + 100]).toBe(255);
    expect(g[20 * w + 25]).toBe(0);
  });
});

describe('extracted documents still satisfy the shared schema', () => {
  it('table lines use only the packing-list line cells', () => {
    const lines = parsePackingTable(SAMPLE_TABLE).lines;
    expect(() => ExtractedDocument.parse({ id: 'x', fileName: 'x.pdf', sha256: null, docType: 'packing_list', docTypeSource: 'content', method: 'ocr', pageCount: 1, fields: {}, lines, containers: [], textLines: [], warnings: [] })).not.toThrow();
  });
});
