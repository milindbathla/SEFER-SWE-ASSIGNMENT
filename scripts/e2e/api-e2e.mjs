// End-to-end API check against the RUNNING app (start it first with `npm run dev`).
// It calls the API through the Vite proxy, the same path the browser uses, with the supplied sample documents.
// Usage: npm run e2e:api            (or: node scripts/e2e/api-e2e.mjs [baseUrl])
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const empty = () => ({ values: {}, acceptedProposals: [], acknowledgements: {}, approvedTransformations: [], entryNumberMode: 'not_set' });
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const analyze = async (documents, brokerInput) => { const r = await post('/api/analyze', { documents, brokerInput }); return { status: r.status, body: await r.json() }; };

const PDFS = ['KBAS-NB-26-0912_Commercial_Invoice.pdf', 'SPG-PL-2609-117_Packing_List.pdf', 'BMLVHCM26090418_House_BL.pdf'];

// 1. Upload + classification
const form = new FormData();
for (const f of PDFS) form.append('files', new Blob([readFileSync(join(ROOT, 'sample-docs', f))], { type: 'application/pdf' }), f);
const up = await fetch(BASE + '/api/documents', { method: 'POST', body: form });
const upBody = await up.json();
check('upload 3 sample PDFs → 200, 3 documents, 0 errors', up.status === 200 && upBody.documents.length === 3 && upBody.errors.length === 0, `status ${up.status}`);
const byType = Object.fromEntries(upBody.documents.map((d) => [d.docType, d]));
check('classification: all three by content (the scans from their OCR text)', ['commercial_invoice', 'packing_list', 'bill_of_lading'].every((t) => byType[t]?.docTypeSource === 'content'),
  upBody.documents.map((d) => `${d.fileName.slice(0, 14)}…=${d.docType}/${d.docTypeSource}/${d.method}`).join(', '));
const inv = byType.commercial_invoice;
check('invoice: text-layer extraction, 2 pages, 5 lines', inv.method === 'text_layer' && inv.pageCount === 2 && inv.lines.length === 5, `${inv.method}, ${inv.pageCount}p, ${inv.lines.length} lines`);
const withEvidence = Object.values(inv.fields).filter((f) => f.value !== null);
check('invoice: every extracted field has page + verbatim quote', withEvidence.length > 0 && withEvidence.every((f) => f.page && f.quote), `${withEvidence.length} fields`);
check('invoice: printed amount kept, not corrected (line 1 = 6,480.00)', inv.lines[0].cells.amount?.value === '6,480.00', inv.lines[0].cells.amount?.value);
check('scans: read by OCR, every reading unverified with a confidence', ['packing_list', 'bill_of_lading'].every((t) => byType[t].method === 'ocr'
  && Object.values(byType[t].fields).every((f) => f.verification === 'unverified' && typeof f.confidence === 'number')));
check('scans: OCR values as read (PL gross weight, B/L gross weight)', byType.packing_list.fields.totalGrossWeight?.value === '1,888.00 KGS' && byType.bill_of_lading.fields.grossWeight?.value === '1,930.000 KGS');

// 2. Analysis on the raw OCR readings: unverified readings block readiness and never reach the XML
let a = await analyze(upBody.documents, empty());
check('analysis with unverified OCR → NOT_READY_TO_FILE + one OCR_UNVERIFIED per scan', a.status === 200 && a.body.result.status === 'NOT_READY_TO_FILE'
  && a.body.result.issues.filter((i) => i.rule === 'OCR_UNVERIFIED' && i.blocking).length === 2);
check('unverified OCR values are not in the XML', !a.body.result.xml.includes('<vessel-name>') && !a.body.result.xml.includes('<gross-weight>'));

// 3. OPTIONAL path: reviewed transcriptions (bound by SHA-256) replace the OCR readings; the D2 sample is built this way
const docs = [inv];
for (const [t, f] of [['packing_list', 'SPG-PL-2609-117_Packing_List'], ['bill_of_lading', 'BMLVHCM26090418_House_BL']]) {
  const transcription = JSON.parse(readFileSync(join(ROOT, 'fixtures/sample-transcriptions', `${f}.transcription.json`), 'utf8'));
  const r = await post('/api/transcriptions/apply', { transcription, target: byType[t] });
  const b = await r.json();
  check(`transcription applied to ${t}`, r.status === 200 && b.document.method === 'manual_transcription' && b.document.id === byType[t].id, `status ${r.status}`);
  docs.push(b.document);
}
const wrong = await post('/api/transcriptions/apply', { transcription: JSON.parse(readFileSync(join(ROOT, 'fixtures/sample-transcriptions/SPG-PL-2609-117_Packing_List.transcription.json'), 'utf8')), target: byType.bill_of_lading });
check('transcription for the wrong PDF → 409', wrong.status === 409, `status ${wrong.status}`);

