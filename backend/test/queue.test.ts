import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, isUnresolvedBlocker, type AnalysisResult, type BrokerInput } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { renderReport } from '../src/report.js';
import { loadSampleDocuments } from '../src/sample.js';

/**
 * Guided review queue support on the sample shipment: source values offered as choices, choosing one, broker to-do marks,
 * and the packing-list cross-check that must never be skipped silently. Typed values are SYNTHETIC test inputs.
 */
const NOW = new Date('2026-10-11T00:00:00.000Z');
const issue = (r: AnalysisResult, idPrefix: string) => r.issues.find((i) => i.id.startsWith(idPrefix))!;
const field = (r: AnalysisResult, path: string) => r.fields.find((f) => f.path === path)!;

describe('review queue: choices and decisions', async () => {
  const docs = await loadSampleDocuments();
  const r0 = await analyzeShipment(docs, emptyBrokerInput(), NOW);
  const withBroker = (patch: Partial<BrokerInput>) => analyzeShipment(docs, { ...emptyBrokerInput(), ...patch }, NOW);

  it('conflicts carry each source value converted to the field format, and none is applied', () => {
    const pick = (id: string) => issue(r0, id).choices?.map((c) => [c.field, c.value]);
    expect(pick('GROSS_WEIGHT_MISMATCH')).toEqual([['header/gross-weight', '1888'], ['header/gross-weight', '1930']]);
    expect(pick('QUANTITY_MISMATCH:invoice[1]/line[2]')).toEqual([['invoice[1]/line[2]/invoice-quantity', '1200'], ['invoice[1]/line[2]/invoice-quantity', '1176']]);
    expect(pick('LINE_ARITHMETIC:invoice[1]/line[1]')).toEqual([['invoice[1]/line[1]/value', '6480.00'], ['invoice[1]/line[1]/value', '6840.00']]);
    expect(pick('ORIGIN_CONFLICT:invoice[1]/line[5]')).toEqual([['invoice[1]/line[5]/country-origin', 'BD'], ['invoice[1]/line[5]/country-origin', 'VN']]);
    // The struck-through printed number is offered only with an explicit warning.
    const container = issue(r0, 'CONTAINER_NUMBER').choices!;
    expect(container.map((c) => c.value)).toEqual(['OPLU3041728', 'OPLU3041722']);
    expect(container[0].caution).toMatch(/Struck through.*check digit does NOT match/);
    expect(container[1].caution).toBeUndefined();
    // Nothing was chosen for the user.
    for (const p of ['header/gross-weight', 'invoice[1]/line[2]/invoice-quantity', 'invoice[1]/line[1]/value', 'invoice[1]/line[5]/country-origin']) expect(field(r0, p).value).toBeNull();
  });

  it('choosing a source value with a note resolves exactly that issue, and the XML carries the chosen value', async () => {
    const gw = issue(r0, 'GROSS_WEIGHT_MISMATCH');
    const r = await withBroker({ values: { 'header/gross-weight': '1888' }, acknowledgements: { [gw.id]: { note: 'test: carrier confirmed 1888' } } });
    expect(issue(r, 'GROSS_WEIGHT_MISMATCH').resolution).toBe('resolved');
    expect(r.xml).toContain('<gross-weight>1888</gross-weight>');
    expect(r.summary.unresolvedBlocking).toBe(r0.summary.unresolvedBlocking - 1);
    // Every other issue keeps its state.
    for (const i of r0.issues.filter((x) => x.id !== gw.id)) expect(r.issues.find((x) => x.id === i.id)!.resolution).toBe(i.resolution);
  });

  it('a chosen value without a recorded decision leaves the conflict open and blocking', async () => {
    const r = await withBroker({ values: { 'invoice[1]/line[5]/country-origin': 'BD' } });
    const origin = issue(r, 'ORIGIN_CONFLICT:invoice[1]/line[5]');
    expect(origin.resolution).toBe('open');
    expect(isUnresolvedBlocker(origin)).toBe(true);
    expect(r.status).toBe('NOT_READY_TO_FILE');
  });

  it('a decision on a valuation issue without a value keeps it blocking (acknowledgement is not resolution)', async () => {
    const assist = issue(r0, 'ASSIST_INDICATOR');
    const r = await withBroker({ acknowledgements: { [assist.id]: { note: 'test: broker reviewing' } } });
    expect(issue(r, 'ASSIST_INDICATOR')).toMatchObject({ resolution: 'acknowledged', pendingFields: ['invoice[1]/line[4]/value'] });
    expect(r.summary.unresolvedBlocking).toBe(r0.summary.unresolvedBlocking);
    // A waiver cannot cover a schema-required value.
    const w = await withBroker({ acknowledgements: { [assist.id]: { note: 'test', waive: true } } });
    expect(issue(w, 'ASSIST_INDICATOR').resolution).toBe('acknowledged');
  });

  it('one action confirming the same suggestion on every line writes it on every line and nothing else', async () => {
    const paths = r0.fields.filter((f) => /\/line\[\d+\]\/country-export$/.test(f.path)).map((f) => f.path);
    expect(paths).toHaveLength(5);
    const r = await withBroker({ acceptedProposals: paths });
    expect(r.xml.split('<country-export>VN</country-export>').length - 1).toBe(5);
    expect(r.summary.failedRuleChecks).toBe(r0.summary.failedRuleChecks - 5);
    for (const f of r0.fields.filter((x) => !paths.includes(x.path))) expect(field(r, f.path).value).toBe(f.value);
  });

  it('"waiting for broker" marks are listed in the report but supply nothing and resolve nothing', async () => {
    const r = await withBroker({ brokerRequests: ['header/entry-type', 'invoice[1]/line[1]/tariff-no'] });
    expect(r.summary).toEqual(r0.summary);
    expect(r.xml.replace(/Input [0-9a-f]{16}\./, '')).toBe(r0.xml.replace(/Input [0-9a-f]{16}\./, ''));
    const md = renderReport(r, { brokerRequests: ['header/entry-type', 'invoice[1]/line[1]/tariff-no'] });
    expect(md).toContain('## Marked as waiting for the broker');
    expect(md).toMatch(/`header\/entry-type` \(Entry type\): Missing/);
    expect(renderReport(r0)).not.toContain('Marked as waiting for the broker');
  });
});

