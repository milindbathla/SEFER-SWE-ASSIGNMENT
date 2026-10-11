import { describe, expect, it } from 'vitest';
import { emptyBrokerInput, type BrokerInput } from '@sefer/shared';
import { analyzeShipment } from '../src/analyze.js';
import { loadSampleDocuments } from '../src/sample.js';

/** Confirmation behaviour on the sample: approvals, proposals, typed values, acknowledgements. */
describe('user confirmation workflow (sample shipment)', async () => {
  const documents = await loadSampleDocuments();
  const run = (b: Partial<BrokerInput>) => analyzeShipment(documents, { ...emptyBrokerInput(), ...b });
  const field = (r: Awaited<ReturnType<typeof run>>, p: string) => r.fields.find((f) => f.path === p)!;

  it('invoice number: transformed value is used only after explicit approval, original kept as evidence', async () => {
    const r = await run({ approvedTransformations: ['invoice[1]/invoice-no'] });
    const f = field(r, 'invoice[1]/invoice-no');
    expect(f).toMatchObject({ value: 'KBASNB26-0912', provenance: 'approved_transformation' });
    expect(f.evidence[0].value).toBe('KBAS/NB/26-0912');
    expect(r.xml).toContain('<invoice-no>KBASNB26-0912</invoice-no>');
    // Approving the transformation does not acknowledge the issue itself.
    expect(r.issues.find((i) => i.rule === 'INVOICE_NUMBER_FORMAT')!.acknowledged).toBe(false);
  });

  it('accepting a proposal is not the same as accepting a different one', async () => {
    const r = await run({ acceptedProposals: ['header/entry-port'] });
    expect(field(r, 'header/entry-port')).toMatchObject({ value: '3002', provenance: 'approved_proposal' });
    expect(field(r, 'header/unlading-port')).toMatchObject({ value: null, provenance: 'proposed' });
  });

  it('a typed value overrides; an invalid typed value is reported and not written', async () => {
    const r = await run({ values: { 'header/entry-date': '10/14/2026', 'header/entry-type': '01', 'invoice[1]/line[1]/value': '6840.00' } });
    expect(field(r, 'header/entry-date')).toMatchObject({ value: null, formatError: expect.stringContaining('yyyy-mm-dd') });
    expect(field(r, 'header/entry-type')).toMatchObject({ value: '01', provenance: 'user_supplied' });
    expect(field(r, 'invoice[1]/line[1]/value')).toMatchObject({ value: '6840.00', provenance: 'user_supplied' });
    expect(r.ruleChecks.find((c) => c.id === 'FORMAT:header/entry-date')?.passed).toBe(false);
    // The conflict stays visible until acknowledged, even after a value is supplied.
    expect(r.issues.find((i) => i.rule === 'LINE_ARITHMETIC')!.acknowledged).toBe(false);
  });

  it('acknowledging an issue never fills a value', async () => {
    const ack = { 'GROSS_WEIGHT_MISMATCH': { note: 'test' } };
    const r = await run({ acknowledgements: ack });
    expect(r.issues.find((i) => i.id === 'GROSS_WEIGHT_MISMATCH')).toMatchObject({ acknowledged: true, acknowledgementNote: 'test' });
    expect(field(r, 'header/gross-weight').value).toBeNull();
  });

  it('system-generated entry number is opt-in and maps to the documented element', async () => {
    expect((await run({})).xml).not.toContain('<system-generated/>');
    const r = await run({ entryNumberMode: 'system_generated' });
    expect(r.xml).toContain('<system-generated/>');
    expect(field(r, 'entry-no')).toMatchObject({ provenance: 'system_option' });
  });

  it('user-specified entry number requires filer code and number in the documented format', async () => {
    const r = await run({ entryNumberMode: 'user_specified', values: { 'entry-no/filer-code': 'AB', 'entry-no/entry-no': '1234567' } });
    expect(field(r, 'entry-no/filer-code').formatError).toMatch(/filerCodeType/);
    expect(r.xml).toContain('<entry-no>1234567</entry-no>');
    expect(r.xml).not.toContain('<filer-code>');
  });

  it('stays NOT READY TO FILE while any blocking issue is open, even with all fields filled', async () => {
    const r = await run({ entryNumberMode: 'system_generated' });
    expect(r.status).toBe('NOT_READY_TO_FILE');
    expect(r.statusReasons.join(' ')).toMatch(/blocking issue/);
  });
});
