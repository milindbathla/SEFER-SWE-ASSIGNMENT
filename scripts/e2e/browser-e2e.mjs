// Real-browser end-to-end check of the RUNNING app (start it first with `npm run dev`).
// Drives headless Chrome or Edge over the Chrome DevTools Protocol using Node's built-in WebSocket: no extra packages.
// The normal workflow uses PDFs only: the two scanned sample documents are read by OCR and reviewed in the UI (no JSON).
// Usage: npm run e2e:browser        (or: node scripts/e2e/browser-e2e.mjs [appUrl])
// Set CHROME_PATH if Chrome/Edge is not in a standard Windows location. Screenshots and downloads go to the OS temp folder.
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = process.argv[2] ?? 'http://127.0.0.1:5173/';
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome/Edge not found. Set CHROME_PATH.'); process.exit(2); }
const PORT = 9333;
const OUT = join(tmpdir(), 'sefer-browser-e2e');
const DL = join(OUT, 'downloads');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { if (process.platform === 'win32') execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); else chrome.kill(); } catch {} };
process.on('exit', cleanup);

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
    else listeners.forEach((l) => l(msg));
  };
  return { send: (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }), on: (l) => listeners.push(l), close: () => ws.close() };
}

let version;
for (let i = 0; i < 50 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); } }
const browser = await connect(version.webSocketDebuggerUrl);
await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const page = await connect(target.webSocketDebuggerUrl);

const consoleErrors = [];
page.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleErrors.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
});
await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable'); await page.send('DOM.enable');