describe('packing-list cross-check is never skipped silently', async () => {
  const docs = await loadSampleDocuments();

  it('with packing-list rows the comparison runs (no "not compared" issue)', async () => {
    const r = await analyzeShipment(docs, emptyBrokerInput(), NOW);
    expect(r.issues.some((i) => i.rule === 'PACKING_LIST_ROWS_NOT_READ')).toBe(false);
    expect(r.issues.some((i) => i.rule === 'QUANTITY_MISMATCH')).toBe(true);
  });

  it('without packing-list rows (e.g. OCR did not read the table) a blocking issue says the lines were NOT checked', async () => {
    const noRows = docs.map((d) => (d.docType === 'packing_list' ? { ...d, lines: [] } : d));
    const r = await analyzeShipment(noRows, emptyBrokerInput(), NOW);
    const i = r.issues.find((x) => x.rule === 'PACKING_LIST_ROWS_NOT_READ')!;
    expect(i).toMatchObject({ blocking: true, affects: [], resolution: 'open' });
    expect(i.explanation).toMatch(/5 invoice line\(s\) were NOT checked/);
    expect(r.issues.some((x) => x.rule === 'QUANTITY_MISMATCH' || x.rule === 'FIBRE_MISMATCH')).toBe(false);
    // Resolved only by a recorded decision with a note.
    const bare = await analyzeShipment(noRows, { ...emptyBrokerInput(), acknowledgements: { [i.id]: { note: '' } } }, NOW);
    expect(bare.issues.find((x) => x.id === i.id)!.resolution).toBe('acknowledged');
    const noted = await analyzeShipment(noRows, { ...emptyBrokerInput(), acknowledgements: { [i.id]: { note: 'test: compared by hand' } } }, NOW);
    expect(noted.issues.find((x) => x.id === i.id)!.resolution).toBe('resolved');
  });
});
