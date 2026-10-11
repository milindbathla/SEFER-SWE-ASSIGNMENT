import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnalyzeRequest, BrokerInput, ExtractedDocument, PATTERNS, TranscriptionFile, emptyBrokerInput, isDollarAmount, isValidIsoDate } from '../src/index.js';

const base = {
  id: 'doc-1', fileName: 'x.pdf', sha256: null, docType: 'commercial_invoice', docTypeSource: 'content', method: 'text_layer', pageCount: 1,
  fields: { invoiceNumber: { value: 'INV-1', page: 1, quote: 'Invoice No.: INV-1' } }, lines: [], containers: [], textLines: [], warnings: [],
};

describe('ExtractedDocument schema', () => {
  it('accepts a well-formed document', () => {
    expect(ExtractedDocument.safeParse(base).success).toBe(true);
  });
  it('rejects field keys that are not defined for the document type', () => {
    const r = ExtractedDocument.safeParse({ ...base, fields: { grossWeight: { value: '1', page: 1, quote: null } } });
    expect(r.success).toBe(false);
  });
  it('rejects malformed extraction output (missing evidence keys, bad page)', () => {
    expect(ExtractedDocument.safeParse({ ...base, fields: { invoiceNumber: { value: 'x' } } }).success).toBe(false);
    expect(ExtractedDocument.safeParse({ ...base, fields: { invoiceNumber: { value: 'x', page: 0, quote: null } } }).success).toBe(false);
    expect(ExtractedDocument.safeParse({ ...base, method: 'vision' }).success).toBe(false);
  });

  it('accepts OCR readings only with a valid confidence and review state', () => {
    const ocr = (f: object) => ExtractedDocument.safeParse({ ...base, method: 'ocr', fields: { invoiceNumber: { value: 'x', page: 1, quote: 'x', ...f } } }).success;
    expect(ocr({ confidence: 87, verification: 'unverified' })).toBe(true);
    expect(ocr({ confidence: 87, verification: 'corrected' })).toBe(true);
    expect(ocr({ confidence: 150 })).toBe(false);
    expect(ocr({ confidence: -1 })).toBe(false);
    expect(ocr({ verification: 'approved' })).toBe(false);
  });
  it('rejects line cells that are not defined for the document type', () => {
    const r = ExtractedDocument.safeParse({ ...base, lines: [{ cells: { grossWeight: { value: '1', page: 1, quote: null } } }] });
    expect(r.success).toBe(false);
  });
  it('distinguishes a missing value (null) from a genuine zero ("0.00")', () => {
    const zero = ExtractedDocument.parse({ ...base, lines: [{ cells: { amount: { value: '0.00', page: 1, quote: '0.00' } } }] });
    const missing = ExtractedDocument.parse({ ...base, lines: [{ cells: { amount: { value: null, page: null, quote: null } } }] });
    expect(zero.lines[0].cells.amount.value).toBe('0.00');
    expect(missing.lines[0].cells.amount.value).toBeNull();
  });
});

describe('Transcription fixtures', () => {
  for (const f of ['SPG-PL-2609-117_Packing_List', 'BMLVHCM26090418_House_BL']) {
    it(`${f} parses as sefer-transcription/v1`, () => {
      const json = JSON.parse(readFileSync(new URL(`../../fixtures/sample-transcriptions/${f}.transcription.json`, import.meta.url), 'utf8'));
      expect(TranscriptionFile.safeParse(json).success).toBe(true);
    });
  }
});

describe('BrokerInput / AnalyzeRequest', () => {
  it('empty broker input is valid and has no entry-number choice', () => {
    expect(BrokerInput.parse(emptyBrokerInput()).entryNumberMode).toBe('not_set');
  });
  it('rejects an unknown entry-number mode', () => {
    expect(BrokerInput.safeParse({ ...emptyBrokerInput(), entryNumberMode: 'auto' }).success).toBe(false);
  });
  it('rejects a request with a malformed document', () => {
    expect(AnalyzeRequest.safeParse({ documents: [{ id: 'x' }], brokerInput: emptyBrokerInput() }).success).toBe(false);
  });
});

describe('NetCHB format constraints (copied from data_type.xsd)', () => {
  it('invoiceNoType rejects slashes and accepts the documented character set', () => {
    expect(PATTERNS.invoiceNo.test('KBAS/NB/26-0912')).toBe(false);
    expect(PATTERNS.invoiceNo.test('KBASNB26-0912')).toBe(true);
    expect(PATTERNS.invoiceNo.test('A'.repeat(18))).toBe(false);
  });
  it('taxIdType accepts the three documented formats only', () => {
    for (const ok of ['12-3456789', '12-3456789AB', '123456-12345', '123-45-6789']) expect(PATTERNS.taxId.test(ok)).toBe(true);
    for (const bad of ['123456789', '12-345678', 'AB-3456789']) expect(PATTERNS.taxId.test(bad)).toBe(false);
  });
  it('ports, tariff numbers and countries', () => {
    expect(PATTERNS.port.test('3002')).toBe(true);
    expect(PATTERNS.port.test('300')).toBe(false);
    expect(PATTERNS.foreignPort.test('55224')).toBe(true);
    expect(PATTERNS.tariffNo.test('6109.10')).toBe(false);
    expect(PATTERNS.tariffNo.test('6109100000')).toBe(true);
    expect(PATTERNS.country.test('VN')).toBe(true);
  });
  it('xsd:date and dollar amounts', () => {
    expect(isValidIsoDate('2026-09-24')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isDollarAmount('6255.00')).toBe(true);
    expect(isDollarAmount('6,255.00')).toBe(false);
    expect(isDollarAmount('-1.00')).toBe(false);
    expect(isDollarAmount('1.005')).toBe(false);
  });
});
