import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyBrokerInput, type ExtractedDocument, type SourceField } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { parseBillOfLading, parsePackingList } from '../src/extraction/documentParsers.js';
import { MIN_OCR_CONFIDENCE, extractDocument } from '../src/extraction/index.js';
import { LANG_PATH, shutdownOcr } from '../src/extraction/ocr.js';
import type { TextRow } from '../src/extraction/pdfText.js';

/**
 * OCR of the two scanned sample documents (tesseract.js 7.0.0, English model 4.0.0_best_int, local files only).
 * The expected readings below are what this engine version produces for these files, INCLUDING its misreads; they
 * are pinned to show that misreads stay visible and unverified, never silently corrected.
 */
const pdf = (name: string) => new Uint8Array(readFileSync(new URL(`../../sample-docs/${name}`, import.meta.url)));
const NOW = new Date('2026-10-11T00:00:00.000Z');
afterAll(() => shutdownOcr());

describe('OCR of scanned PDFs (local engine, no runtime download)', async () => {
  const pl = await extractDocument('SPG-PL-2609-117_Packing_List.pdf', pdf('SPG-PL-2609-117_Packing_List.pdf'));
  const bl = await extractDocument('BMLVHCM26090418_House_BL.pdf', pdf('BMLVHCM26090418_House_BL.pdf'));
  const v = (d: ExtractedDocument, k: string) => d.fields[k]?.value ?? null;

  it('uses the language data installed with the package (no CDN)', () => {
    expect(existsSync(`${LANG_PATH}/eng.traineddata.gz`)).toBe(true);
    expect(LANG_PATH).not.toMatch(/^https?:/);
  });

  it('reads the scans by OCR and recognises the document type from the OCR text', () => {
    for (const d of [pl, bl]) {
      expect(d.method).toBe('ocr');
      expect(d.docTypeSource).toBe('content');
      expect(d.warnings.join(' ')).toMatch(/Read by OCR .*unverified/);
      expect(d.textLines.length).toBeGreaterThan(20);
    }
    expect(pl.docType).toBe('packing_list');
    expect(bl.docType).toBe('bill_of_lading');
  });

  it('packing list: labelled values are read, with page, quote and confidence, all unverified', () => {
    expect({
      packingListNumber: v(pl, 'packingListNumber'), invoiceReference: v(pl, 'invoiceReference'), buyerPo: v(pl, 'buyerPo'),
      vesselName: v(pl, 'vesselName'), voyageNumber: v(pl, 'voyageNumber'), portOfLoading: v(pl, 'portOfLoading'), portOfDischarge: v(pl, 'portOfDischarge'),
      totalCartons: v(pl, 'totalCartons'), totalQuantity: v(pl, 'totalQuantity'), totalGrossWeight: v(pl, 'totalGrossWeight'), totalNetWeight: v(pl, 'totalNetWeight'),
    }).toEqual({
      packingListNumber: 'SPG-PL-2609-117', invoiceReference: 'KBAS/NB/26-0912', buyerPo: 'NB-26-0918', vesselName: 'PACIFIC ARGOS', voyageNumber: '041E',
      portOfLoading: 'CAT LAI, HCMC', portOfDischarge: 'TACOMA, WA', totalCartons: '138', totalQuantity: '5,100', totalGrossWeight: '1,888.00 KGS', totalNetWeight: '1,734.50 KGS',
    });
    for (const f of Object.values(pl.fields)) {
      expect(f.verification).toBe('unverified');
      expect(f.page).toBe(1);
      expect(f.quote).toBeTruthy();
      expect(typeof f.confidence).toBe('number');
    }
  });

  it('packing list goods table: all 5 rows are read by the second OCR pass (table lines removed), every cell unverified with its confidence', () => {
    const cells = (k: string) => pl.lines.map((l) => l.cells[k]?.value ?? null);
    expect(pl.lines).toHaveLength(5);
    // Same values as the reviewed transcription (fixtures/sample-transcriptions), except where noted.
    expect(cells('cartonRange')).toEqual(['1-48', '49-97', '98-127', '128-137', '138']);
    // W-B220 is read at 47% confidence: below the threshold, so it is withheld (not guessed) and must be entered.
    expect(cells('style')).toEqual(['NB-T101', 'NB-H205', 'NB-C330', null, 'NB-P118S']);
    expect(pl.lines[3].cells.style).toMatchObject({ confidence: 47, note: expect.stringMatching(/below 50% confidence/) });
    expect(cells('cartons')).toEqual(['48', '49', '30', '10', '1']);
    expect(cells('pcsPerCarton')).toEqual(['50', '24', '30', '60', '24']);
    expect(cells('quantity')).toEqual(['2,400', '1,176', '900', '600', '24']);
    expect(cells('description')).toEqual([
      "MEN'S CREW NECK S/S TEE\n100% COTTON JERSEY 160GSM", 'LADIES PULLOVER HOODIE\nTC 65/35 FLEECE 280GSM', "MEN'S SLIM CHINO PANT\n98/2 COTTON/SPANDEX TWILL",
      'LADIES L/S V-NECK BLOUSE\n100% POLY CREPE (BUYER FABRIC)', 'LADIES POLO - SAMPLES (FOC)\n100% COTTON PIQUE',
    ]);
    // Row 4's N.W./Ctn "9.60" is OCR-read as "960", so its weights fail the arithmetic check and stay empty (not repaired).
    expect(cells('netWeight')).toEqual(['432.00', '715.40', '486.00', null, '5.10']);
    expect(cells('grossWeight')).toEqual(['480.00', '774.20', '522.00', null, '5.80']);
    for (const l of pl.lines) {
      for (const f of Object.values(l.cells)) {
        expect(f.verification).toBe('unverified');
        expect(f.page).toBe(1);
        expect(f.quote).toBeTruthy();
        expect(typeof f.confidence).toBe('number');
      }
      expect(l.cells.quantity!.note).toMatch(/arithmetic check, not a verification.*second OCR pass with the table lines removed/);
    }
    expect(pl.warnings.join(' ')).toMatch(/5 goods row\(s\) read from the table/);
    expect(pl.warnings.join(' ')).not.toMatch(/add up to/); // 138 cartons and 5,100 pieces, as the grand total
  });

  it(`a reading below ${MIN_OCR_CONFIDENCE}% confidence is not offered as a value; its OCR text stays as evidence`, () => {
    const shipper = pl.fields.shipper as SourceField;
    expect(shipper.value).toBeNull();
    expect(shipper.confidence).toBeLessThan(MIN_OCR_CONFIDENCE);
    expect(shipper.note).toMatch(/below 50% confidence/);
    expect(shipper.quote).toMatch(/SAIGON/);
  });

  it('bill of lading: correct readings and OCR misreads are both kept as unverified readings, never corrected', () => {
    expect(v(bl, 'blNumber')).toBe('BMLVHCM26090418');
    expect(v(bl, 'grossWeight')).toBe('1,930.000 KGS');
    expect(v(bl, 'vesselName')).toBe('PACIFIC ARGOS');
    expect(v(bl, 'voyageNumber')).toBe('041E');
    expect(v(bl, 'carrier')).toBe('ORIENT PACIFIC LINES (OPLU)');
    // Misreads of this engine on this scan (printed "VN", "DOOR", "2026"): visible, unverified, not corrected.
    expect(v(bl, 'portOfLoading')).toBe('CAT LAI, HCMC, WN');
    expect(v(bl, 'placeOfDelivery')).toBe('KENT, WA (DODR)');
    expect(v(bl, 'shippedOnBoardDate')).toBe('24 SEP 206');
    expect(Object.values(bl.fields).every((f) => f.verification === 'unverified')).toBe(true);
    expect(v(bl, 'masterBlNumber')).toBeNull(); // not read: left empty, not guessed
  });

  it('a struck-through / handwritten container number is never read as certain', () => {
    expect(bl.containers.length).toBeGreaterThan(0);
    for (const c of bl.containers) {
      expect(c.marking).toBe('unknown');
      expect(c.number.verification).toBe('unverified');
      expect(c.number.value).not.toBe('OPLU3041722'); // the handwritten correction is not "read"
    }
    expect(bl.containers[0].seal?.value).toBe('OPL7731482');
    expect(bl.warnings.join(' ')).toMatch(/Handwritten corrections, stamps and signatures are not read reliably/);
  });

  describe('analysis with OCR documents', async () => {
    const invoice = await extractDocument('KBAS-NB-26-0912_Commercial_Invoice.pdf', pdf('KBAS-NB-26-0912_Commercial_Invoice.pdf'));
    const r = await analyzeShipment([invoice, pl, bl], emptyBrokerInput(), NOW);
    const field = (res: typeof r, p: string) => res.fields.find((f) => f.path === p)!;
    const confirm = (d: ExtractedDocument, keys: string[], patch: Partial<SourceField> = { verification: 'confirmed' }): ExtractedDocument =>
      ({ ...d, fields: Object.fromEntries(Object.entries(d.fields).map(([k, f]) => [k, keys.includes(k) ? { ...f, ...patch } : f])) });

    it('raises one blocking OCR_UNVERIFIED issue per OCR document and keeps the entry NOT READY', () => {
      const ocr = r.issues.filter((i) => i.rule === 'OCR_UNVERIFIED');
      expect(ocr.map((i) => i.id).sort()).toEqual([`OCR_UNVERIFIED:${bl.id}`, `OCR_UNVERIFIED:${pl.id}`].sort());
      expect(ocr.every((i) => i.blocking && i.resolution === 'open')).toBe(true);
      expect(ocr.flatMap((i) => i.evidence).every((e) => e.ocr && !e.ocr.verified)).toBe(true);
      expect(r.status).toBe('NOT_READY_TO_FILE');
    });

    it('unverified OCR readings never reach the XML; cross-document conflicts are still shown with OCR evidence', () => {
      expect(field(r, 'header/vessel-name')).toMatchObject({ value: null, provenance: 'withheld' });
      expect(field(r, 'header/vessel-name').issueIds).toContain(`OCR_UNVERIFIED:${bl.id}`);
      expect(r.xml).not.toContain('<vessel-name>');
      const gw = r.issues.find((i) => i.rule === 'GROSS_WEIGHT_MISMATCH')!;
      expect(gw.evidence.filter((e) => e.ocr).map((e) => e.value).sort()).toEqual(['1,888.00 KGS', '1,930.000 KGS']);
    });

    it('acknowledging the OCR issue without verifying keeps it blocking', async () => {
      const id = `OCR_UNVERIFIED:${bl.id}`;
      const acked = await analyzeShipment([invoice, pl, bl], { ...emptyBrokerInput(), acknowledgements: { [id]: { note: 'looked at it' } } }, NOW);
      expect(acked.issues.find((i) => i.id === id)).toMatchObject({ resolution: 'acknowledged' });
      expect(acked.issues.find((i) => i.id === id)!.pendingFields).toContain('header/vessel-name');
    });

    it('confirming, correcting and rejecting readings are re-evaluated; a value is written only once every source is verified', async () => {
      const pl2 = confirm(pl, ['vesselName', 'voyageNumber']);
      const bl2 = confirm(confirm(bl, ['vesselName', 'voyageNumber']), ['portOfLoading'], { value: 'CAT LAI, HCMC, VN', verification: 'corrected' });
      const onlyBl = await analyzeShipment([invoice, pl, bl2], emptyBrokerInput(), NOW);
      expect(field(onlyBl, 'header/vessel-name').value).toBeNull(); // the packing list's reading is still unverified
      const both = await analyzeShipment([invoice, pl2, bl2], emptyBrokerInput(), NOW);
      expect(field(both, 'header/vessel-name')).toMatchObject({ value: 'PACIFIC ARGOS', provenance: 'extracted' });
      expect(both.xml).toContain('<vessel-name>PACIFIC ARGOS</vessel-name>');
      const evidence = both.issues.find((i) => i.id === `OCR_UNVERIFIED:${bl.id}`)!.evidence.map((e) => e.label);
      expect(evidence).not.toContain('portOfLoading'); // corrected → no longer pending
      const rejected = confirm(bl2, ['grossWeight'], { value: null, verification: 'rejected' });
      const afterReject = await analyzeShipment([invoice, pl2, rejected], emptyBrokerInput(), NOW);
      expect(afterReject.issues.find((i) => i.id === `OCR_UNVERIFIED:${bl.id}`)!.evidence.map((e) => e.label)).not.toContain('grossWeight');
      expect(field(afterReject, 'header/gross-weight').value).toBeNull();
    });

    it('when every OCR reading is verified, the OCR issue disappears', async () => {
      // Fields, goods-table cells and container readings: every OCR reading must be verified.
      const all = (d: ExtractedDocument) => ({ ...confirm(d, Object.keys(d.fields)), lines: d.lines.map((l) => ({ cells: Object.fromEntries(Object.entries(l.cells).map(([k, f]) => [k, { ...f, verification: 'confirmed' as const }])) })), containers: d.containers.map((c) => ({ ...c, number: { ...c.number, verification: 'confirmed' as const }, ...(c.seal ? { seal: { ...c.seal, verification: 'confirmed' as const } } : {}) })) });
      const res = await analyzeShipment([invoice, all(pl), all(bl)], emptyBrokerInput(), NOW);
      expect(res.issues.some((i) => i.rule === 'OCR_UNVERIFIED')).toBe(false);
    });

    it('on the PDF-only path, the invoice lines are compared with the OCR-read packing-list rows (C-2 / C-3 found)', () => {
      expect(r.issues.some((i) => i.rule === 'PACKING_LIST_ROWS_NOT_READ')).toBe(false);
      const ids = (rule: string) => r.issues.filter((i) => i.rule === rule).map((i) => i.id);
      expect(ids('QUANTITY_MISMATCH')).toEqual(['QUANTITY_MISMATCH:invoice[1]/line[2]']); // 1,200 vs 1,176
      expect(ids('FIBRE_MISMATCH')).toEqual(['FIBRE_MISMATCH:invoice[1]/line[2]']); // 60/40 vs 65/35
      const q = r.issues.find((i) => i.rule === 'QUANTITY_MISMATCH')!;
      expect(q.evidence.find((e) => e.label === 'packing-list quantity')).toMatchObject({ value: '1,176', ocr: { verified: false } });
      // The row whose style could not be read is pointed at, not silently dropped.
      expect(ids('STYLE_NOT_ON_PACKING_LIST')).toEqual(['STYLE_NOT_ON_PACKING_LIST:invoice[1]/line[4]']);
      expect(r.issues.find((i) => i.rule === 'STYLE_NOT_ON_PACKING_LIST')!.explanation).toMatch(/1 packing-list row\(s\) have no \(readable\) style/);
      expect(ids('PACKING_LIST_ROWS_TOTAL')).toEqual([]);
      // Comparisons use unverified readings, but nothing that rests on them reaches the XML.
      expect(r.xml).not.toMatch(/<invoice-quantity>(1176|1200)</); // the NB-H205 line quantity is withheld
    });

    it('once the user enters the unreadable style from the page, all five invoice lines are compared with the packing list', async () => {
      const lines = pl.lines.map((l, i) => (i === 3 ? { cells: { ...l.cells, style: { ...l.cells.style!, value: 'W-B220', verification: 'corrected' as const } } } : l));
      const res = await analyzeShipment([invoice, { ...pl, lines }, bl], emptyBrokerInput(), NOW);
      const rules = res.issues.map((i) => i.rule);
      for (const rule of ['PACKING_LIST_ROWS_NOT_READ', 'STYLE_NOT_ON_PACKING_LIST', 'STYLE_NOT_ON_INVOICE', 'QUANTITY_NOT_COMPARED', 'PACKING_LIST_ROWS_TOTAL']) expect(rules).not.toContain(rule);
      expect(res.issues.filter((i) => i.rule === 'QUANTITY_MISMATCH' || i.rule === 'FIBRE_MISMATCH').map((i) => i.id).sort())
        .toEqual(['FIBRE_MISMATCH:invoice[1]/line[2]', 'QUANTITY_MISMATCH:invoice[1]/line[2]']);
    });

    it('on the PDF-only path, the unreadable container number is described as unreadable, never as "null" (regression)', () => {
      // The container reading below the confidence threshold is described as unreadable (previously rendered as "null (unknown)").
      const c = r.issues.find((i) => i.rule === 'CONTAINER_NUMBER')!;
      expect(c.explanation).not.toMatch(/\bnull\b/);
      expect(c.explanation).toMatch(/no reliable reading \(source text: "BRLU3841728/);
    });
  });
});

describe('OCR failure is reported, never an empty successful read', () => {
  it('a page with neither a text layer nor an image is "not read", with the reason', async () => {
    // Minimal valid one-page PDF without content.
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'];
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = body.length;
    body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const d = await extractDocument('blank-packing-list.pdf', new TextEncoder().encode(body));
    expect(d.method).toBe('unavailable');
    expect(d.warnings.join(' ')).toMatch(/OCR failed: The page has neither a text layer nor an embedded image/);
    expect(d.fields).toEqual({});
  });
});

describe('document readers on a different (synthetic) layout', () => {
  const row = (page: number, y: number, ...cells: [number, string][]): TextRow => ({ page, y, items: cells.map(([x, text]) => ({ x, text })), text: cells.map((c) => c[1]).join('  ') });

  it('packing list: labels with different values and spacing', () => {
    const p = parsePackingList([
      row(1, 800, [40, 'PACKING LIST']),
      row(1, 780, [40, 'P/L No: TST-PL-77'], [300, 'Date: 05-Mar-2026']),
      row(1, 770, [40, 'Ref. Invoice: TST/INV/001'], [300, 'Buyer P.O.: PO-TEST-9']),
      row(1, 760, [40, 'Vessel: TEST CARRIER 017W'], [300, 'Cntr: 2 x 40\'HC']),
      row(1, 750, [40, 'From: TESTPORT A To: LONG BEACH, CA']),
      row(1, 300, [40, 'GRAND TOTAL:'], [200, '10'], [260, '150']),
      row(1, 290, [40, 'TOTAL N.W.: 200.00 KGS'], [300, 'TOTAL G.W.: 250.00 KGS'], [450, 'TOTAL MEAS.: 3.20 CBM']),
    ]);
    expect(Object.fromEntries(Object.entries(p.fields).map(([k, f]) => [k, f.value]))).toEqual({
      packingListNumber: 'TST-PL-77', packingListDate: '05-Mar-2026', invoiceReference: 'TST/INV/001', buyerPo: 'PO-TEST-9', vesselName: 'TEST CARRIER',
      voyageNumber: '017W', portOfLoading: 'TESTPORT A', portOfDischarge: 'LONG BEACH, CA', containerSummary: "2 x 40'HC", totalCartons: '10', totalQuantity: '150',
      totalNetWeight: '200.00 KGS', totalGrossWeight: '250.00 KGS', totalVolume: '3.20 CBM',
    });
    // Text-layer values carry no OCR confidence or review state.
    expect(Object.values(p.fields).every((f) => f.confidence === undefined && f.verification === undefined)).toBe(true);
  });

  it('bill of lading: column grids, container/seal and missing labels left empty', () => {
    const b = parseBillOfLading([
      row(1, 800, [40, 'Shipper / Exporter'], [320, 'BILL OF LADING']),
      row(1, 790, [40, 'TEST SHIPPER CO'], [320, 'SCAC: TSTC']),
      row(1, 780, [320, 'B/L No.'], [450, 'Booking No.']),
      row(1, 770, [320, 'TSTC0000001'], [450, 'BK-12345']),
      row(1, 600, [40, 'Place of Receipt'], [200, 'Ocean Vessel / Voy. No.'], [380, 'Port of Loading']),
      row(1, 590, [40, 'TEST CITY'], [200, 'TEST CARRIER 017W'], [380, 'TESTPORT A']),
      row(1, 580, [40, 'Port of Discharge'], [200, 'Place of Delivery']),
      row(1, 570, [40, 'LONG BEACH, CA'], [200, 'ONTARIO, CA']),
      row(1, 500, [40, 'CSQU3054383'], [200, '10 CARTONS OF TEST GOODS'], [420, '250.00 KGS'], [500, '3.20 CBM']),
      row(1, 490, [40, 'SEAL: TS123456']),
    ]);
    const val = (k: string) => b.fields[k]?.value ?? null;
    expect([val('blNumber'), val('bookingNumber'), val('issuerScac'), val('shipper')]).toEqual(['TSTC0000001', 'BK-12345', 'TSTC', 'TEST SHIPPER CO']);
    expect([val('vesselName'), val('voyageNumber'), val('portOfLoading'), val('placeOfReceipt')]).toEqual(['TEST CARRIER', '017W', 'TESTPORT A', 'TEST CITY']);
    expect([val('portOfDischarge'), val('placeOfDelivery'), val('packages'), val('grossWeight'), val('measurement')]).toEqual(['LONG BEACH, CA', 'ONTARIO, CA', '10 CARTONS', '250.00 KGS', '3.20 CBM']);
    expect(b.containers.map((c) => [c.number.value, c.seal?.value, c.marking])).toEqual([['CSQU3054383', 'TS123456', 'unknown']]);
    expect(val('masterBlNumber')).toBeNull();
    expect(val('consignee')).toBeNull();
  });
});
