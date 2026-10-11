import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEntryXml } from '../src/entry/xsdValidator.js';

/**
 * The submitted D2 lives in Artifacts/: XML drafts downloaded from the app with their validation reports. They were made with a
 * reviewer's decisions, so they cannot be regenerated here. These tests check that each report tells the truth about its XML:
 * same run, same status label, and exactly the XSD errors that an independent validation against the official schema finds.
 */
const dir = new URL('../../Artifacts/', import.meta.url);
const drafts = readdirSync(dir).filter((n) => /^entry-draft-.+\.xml$/.test(n));

describe('submission artifacts (D2)', () => {
  it('Artifacts/ contains at least one XML draft, each with its validation report', () => {
    expect(drafts.length).toBeGreaterThan(0);
    for (const n of drafts) expect(readdirSync(dir)).toContain(n.replace(/^entry-draft-/, 'validation-report-').replace(/\.xml$/, '.md'));
  });

  for (const name of drafts) {
    const xml = readFileSync(new URL(name, dir), 'utf8');
    const report = readFileSync(new URL(name.replace(/^entry-draft-/, 'validation-report-').replace(/\.xml$/, '.md'), dir), 'utf8');

    it(`${name}: XML and report come from the same run, say NOT READY TO FILE and contain no <transmit/>`, () => {
      const head = /DRAFT: NOT READY TO FILE\. Generated (\S+)\. Input ([0-9a-f]{16})\./.exec(xml);
      expect(head).not.toBeNull();
      expect(report).toContain(`Generated: ${head![1]}`);
      expect(report).toMatch(new RegExp(`Input fingerprint[^\`]*\`${head![2]}[0-9a-f]{48}\``));
      expect(report).toContain('## Status: ❌ NOT READY TO FILE');
      expect(xml).not.toMatch(/<transmit/);
    });

    it(`${name}: the report lists exactly the XSD errors found by validating the XML against the official schema`, async () => {
      const v = await validateEntryXml(xml);
      expect(v.ran).toBe(true);
      const stated = Number(/XSD validation failed with (\d+) error\(s\)/.exec(report)?.[1] ?? 0);
      expect(v.errors).toHaveLength(stated);
      expect(v.valid).toBe(stated === 0);
      const reportedLines = [...report.matchAll(/^\| (\d+) \| Schemas validity error/gm)].map((m) => Number(m[1]));
      expect(reportedLines).toEqual(v.errors.map((e) => e.line));
    });
  }
});
