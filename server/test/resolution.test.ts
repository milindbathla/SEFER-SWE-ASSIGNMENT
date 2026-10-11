import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, isUnresolvedBlocker, type AnalysisResult, type BrokerInput } from '@sefer/shared';
import { analyzeShipment, explainXsdErrors, unwrittenValues } from '../src/analyze.js';
import { buildEntryXml } from '../src/entry/xmlBuilder.js';
import { renderReport } from '../src/report.js';
import { loadSampleDocuments } from '../src/sample.js';

/**
 * Issue resolution, state consistency and determinism on the sample shipment.
 * Values typed below are SYNTHETIC test inputs (they stand in for broker decisions); none is a claim about the shipment.
 */
const NOW = new Date('2026-10-11T00:00:00.000Z');

/** Synthetic values for every required/conditional field that has no value, as a broker would type them. */
function typedRequiredValues(r: AnalysisResult): Record<string, string> {
  const values: Record<string, string> = {};
  const synth: Record<string, string> = {
    'header/importer-tax-id': '12-3456789', 'header/processing-port': '3002', 'header/entry-port': '3002', 'header/entry-date': '2026-10-01',
    'header/entry-type': '01', 'header/state-destination': 'WA', 'header/unlading-port': '3002', 'manifest/bill-of-lading/unit': 'CTN',
  };
  for (const f of r.fields.filter((x) => x.value === null && x.requirement !== 'optional' && x.path !== 'entry-no')) {
    values[f.path] = synth[f.path]
      ?? (/tariff-no$/.test(f.path) ? '0000000000' : /\/value$/.test(f.path) ? '1.00' : /country-(export|origin)$/.test(f.path) ? 'VN'
        : /lading-port$/.test(f.path) ? '55224' : /invoice-no$/.test(f.path) ? 'TEST-1' : 'X');
  }
  return values;
}

