import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, type BrokerInput, type ExtractedDocument } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { cleanShipment, container, doc } from './helpers.js';

/**
 * SYNTHETIC shipments (invented test data, not the sample) to show the rules are generic:
 * different seller, ports, goods, currencies, document sets and layouts.
 */

const rules = (r: { issues: { rule: string }[] }) => [...new Set(r.issues.map((i) => i.rule))].sort();

/** Broker input that completes the clean synthetic shipment (fake but schema-valid test values). */
function completeBrokerInput(docs: ExtractedDocument[], issueIds: string[]): BrokerInput {
  const values: Record<string, string> = {
    'header/importer-tax-id': '12-3456789', 'header/ultimate-consignee/tax-id': '12-3456789', 'header/processing-port': '9999', 'header/entry-port': '9999', 'header/entry-date': '2026-03-20',
    'header/entry-type': '01', 'header/state-destination': 'CA', 'header/unlading-port': '9999', 'manifest/bill-of-lading/unit': 'CTN',
  };
  for (const n of ['1', '2']) {
    Object.assign(values, {
      [`invoice[1]/line[${n}]/tariff-no`]: '0000000000', [`invoice[1]/line[${n}]/manufacturer-id`]: 'TESTMID0001',
      [`invoice[1]/line[${n}]/country-export`]: 'MX', [`invoice[1]/line[${n}]/lading-port`]: '99999',
    });
  }
  return {
    ...emptyBrokerInput(), values, entryNumberMode: 'system_generated',
    acceptedProposals: ['invoice[1]/line[1]/value', 'invoice[1]/line[2]/value'],
    acknowledgements: Object.fromEntries(issueIds.map((id) => [id, { note: 'synthetic test' }])),
  };
}

describe('clean synthetic shipment (no known conflicts)', async () => {
  const docs = cleanShipment();
  const r0 = await analyzeShipment(docs, emptyBrokerInput());

  it('raises only the always-required broker issues: no conflicts, no uncertainty', () => {
    expect(rules(r0)).toEqual(['MID_MISSING', 'PARTIES_UNRESOLVED']);
    expect(r0.issues.every((i) => i.kind === 'missing_broker')).toBe(true);
  });

  it('does not propose ports that are not in the researched reference table', () => {
    const f = (p: string) => r0.fields.find((x) => x.path === p)!;
    expect(f('header/entry-port')).toMatchObject({ value: null, proposal: null });
    expect(f('invoice[1]/line[1]/lading-port')).toMatchObject({ value: null, proposal: null });
    expect(f('containers/container[1]/container-number')).toMatchObject({ value: 'CSQU3054383', provenance: 'extracted' });
    expect(f('invoice[1]/line[1]/country-origin')).toMatchObject({ value: 'MX' });
  });

  it('passes local checks (XSD valid) once broker input is complete and issues are reviewed', async () => {
    const r = await analyzeShipment(docs, completeBrokerInput(docs, r0.issues.map((i) => i.id)));
    expect(r.xsd).toMatchObject({ ran: true, valid: true });
    expect(r.ruleChecks.filter((c) => !c.passed)).toEqual([]);
    expect(r.status).toBe('PASSES_LOCAL_CHECKS');
    expect(r.xml).toContain('NOT verified by NetCHB or CBP');
    expect(r.xml).not.toMatch(/<transmit/);
    expect(r.xml.match(/<line-item>/g)).toHaveLength(2);
  });

  it('a single unacknowledged blocking issue keeps it NOT READY', async () => {
    const ids = r0.issues.map((i) => i.id).filter((id) => id !== 'MID_MISSING');
    const r = await analyzeShipment(docs, completeBrokerInput(docs, ids));
    expect(r.status).toBe('NOT_READY_TO_FILE');
  });
});

