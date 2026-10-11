import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { extractImages, type getDocumentProxy } from 'unpdf';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { TextRow } from './pdfText.js';

/**
 * Local OCR for scanned PDF pages: tesseract.js (WebAssembly) with the English model installed as an npm package
 * (@tesseract.js-data/eng). Nothing is downloaded at runtime: the language data path is explicit and caching is off.
 *
 * Limits: one shared worker, one page at a time (memory), at most MAX_OCR_PAGES pages per document, and a per-page
 * timeout after which the worker is discarded. Every failure is reported as an OcrError; it is never turned into an
 * empty but "successfully read" document.
 */
export const MAX_OCR_PAGES = 5;
export const OCR_PAGE_TIMEOUT_MS = 60_000;
/** Scans below this width are upscaled 2x before OCR (measured on the sample scans: confidence 63→73% and 77→82%). */
const UPSCALE_BELOW_WIDTH = 2000;
const MAX_PIXELS = 16_000_000;
/** Table mode: dark runs at least this long (in PDF points) are ruling lines, not text strokes. */
const RULE_MIN_LENGTH_PT = 30;
const RULE_DARK_BELOW = 160;

export class OcrError extends Error {}

export interface OcrWord { text: string; confidence: number; x: number; x1: number }
export interface OcrLine { page: number; y: number; text: string; confidence: number; words: OcrWord[] }
export interface OcrPageResult { page: number; confidence: number; lines: OcrLine[]; width: number; upscaled: boolean }

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

const require = createRequire(import.meta.url);
export const LANG_PATH = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, { langPath: LANG_PATH, cacheMethod: 'none', gzip: true }).catch((err) => {
    workerPromise = null;
    throw new OcrError(`The OCR engine could not start (${err instanceof Error ? err.message : String(err)}).`);
  });
  return workerPromise;
}

async function resetWorker(): Promise<void> {
  const w = workerPromise;
  workerPromise = null;
  if (w) await w.then((x) => x.terminate()).catch(() => undefined);
}

/** Releases the OCR worker (tests, shutdown). */
export async function shutdownOcr(): Promise<void> {
  await queue.catch(() => undefined);
  await resetWorker();
}

/** Runs tasks one at a time across all requests, so only one page is in OCR memory at once. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function toGray(data: Uint8ClampedArray, channels: number, n: number): Uint8Array {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = channels < 3 ? data[i * channels] : Math.round(0.299 * data[i * channels] + 0.587 * data[i * channels + 1] + 0.114 * data[i * channels + 2]);
  }
  return g;
}

function upscale2x(g: Uint8Array, w: number, h: number): { g: Uint8Array; w: number; h: number } {
  const W = w * 2, H = h * 2, out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, y / 2), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, x / 2), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      out[y * W + x] = (g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy) + (g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy;
    }
  }
  return { g: out, w: W, h: H };
}

/** Minimal 8-bit greyscale PNG encoder (Node's zlib), so no image library is needed. */
function encodePng(gray: Uint8Array, w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(gray.buffer, gray.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Whitens long straight horizontal and vertical dark runs (table ruling lines) and their 1-pixel fringe. In a ruled
 * table each number sits alone in a bordered cell, and tesseract's page-layout step drops many such cells as graphics
 * (measured on the sample packing list: most quantity cells were missing). Text strokes are far shorter than `minLen`.
 */
export function removeRules(g: Uint8Array, w: number, h: number, minLen: number): number {
  const mark = new Uint8Array(w * h);
  const scan = (outer: number, inner: number, at: (o: number, i: number) => number) => {
    for (let o = 0; o < outer; o++) {
      let start = -1;
      for (let i = 0; i <= inner; i++) {
        const dark = i < inner && g[at(o, i)] < RULE_DARK_BELOW;
        if (dark && start < 0) start = i;
        if (!dark && start >= 0) {
          if (i - start >= minLen) for (let k = start; k < i; k++) mark[at(o, k)] = 1;
          start = -1;
        }
      }
    }
  };
  scan(h, w, (y, x) => y * w + x);
  scan(w, h, (x, y) => y * w + x);
  let erased = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mark[i] || mark[i - w] || mark[i + w] || mark[i - 1] || mark[i + 1]) {
        if (g[i] !== 255) erased++;
        g[i] = 255;
      }
    }
  }
  return erased;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Promise<void>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void onTimeout(); reject(new OcrError(`OCR timed out after ${ms / 1000} s.`)); }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

interface TesseractWord { text: string; confidence: number; bbox: { x0: number; x1: number; y0: number } }
interface TesseractLine { text: string; confidence: number; bbox: { y0: number }; words: TesseractWord[] }

/**
 * OCR of one page: the largest embedded image on the page (a scan).
 * mode 'table' is a second pass for ruled goods tables: the ruling lines are erased first. The page segmentation mode
 * is not changed (tesseract's library default, a single uniform block of text lines, keeps a table row on one line).
 */
export async function ocrPage(pdf: PdfProxy, page: number, mode: 'page' | 'table' = 'page'): Promise<OcrPageResult> {
  return serialized(async () => {
    let images;
    try {
      images = await extractImages(pdf, page);
    } catch (err) {
      throw new OcrError(`The page image could not be extracted (${err instanceof Error ? err.message : String(err)}).`);
    }
    const img = [...images].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!img) throw new OcrError('The page has neither a text layer nor an embedded image to read.');
    let im = { g: toGray(img.data, img.channels, img.width * img.height), w: img.width, h: img.height };
    const upscaled = im.w < UPSCALE_BELOW_WIDTH && im.w * im.h * 4 <= MAX_PIXELS;
    if (upscaled) im = upscale2x(im.g, im.w, im.h);
    // Positions are converted from image pixels to PDF points, the unit the text-layer parsers use.
    const pageWidthPt = (await pdf.getPage(page)).getViewport({ scale: 1 }).width;
    const scale = (upscaled ? 2 : 1) * (img.width / pageWidthPt);
    if (mode === 'table') removeRules(im.g, im.w, im.h, Math.round(RULE_MIN_LENGTH_PT * scale));
    const worker = await getWorker();
    const { data } = await withTimeout(worker.recognize(encodePng(im.g, im.w, im.h), {}, { text: true, blocks: true }), OCR_PAGE_TIMEOUT_MS, resetWorker);
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const l of para.lines as unknown as TesseractLine[]) {
          const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), confidence: Math.round(w.confidence), x: Math.round(w.bbox.x0 / scale), x1: Math.round(w.bbox.x1 / scale) }));
          if (words.length) lines.push({ page, y: Math.round(l.bbox.y0 / scale), text: words.map((w) => w.text).join(' '), confidence: Math.round(l.confidence), words });
        }
      }
    }
    lines.sort((a, b) => a.y - b.y);
    return { page, confidence: Math.round(data.confidence), lines, width: img.width, upscaled };
  });
}

/** OCR lines as layout rows (top of page first), compatible with the text-layer parsers. */
export function ocrRows(lines: OcrLine[]): TextRow[] {
  return lines.map((l) => ({ page: l.page, y: -l.y, items: l.words.map((w) => ({ x: w.x, x1: w.x1, text: w.text, confidence: w.confidence })), text: l.words.map((w) => w.text).join('  '), confidence: l.confidence }));
}
