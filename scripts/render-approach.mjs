// Renders docs/approach.md (D4) to docs/approach.pdf with headless Chrome/Edge (A4, 11 pt, 2 cm margins) and checks that it
// is ONE page. Handles only the Markdown that file uses: headings, paragraphs, bullet lists, **bold**, *italic*, `code`.
// Usage: node scripts/render-approach.mjs   (set CHROME_PATH if Chrome/Edge is not in a standard location)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome/Edge not found. Set CHROME_PATH.'); process.exit(2); }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
let html = '', para = [], list = null;
const flushPara = () => { if (para.length) html += `<p>${inline(para.join(' '))}</p>\n`; para = []; };
const flushList = () => { if (list) html += `<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>\n`; list = null; };
for (const l of readFileSync(join(ROOT, 'docs/approach.md'), 'utf8').split(/\r?\n/)) {
  const h = /^(#{1,6})\s+(.*)$/.exec(l);
  const li = /^\s*[-*]\s+(.*)$/.exec(l);
  if (h) { flushPara(); flushList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>\n`; }
  else if (li) { flushPara(); (list ??= []).push(li[1]); }
  else if (!l.trim()) { flushPara(); flushList(); }
  else if (list && /^\s{2,}/.test(l)) list[list.length - 1] += ' ' + l.trim();
  else { flushList(); para.push(l.trim()); }
}
flushPara(); flushList();

const dir = mkdtempSync(join(tmpdir(), 'approach-'));
const htmlPath = join(dir, 'approach.html');
const pdfPath = join(ROOT, 'docs/approach.pdf');
writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>Approach</title><style>
@page { size: A4; margin: 2cm; }
body { font: 11pt/1.3 Calibri, Arial, sans-serif; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 6pt; } p { margin: 0 0 5pt; } ul { margin: 0 0 5pt; padding-left: 16pt; } li { margin: 0 0 2pt; }
code { font: 0.92em Consolas, monospace; }
</style></head><body>${html}</body></html>`);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${join(dir, 'profile')}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
rmSync(dir, { recursive: true, force: true });
const pages = (readFileSync(pdfPath, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`docs/approach.pdf: ${pages} page(s) (A4, 11 pt, 2 cm margins)`);
process.exit(pages === 1 ? 0 : 1);
