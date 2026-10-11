import { DOC_TYPE_LABELS, PROVENANCE_LABELS, RESOLUTION_LABELS, type AnalysisResult, type Evidence } from '@sefer/shared';

const esc = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ');

function ev(e: Evidence): string {
  return `${e.label ? `**${esc(e.label)}**: ` : ''}${e.value !== null ? `"${esc(e.value)}"` : ''}${e.quote && e.quote !== e.value ? ` (quote: "${esc(e.quote)}")` : ''}. ${esc(e.fileName)}${e.page ? `, p.${e.page}` : ''}`;
}

/** Human-readable validation report (Markdown) for the generated XML. */
export function renderReport(r: AnalysisResult, opts: { title?: string; issueMap?: Record<string, string>; brokerRequests?: string[] } = {}): string {
  const out: string[] = [];
  const status = r.status === 'NOT_READY_TO_FILE' ? '❌ NOT READY TO FILE' : '⚠️ PASSES LOCAL CHECKS: broker review still required; not NetCHB/CBP acceptance';
  out.push(`# ${opts.title ?? 'Entry validation report'}`, '', `Generated: ${r.generatedAt}  `, `Input fingerprint (SHA-256 of documents + broker decisions): \`${r.inputFingerprint}\``, '', `## Status: ${status}`, '');
  for (const reason of r.statusReasons) out.push(`- ${reason}`);

  const s = r.summary;
  out.push('', '### Summary', '', '| Measure | Count | Meaning |', '|---|---|---|');
  out.push(`| Issues | ${s.issues} | Findings from the cross-document review (conflicts, uncertain readings, broker-only data). |`);
  out.push(`| Blocking issues still unresolved | ${s.unresolvedBlocking} of ${s.blocking} | Blocking issues that are open (${s.open} open in total, including non-blocking) or reviewed but still waiting for confirmed values (${s.acknowledgedPending}). Resolved: ${s.resolved}; waived: ${s.waived}. |`);
  out.push(`| Required/conditional field checks failed | ${s.failedRuleChecks} of ${s.ruleChecks} | Entry fields the schema or NetCHB's documented rules require that have no confirmed value or an invalid format. |`);
  out.push(`| XSD errors | ${s.xsdErrors} | Structural errors from validating this exact XML against the official schema. libxml2 reports only the first missing child per element. |`);
  out.push('', '### Disclaimers', '');
  for (const d of r.disclaimers) out.push(`- ${d}`);

  out.push('', '## Documents', '', '| File | Type | Extraction method | Pages | Warnings |', '|---|---|---|---|---|');
  for (const d of r.documents) out.push(`| ${esc(d.fileName)} | ${DOC_TYPE_LABELS[d.docType]} | ${d.method} | ${d.pageCount} | ${esc(d.warnings.join(' '))} |`);

  out.push('', '## XSD validation', '');
  out.push(`- Validator: ${r.xsd.validator}`);
  for (const f of r.xsd.schemaFiles) out.push(`- Schema: \`${f.file}\` (source ${f.source}, SHA-256 \`${f.sha256}\`)`);
  out.push(`- Ran: ${r.xsd.ran ? 'yes' : 'NO'}; result: ${r.xsd.valid === null ? 'n/a' : r.xsd.valid ? 'valid' : `**invalid** (${r.xsd.errors.length} error(s))`}`);
  if (r.xsd.limitation) out.push(`- Limitation: ${r.xsd.limitation}`);
  if (r.xsd.errors.length) {
    out.push('', '| XML line | Error | Cause |', '|---|---|---|');
    for (const e of r.xsd.errors) {
      const cause = e.cause === 'missing_data' ? `Missing data: ${(e.relatedFields ?? []).map((f) => `\`${f}\``).join(', ')}` : '**Unexplained**: not traced to a missing field (possible generator defect)';
      out.push(`| ${e.line ?? ''} | ${esc(e.message)} | ${cause} |`);
    }
  }

  const failed = r.ruleChecks.filter((c) => !c.passed);
  out.push('', `## Required and conditional field checks (${failed.length} failed of ${r.ruleChecks.length})`, '', '| Result | Check | Source | Detail |', '|---|---|---|---|');
  for (const c of [...failed, ...r.ruleChecks.filter((x) => x.passed)]) out.push(`| ${c.passed ? '✅' : '❌'} | ${esc(c.description)} | ${esc(c.source)} | ${esc(c.detail)} |`);

  out.push('', `## Issues (${s.issues}; ${s.unresolvedBlocking} blocking and unresolved)`, '');
  for (const i of r.issues) {
    const ref = opts.issueMap?.[i.id];
    out.push(`### ${ref ? `[${ref}] ` : ''}${i.title}`, '');
    out.push(`- **State:** ${i.state}${i.blocking ? ' · **blocking**' : ''}`);
    out.push(`- **Resolution:** ${RESOLUTION_LABELS[i.resolution]}${i.acknowledgementNote ? ` · note: "${esc(i.acknowledgementNote)}"` : ''}${i.pendingFields.length ? ` · values still unconfirmed: ${i.pendingFields.map((p) => `\`${p}\``).join(', ')}` : ''}`);
    out.push(`- **Rule:** \`${i.rule}\`${i.reference ? ` · Reference: ${i.reference}` : ''}`);
    out.push(`- **Explanation:** ${i.explanation}`);
    out.push(`- **Required action:** ${i.requiredAction}`);
    if (i.affects.length) out.push(`- **Affects:** ${i.affects.map((a) => `\`${a}\``).join(', ')}`);
    if (i.choices?.length) {
      out.push('- **Values stated by the sources** (offered as choices; none is applied automatically):');
      for (const c of i.choices) out.push(`  - \`${c.field}\` = \`${esc(c.value)}\`: ${esc(c.source)}${c.caution ? ` ⚠️ ${esc(c.caution)}` : ''}`);
    }
    if (i.evidence.length) {
      out.push('- **Evidence:**');
      for (const e of i.evidence) out.push(`  - ${ev(e)}`);
    }
    out.push('');
  }

  const requests = (opts.brokerRequests ?? []).map((p) => r.fields.find((f) => f.path === p)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  if (requests.length) {
    out.push('## Marked as waiting for the broker', '', 'Fields the reviewer marked as needing broker input. This is a to-do list: it supplies no value and resolves nothing.', '');
    for (const f of requests) out.push(`- \`${f.path}\` (${esc(f.label)}): ${f.value !== null ? `now \`${esc(f.value)}\` (${PROVENANCE_LABELS[f.provenance]})` : PROVENANCE_LABELS[f.provenance]}${f.inputHint ? `. ${esc(f.inputHint)}` : ''}`);
    out.push('');
  }

  const notWritten = r.fields.filter((f) => f.value === null);
  out.push('## Not written to the XML', '', 'Elements the XML does not contain, and why. Required ones are also marked with a comment inside the XML; optional ones are marked when an issue concerns them.', '');
  for (const [title, list] of [
    ['Withheld: the documents disagree or are uncertain', notWritten.filter((f) => f.provenance === 'withheld')],
    ['Proposal awaiting explicit confirmation', notWritten.filter((f) => f.provenance === 'proposed')],
    ['Missing: no value available (broker input required)', notWritten.filter((f) => f.provenance === 'missing' && (f.requirement !== 'optional' || f.issueIds.length > 0 || f.formatError))],
  ] as const) {
    out.push(`### ${title} (${list.length})`, '');
    if (!list.length) out.push('None.', '');
    for (const f of list) out.push(`- \`${f.path}\` (${f.label}; ${f.requirement.replace('_', ' ')})${f.formatError ? `: ⚠️ ${esc(f.formatError)}` : ''}${f.proposal ? `: proposal \`${esc(f.proposal)}\`` : ''}${f.issueIds.length ? `; issues: ${f.issueIds.map((x) => `\`${x}\``).join(', ')}` : ''}`);
    if (list.length) out.push('');
  }

  out.push('## Field provenance', '', '| Field | XML element | Requirement | Value written | Status | Proposal (not used unless confirmed) |', '|---|---|---|---|---|---|');
  for (const f of r.fields) {
    out.push(`| ${esc(f.label)} | \`${f.xmlPath}\` | ${f.requirement.replace('_', ' ')} | ${f.value !== null ? `\`${esc(f.value)}\`` : '—'} | ${PROVENANCE_LABELS[f.provenance]}${f.formatError ? ` ⚠️ ${esc(f.formatError)}` : ''} | ${f.proposal ? `\`${esc(f.proposal)}\`: ${esc(f.proposalReason)}` : ''} |`);
  }
  out.push('');
  return out.join('\n');
}