describe('issue resolution: acknowledging is not confirming', async () => {
  const docs = await loadSampleDocuments();
  const r0 = await analyzeShipment(docs, emptyBrokerInput(), NOW);
  const ackAll = (note = 'reviewed (test)', extra: Record<string, { waive?: boolean }> = {}) =>
    Object.fromEntries(r0.issues.map((i) => [i.id, { note, ...extra[i.id] }]));
  const complete = (acknowledgements: BrokerInput['acknowledgements']): BrokerInput => ({
    ...emptyBrokerInput(), values: typedRequiredValues(r0), entryNumberMode: 'system_generated', acknowledgements,
  });
  const issue = (r: AnalysisResult, rule: string) => r.issues.find((i) => i.rule === rule)!;

  it('regression (D-1): acknowledging every issue does not make disputed optional values confirmed', async () => {
    const r = await analyzeShipment(docs, complete(ackAll()), NOW);
    expect(r.ruleChecks.filter((c) => !c.passed)).toEqual([]);
    expect(r.status).toBe('NOT_READY_TO_FILE');
    expect(issue(r, 'GROSS_WEIGHT_MISMATCH')).toMatchObject({ resolution: 'acknowledged', pendingFields: ['header/gross-weight'] });
    expect(issue(r, 'CONTAINER_NUMBER')).toMatchObject({ resolution: 'acknowledged', pendingFields: ['containers/container[1]/container-number'] });
    expect(r.statusReasons.join(' ')).toMatch(/still need confirmed values/);
    expect(r.fields.find((f) => f.path === 'header/gross-weight')!.value).toBeNull();
  });

  it('a typed (confirmed) value resolves an acknowledged issue; a typed value alone leaves it open', async () => {
    const b = complete(ackAll());
    const typed = await analyzeShipment(docs, { ...b, values: { ...b.values, 'header/gross-weight': '1930' } }, NOW);
    expect(issue(typed, 'GROSS_WEIGHT_MISMATCH')).toMatchObject({ resolution: 'resolved', pendingFields: [] });
    const { [issue(r0, 'GROSS_WEIGHT_MISMATCH').id]: _, ...withoutAck } = b.acknowledgements;
    const unreviewed = await analyzeShipment(docs, { ...b, acknowledgements: withoutAck, values: { ...b.values, 'header/gross-weight': '1930' } }, NOW);
    expect(issue(unreviewed, 'GROSS_WEIGHT_MISMATCH').resolution).toBe('open');
    expect(unreviewed.status).toBe('NOT_READY_TO_FILE');
  });

  it('a waiver needs a note and may only cover optional values', async () => {
    const gw = issue(r0, 'GROSS_WEIGHT_MISMATCH').id;
    const line1 = issue(r0, 'LINE_ARITHMETIC').id;
    const noNote = await analyzeShipment(docs, complete({ ...ackAll(), [gw]: { note: ' ', waive: true } }), NOW);
    expect(issue(noNote, 'GROSS_WEIGHT_MISMATCH').resolution).toBe('acknowledged');
    const withNote = await analyzeShipment(docs, complete({ ...ackAll(), [gw]: { note: 'Broker: omit gross weight until carrier confirms', waive: true } }), NOW);
    expect(issue(withNote, 'GROSS_WEIGHT_MISMATCH').resolution).toBe('waived');
    expect(isUnresolvedBlocker(issue(withNote, 'GROSS_WEIGHT_MISMATCH'))).toBe(false);
    // A schema-required value can never be waived: the line value stays withheld and the issue keeps blocking.
    const b = complete({ ...ackAll(), [line1]: { note: 'try to waive', waive: true } });
    const { 'invoice[1]/line[1]/value': _, ...values } = b.values;
    const required = await analyzeShipment(docs, { ...b, values }, NOW);
    expect(issue(required, 'LINE_ARITHMETIC')).toMatchObject({ resolution: 'acknowledged', pendingFields: ['invoice[1]/line[1]/value'] });
  });

  it('passes local checks only after every blocker is resolved or explicitly waived, and the waived values stay out of the XML', async () => {
    const waive = Object.fromEntries(r0.issues.map((i) => [i.id, { waive: true }]));
    const r = await analyzeShipment(docs, complete(ackAll('Broker decision recorded in test', waive)), NOW);
    expect(r.issues.filter(isUnresolvedBlocker)).toEqual([]);
    expect(r.status).toBe('PASSES_LOCAL_CHECKS');
    expect(r.xml).not.toMatch(/<gross-weight>|<container-number>|<manufacturer-id>/);
    const report = renderReport(r);
    expect(report).toMatch(/Waived: optional values deliberately left out/);
    expect(report).toContain('`header/gross-weight`');
  });
});

describe('field states: missing vs withheld vs proposed (D-6)', async () => {
  const r = await analyzeShipment(await loadSampleDocuments(), emptyBrokerInput(), NOW);
  const f = (p: string) => r.fields.find((x) => x.path === p)!;
  it('distinguishes a disputed value from a value no document provides and from an unconfirmed proposal', () => {
    expect(f('header/gross-weight').provenance).toBe('withheld'); // C-4 conflict
    expect(f('invoice[1]/line[2]/invoice-quantity').provenance).toBe('withheld'); // C-2 conflict
    expect(f('header/entry-date').provenance).toBe('missing'); // broker-only, no document value
    expect(f('invoice[1]/line[1]/tariff-no').provenance).toBe('missing'); // HTSUS: broker classification
    expect(f('header/entry-port')).toMatchObject({ provenance: 'proposed', value: null }); // unconfirmed proposal
  });
});