describe('missing documents and fields', () => {
  it('invoice only, no currency: flags missing B/L, packing list and currency', async () => {
    const [invoice] = cleanShipment();
    const { currency: _c, ...fields } = invoice.fields;
    const r = await analyzeShipment([{ ...invoice, fields }], emptyBrokerInput());
    expect(rules(r)).toEqual(expect.arrayContaining(['MISSING_DOCUMENT', 'CURRENCY_MISSING']));
    expect(r.issues.filter((i) => i.rule === 'MISSING_DOCUMENT').map((i) => i.id).sort()).toEqual(['MISSING_DOCUMENT:bill_of_lading', 'MISSING_DOCUMENT:packing_list']);
    expect(r.fields.find((f) => f.path === 'invoice[1]/line[1]/value')!.proposal).toBeNull();
    expect(r.status).toBe('NOT_READY_TO_FILE');
  });

  it('no documents at all still yields a well-formed, clearly incomplete draft', async () => {
    const r = await analyzeShipment([], emptyBrokerInput());
    expect(r.xsd.ran).toBe(true);
    expect(r.status).toBe('NOT_READY_TO_FILE');
    expect(r.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['MISSING_DOCUMENT:commercial_invoice']));
  });

  it('an unread scanned document blocks readiness', async () => {
    const scanned = { ...doc('packing_list', {}), method: 'unavailable' as const };
    const [invoice, , bol] = cleanShipment();
    const r = await analyzeShipment([invoice, scanned, bol], emptyBrokerInput());
    expect(r.issues.some((i) => i.rule === 'DOCUMENT_NOT_READ' && i.blocking)).toBe(true);
  });
});

describe('other variations', () => {
  it('non-USD invoice: no conversion, no value proposals', async () => {
    const [invoice, pl, bol] = cleanShipment();
    const eur = { ...invoice, fields: { ...invoice.fields, currency: { value: 'EUR', page: 1, quote: 'Currency: EUR' } } };
    const r = await analyzeShipment([eur, pl, bol], emptyBrokerInput());
    expect(rules(r)).toContain('FOREIGN_CURRENCY');
    expect(r.fields.filter((f) => f.path.endsWith('/value')).every((f) => f.proposal === null)).toBe(true);
  });

  it('two invoices produce two <invoice> elements and lines are matched across both', async () => {
    const [invoice, pl, bol] = cleanShipment();
    const inv1 = { ...invoice, lines: [invoice.lines[0]] };
    const inv2 = { ...invoice, id: 'second', fields: { ...invoice.fields, invoiceNumber: { value: 'TST-2026-002', page: 1, quote: 'TST-2026-002' } }, lines: [invoice.lines[1]] };
    const r = await analyzeShipment([inv1, inv2, pl, bol], emptyBrokerInput());
    expect(r.xml.match(/<invoice>/g)).toHaveLength(2);
    expect(rules(r)).not.toContain('STYLE_NOT_ON_INVOICE');
    expect(rules(r)).not.toContain('QUANTITY_MISMATCH');
  });

  it('extra invoice line not on the packing list, and a wrong printed check digit', async () => {
    const [invoice, pl, bol] = cleanShipment();
    const extra = { ...invoice, lines: [...invoice.lines, { cells: { lineNo: { value: '3', page: 1, quote: '3' }, style: { value: 'ST-9', page: 1, quote: 'ST-9' }, quantity: { value: '5', page: 1, quote: '5' }, unitPrice: { value: '1.00', page: 1, quote: '1.00' }, amount: { value: '5.00', page: 1, quote: '5.00' } } }] };
    const badBol = { ...bol, containers: [container('CSQU3054384')] };
    const r = await analyzeShipment([extra, pl, badBol], emptyBrokerInput());
    expect(rules(r)).toEqual(expect.arrayContaining(['STYLE_NOT_ON_PACKING_LIST', 'CONTAINER_NUMBER', 'INVOICE_TOTALS']));
    expect(r.issues.find((i) => i.rule === 'CONTAINER_NUMBER')!.kind).toBe('uncertain');
  });

  it('conflicting vessel names and package counts are flagged, never picked', async () => {
    const [invoice, pl, bol] = cleanShipment();
    const b2 = { ...bol, fields: { ...bol.fields, vesselName: { value: 'OTHER VESSEL', page: 1, quote: 'OTHER VESSEL' }, packages: { value: '11 CARTONS', page: 1, quote: '11 CARTONS' } } };
    const r = await analyzeShipment([invoice, pl, b2], emptyBrokerInput());
    expect(rules(r)).toEqual(expect.arrayContaining(['VESSEL_VOYAGE_MISMATCH', 'PACKAGE_COUNT_MISMATCH']));
    expect(r.fields.find((f) => f.path === 'header/vessel-name')!.value).toBeNull();
    expect(r.fields.find((f) => f.path === 'manifest/bill-of-lading/quantity')!.value).toBeNull();
  });
});