const evaluate = async (expr) => { const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, label, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch {} await sleep(200); } console.log(`   (timeout waiting for: ${label})`); return false; };
const bodyText = () => evaluate('document.body.innerText');
const clickButton = (prefix) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(prefix)})); if (!b) return false; b.click(); return true; })()`);
const shot = async (name) => { const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64')); };
const setFiles = async (selector, files) => { const { root } = await page.send('DOM.getDocument', { depth: -1, pierce: true }); const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector }); if (!nodeId) throw new Error(`no node for ${selector}`); await page.send('DOM.setFileInputFiles', { nodeId, files }); };
const win = (p) => (process.platform === 'win32' ? p.replace(/\//g, '\\') : p);

// Any confirm() dialog (bulk OCR confirmation, clearing the review) is accepted, as a user would.
page.on((m) => { if (m.method === 'Page.javascriptDialogOpening') page.send('Page.handleJavaScriptDialog', { accept: true }); });
const card = (needle) => `[...document.querySelectorAll('section.card')].find((c) => c.innerText.includes(${JSON.stringify(needle)}) && [...c.querySelectorAll('button')].some((b) => b.textContent === 'Remove'))`;
const fieldRow = (cardNeedle, label) => `[...${card(cardNeedle)}.querySelectorAll('tr')].find((r) => r.children[0] && r.children[0].textContent.trim() === ${JSON.stringify(label)})`;
const typeInto = (inputExpr, value) => evaluate(`(() => { const inp = ${inputExpr}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, ${JSON.stringify(value)}); inp.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const issuesLabel = () => evaluate(`(document.body.innerText.match(/3\\. All issues \\((\\d+) blocking unresolved\\)/) || [])[1]`).then((n) => (n === undefined ? null : Number(n)));

// 1. Load the app
await page.send('Page.navigate', { url: APP });
check('UI loads (title + heading)', await waitFor(`document.title === 'Entry Draft Builder' && !!document.querySelector('h1')`, 'h1'));
check('UI states local review only / no <transmit/>', /nothing is submitted/i.test(await bodyText()));
await shot('01-start');

// 2. Upload the three sample PDFs through the real file input: NO JSON anywhere in the normal workflow
const pdfs = ['KBAS-NB-26-0912_Commercial_Invoice.pdf', 'SPG-PL-2609-117_Packing_List.pdf', 'BMLVHCM26090418_House_BL.pdf'].map((f) => win(join(ROOT, 'sample-docs', f)));
const t0 = Date.now();
await setFiles('input[type=file][accept*="pdf"]', pdfs);
check('an OCR progress message is shown while the scans are read', await waitFor(`document.body.innerText.includes('read by OCR on this computer')`, 'OCR busy', 10000));
check('3 PDFs read (text layer + OCR), no JSON used', await waitFor(`document.body.innerText.includes('1. Documents (3)')`, 'Documents (3)', 120000), `${Date.now() - t0} ms`);
check('status banner shows NOT READY', await waitFor(`/NOT READY TO FILE/i.test(document.body.innerText)`, 'banner'));
let text = await bodyText();
check('the two scans are labelled "Read by OCR" and their type comes from their content', (text.match(/Read by OCR \(scanned\): verify every value/g) ?? []).length === 2 && !text.includes('guessed from file name'));
check('OCR readings are shown as unverified, with confidence badges', await evaluate(`document.querySelectorAll('.badge.review-unverified').length > 20 && document.querySelectorAll('.badge.conf').length > 20`));
const togglePages = () => evaluate(`[...document.querySelectorAll('button')].filter((b) => /Show page beside values|Hide page/.test(b.textContent)).forEach((b) => b.click())`);
await togglePages();
check('each scanned PDF can show its page next to its values', await waitFor(`document.querySelectorAll('.doc-review iframe').length === 2`, 'previews'));
await shot('02b-page-preview');
await togglePages();
const settled = () => waitFor(`!document.body.innerText.includes('Updating for your latest changes')`, 'analysis settled', 30000);
await shot('02-ocr-read');

// 3. Unverified OCR readings block the entry and the downloads
await clickButton('3. All issues');
await waitFor(`document.querySelectorAll('article.issue').length > 0`, 'issue cards');
text = await bodyText();
check('one blocking OCR_UNVERIFIED issue per scanned document', (text.match(/OCR_UNVERIFIED/g) ?? []).length === 2);
const blockersBefore = await issuesLabel();
await clickButton('5. XML');
await waitFor(`!!document.querySelector('pre.xml')`, 'xml');
check('downloads are disabled while OCR readings are unverified, with the reason', await evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.startsWith('Download')).every((b) => b.disabled) && document.body.innerText.includes('Verify the OCR readings first')`));
check('the XML contains no unverified OCR value (vessel name withheld)', !(await evaluate(`document.querySelector('pre.xml').textContent`)).includes('<vessel-name>'));

// 4. Review the OCR readings: correct one, reject one, confirm one, then confirm the rest after comparing with the page
await clickButton('1. Documents');
await waitFor(`!!${card('BMLVHCM26090418_House_BL.pdf')}`, 'B/L card');
check('the packing-list goods table is read by OCR: 5 rows with style, quantity and description, shown as unverified readings', await evaluate(`(() => { const t = ${card('SPG-PL-2609-117_Packing_List.pdf')}.innerText; return t.includes('Lines (5)') && ['NB-T101', 'NB-H205', '2,400', '1,176', '65/35'].every((v) => t.includes(v) || [...${card('SPG-PL-2609-117_Packing_List.pdf')}.querySelectorAll('input, textarea')].some((i) => i.value.includes(v))); })()`));
await typeInto(`${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Port Of Loading')}.querySelector('input')`, 'CAT LAI, HCMC, VN');
check('typing over an OCR reading marks it "corrected" and keeps the OCR text as evidence', await waitFor(`${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Port Of Loading')}.innerText.includes('corrected') && ${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Port Of Loading')}.innerText.includes('WN')`, 'corrected'));
await evaluate(`[...${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Shipped On Board Date')}.querySelectorAll('button')].find((b) => b.textContent === 'Reject').click()`);
check('rejecting a misread empties the value and marks it "rejected"', await waitFor(`${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Shipped On Board Date')}.innerText.includes('rejected') && ${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Shipped On Board Date')}.querySelector('input').value === ''`, 'rejected'));
await evaluate(`[...${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Gross Weight')}.querySelectorAll('button')].find((b) => b.textContent === 'Confirm').click()`);
check('confirming one reading marks it "confirmed"', await waitFor(`${fieldRow('BMLVHCM26090418_House_BL.pdf', 'Gross Weight')}.innerText.includes('confirmed')`, 'confirmed'));
for (const name of ['BMLVHCM26090418_House_BL.pdf', 'SPG-PL-2609-117_Packing_List.pdf']) {
  await evaluate(`[...${card(name)}.querySelectorAll('button')].find((b) => b.textContent.startsWith('Confirm all remaining readings')).click()`);
}
await settled();
check('after every reading is reviewed, the OCR issues disappear', await waitFor(`!document.body.innerText.includes('unverified') || document.querySelectorAll('.badge.review-unverified').length === 0`, 'no unverified', 20000)
  && await waitFor(`(() => { const t = document.body.innerText; return !/OCR reading\\(s\\) not yet verified/.test(t); })()`, 'issues gone'));
await shot('03-ocr-reviewed');

// 5. Issues tab: cross-document conflicts on the verified readings
await clickButton('3. All issues');
await waitFor(`document.querySelectorAll('article.issue').length > 0`, 'issue cards');
text = await bodyText();
check('OCR_UNVERIFIED issues are gone after review', !text.includes('OCR_UNVERIFIED'));
check('gross weight conflict (C-4) shows both printed values', text.includes('GROSS_WEIGHT_MISMATCH') && text.includes('1,888.00') && text.includes('1,930.000'));
for (const rule of ['LINE_ARITHMETIC', 'ORIGIN_CONFLICT', 'AMBIGUOUS_DATE', 'CIF_DEDUCTIONS', 'ASSIST_INDICATOR', 'NO_COMMERCIAL_VALUE']) if (!text.includes(rule)) check(`rule ${rule} visible`, false);
const blockers = await issuesLabel();
check('blocking count dropped by exactly the two OCR issues', blockers === blockersBefore - 2, `${blockersBefore} → ${blockers}`);
const gwCard = `[...document.querySelectorAll('article.issue')].find((x) => x.innerText.includes('GROSS_WEIGHT_MISMATCH'))`;
await evaluate(`${gwCard}.querySelector('input[type=checkbox]').click()`);
check('reviewing the gross-weight conflict keeps it blocking with a next step', await waitFor(`${gwCard}.innerText.includes('Reviewed: confirmed values (or a resolution note) still needed') && ${gwCard}.innerText.includes('Next step')`, 'acknowledged state')
  && (await issuesLabel()) === blockers);
const waiverBox = `[...${gwCard}.querySelectorAll('label')].find((l) => l.textContent.includes('explicit waiver')).querySelector('input')`;
check('the waiver is disabled until a resolution note is written', await evaluate(`${waiverBox}.disabled === true`));
await typeInto(`${gwCard}.querySelector('input.wide')`, 'E2E: broker decided to omit gross weight until the carrier confirms');
await waitFor(`${waiverBox}.disabled === false`, 'waiver enabled');
await evaluate(`${waiverBox}.click()`);
check('an explicit waiver with a note closes the issue', await waitFor(`(() => { const m = document.body.innerText.match(/3\\. All issues \\((\\d+) blocking unresolved\\)/); return m && Number(m[1]) === ${blockers - 1}; })()`, 'count - 1'));
check('the waived issue moves to the closed list, labelled as waived', await evaluate(`(() => { const d = document.querySelector('details'); return !!d && d.textContent.includes('Resolved or waived issues (1)') && d.textContent.includes('Waived: optional values deliberately left out'); })()`));

// 6. Fields tab: approve the invoice-number transformation; verified OCR values are now used
await clickButton('4. All entry fields');
await waitFor(`document.querySelectorAll('table.fields').length > 0`, 'fields tables');
const valueOf = (needle) => `(() => { const row = [...document.querySelectorAll('table.fields tr')].find((r) => r.innerText.includes(${JSON.stringify(needle)})); return row ? row.children[1].textContent : null; })()`;
check('verified OCR readings now reach the entry (vessel name from three agreeing documents)', (await evaluate(valueOf('header/vessel-name'))) === 'PACIFIC ARGOS');
check('invoice-no proposal shown but not written', (await evaluate(valueOf('invoice/invoice-no'))) === 'not written');
await evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('I approve using the transformed number')); l.querySelector('input').click(); })()`);
check('after explicit approval the transformed invoice number is written', await waitFor(`${valueOf('invoice/invoice-no')} === 'KBASNB26-0912'`, 'value written'));
await shot('04-fields');

// 7. XML tab + downloads
await clickButton('5. XML');
await waitFor(`!!document.querySelector('pre.xml') && [...document.querySelectorAll('button')].filter((b) => b.textContent.startsWith('Download')).every((b) => !b.disabled)`, 'downloads enabled');
const xml = await evaluate(`document.querySelector('pre.xml').textContent`);
check('XML: NOT READY label, approved invoice-no, verified vessel, no <transmit', /DRAFT: NOT READY TO FILE/.test(xml) && xml.includes('<invoice-no>KBASNB26-0912</invoice-no>') && xml.includes('<vessel-name>PACIFIC ARGOS</vessel-name>') && !/<transmit/.test(xml));
check('XSD section shows the official-schema validator and traced causes', /xmllint-wasm/.test(await bodyText()) && (await bodyText()).includes('Missing data:'));
await shot('05-xml');
for (const [btn, re] of [['Download XML', /^entry-draft-.*\.xml$/], ['Download report', /^validation-report-.*\.md$/], ['Download full analysis', /^analysis-.*\.json$/]]) {
  await clickButton(btn);
  let file;
  for (let i = 0; i < 50 && !file; i++) { file = readdirSync(DL).find((f) => re.test(f)); if (!file) await sleep(200); }
  check(`${btn} produces a file`, !!file, file ?? 'none');
  if (file && file.endsWith('.xml')) { const c = readFileSync(join(DL, file), 'utf8'); check('downloaded XML equals preview and is labelled NOT READY', c === xml && /NOT READY TO FILE/.test(c)); }
  if (file && file.endsWith('.md')) {
    const c = readFileSync(join(DL, file), 'utf8');
    const fp = await evaluate(`document.querySelector('.banner .small').textContent.match(/input ([0-9a-f]{16})/)[1]`);
    check('downloaded report describes the state on screen (same fingerprint and blocker count)', c.includes(fp) && xml.includes(`Input ${fp}.`) && c.includes(`| Blocking issues still unresolved | ${blockers - 1} of`), fp);
  }
}

// 8. Persistence: a page reload restores documents, OCR review state and decisions
await page.send('Page.reload');
check('reload restores the review from this browser', await waitFor(`document.body.innerText.includes('Restored your saved review') && document.body.innerText.includes('1. Documents (3)')`, 'restored'));
check('restored decisions and OCR verification still apply (same blocker count; vessel and invoice number in the XML)', await waitFor(`(() => { const m = document.body.innerText.match(/3\\. All issues \\((\\d+) blocking unresolved\\)/); return m && Number(m[1]) === ${blockers - 1}; })()`, 'restored count')
  && (await clickButton('5. XML')) && await waitFor(`!!document.querySelector('pre.xml') && document.querySelector('pre.xml').textContent.includes('<invoice-no>KBASNB26-0912</invoice-no>') && document.querySelector('pre.xml').textContent.includes('<vessel-name>PACIFIC ARGOS</vessel-name>')`, 'restored xml'));

// 8b. Review queue (A–E) on the real documents: grouped confirmation, source choices with a note, acknowledgement is not resolution
await clickButton('2. Review queue');
check('review queue shows sections A–E', await waitFor(`['A. Confirm suggested values', 'B. Resolve conflicting', 'C. Supply broker', 'D. Tariff classification', 'E. Final XML validation'].every((h) => document.body.innerText.includes(h))`, 'queue sections'));
const section = (k) => `document.getElementById('queue-${k}')`;
const xmlNow = async () => { await clickButton('5. XML'); await waitFor(`!!document.querySelector('pre.xml')`, 'xml'); await settled(); const x = await evaluate(`document.querySelector('pre.xml').textContent`); await clickButton('2. Review queue'); await waitFor(`!!${section('A')}`, 'queue'); return x; };
const count = (x, needle) => x.split(needle).length - 1;
check('A: the same suggestion on 5 lines is one row with one action', await evaluate(`[...${section('A')}.querySelectorAll('button')].some((b) => b.textContent === 'Confirm for all 5 lines')`));
const xmlBeforeQueue = await xmlNow();
await evaluate(`(() => { const row = [...${section('A')}.querySelectorAll('tr')].find((r) => r.innerText.includes('country of export (5 lines)')); [...row.querySelectorAll('button')].find((b) => b.textContent === 'Confirm for all 5 lines').click(); })()`);
await settled();
let qx = await xmlNow();
check('confirming the grouped suggestion writes <country-export>VN</country-export> on all 5 lines', count(xmlBeforeQueue, '<country-export>VN</country-export>') === 0 && count(qx, '<country-export>VN</country-export>') === 5);

// B: origin conflict on line 5, resolved by choosing a source value with a note
const issueEl = (id) => `document.querySelector('[data-issue=${JSON.stringify(JSON.stringify(id)).slice(1, -1)}]')`;
const originId = 'ORIGIN_CONFLICT:invoice[1]/line[5]';
check('B: origin conflict lists both source values (BD from the line, VN from the document level)', await waitFor(`!!${issueEl(originId)} && ${issueEl(originId)}.innerText.includes('BD') && ${issueEl(originId)}.innerText.includes('VN')`, 'origin choices'));
check('B: "Use this value" is disabled until a decision note is written', await evaluate(`[...${issueEl(originId)}.querySelectorAll('button')].filter((b) => b.textContent === 'Use this value').every((b) => b.disabled)`));
const blockersQ = await issuesLabel();
await typeInto(`${issueEl(originId)}.querySelector('input[aria-label^="Decision note"]')`, 'E2E test decision: origin per line taken from the invoice line');
await waitFor(`[...${issueEl(originId)}.querySelectorAll('button')].some((b) => b.textContent === 'Use this value' && !b.disabled)`, 'choice enabled');
await evaluate(`(() => { const row = [...${issueEl(originId)}.querySelectorAll('tr')].find((r) => r.children[1] && r.children[1].textContent === 'BD'); row.querySelector('button').click(); })()`);
await settled();
check('choosing a value with a note resolves exactly that issue (blocking count −1, issue leaves the queue)', await waitFor(`(() => { const m = document.body.innerText.match(/3\\. All issues \\((\\d+) blocking unresolved\\)/); return m && Number(m[1]) === ${blockersQ - 1}; })()`, 'count -1') && !(await evaluate(`!!${issueEl(originId)}`)));
qx = await xmlNow();
check('the chosen origin is in the XML for line 5 only', count(qx, '<country-origin>BD</country-origin>') === 1);

// B: the invoice lines are compared with the OCR-read packing-list rows: the known NB-H205 differences are found on the PDF-only path
const qtyId = 'QUANTITY_MISMATCH:invoice[1]/line[2]';
check('B: no "could not be compared with the packing list" item: the goods table was read', !(await evaluate(`!!${issueEl('PACKING_LIST_ROWS_NOT_READ')}`)));
check('B: quantity conflict for NB-H205 lists both source values (invoice 1200, packing list 1176)', await waitFor(`!!${issueEl(qtyId)} && ${issueEl(qtyId)}.innerText.includes('1200') && ${issueEl(qtyId)}.innerText.includes('1176')`, 'qty conflict'));
check('B: fibre-composition conflict for NB-H205 (60/40 vs 65/35) is shown', await waitFor(`!!${issueEl('FIBRE_MISMATCH:invoice[1]/line[2]')} && ${issueEl('FIBRE_MISMATCH:invoice[1]/line[2]')}.innerText.includes('65/35')`, 'fibre conflict'));
check('B: the W-B220 line points at the packing-list row whose style OCR could not read (not silently unmatched)', await waitFor(`!!${issueEl('STYLE_NOT_ON_PACKING_LIST:invoice[1]/line[4]')} && ${issueEl('STYLE_NOT_ON_PACKING_LIST:invoice[1]/line[4]')}.innerText.includes('no (readable) style number')`, 'style row'));

// D: an acknowledgement alone never clears a blocking valuation issue
const assistId = 'ASSIST_INDICATOR:invoice[1]/line[4]';
await typeInto(`${issueEl(assistId)}.querySelector('input[aria-label^="Decision note"]')`, 'E2E test: broker reviewing the assist');
await evaluate(`[...${issueEl(assistId)}.querySelectorAll('button')].find((b) => b.textContent === 'Record decision').click()`);
await settled();
check('D: recording a decision on the assist keeps it blocking (no value was supplied)', await waitFor(`${issueEl(assistId)}.innerText.includes('Decision recorded, but this issue stays blocking')`, 'assist pending') && (await issuesLabel()) === blockersQ - 1);
check('D: no waiver offered for a schema-required value', !(await evaluate(`${issueEl(assistId)}.innerText.includes('explicit waiver')`)));

// C: one explicit action applies a typed line value to all lines
const midRow = `[...${section('C')}.querySelectorAll('tr')].find((r) => r.innerText.includes('manufacturer ID (MID) (5 lines)'))`;
await typeInto(`${midRow}.querySelector('input.wide')`, 'E2ETESTMID01');
await waitFor(`[...${midRow}.querySelectorAll('button')].some((b) => b.textContent.startsWith('Use "E2ETESTMID01" for all 5 lines'))`, 'copy button');
await evaluate(`[...${midRow}.querySelectorAll('button')].find((b) => b.textContent.startsWith('Use "E2ETESTMID01"')).click()`);
await settled();
check('C: "use for all lines" writes the typed MID on all 5 lines (test value)', count(await xmlNow(), '<manufacturer-id>E2ETESTMID01</manufacturer-id>') === 5);
await shot('07-queue');

// The queue's decisions survive a reload and are revalidated, not trusted
await page.send('Page.reload');
check('reload: queue decisions are restored and re-analysed (same count; BD origin, 5 MIDs, 5 VN exports in the XML)', await waitFor(`document.body.innerText.includes('Restored your saved review')`, 'restored2')
  && await waitFor(`(() => { const m = document.body.innerText.match(/3\\. All issues \\((\\d+) blocking unresolved\\)/); return m && Number(m[1]) === ${blockersQ - 1}; })()`, 'restored count 2')
  && await (async () => { const x = await xmlNow(); return count(x, '<country-origin>BD</country-origin>') === 1 && count(x, '<manufacturer-id>E2ETESTMID01</manufacturer-id>') === 5 && count(x, '<country-export>VN</country-export>') === 5; })());
check('the draft stays NOT READY TO FILE while mandatory data is missing', /DRAFT: NOT READY TO FILE/.test(await bodyText()));

// 9. Error handling in the UI
await clickButton('1. Documents');
writeFileSync(join(OUT, 'notes.txt'), 'not a pdf');
await setFiles('input[type=file][accept*="pdf"]', [win(join(OUT, 'notes.txt'))]);
check('non-PDF upload shows a per-file error', await waitFor(`document.body.innerText.includes('is not a PDF file')`, 'non-PDF error'));
await setFiles('input[type=file][accept*="pdf"]', [pdfs[0]]);
check('re-uploading an already loaded PDF is ignored with a message', await waitFor(`document.body.innerText.includes('already loaded')`, 'duplicate msg') && (await bodyText()).includes('1. Documents (3)'));
await evaluate(`[...${card('KBAS-NB-26-0912_Commercial_Invoice')}.querySelectorAll('button')].find((b) => b.textContent === 'Remove').click()`);
check('removing the invoice leaves 2 documents', await waitFor(`document.body.innerText.includes('1. Documents (2)')`, 'Documents (2)'));
await setFiles('input[type=file][accept*="pdf"]', [pdfs[0], pdfs[0]]);
await waitFor(`['1. Documents (3)', '1. Documents (4)'].some((s) => document.body.innerText.includes(s))`, 'invoice re-added');
await sleep(800);
text = await bodyText();
check('same PDF twice in ONE selection is added once, duplicate reported', text.includes('1. Documents (3)') && text.includes('already loaded'), text.match(/1\. Documents \(\d+\)/)?.[0]);
await shot('06-errors');

// 10. Clear the saved review → nothing is restored after a reload
await clickButton('Clear saved review');
check('"Clear saved review" removes documents and decisions', await waitFor(`!document.body.innerText.includes('1. Documents (')`, 'cleared'));
await page.send('Page.reload');
await waitFor(`!!document.querySelector('h1')`, 'reloaded');
await sleep(800);
check('after clearing, a reload restores nothing', !(await bodyText()).includes('Restored your saved review'));

check('no uncaught exceptions or console errors in the browser', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' || '));
console.log(`\nScreenshots and downloads: ${OUT}`);
console.log(`${pass} passed, ${fail} failed`);
page.close(); browser.close(); cleanup();
process.exit(fail ? 1 : 0);
