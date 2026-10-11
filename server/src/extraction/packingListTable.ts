import type { DocumentLine, SourceField } from '@sefer/shared';
import { norm } from './layout.js';
import type { TextRow } from './pdfText.js';

/**
 * Goods rows of a packing list (style, description, cartons, pieces per carton, total pieces, weights).
 *
 * Column headings are not relied on (on a scan they are often unreadable). Instead a row is accepted only when its
 * numbers check themselves: some cartons × pieces-per-carton = total-pieces triple must hold among the whole numbers
 * to the right of the style code. That arithmetic is what identifies the quantity columns, so a misread digit or a
 * stray mark cannot silently become a quantity. Weights are taken only when BOTH the net and the gross pair check
 * (cartons × per-carton weight = total weight); otherwise they stay empty. Nothing is completed, corrected or guessed:
 * a row that does not check is not returned, and it is reported in the warnings.
 */

export interface PackingTable {
  lines: DocumentLine[];
  warnings: string[];
}

interface Token { text: string; x: number; x1: number; confidence?: number }

/** Whole numbers (cartons, pieces) and decimal numbers (weights) as printed. */
const INT = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;
const DEC = /^(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{1,3}$/;
/** A style / article code: letters and digits, e.g. NB-T101, W-B220, AB1234. */
const STYLE = /^(?=[A-Z0-9/.-]*\d)(?=[A-Z0-9/.-]*[A-Z])[A-Z0-9][A-Z0-9/.-]{2,}[A-Z0-9]$/;
/** Words further apart than this (PDF points) belong to different columns. */
const COLUMN_GAP_PT = 20;
/** A description's continuation line starts within this distance (points) of the description column. */
const SAME_COLUMN_PT = 10;
const MAX_CONTINUATION_LINES = 2;

const value = (t: string) => Number(t.replace(/,/g, ''));
/** Ruling-line remnants OCR leaves at word edges ("|MEN'S", "[49-97"). */
const trimRule = (t: string) => t.replace(/^[|[\]]+|[|[\]]+$/g, '');

function tokens(row: TextRow): Token[] {
  const out: Token[] = [];
  for (const item of row.items) {
    const words = item.text.split(/\s+/).filter(Boolean);
    const end = item.x1 ?? item.x + item.text.length * 5;
    const per = (end - item.x) / Math.max(item.text.length, 1);
    let offset = 0;
    for (const w of words) {
      const at = item.text.indexOf(w, offset);
      offset = at + w.length;
      const text = trimRule(w);
      // Specks and ruling remnants are dropped; printed punctuation words ("-", "/", "&") are kept as printed.
      if (!text || (!/[A-Za-z0-9]/.test(text) && !/^[-/&+]$/.test(text))) continue;
      const x = words.length === 1 ? item.x : item.x + at * per;
      out.push({ text, x, x1: words.length === 1 ? end : x + w.length * per, ...(item.confidence !== undefined ? { confidence: item.confidence } : {}) });
    }
  }
  return out;
}

/** Words from `start` up to the first column gap. */
function columnRun(toks: Token[], start: number): Token[] {
  const run = [toks[start]];
  for (let i = start + 1; i < toks.length && toks[i].x - run[run.length - 1].x1 <= COLUMN_GAP_PT; i++) run.push(toks[i]);
  return run;
}

function minConfidence(ts: Token[]): number | undefined {
  const c = ts.map((t) => t.confidence).filter((x): x is number => x !== undefined);
  return c.length ? Math.min(...c) : undefined;
}

function cell(ts: Token[], row: TextRow, quote: string, note?: string, joiner = ' '): SourceField {
  const confidence = minConfidence(ts);
  return { value: ts.map((t) => t.text).join(joiner), page: row.page, quote, ...(note ? { note } : {}), ...(confidence !== undefined ? { confidence } : {}) };
}

/** cartons × pieces-per-carton = total-pieces: the first such triple, in column order. */
function quantityTriple(nums: Token[]): [number, number, number] | null {
  const ints = nums.map((t, i) => ({ t, i })).filter(({ t }) => INT.test(t.text));
  for (let a = 0; a < ints.length; a++) {
    for (let b = a + 1; b < ints.length; b++) {
      for (let c = b + 1; c < ints.length; c++) {
        const [x, y, z] = [ints[a], ints[b], ints[c]].map((e) => value(e.t.text));
        if (x > 0 && y > 0 && x * y === z) return [ints[a].i, ints[b].i, ints[c].i];
      }
    }
  }
  return null;
}

/** Net and gross weight pairs (per carton, total) that both satisfy cartons × per-carton = total, in column order. */
function weightPairs(nums: Token[], cartons: number): { net: [number, number]; gross: [number, number] } | null {
  const decs = nums.map((t, i) => ({ t, i })).filter(({ t }) => DEC.test(t.text));
  const pairs: [number, number][] = [];
  for (let p = 0; p < decs.length; p++) {
    for (let q = p + 1; q < decs.length; q++) {
      if (Math.abs(cartons * value(decs[p].t.text) - value(decs[q].t.text)) < 0.005) pairs.push([decs[p].i, decs[q].i]);
    }
  }
  for (const a of pairs) {
    for (const b of pairs) {
      // Per-carton columns come before total columns; the heavier per-carton weight is the gross weight.
      if (a[0] < b[0] && b[0] < a[1] && a[1] < b[1]) {
        const [net, gross] = value(nums[a[0]].text) <= value(nums[b[0]].text) ? [a, b] : [b, a];
        return { net, gross };
      }
    }
  }
  return null;
}

export function parsePackingTable(rows: TextRow[]): PackingTable {
  const warnings: string[] = [];
  const parsed = rows.map((row) => {
    const toks = tokens(row);
    // The style code comes first in the row, after an optional carton range ("1 - 48", "138").
    const s = toks.findIndex((t, i) => i < 5 && STYLE.test(t.text) && toks.slice(0, i).every((p) => /^[\d-]+$/.test(p.text)));
    return { row, toks, s };
  });
  const goods = parsed.map((p, i) => ({ ...p, i })).filter((p) => p.s >= 0);
  const lines: DocumentLine[] = [];
  const unread: string[] = [];

  goods.forEach((g, gi) => {
    const { row, toks, s } = g;
    const quote = norm(row.text);
    const desc = s + 1 < toks.length && !INT.test(toks[s + 1].text) && !DEC.test(toks[s + 1].text) ? columnRun(toks, s + 1) : [];
    const afterDesc = s + 1 + desc.length;
    const nums = toks.slice(afterDesc);
    const triple = quantityTriple(nums);
    if (!triple) {
      // Only rows that look like goods rows (a style code AND numbers) are worth reporting as unread.
      if (nums.filter((t) => INT.test(t.text) || DEC.test(t.text)).length >= 2) unread.push(toks[s].text);
      return;
    }
    const [ci, pi, qi] = triple;
    const cartons = value(nums[ci].text);
    const check = `cartons × pieces per carton = total pieces holds for this reading (${nums[ci].text} × ${nums[pi].text} = ${nums[qi].text}); that is an arithmetic check, not a verification of the reading`;
    const cells: Record<string, SourceField> = {
      style: cell([toks[s]], row, quote),
      cartons: cell([nums[ci]], row, quote, check),
      pcsPerCarton: cell([nums[pi]], row, quote, check),
      quantity: cell([nums[qi]], row, quote, check),
    };
    if (s > 0) cells.cartonRange = cell(toks.slice(0, s), row, quote);

    // Description: the style's neighbouring column, plus its continuation lines (e.g. the fabric line) below it.
    if (desc.length) {
      const parts = [desc];
      const quotes = [quote];
      const nextGoods = goods[gi + 1]?.i ?? parsed.length;
      for (let j = g.i + 1; j < Math.min(nextGoods, g.i + 1 + MAX_CONTINUATION_LINES); j++) {
        const t = parsed[j].toks;
        const k = t.findIndex((x) => Math.abs(x.x - desc[0].x) <= SAME_COLUMN_PT);
        if (k < 0 || /^GRAND$|^TOTAL/i.test(t[k].text)) break;
        parts.push(columnRun(t, k));
        quotes.push(norm(parsed[j].row.text));
      }
      const all = parts.flat();
      const confidence = minConfidence(all);
      cells.description = { value: parts.map((p) => p.map((t) => t.text).join(' ')).join('\n'), page: row.page, quote: quotes.join(' / '), ...(confidence !== undefined ? { confidence } : {}) };
    }

    const weights = weightPairs(nums.slice(qi + 1), cartons);
    if (weights) {
      const w = nums.slice(qi + 1);
      const note = 'cartons × per-carton weight = total weight holds for both the net and the gross weight of this reading';
      cells.netWeight = cell([w[weights.net[1]]], row, quote, note);
      cells.grossWeight = cell([w[weights.gross[1]]], row, quote, note);
    }
    lines.push({ cells });
  });

  if (unread.length) {
    warnings.push(`Goods row(s) for ${unread.join(', ')} could not be read reliably (no cartons × pieces per carton = total pieces among the numbers read), so they are not listed. Enter them from the page.`);
  }
  return { lines, warnings };
}
