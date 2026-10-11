import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ResolvedField } from '@sefer/shared';
import { buildEntryXml } from '../src/entry/xmlBuilder.js';
import { validateEntryXml } from '../src/entry/xsdValidator.js';

/** Minimal ResolvedField factory for builder tests (synthetic values). */
function rf(path: string, value: string | null, requirement: ResolvedField['requirement'] = 'optional', xmlPath = path): ResolvedField {
  return {
    path, label: path, xmlPath, group: 'header', requirement, requirementNote: '', value, provenance: value === null ? 'missing' : 'user_supplied',
    proposal: null, proposalReason: null, evidence: [], issueIds: [], formatError: null, brokerOnly: false, inputHint: '',
  };
}

const complete = (): ResolvedField[] => [
  rf('entry-no', 'system-generated', 'schema_required'),
  rf('header/importer-tax-id', '12-3456789'),
  rf('header/processing-port', '9999', 'schema_required'),
  rf('header/entry-port', '9999', 'schema_required'),
  rf('header/entry-date', '2099-01-01', 'schema_required'),
  rf('header/entry-type', '01', 'schema_required'),
  rf('manifest/bill-of-lading/house-bill', 'TESTHBL1'),
  rf('manifest/bill-of-lading/quantity', '1', 'schema_required'),
  rf('manifest/bill-of-lading/unit', 'CTN', 'schema_required'),
  rf('containers/container[1]/container-number', 'CSQU3054383'),
  rf('invoice[1]/invoice-no', 'TEST-1', 'schema_required'),
  rf('invoice[1]/line[1]/country-origin', 'ZZ', 'schema_required'),
  rf('invoice[1]/line[1]/commercial-description', 'A & B <C> "quoted" \'apos\' ]]> --dash'),
  rf('invoice[1]/line[1]/tariff-no', '0000000000', 'schema_required'),
  rf('invoice[1]/line[1]/value', '1.00', 'schema_required'),
];

describe('XML builder', () => {
  const opts = { readyToFile: false, generatedAt: '2099-01-01T00:00:00.000Z' };

  it('emits <entry> children in schema sequence order', () => {
    const xml = buildEntryXml(complete(), opts);
    const order = ['<entry-no>', '<header>', '<manifest>', '<containers>', '<invoices>'].map((t) => xml.indexOf(t));
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(xml).toContain('<entry xmlns="http://www.netchb.com/xml/entry">');
    expect(xml).toContain('<system-generated/>');
  });

  it('escapes special characters and keeps comments well-formed', async () => {
    const xml = buildEntryXml(complete(), opts);
    expect(xml).toContain('A &amp; B &lt;C&gt; "quoted" \'apos\' ]]&gt; --dash');
    const comments = [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    expect(comments.every((c) => !c.includes('--') && !c.endsWith('-'))).toBe(true);
    const v = await validateEntryXml(xml);
    expect(v).toMatchObject({ ran: true, valid: true, errors: [] });
  });

  it('never writes missing values or placeholders; marks required gaps with comments', async () => {
    const fields = complete().map((f) => (f.path === 'header/entry-date' || f.path === 'invoice[1]/line[1]/value' ? { ...f, value: null, provenance: 'missing' as const } : f));
    fields.find((f) => f.path === 'header/entry-date')!.xmlPath = 'header/entry-date';
    const xml = buildEntryXml(fields, opts);
    expect(xml).not.toContain('<entry-date>');
    expect(xml).not.toContain('<value>');
    expect(xml).toContain('MISSING (required by schema): header/entry-date');
    const v = await validateEntryXml(xml);
    expect(v.valid).toBe(false);
    expect(v.errors.map((e) => e.message).join(' ')).toMatch(/header.*Missing child element/);
  });

  it('omits <entry-no> content when no option is chosen and never emits <transmit/>', () => {
    const xml = buildEntryXml(complete().map((f) => (f.path === 'entry-no' ? { ...f, value: null } : f)), opts);
    expect(xml).toMatch(/<entry-no>\s*<!--[^>]*MISSING/);
    expect(xml).not.toMatch(/<transmit/);
  });

  it('labels the draft in the file itself', () => {
    expect(buildEntryXml(complete(), opts)).toContain('DRAFT: NOT READY TO FILE');
    expect(buildEntryXml(complete(), { ...opts, readyToFile: true })).toContain('NOT verified by NetCHB or CBP');
  });
});

describe('XSD validator (official NetCHB schema, unmodified)', () => {
  it('rejects schema violations with the documented pattern', async () => {
    const xml = buildEntryXml(complete().map((f) => (f.path === 'invoice[1]/invoice-no' ? { ...f, value: 'TEST/1' } : f)), { readyToFile: false, generatedAt: 'x' });
    const v = await validateEntryXml(xml);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.message.includes("'TEST/1' is not accepted by the pattern '[A-Za-z\\d\\-]{1,17}'"))).toBe(true);
  });

  it('reproduces research finding RL-5: the official NetCHB sample fails the official schema at dea-drug-code', async () => {
    const sample = readFileSync(new URL('../schemas/netchb/reference/entry_sample.xml', import.meta.url), 'utf8');
    const v = await validateEntryXml(sample);
    expect(v.valid).toBe(false);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatchObject({ line: 758 });
    expect(v.errors[0].message).toMatch(/dea-drug-code.*not expected/);
  });

  it('records the schema files and their hashes', async () => {
    const v = await validateEntryXml(buildEntryXml(complete(), { readyToFile: false, generatedAt: 'x' }));
    expect(v.schemaFiles.map((f) => f.sha256)).toEqual([
      '1bef18d4121f83f7f09a7346fa9d4a1a37310730363b66e6724908a3e5dc7132',
      'c1c529ad31045c37f794a4ec230975868d788b5d661348794aa4ffe9b3eb45fc',
    ]);
  });
});
