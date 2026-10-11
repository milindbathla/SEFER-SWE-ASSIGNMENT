import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, ISSUE_STATES, type Issue } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { SAMPLE_RULE_TO_RESEARCH_ID, loadSampleDocuments } from '../src/sample.js';

/**
 * Regression test for the supplied sample shipment: every issue group C-1 … C-12 recorded in
 * docs/research-log.md §4 must be detected, with the approved state, and nothing may be silently
 * resolved or written to the XML.
 */
describe('sample shipment KBAS/NB/26-0912 (no broker input)', async () => {
  const documents = await loadSampleDocuments();
  const before = JSON.stringify(documents);
  const r = await analyzeShipment(documents, emptyBrokerInput());
  const byRule = (rule: string) => r.issues.filter((i) => i.rule === rule);
  const one = (rule: string, idPart = ''): Issue => {
    const found = byRule(rule).filter((i) => i.id.includes(idPart));
    expect(found, `${rule} ${idPart}`).toHaveLength(1);
    return found[0];
  };
  const field = (path: string) => r.fields.find((f) => f.path === path)!;
  const evidenceValues = (i: Issue) => i.evidence.map((e) => e.value);

  it('detects all twelve research issue groups', () => {
    const groups = new Set(r.issues.map((i) => SAMPLE_RULE_TO_RESEARCH_ID[i.rule]).filter(Boolean));
    expect([...groups].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))).toEqual(['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-11', 'C-12']);
  });

  it('C-1: line 1 arithmetic and totals are flagged, the printed amount is not corrected', () => {
    const i = one('LINE_ARITHMETIC', 'line[1]');
    expect(i.state).toBe(ISSUE_STATES.conflict);
    expect(i.explanation).toContain('6840.00');
    expect(i.explanation).toContain('6,480.00');
    const totals = one('INVOICE_TOTALS');
    expect(totals.explanation).toContain('21,975.00');
    expect(totals.explanation).toContain('21615.00');
    expect(field('invoice[1]/line[1]/value')).toMatchObject({ value: null, proposal: null });
  });

  it('C-2: hoodie quantity 1,200 vs 1,176', () => {
    const i = one('QUANTITY_MISMATCH', 'line[2]');
    expect(i.state).toBe(ISSUE_STATES.conflict);
    expect(evidenceValues(i)).toEqual(expect.arrayContaining(['1,200', '1,176']));
    expect(field('invoice[1]/line[2]/invoice-quantity').value).toBeNull();
  });

  it('C-3: hoodie fibre 60/40 vs TC 65/35 blocks classification of that line', () => {
    const i = one('FIBRE_MISMATCH', 'line[2]');
    expect(i.state).toBe(ISSUE_STATES.conflict);
    expect(i.affects).toContain('invoice[1]/line[2]/tariff-no');
  });

  it('C-4: gross weight 1,888.00 vs 1,930.000 is not resolved', () => {
    const i = one('GROSS_WEIGHT_MISMATCH');
    expect(evidenceValues(i)).toEqual(expect.arrayContaining(['1,888.00 KGS', '1,930.000 KGS']));
    expect(field('header/gross-weight')).toMatchObject({ value: null, proposal: null });
  });

  it('C-5: container correction stays provisional; neither reading is written', () => {
    const i = one('CONTAINER_NUMBER');
    expect(i.state).toBe(ISSUE_STATES.provisional);
    expect(i.explanation).toMatch(/OPLU3041728.*INVALID/);
    expect(i.explanation).toMatch(/OPLU3041722.*expected 2.*valid/);
    expect(field('containers/container[1]/container-number')).toMatchObject({ value: null, provenance: 'proposed', proposal: 'OPLU3041722' });
    expect(r.xml).not.toContain('OPLU304172');
  });

  it('C-6: buyer-supplied fabric (assist) on W-B220 needs broker input', () => {
    const i = one('ASSIST_INDICATOR', 'line[4]');
    expect(i.state).toBe(ISSUE_STATES.missing_broker);
    expect(i.evidence.some((e) => e.quote?.includes('4,180.00'))).toBe(true);
    expect(byRule('ASSIST_INDICATOR')).toHaveLength(1);
  });

  it('C-7: sample origin (Bangladesh) conflicts with document-level origin (Vietnam)', () => {
    const i = one('ORIGIN_CONFLICT', 'line[5]');
    expect(i.state).toBe(ISSUE_STATES.conflict);
    expect(i.evidence.some((e) => /Made in Bangladesh/i.test(e.quote ?? ''))).toBe(true);
    expect(i.evidence.some((e) => /MADE IN VIETNAM/i.test(e.quote ?? ''))).toBe(true);
    expect(field('invoice[1]/line[5]/country-origin').value).toBeNull();
    expect(field('invoice[1]/line[1]/country-origin').value).toBe('VN');
  });

  it('C-8: FOC samples with a "value for customs" need broker input', () => {
    const i = one('NO_COMMERCIAL_VALUE', 'line[5]');
    expect(i.state).toBe(ISSUE_STATES.missing_broker);
    expect(field('invoice[1]/line[5]/value')).toMatchObject({ value: null, proposal: null });
  });

  it('C-9: importer and ultimate consignee are left for the broker', () => {
    const i = one('PARTIES_UNRESOLVED');
    expect(i.state).toBe(ISSUE_STATES.missing_broker);
    expect(evidenceValues(i)).toEqual(expect.arrayContaining(['NORTHBOUND OUTFITTERS, INC.', 'CASCADE FULFILLMENT PARTNERS LLC']));
    expect(field('header/importer-tax-id').value).toBeNull();
    expect(field('header/ultimate-consignee/tax-id').value).toBeNull();
  });

  it('C-10: invoice number transformation is proposed but not used without approval', () => {
    const i = one('INVOICE_NUMBER_FORMAT');
    expect(i.state).toBe(ISSUE_STATES.transformation);
    expect(field('invoice[1]/invoice-no')).toMatchObject({ value: null, provenance: 'proposed', proposal: 'KBASNB26-0912' });
    expect(r.xml).not.toContain('<invoice-no>');
  });

  it('C-11: invoice date 12/09/2026 is uncertain, both readings shown', () => {
    const i = one('AMBIGUOUS_DATE', 'invoiceDate');
    expect(i.state).toBe(ISSUE_STATES.uncertain);
    expect(i.explanation).toContain('2026-09-12 or 2026-12-09');
  });

  it('C-12: CIF terms with freight and insurance are flagged for broker review', () => {
    const i = one('CIF_DEDUCTIONS');
    expect(i.state).toBe(ISSUE_STATES.missing_broker);
    expect(evidenceValues(i)).toEqual(expect.arrayContaining(['3,850.00', '185.00']));
  });

  it('produces a NOT READY TO FILE draft that fails XSD only for missing data', () => {
    expect(r.status).toBe('NOT_READY_TO_FILE');
    expect(r.xml).toContain('DRAFT: NOT READY TO FILE');
    expect(r.xsd).toMatchObject({ ran: true, valid: false });
    expect(r.xsd.errors.every((e) => /Missing child element/.test(e.message))).toBe(true);
    expect(r.xml).not.toMatch(/<transmit/);
  });

  it('writes only document values that are consistent, and no proposals or broker values', () => {
    const written = r.fields.filter((f) => f.value !== null);
    expect(written.every((f) => f.provenance === 'extracted' || f.provenance === 'calculated')).toBe(true);
    expect(field('header/mode-transportation')).toMatchObject({ value: '11', provenance: 'calculated' });
    expect(field('header/entry-port')).toMatchObject({ value: null, proposal: '3002' });
    expect(field('invoice[1]/line[1]/lading-port')).toMatchObject({ value: null, proposal: '55224' });
    for (const p of ['header/entry-date', 'header/entry-type', 'header/processing-port', 'invoice[1]/line[1]/tariff-no', 'invoice[1]/line[1]/manufacturer-id']) {
      expect(field(p)).toMatchObject({ value: null, provenance: 'missing', brokerOnly: true });
    }
  });

  it('marks optional values withheld by an unresolved issue inside the XML (C-2, C-4, C-5)', () => {
    for (const [xmlPath, path] of [['header/gross-weight', 'header/gross-weight'], ['line-item/invoice-quantity', 'invoice[1]/line[2]/invoice-quantity']]) {
      expect(r.xml).toContain(`<!-- WITHHELD (unresolved issue): ${xmlPath} [${path}]: see the validation report -->`);
    }
    expect(r.xml).toContain('<!-- WITHHELD (unresolved issue; proposal awaiting confirmation): containers/container/container-number [containers/container[1]/container-number]: see the validation report -->');
    expect(r.xml).toContain('<!-- MISSING (optional; broker input required): line-item/manufacturer-id [invoice[1]/line[1]/manufacturer-id]: see the validation report -->');
    expect(r.xml).not.toMatch(/<gross-weight>|<container-number>/);
  });

  it('does not modify the source documents', () => {
    expect(JSON.stringify(documents)).toBe(before);
  });
});
