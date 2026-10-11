/**
 * Deterministic parsing of values that were transcribed exactly as printed.
 * Nothing here guesses: when a value is ambiguous the caller receives every candidate.
 */

export interface ParsedNumber {
  value: number;
  /** Printed in parentheses, e.g. "(24.00)": often a no-charge or credit presentation. */
  parenthesized: boolean;
  /** Trailing marker such as "*" (footnote reference). */
  marker: string | null;
  unit: string | null;
  raw: string;
}

const NUMBER_RE = /^\s*(\()?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(\))?\s*(\*+)?\s*([A-Za-z][A-Za-z.' ]*)?\s*$/;

export function parseNumber(raw: string | null | undefined): ParsedNumber | null {
  if (raw == null) return null;
  const m = NUMBER_RE.exec(raw);
  if (!m) return null;
  const value = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return {
    value,
    parenthesized: Boolean(m[1] && m[3]),
    marker: m[4] ?? null,
    unit: m[5] ? m[5].trim().toUpperCase() : null,
    raw,
  };
}

/** Money is compared in integer cents to avoid floating-point drift. */
export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function formatMoney(n: number): string {
  return (toCents(n) / 100).toFixed(2);
}

const WEIGHT_UNITS: Record<string, string> = { KG: 'KG', KGS: 'KG', KILO: 'KG', KILOS: 'KG', KILOGRAM: 'KG', KILOGRAMS: 'KG', LB: 'LB', LBS: 'LB' };

export function normalizeWeightUnit(unit: string | null): string | null {
  if (!unit) return null;
  return WEIGHT_UNITS[unit.replace(/\./g, '').toUpperCase()] ?? null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** "Sep", "SEPT", "September" -> 9. Anything else -> null. */
function monthOf(word: string): number | null {
  const w = word.toUpperCase();
  const i = MONTHS.indexOf(w.slice(0, 3));
  if (i < 0) return null;
  return w.length === 3 || MONTH_NAMES[i].startsWith(w) ? i + 1 : null;
}

export interface ParsedDate {
  /** The single ISO date if unambiguous, otherwise null. */
  iso: string | null;
  /** Every valid interpretation (2 when day/month order is ambiguous). */
  candidates: string[];
  ambiguous: boolean;
  raw: string;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(raw: string | null | undefined): ParsedDate | null {
  if (raw == null) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const v = iso(+m[1], +m[2], +m[3]);
    return v ? { iso: v, candidates: [v], ambiguous: false, raw } : null;
  }
  m = /^(\d{1,2})[\s\-./]([A-Za-z]{3,9})[\s\-./,]+(\d{4})$/.exec(s);
  if (m && monthOf(m[2])) {
    const v = iso(+m[3], monthOf(m[2])!, +m[1]);
    return v ? { iso: v, candidates: [v], ambiguous: false, raw } : null;
  }
  m = /^([A-Za-z]{3,9})[\s.]+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && monthOf(m[1])) {
    const v = iso(+m[3], monthOf(m[1])!, +m[2]);
    return v ? { iso: v, candidates: [v], ambiguous: false, raw } : null;
  }
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    const dayFirst = iso(y, b, a);
    const monthFirst = iso(y, a, b);
    const candidates = [...new Set([dayFirst, monthFirst].filter((x): x is string => x !== null))];
    if (candidates.length === 0) return null;
    return { iso: candidates.length === 1 ? candidates[0] : null, candidates, ambiguous: candidates.length > 1, raw };
  }
  return null;
}

export function normalizeKey(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Extracts fibre-composition percentages from text such as "60% Cotton 40% Polyester" or
 * "TC 65/35". Only the numbers are compared; fibre names and abbreviations are NOT
 * interpreted (e.g. what "TC" stands for is left to a person).
 */
export function compositionNumbers(text: string | null | undefined): number[] | null {
  if (!text) return null;
  const pct = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  if (pct.length && Math.abs(pct.reduce((a, b) => a + b, 0) - 100) < 0.01) return pct.sort((a, b) => b - a);
  for (const m of text.matchAll(/\b(\d{1,3})((?:\/\d{1,3})+)\b/g)) {
    const parts = [m[1], ...m[2].split('/').filter(Boolean)].map(Number);
    if (parts.length >= 2 && parts.reduce((a, b) => a + b, 0) === 100) return parts.sort((a, b) => b - a);
  }
  return pct.length ? pct.sort((a, b) => b - a) : null;
}