describe('consistent, reproducible results (D-4, D-5)', async () => {
  const docs = await loadSampleDocuments();
  const a = await analyzeShipment(docs, emptyBrokerInput(), NOW);
  const b = await analyzeShipment(docs, emptyBrokerInput(), NOW);

  it('the same input gives the same result, issue ids and counts (no accumulation across runs)', () => {
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(new Set(a.issues.map((i) => i.id)).size).toBe(a.issues.length);
  });

  it('the input fingerprint changes with any decision and ignores key order', async () => {
    const ack = await analyzeShipment(docs, { ...emptyBrokerInput(), acknowledgements: { [a.issues[0].id]: { note: 'x' } } }, NOW);
    expect(ack.inputFingerprint).not.toBe(a.inputFingerprint);
    const reordered = { entryNumberMode: 'not_set', approvedTransformations: [], acknowledgements: {}, acceptedProposals: [], values: {} } as BrokerInput;
    expect((await analyzeShipment(docs, reordered, NOW)).inputFingerprint).toBe(a.inputFingerprint);
    expect(a.xml).toContain(`Input ${a.inputFingerprint.slice(0, 16)}.`);
  });

  it('summary counts are derived from the same state as the issues, checks and XSD result, and the report shows them', () => {
    const s = a.summary;
    expect(s).toMatchObject({
      issues: a.issues.length, blocking: a.issues.filter((i) => i.blocking).length, unresolvedBlocking: a.issues.filter(isUnresolvedBlocker).length,
      failedRuleChecks: a.ruleChecks.filter((c) => !c.passed).length, ruleChecks: a.ruleChecks.length, xsdErrors: a.xsd.errors.length,
    });
    expect(s).toMatchObject({ issues: 16, blocking: 15, unresolvedBlocking: 15, xsdErrors: 10 });
    const report = renderReport(a);
    expect(report).toContain(a.inputFingerprint);
    expect(report).toContain(`| Blocking issues still unresolved | ${s.unresolvedBlocking} of ${s.blocking} |`);
    expect(report).toContain(`| Required/conditional field checks failed | ${s.failedRuleChecks} of ${s.ruleChecks} |`);
    expect(report).toContain(`| XSD errors | ${s.xsdErrors} |`);
  });

  it('every sample XSD error is traced to missing data, none is unexplained (no generator defect)', () => {
    expect(a.xsd.errors.length).toBe(10);
    for (const e of a.xsd.errors) {
      expect(e.cause).toBe('missing_data');
      expect(e.relatedFields!.length).toBeGreaterThan(0);
    }
    const entryNo = a.xsd.errors.find((e) => /'entry-no'/.test(e.message))!;
    expect(entryNo.relatedFields).toEqual(['entry-no']);
    const line5 = a.xsd.errors.find((e) => /'line-item'/.test(e.message))!;
    expect(line5.relatedFields).toEqual(['invoice[1]/line[5]/country-origin']);
  });
});

describe('valuation evidence (D-7)', async () => {
  const r = await analyzeShipment(await loadSampleDocuments(), emptyBrokerInput(), NOW);
  it('C-12: verifies goods + freight + insurance against the printed total without adjusting anything', () => {
    const cif = r.issues.find((i) => i.rule === 'CIF_DEDUCTIONS')!;
    expect(cif.explanation).toMatch(/23,235\.00 \+ 3,850\.00 \+ 185\.00 = 27270\.00, which equals the printed invoice total 27,270\.00/);
    expect(r.fields.filter((f) => /\/value$/.test(f.path)).every((f) => f.value === null)).toBe(true);
  });
  it('C-6: quotes the value stated for the buyer-supplied fabric, as printed, and adds nothing', () => {
    const assist = r.issues.find((i) => i.rule === 'ASSIST_INDICATOR')!;
    expect(assist.explanation).toContain('"value USD 4,180.00"');
    expect(r.fields.find((f) => f.path === assist.affects[0])!.value).toBeNull();
  });
});

