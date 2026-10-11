import { createHash } from 'node:crypto';
import { isUnresolvedBlocker, type AnalysisResult, type BrokerInput, type ExtractedDocument, type Issue, type ResolvedField, type RuleCheck, type XsdResult } from '@sefer/shared';
import { buildContext } from './analysis/context.js';
import { resolveFields } from './analysis/fields.js';
import { runRules, withState } from './analysis/rules.js';
import { buildEntryXml } from './entry/xmlBuilder.js';
import { validateEntryXml } from './entry/xsdValidator.js';

export const DISCLAIMERS = [
  'Generated for local review and download only. Nothing is submitted to NetCHB or CBP, and no <transmit/> instruction is included.',
  'Integration is NOT production-verified: the public NetCHB schema may not match production, the official NetCHB sample itself fails that schema, and the upload endpoint/authentication were not available (docs/research-log.md RL-5, RL-7).',
  'Passing local XSD and rule checks is structural validation only. It does not mean NetCHB or CBP will accept the entry.',
  'Classification, valuation, origin, party identity and bond decisions are broker responsibilities; the tool never makes them.',
];

type AcknowledgedIssue = Omit<Issue, 'resolution' | 'pendingFields'>;

export function applyAcknowledgements(issues: ReturnType<typeof withState>[], broker: BrokerInput): AcknowledgedIssue[] {
  return issues.map((i) => {
    const ack = broker.acknowledgements[i.id];
    return ack ? { ...i, acknowledged: true, acknowledgementNote: ack.note } : { ...i, acknowledged: false };
  });
}

/**
 * Acknowledging an issue records that it was reviewed; it never confirms a shipment fact. An issue is
 * - resolved only when every field it affects now holds a confirmed value (typed, or an approved proposal/transformation);
 * - waived only when the user explicitly chose, with a note, to leave out the remaining values AND none of them is schema-required;
 * - otherwise acknowledged-but-pending, which keeps a blocking issue blocking.
 */
export function resolveIssues(issues: AcknowledgedIssue[], fields: ResolvedField[], broker: BrokerInput): Issue[] {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  return issues.map((i) => {
    const pendingFields = i.affects.filter((p) => byPath.has(p) && byPath.get(p)!.value === null);
    if (!i.acknowledged) return { ...i, resolution: 'open' as const, pendingFields };
    const ack = broker.acknowledgements[i.id];
    // A blocking issue with no entry field to confirm (e.g. an ambiguous date, a document that was not read) is
    // resolved only by a recorded decision: the acknowledgement must carry a non-empty note.
    if (i.affects.length === 0 && i.blocking && !ack?.note.trim()) return { ...i, resolution: 'acknowledged' as const, pendingFields };
    if (pendingFields.length === 0) return { ...i, resolution: 'resolved' as const, pendingFields };
    const waivable = pendingFields.every((p) => byPath.get(p)!.requirement !== 'schema_required');
    const waived = Boolean(ack?.waive) && waivable && Boolean(ack?.note.trim());
    return { ...i, resolution: waived ? ('waived' as const) : ('acknowledged' as const), pendingFields };
  });
}

/** Stable SHA-256 of the analysis input, independent of object key order. */
export function inputFingerprint(documents: ExtractedDocument[], broker: BrokerInput): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, canonical(o[k])]));
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical({ documents, broker }))).digest('hex');
}

const MISSING_CHILD = /Element '(?:\{[^}]*\})?([\w-]+)': Missing child element\(s\)\. Expected is one of \(([^)]*)\)/;
// Only required/conditionally required gaps can explain a missing-child error (optional markers never do).
const MARKER = /<!-- MISSING \((?:required by schema|conditionally required)\): (\S+) \[(.+?)\]: /;

/**
 * Traces each XSD error to the entry fields responsible. libxml2 reports "Element 'X': Missing child element(s).
 * Expected is one of ( a, b, ... )" at the line of <X>; the builder marks every missing field inside <X> with a comment
 * naming its field path, so an error is explained when such a comment inside <X> names one of the expected elements.
 * Anything else is reported as unexplained: a possible generator defect, never silently ignored.
 */
/**
 * Builder self-check: every field with a confirmed value must appear in the XML as <element>value</element>.
 * A value that is not written is a generator defect; it must never be mistaken for missing business data.
 */
export function unwrittenValues(fields: ResolvedField[], xml: string): string[] {
  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const count = (needle: string) => xml.split(needle).length - 1;
  const needed = new Map<string, { needle: string; paths: string[] }>();
  for (const f of fields) {
    if (f.value === null || f.path === 'entry-no') continue; // entry-no is a choice element, checked by the schema
    const leaf = f.xmlPath.split('/').pop()!;
    const needle = `<${leaf}>${escape(f.value)}</${leaf}>`;
    const entry = needed.get(needle) ?? { needle, paths: [] };
    entry.paths.push(f.path);
    needed.set(needle, entry);
  }
  return [...needed.values()].filter((e) => count(e.needle) < e.paths.length).flatMap((e) => e.paths);
}