// 4. Full analysis, no broker input
a = await analyze(docs, empty());
const res = a.body.result;
const f = (r, p) => r.fields.find((x) => x.path === p);
const rules = new Set(res.issues.map((i) => i.rule));
const expected = ['LINE_ARITHMETIC', 'INVOICE_TOTALS', 'QUANTITY_MISMATCH', 'FIBRE_MISMATCH', 'GROSS_WEIGHT_MISMATCH', 'CONTAINER_NUMBER', 'ASSIST_INDICATOR', 'ORIGIN_CONFLICT', 'NO_COMMERCIAL_VALUE', 'PARTIES_UNRESOLVED', 'INVOICE_NUMBER_FORMAT', 'AMBIGUOUS_DATE', 'CIF_DEDUCTIONS'];
check('all C-1…C-12 rules raised', expected.every((r) => rules.has(r)), `missing: ${expected.filter((r) => !rules.has(r)).join(',') || 'none'}`);
check('issue count 16 (15 blocking), status NOT_READY_TO_FILE', res.issues.length === 16 && res.issues.filter((i) => i.blocking).length === 15 && res.status === 'NOT_READY_TO_FILE', `${res.issues.length}/${res.issues.filter((i) => i.blocking).length}, ${res.status}`);
check('every issue has evidence and a required action', res.issues.every((i) => i.requiredAction && (i.evidence.length > 0 || i.kind === 'missing_broker')), res.issues.filter((i) => !i.evidence.length).map((i) => i.rule).join(','));
const conflicts = res.issues.filter((i) => i.kind === 'conflict');
check('conflicts cite ≥2 sources each', conflicts.every((i) => i.evidence.length >= 2), conflicts.filter((i) => i.evidence.length < 2).map((i) => i.id).join(',') || `${conflicts.length} conflicts`);
const gw = res.issues.find((i) => i.rule === 'GROSS_WEIGHT_MISMATCH');
check('gross weight: both printed values shown', gw.evidence.some((e) => /1,888/.test(e.value ?? '')) && gw.evidence.some((e) => /1,930/.test(e.value ?? '')), gw.evidence.map((e) => e.value).join(' | '));
check('gross-weight field withheld while conflicting', f(res, 'header/gross-weight')?.value === null);
check('XML: NOT READY label, no <transmit', /DRAFT: NOT READY TO FILE/.test(res.xml) && !/<transmit/.test(res.xml));
check('XSD ran against official schema and reports errors', res.xsd.ran === true && res.xsd.valid === false && res.xsd.errors.length > 0, `${res.xsd.errors.length} errors`);
check('report Markdown says NOT READY TO FILE', /NOT READY TO FILE/.test(a.body.reportMarkdown));
check('summary counts come from the same state (15/15 blockers unresolved, 10 XSD errors) and the report shows them',
  res.summary.unresolvedBlocking === 15 && res.summary.blocking === 15 && res.summary.xsdErrors === res.xsd.errors.length && res.summary.failedRuleChecks === res.ruleChecks.filter((c) => !c.passed).length
  && a.body.reportMarkdown.includes(res.inputFingerprint) && a.body.reportMarkdown.includes(`| Blocking issues still unresolved | 15 of 15 |`) && res.xml.includes(`Input ${res.inputFingerprint.slice(0, 16)}.`),
  JSON.stringify(res.summary));
check('every XSD error is traced to missing data (no unexplained generator errors)', res.xsd.errors.every((e) => e.cause === 'missing_data' && e.relatedFields.length > 0));
check('disputed values are "withheld", absent ones "missing", unconfirmed proposals "proposed"',
  f(res, 'header/gross-weight')?.provenance === 'withheld' && f(res, 'header/entry-date')?.provenance === 'missing' && f(res, 'header/entry-port')?.provenance === 'proposed');
check('no proposal written without confirmation', res.fields.every((x) => x.provenance !== 'proposed' || x.value === null));

// D2 consistency: committed XML equals current output (ignoring timestamp)
const strip = (x) => x.replace(/Generated [^.]+\.\d+Z/, 'Generated <t>').replace(/\r\n/g, '\n').trim();
const d2 = readFileSync(join(ROOT, 'output/sample/sample-entry-draft.xml'), 'utf8');
check('committed D2 XML matches what the running app generates (timestamp ignored)', strip(d2) === strip(res.xml));

