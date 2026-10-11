import type { DocType } from '@sefer/shared';

/** Title phrases checked against the document's own text (highest signal). */
const CONTENT_RULES: { type: DocType; pattern: RegExp }[] = [
  { type: 'commercial_invoice', pattern: /\bcommercial\s+invoice\b/i },
  { type: 'packing_list', pattern: /\bpacking\s+list\b/i },
  { type: 'bill_of_lading', pattern: /\b(bill\s+of\s+lading|sea\s*waybill)\b/i },
];

/** File-name hints. Only a guess: the UI asks the user to confirm. */
const FILE_NAME_RULES: { type: DocType; pattern: RegExp }[] = [
  { type: 'commercial_invoice', pattern: /invoice|(^|[^a-z])ci([^a-z]|$)/i },
  { type: 'packing_list', pattern: /packing|(^|[^a-z])pl([^a-z]|$)/i },
  { type: 'bill_of_lading', pattern: /lading|(^|[^a-z])(h|m)?bl([^a-z]|$)|waybill/i },
];

export function classifyByContent(text: string): DocType | null {
  // Use the earliest matching title: an invoice may mention "packing list" in its notes.
  let best: { type: DocType; index: number } | null = null;
  for (const rule of CONTENT_RULES) {
    const m = rule.pattern.exec(text);
    if (m && (best === null || m.index < best.index)) best = { type: rule.type, index: m.index };
  }
  return best?.type ?? null;
}

export function classifyByFileName(fileName: string): DocType | null {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const hits = FILE_NAME_RULES.filter((r) => r.pattern.test(base));
  return hits.length === 1 ? hits[0].type : null;
}