export function explainXsdErrors(xml: string, errors: XsdResult['errors'], unwritten: string[] = []): XsdResult['errors'] {
  // If the builder dropped a value, no XSD error can safely be attributed to missing data.
  if (unwritten.length) return errors.map((e) => ({ ...e, cause: 'unexplained' as const, relatedFields: [] }));
  const lines = xml.split(/\r?\n/);
  return errors.map((e) => {
    const m = MISSING_CHILD.exec(e.message);
    if (!m || e.line === null) return { ...e, cause: 'unexplained' as const, relatedFields: [] };
    const [, element, expectedList] = m;
    const expected = new Set(expectedList.split(',').map((x) => x.trim()));
    const open = new RegExp(`<${element}(\\s[^>]*)?>`, 'g');
    const close = new RegExp(`</${element}>`, 'g');
    const related: string[] = [];
    let depth = 0;
    for (let n = e.line - 1; n < lines.length; n++) {
      depth += (lines[n].match(open) ?? []).length - (lines[n].match(close) ?? []).length;
      const c = MARKER.exec(lines[n]);
      // The element itself is reported when its required content is a choice (e.g. <entry-no>).
      if (c && (expected.has(c[1].split('/').pop()!) || c[1] === element)) related.push(c[2]);
      if (depth <= 0) break;
    }
    return { ...e, cause: related.length ? ('missing_data' as const) : ('unexplained' as const), relatedFields: related };
  });
}

/** NetCHB-documented conditional rules (research log RL-9) and CBP rules (RL-10), checked in code. */
export function businessRuleChecks(fields: ResolvedField[], broker: BrokerInput): RuleCheck[] {
  const get = (p: string) => fields.find((f) => f.path === p);
  const has = (p: string) => get(p)?.value != null;
  const checks: RuleCheck[] = [];
  const check = (id: string, description: string, source: string, passed: boolean, detail: string) => checks.push({ id, description, source, passed, detail });

  for (const f of fields.filter((x) => x.requirement === 'schema_required')) {
    check(`REQUIRED:${f.path}`, `${f.label} is present`, f.requirementNote, f.value !== null, f.value !== null ? 'Present.' : `Missing (${f.provenance === 'proposed' ? 'proposal awaiting confirmation' : 'no confirmed value'}).`);
  }

  const entryType = get('header/entry-type')?.value ?? null;
  check('CONDITIONAL:importer-tax-id', 'Importer tax ID present unless entry type is 86', 'entry.xsd: "Required unless the entry type is 86"',
    entryType === '86' || has('header/importer-tax-id'), entryType === '86' ? 'Entry type 86: not required.' : has('header/importer-tax-id') ? 'Present.' : `Missing (entry type ${entryType ?? 'not yet set'}).`);

  for (const [p, quote] of [['header/state-destination', 'required for formal entries'], ['header/mode-transportation', 'required for formal entries or cargo release processing']] as const) {
    check(`CONDITIONAL:${p}`, `${get(p)?.label ?? p} present (formal entry)`, `NetCHB: "${quote}". Treated as applicable until the broker confirms the entry is not formal.`, has(p), has(p) ? 'Present.' : 'Missing.');
  }

  const mode = get('header/mode-transportation')?.value ?? null;
  const ocean = mode === '10' || mode === '11' || (mode === null && has('header/vessel-name'));
  if (ocean) {
    for (const [p, quote] of [['header/vessel-name', 'required for ocean shipments or 06 entry types'], ['header/voyage-no', 'voyage/flight-no is required for air or ocean shipments'], ['header/unlading-port', 'port of unlading is required for ocean shipments']] as const) {
      check(`CONDITIONAL:${p}`, `${get(p)?.label ?? p} present (ocean shipment)`, `NetCHB: "${quote}"`, has(p), has(p) ? 'Present.' : 'Missing.');
    }
    for (const f of fields.filter((x) => /\/line\[[^\]]+\]\/(country-export|lading-port)$/.test(x.path))) {
      const quote = f.path.endsWith('country-export') ? 'required for ocean/air shipments' : 'required for ocean shipments';
      check(`CONDITIONAL:${f.path}`, `${f.label} present (ocean shipment)`, `NetCHB: "${quote}"`, f.value !== null, f.value !== null ? 'Present.' : 'Missing.');
    }
    check('CONDITIONAL:bill-number', 'Bill of lading number reported (vessel modes 10/11)', 'CBP Form 7501 / ACE Entry Summary instructions (research log RL-10)',
      has('manifest/bill-of-lading/master-bill') || has('manifest/bill-of-lading/house-bill'), 'Master or house bill number.');
  }

  if (broker.entryNumberMode === 'not_set') {
    check('ENTRY_NUMBER_OPTION', 'Entry number option chosen', 'entry.xsd: <entry-no> must contain <user-specified> or <system-generated/>', false, 'Not chosen.');
  }

  for (const f of fields.filter((x) => x.formatError)) {
    check(`FORMAT:${f.path}`, `${f.label} has a valid format`, 'Vendored NetCHB schema constraint', false, f.formatError!);
  }
  return checks;
}