// 5. Broker workflow: proposals / transformation / acknowledgements
const invField = res.fields.find((x) => /invoice-no$/.test(x.path));
let b = { ...empty(), approvedTransformations: [invField.path] };
let r2 = (await analyze(docs, b)).body.result;
check('invoice-no transformation used only after approval', invField.value === null && f(r2, invField.path).value === 'KBASNB26-0912' && f(r2, invField.path).provenance === 'approved_transformation', `${invField.value} → ${f(r2, invField.path).value}`);
const portField = res.fields.find((x) => x.path === 'header/entry-port');
b = { ...b, acceptedProposals: [portField.path] };
r2 = (await analyze(docs, b)).body.result;
check('entry-port proposal used only after explicit acceptance', portField.value === null && f(r2, 'header/entry-port').value === portField.proposal, `${portField.proposal}`);
b = { ...b, acknowledgements: Object.fromEntries(res.issues.map((i) => [i.id, { note: 'reviewed in e2e test' }])) };
r2 = (await analyze(docs, b)).body.result;
check('acknowledging ALL issues does not fill withheld values', f(r2, 'header/gross-weight').value === null && r2.status === 'NOT_READY_TO_FILE', `status ${r2.status}`);
const gwIssue = r2.issues.find((i) => i.rule === 'GROSS_WEIGHT_MISMATCH');
check('a reviewed conflict stays blocking until a value is confirmed or (optional only) waived with a note', gwIssue.resolution === 'acknowledged' && gwIssue.pendingFields.includes('header/gross-weight'), gwIssue.resolution);
check('still NOT READY with reasons listed (missing broker data)', r2.statusReasons.length > 0, r2.statusReasons.slice(0, 2).join(' / '));
b = { ...b, values: { 'header/entry-date': '2026-13-45' } };
r2 = (await analyze(docs, b)).body.result;
check('invalid typed date → format error, value withheld', f(r2, 'header/entry-date').formatError !== null && f(r2, 'header/entry-date').value === null, f(r2, 'header/entry-date').formatError);
b = { ...b, entryNumberMode: 'system_generated' };
r2 = (await analyze(docs, b)).body.result;
check('system-generated entry number only when chosen', /<system-generated\/>/.test(r2.xml) && !/<system-generated\/>/.test(res.xml));

// 6. Error handling
const bad = new FormData();
bad.append('files', new Blob(['hello']), 'notes.txt');
bad.append('files', new Blob([]), 'empty.pdf');
bad.append('files', new Blob(['%PDF-1.4 garbage']), 'corrupt.pdf');
let e = await fetch(BASE + '/api/documents', { method: 'POST', body: bad });
let eb = await e.json();
check('non-PDF / empty / corrupt → 200 with 3 per-file errors, 0 documents', e.status === 200 && eb.errors.length === 3 && eb.documents.length === 0, eb.errors.map((x) => `${x.fileName}: ${x.message}`).join(' | '));
e = await fetch(BASE + '/api/documents', { method: 'POST' });
check('upload with no files → 400', e.status === 400, `${e.status}`);
const many = new FormData();
for (let i = 0; i < 11; i++) many.append('files', new Blob(['%PDF-']), `f${i}.pdf`);
e = await fetch(BASE + '/api/documents', { method: 'POST', body: many });
check('11 files (limit 10) → 400 with clear message', e.status === 400, `${e.status} ${JSON.stringify(await e.json())}`);
const wrongField = new FormData();
wrongField.append('document', new Blob(['%PDF-']), 'x.pdf');
e = await fetch(BASE + '/api/documents', { method: 'POST', body: wrongField });
check('wrong multipart field name → 400', e.status === 400, `${e.status} ${JSON.stringify(await e.json())}`);
e = await fetch(BASE + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
check('invalid JSON → 400', e.status === 400, `${e.status}`);
e = await post('/api/analyze', { documents: [{ id: 'x' }], brokerInput: empty() });
eb = await e.json();
check('malformed document → 400 with field paths', e.status === 400 && eb.details?.[0]?.path?.startsWith('documents.0'), eb.details?.[0]?.path);
e = await post('/api/analyze', { documents: docs, brokerInput: { ...empty(), entryNumberMode: 'submit_now' } });
check('unknown entry-number mode → 400', e.status === 400, `${e.status}`);
e = await post('/api/transcriptions/apply', { transcription: { format: 'nope' } });
check('malformed transcription → 400', e.status === 400, `${e.status}`);
e = await fetch(BASE + '/api/does-not-exist');
check('unknown API route → 404', e.status === 404, `${e.status} ${e.headers.get('content-type')}`);
e = await post('/api/analyze', { documents: [], brokerInput: empty() });
check('empty shipment → 200, NOT_READY_TO_FILE', e.status === 200 && (await e.json()).result.status === 'NOT_READY_TO_FILE');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