describe('final audit regressions', async () => {
  const docs = await loadSampleDocuments();
  const r0 = await analyzeShipment(docs, emptyBrokerInput(), NOW);

  it('A-1: a blocking issue that affects no field is not resolved by an acknowledgement without a note', async () => {
    const date = r0.issues.find((i) => i.rule === 'AMBIGUOUS_DATE')!;
    expect(date).toMatchObject({ blocking: true, affects: [] });
    const silent = await analyzeShipment(docs, { ...emptyBrokerInput(), acknowledgements: { [date.id]: { note: '  ' } } }, NOW);
    expect(silent.issues.find((i) => i.id === date.id)!.resolution).toBe('acknowledged');
    const noted = await analyzeShipment(docs, { ...emptyBrokerInput(), acknowledgements: { [date.id]: { note: 'Issuer confirmed 2026-09-12 by email' } } }, NOW);
    expect(noted.issues.find((i) => i.id === date.id)!.resolution).toBe('resolved');
    // Same rule for an unread scan.
    const unread = [docs[0], { ...docs[1], method: 'unavailable' as const, fields: {}, lines: [], containers: [] }, docs[2]];
    const dnr = (await analyzeShipment(unread, emptyBrokerInput(), NOW)).issues.find((i) => i.rule === 'DOCUMENT_NOT_READ')!;
    const acked = await analyzeShipment(unread, { ...emptyBrokerInput(), acknowledgements: { [dnr.id]: { note: '' } } }, NOW);
    expect(acked.issues.find((i) => i.id === dnr.id)!.resolution).toBe('acknowledged');
  });

  it('editing a field after a waiver re-evaluates: an invalid value fails a check, a valid one resolves the issue', async () => {
    const gw = r0.issues.find((i) => i.rule === 'GROSS_WEIGHT_MISMATCH')!.id;
    const base = { ...emptyBrokerInput(), acknowledgements: { [gw]: { note: 'Broker: omit until carrier confirms', waive: true } } };
    expect((await analyzeShipment(docs, base, NOW)).issues.find((i) => i.id === gw)!.resolution).toBe('waived');
    const invalid = await analyzeShipment(docs, { ...base, values: { 'header/gross-weight': 'about 1.9 t' } }, NOW);
    expect(invalid.fields.find((f) => f.path === 'header/gross-weight')).toMatchObject({ value: null, formatError: expect.any(String) });
    expect(invalid.ruleChecks.some((c) => c.id === 'FORMAT:header/gross-weight' && !c.passed)).toBe(true);
    const valid = await analyzeShipment(docs, { ...base, values: { 'header/gross-weight': '1930' } }, NOW);
    expect(valid.issues.find((i) => i.id === gw)!.resolution).toBe('resolved');
  });

  it('A-2: a confirmed value missing from the XML is a generator defect, never "missing data"', async () => {
    const xml = r0.xml.replace(/\s*<vessel-name>[^<]*<\/vessel-name>/, '');
    expect(unwrittenValues(r0.fields, xml)).toEqual(['header/vessel-name']);
    expect(unwrittenValues(r0.fields, r0.xml)).toEqual([]);
    const explained = explainXsdErrors(xml, r0.xsd.errors, ['header/vessel-name']);
    expect(explained.every((e) => e.cause === 'unexplained')).toBe(true);
    // Escaped special characters still count as written.
    const fields = r0.fields.map((f) => (f.path === 'invoice[1]/line[1]/commercial-description' ? { ...f, value: `A & B <C> "q" 'a'` } : f));
    expect(unwrittenValues(fields, buildEntryXml(fields, { readyToFile: false, generatedAt: NOW.toISOString() }))).toEqual([]);
  });

  it('A-3: the CIF arithmetic check says when it could not be made, and never guesses a format or sign', async () => {
    const run = async (patch: Record<string, string>) => {
      const [inv, ...rest] = docs;
      const fields = { ...inv.fields };
      for (const [k, v] of Object.entries(patch)) fields[k] = { value: v, page: 1, quote: v };
      return (await analyzeShipment([{ ...inv, fields }, ...rest], emptyBrokerInput(), NOW)).issues.find((i) => i.rule === 'CIF_DEDUCTIONS')!.explanation;
    };
    expect(await run({ freight: 'USD 3,850.00' })).toMatch(/Arithmetic check not made: freight could not be read as a plain amount/);
    expect(await run({ totalGoodsValue: '23.235,00' })).toMatch(/Arithmetic check not made: total goods value could not be read/);
    expect(await run({ insurance: '(185.00)' })).toMatch(/Arithmetic check not made: an amount is negative or in parentheses/);
    expect(await run({ totalInvoiceValue: '27,271.00' })).toMatch(/= 27270\.00, which does NOT equal the printed invoice total 27,271\.00/);
  });
});