export async function analyzeShipment(documents: ExtractedDocument[], broker: BrokerInput, now = new Date()): Promise<AnalysisResult> {
  const ctx = buildContext(documents);
  const acknowledged = applyAcknowledgements(runRules(ctx).map(withState), broker);
  const fields = resolveFields(ctx, broker, acknowledged);
  for (const i of acknowledged.filter((x) => x.rule === 'OCR_UNVERIFIED')) i.affects = fields.filter((f) => f.issueIds.includes(i.id)).map((f) => f.path);
  const issues = resolveIssues(acknowledged, fields, broker);
  const ruleChecks = businessRuleChecks(fields, broker);
  const generatedAt = now.toISOString();
  const fingerprint = inputFingerprint(documents, broker);

  const openBlocking = issues.filter((i) => isUnresolvedBlocker(i) && i.resolution === 'open');
  const pendingBlocking = issues.filter((i) => isUnresolvedBlocker(i) && i.resolution === 'acknowledged');
  const failedChecks = ruleChecks.filter((c) => !c.passed);

  // First pass decides readiness without XSD; the XSD result can only make it stricter.
  let xml = buildEntryXml(fields, { readyToFile: false, generatedAt, inputFingerprint: fingerprint });
  let xsd = await validateEntryXml(xml);
  const reasons: string[] = [];
  if (openBlocking.length) reasons.push(`${openBlocking.length} blocking issue(s) are not yet reviewed.`);
  if (pendingBlocking.length) {
    reasons.push(`${pendingBlocking.length} reviewed blocking issue(s) still need confirmed values, or a resolution note where no entry field is affected (for optional values only, an explicit waiver with a note is also possible).`);
  }
  if (failedChecks.length) reasons.push(`${failedChecks.length} required/conditional field check(s) failed.`);
  const unwritten = unwrittenValues(fields, xml);
  if (unwritten.length) reasons.push(`Generator defect: confirmed value(s) not written to the XML: ${unwritten.join(', ')}.`);
  if (!xsd.ran) reasons.push('XSD validation did not run (see limitation).');
  else if (!xsd.valid) reasons.push(`XSD validation failed with ${xsd.errors.length} error(s).`);
  let status: AnalysisResult['status'] = reasons.length === 0 ? 'PASSES_LOCAL_CHECKS' : 'NOT_READY_TO_FILE';
  if (status === 'PASSES_LOCAL_CHECKS') {
    // Only the header comment changes, but the file the user downloads is the file that is validated.
    xml = buildEntryXml(fields, { readyToFile: true, generatedAt, inputFingerprint: fingerprint });
    xsd = await validateEntryXml(xml);
    if (!xsd.ran || !xsd.valid) {
      status = 'NOT_READY_TO_FILE';
      reasons.push('XSD validation of the final file failed.');
    }
  }

  return {
    generatedAt,
    status,
    statusReasons: status === 'PASSES_LOCAL_CHECKS' ? ['All local checks passed. Broker review is still required; this is not NetCHB or CBP acceptance.'] : reasons,
    documents: documents.map((d) => ({ id: d.id, fileName: d.fileName, docType: d.docType, method: d.method, pageCount: d.pageCount, warnings: d.warnings })),
    issues,
    fields,
    xml,
    xsd: { ...xsd, errors: explainXsdErrors(xml, xsd.errors, unwrittenValues(fields, xml)) },
    ruleChecks,
    disclaimers: DISCLAIMERS,
    inputFingerprint: fingerprint,
    summary: {
      issues: issues.length,
      blocking: issues.filter((i) => i.blocking).length,
      unresolvedBlocking: issues.filter(isUnresolvedBlocker).length,
      open: issues.filter((i) => i.resolution === 'open').length,
      acknowledgedPending: issues.filter((i) => i.resolution === 'acknowledged').length,
      resolved: issues.filter((i) => i.resolution === 'resolved').length,
      waived: issues.filter((i) => i.resolution === 'waived').length,
      ruleChecks: ruleChecks.length,
      failedRuleChecks: failedChecks.length,
      xsdErrors: xsd.errors.length,
    },
  };
}
