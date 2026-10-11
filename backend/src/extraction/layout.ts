import type { SourceField } from '@sefer/shared';
import type { TextRow } from './pdfText.js';

/**
 * Label- and column-aware helpers shared by the document readers. They work on layout rows from either the PDF text
 * layer or OCR (both carry x positions in PDF points). A helper returns null instead of guessing when a label or value
 * is not found; every value keeps the row text it came from as its quote.
 */

export interface Reading {
  value: string;
  page: number;
  quote: string;
  /** Minimum OCR confidence of the words that make up the value (OCR rows only). */
  confidence?: number;
  note?: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Tokens made only of punctuation are OCR noise (table rules, stray marks). */
const isNoise = (t: string) => !/[A-Za-z0-9]/.test(t);

export function confidenceOf(row: TextRow, value: string): number | undefined {
  const scores = row.items.filter((i) => i.confidence !== undefined);
  if (!scores.length) return row.confidence;
  const tokens = value.split(/\s+/).filter((t) => !isNoise(t));
  const hits = tokens.map((t) => scores.find((i) => i.text.includes(t) || (t.includes(i.text) && i.text.length > 1))?.confidence).filter((c): c is number => c !== undefined);
  return hits.length ? Math.min(...hits) : row.confidence;
}

function reading(row: TextRow, value: string, quote = norm(row.text), note?: string): Reading {
  return { value, page: row.page, quote, confidence: confidenceOf(row, value), ...(note ? { note } : {}) };
}

/** First row whose text matches `re`; the value is capture group 1 (or the given group). */
export function byLabel(rows: TextRow[], re: RegExp, group = 1, from = 0): (Reading & { index: number }) | null {
  for (let i = from; i < rows.length; i++) {
    const m = re.exec(norm(rows[i].text));
    const v = m?.[group]?.trim();
    if (v) return { ...reading(rows[i], v), index: i };
  }
  return null;
}

export function findRow(rows: TextRow[], re: RegExp, from = 0): number {
  for (let i = from; i < rows.length; i++) if (re.test(norm(rows[i].text))) return i;
  return -1;
}

/** x position where `label` starts in a row (matching from an item boundary), or null. */
function labelX(row: TextRow, label: RegExp): number | null {
  for (let i = 0; i < row.items.length; i++) {
    const rest = row.items.slice(i).map((t) => t.text).join(' ');
    if (new RegExp(`^(?:${label.source})`, 'i').test(rest)) return row.items[i].x;
  }
  return null;
}

/**
 * Values printed under a row of column headings (typical B/L and packing-list grids). Words of the next row are
 * assigned to the heading whose x range they fall in. Returns one reading (or null) per heading.
 */
export function columnsBelow(rows: TextRow[], headerIndex: number, labels: RegExp[], tolerance = 6): (Reading | null)[] {
  const header = rows[headerIndex];
  const valueRow = rows[headerIndex + 1];
  if (!header || !valueRow || valueRow.page !== header.page) return labels.map(() => null);
  const xs = labels.map((l) => labelX(header, l));
  return labels.map((_, k) => {
    const x0 = xs[k];
    if (x0 === null) return null;
    const x1 = Math.min(...xs.filter((x): x is number => x !== null && x > x0), Infinity);
    const words = valueRow.items.filter((it) => it.x >= x0 - tolerance && it.x < x1 - tolerance && !isNoise(it.text));
    if (!words.length) return null;
    const value = norm(words.map((w) => w.text).join(' '));
    return reading(valueRow, value, `${norm(header.text)} / ${norm(valueRow.text)}`);
  });
}

/** First line of the left-column block below a party heading (e.g. "Shipper / Exporter"). */
export function partyBelow(rows: TextRow[], label: RegExp): Reading | null {
  const i = findRow(rows, label);
  if (i < 0) return null;
  const x0 = labelX(rows[i], label) ?? 0;
  const pageRows = rows.filter((r) => r.page === rows[i].page);
  const pageRight = Math.max(...pageRows.flatMap((r) => r.items.map((t) => t.x)));
  for (let j = i + 1; j < Math.min(rows.length, i + 3); j++) {
    const words = rows[j].items.filter((it) => it.x >= x0 - 10 && it.x < x0 + (pageRight - x0) / 2 && !isNoise(it.text));
    const value = norm(words.map((w) => w.text).join(' '));
    if (/[A-Za-z]{3,}/.test(value)) return reading(rows[j], value, `${norm(rows[i].text)} / ${norm(rows[j].text)}`);
  }
  return null;
}

/** Converts a reading to the shared SourceField shape. */
export function toField(r: Reading | null | undefined): SourceField | undefined {
  if (!r) return undefined;
  return { value: r.value, page: r.page, quote: r.quote, ...(r.note ? { note: r.note } : {}), ...(r.confidence !== undefined ? { confidence: r.confidence } : {}) };
}

export function fieldsFrom(readings: Record<string, Reading | null | undefined>): Record<string, SourceField> {
  const out: Record<string, SourceField> = {};
  for (const [k, r] of Object.entries(readings)) {
    const f = toField(r);
    if (f) out[k] = f;
  }
  return out;
}

export { norm };
