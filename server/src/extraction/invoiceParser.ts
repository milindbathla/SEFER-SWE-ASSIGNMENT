import type { DocumentLine, SourceField, TextLine } from '@sefer/shared';
import type { TextRow } from './pdfText.js';

/**
 * Deterministic parser for commercial invoices that have a text layer.
 * It recognises common label wording ("Invoice No.:", "Currency:" ...) and a goods table
 * whose rows end with HS code, quantity, unit, unit price and amount. It transcribes; it never
 * computes or corrects. Anything it cannot recognise is reported as a warning, and the user can
 * complete or fix the result through manual entry.
 */

interface LabelRule {
  pattern: RegExp;
  keys: string[];
}

const LABELS: LabelRule[] = [
  { pattern: /^invoice\s*(no|number|#)\.?$/i, keys: ['invoiceNumber'] },
  { pattern: /^(invoice\s+)?date$/i, keys: ['invoiceDate'] },
  { pattern: /^(buyer'?s\s+)?p\.?\s?o\.?(\s*(no|number)\.?)?$/i, keys: ['buyerPo'] },
  { pattern: /^currency$/i, keys: ['currency'] },
  { pattern: /^(incoterms?|terms\s+of\s+delivery|delivery\s+terms)$/i, keys: ['incoterms'] },
  { pattern: /^payment\s+terms$/i, keys: ['paymentTerms'] },
  { pattern: /^port\s+of\s+loading$/i, keys: ['portOfLoading'] },
  { pattern: /^port\s+of\s+discharge$/i, keys: ['portOfDischarge'] },
  { pattern: /^country\s+of\s+origin$/i, keys: ['countryOfOrigin'] },
  { pattern: /^vessel\s*\/\s*voy(age)?\.?$/i, keys: ['vesselName', 'voyageNumber'] },
  { pattern: /^vessel(\s+name)?$/i, keys: ['vesselName'] },
  { pattern: /^voy(age)?\.?(\s*(no|number)\.?)?$/i, keys: ['voyageNumber'] },
  { pattern: /^(b\/l|bill\s+of\s+lading)\s*(no|number)\.?$/i, keys: ['blNumber'] },
  { pattern: /^etd\s*\/\s*eta$/i, keys: ['etd', 'eta'] },
  { pattern: /^etd$/i, keys: ['etd'] },
  { pattern: /^eta$/i, keys: ['eta'] },
  { pattern: /sub-?\s?total/i, keys: ['subtotal'] },
  { pattern: /^total\s+(fob|exw|ex-works|fca)\b/i, keys: ['totalGoodsValue'] },
  { pattern: /freight/i, keys: ['freight'] },
  { pattern: /insurance/i, keys: ['insurance'] },
  { pattern: /^total\s+(cif|cip|cfr|cpt|dap|dpu|ddp|invoice\s+(value|amount)|amount)\b/i, keys: ['totalInvoiceValue'] },
  { pattern: /^total\s+quantity$/i, keys: ['totalQuantity'] },
  { pattern: /^total\s+(packages|cartons)$/i, keys: ['totalPackages'] },
];

const PARTY_LABELS: { pattern: RegExp; key: string }[] = [
  { pattern: /^(sold\s+to|bill\s+to)\b/i, key: 'soldTo' },
  { pattern: /^(ship\s+to|deliver\s+to)\b/i, key: 'shipTo' },
];

const LABEL_SPLIT = /^([^:]{1,60}):\s*(.*)$/s;
const NUMBER = /^\(?-?[\d,]+(\.\d+)?\)?\s*\*?$/;
const HS_CODE = /^\d{4}(\.?\d{2}){0,3}$/;
const LINE_NO = /^\d{1,3}$/;

export interface InvoiceParseResult {
  fields: Record<string, SourceField>;
  lines: DocumentLine[];
  textLines: TextLine[];
  warnings: string[];
}

function field(value: string | null, page: number, quote: string, note?: string): SourceField {
  return note ? { value, page, quote, note } : { value, page, quote };
}

function matchLabel(label: string): LabelRule | undefined {
  const clean = label.replace(/\s+/g, ' ').trim();
  return LABELS.find((l) => l.pattern.test(clean));
}

function isTableHeader(row: TextRow): boolean {
  return /hs\s*code/i.test(row.text) && /quantity|qty/i.test(row.text) && /description/i.test(row.text);
}

export function parseInvoiceRows(rows: TextRow[]): InvoiceParseResult {
  const fields: Record<string, SourceField> = {};
  const lines: DocumentLine[] = [];
  const textLines: TextLine[] = [];
  const warnings: string[] = [];

  const setField = (key: string, f: SourceField) => {
    const existing = fields[key];
    if (!existing) {
      fields[key] = f;
    } else if ((existing.value ?? '').replace(/\s+/g, ' ') !== (f.value ?? '').replace(/\s+/g, ' ')) {
      warnings.push(`"${key}" appears more than once with different values: "${existing.value}" (page ${existing.page}) and "${f.value}" (page ${f.page}). The first is used; please check.`);
    }
  };

  // Seller heuristic: the letterhead is the first row of page 1.
  const first = rows.find((r) => r.page === 1);
  if (first) setField('seller', field(first.text, 1, first.text, 'Heuristic: first line of page 1 (letterhead).'));

  let inTable = false;
  let tableCols: { descX: number; hsX: number } | null = null;
  let current: DocumentLine | null = null;
  let currentDesc: string[] = [];
  let currentPage = 0;
  let currentDescX = 0;
  let rowsInTable = 0;
  let lastPartyY: number | null = null;
  const party: Record<string, { x: number; page: number; lines: string[] } | undefined> = {};
  let activeParties: { key: string; x: number }[] = [];

  const closeLine = () => {
    if (current) {
      const desc = currentDesc.join('\n');
      current.cells.description = field(desc, currentPage, desc);
      const originMatch = /\(?\s*(?:country\s+of\s+)?origin\s*:\s*([A-Za-z][A-Za-z .'-]*?)\s*\)?\s*$/im.exec(desc) ?? /made\s+in\s+([A-Za-z][A-Za-z .'-]*)/i.exec(desc);
      if (originMatch) current.cells.origin = field(originMatch[1].trim(), currentPage, originMatch[0].trim());
      lines.push(current);
    }
    current = null;
    currentDesc = [];
  };

  for (const row of rows) {
    if (isTableHeader(row)) {
      closeLine();
      inTable = true;
      activeParties = [];
      const desc = row.items.find((i) => /description/i.test(i.text));
      const hs = row.items.find((i) => /hs\s*code/i.test(i.text));
      tableCols = { descX: desc ? desc.x : 0, hsX: hs ? hs.x : Number.POSITIVE_INFINITY };
      rowsInTable = 0;
      continue;
    }

    if (inTable && tableCols) {
      const items = row.items.map((i) => ({ x: i.x, text: i.text.trim() }));
      const isItemRow = items.length >= 7 && LINE_NO.test(items[0].text) && NUMBER.test(items[items.length - 1].text);
      if (isItemRow) {
        closeLine();
        const n = items.length;
        const [amount, unitPrice, unit, quantity, hsCode] = [items[n - 1], items[n - 2], items[n - 3], items[n - 4], items[n - 5]];
        const ok = NUMBER.test(unitPrice.text) && /^[A-Za-z]{1,6}$/.test(unit.text) && NUMBER.test(quantity.text) && HS_CODE.test(hsCode.text);
        if (!ok) {
          warnings.push(`Page ${row.page}: a goods-table row could not be split into columns and was skipped: "${row.text}". Enter this line manually.`);
          continue;
        }
        const q = row.text;
        current = {
          cells: {
            lineNo: field(items[0].text, row.page, q),
            style: field(items[1].text, row.page, q),
            hsCode: field(hsCode.text, row.page, q),
            quantity: field(quantity.text, row.page, q),
            unit: field(unit.text, row.page, q),
            unitPrice: field(unitPrice.text, row.page, q),
            amount: field(amount.text, row.page, q),
          },
        };
        currentPage = row.page;
        currentDesc = items.slice(2, n - 5).map((i) => i.text);
        currentDescX = items.length > 7 ? items[2].x : tableCols.descX;
        rowsInTable++;
        continue;
      }
      const isContinuation = current !== null && items.every((i) => i.x >= currentDescX - 3 && i.x < tableCols!.hsX - 2);
      if (isContinuation) {
        currentDesc.push(row.text);
        continue;
      }
      if (rowsInTable === 0 && current === null && !LABEL_SPLIT.test(row.text)) {
        continue; // header noise between the column titles and the first goods row (e.g. "USD")
      }
      if (current === null && /brought\s+forward/i.test(row.text)) {
        textLines.push({ page: row.page, text: row.text });
        continue;
      }
      closeLine();
      inTable = false;
    }

    textLines.push({ page: row.page, text: row.text });

    // Party blocks: a label with no value on its row, followed by lines at the same x position.
    let rowHasLabel = false;
    for (const item of row.items) {
      const m = LABEL_SPLIT.exec(item.text.trim());
      if (!m || m[2].trim()) continue;
      const p = PARTY_LABELS.find((pl) => pl.pattern.test(m[1].trim()));
      if (p && !party[p.key]) {
        party[p.key] = { x: item.x, page: row.page, lines: [] };
        activeParties.push({ key: p.key, x: item.x });
        rowHasLabel = true;
      }
    }
    const rowHasKnownLabel = row.items.some((it) => {
      const m = LABEL_SPLIT.exec(it.text.trim());
      return m !== null && matchLabel(m[1]) !== undefined;
    });
    const bigGap = lastPartyY !== null && lastPartyY - row.y > 20;
    if (activeParties.length && (rowHasKnownLabel || bigGap)) activeParties = [];
    if (rowHasLabel) lastPartyY = row.y;
    if (!rowHasLabel && activeParties.length) {
      let continued = false;
      for (const ap of activeParties) {
        const item = row.items.find((i) => Math.abs(i.x - ap.x) <= 3);
        if (item) {
          party[ap.key]!.lines.push(item.text.trim());
          continued = true;
        }
      }
      if (!continued) activeParties = [];
      else {
        lastPartyY = row.y;
        continue;
      }
    }

    // Label/value pairs, either inside one text item ("Date: 12/09/2026") or across items.
    for (let i = 0; i < row.items.length; i++) {
      const m = LABEL_SPLIT.exec(row.items[i].text.trim());
      if (!m) continue;
      const rule = matchLabel(m[1]);
      if (!rule) continue;
      let value = m[2].trim();
      let quote = row.items[i].text.trim();
      if (!value) {
        const parts: string[] = [];
        for (let j = i + 1; j < row.items.length; j++) {
          const next = LABEL_SPLIT.exec(row.items[j].text.trim());
          if (next && matchLabel(next[1])) break;
          parts.push(row.items[j].text.trim());
        }
        value = parts.join(' ').trim();
        quote = [quote, ...parts].join(' ');
      }
      if (!value) continue;
      if (rule.keys.length === 1) {
        setField(rule.keys[0], field(value, row.page, quote));
      } else {
        const pieces = value.split(/\s*\/\s*/);
        if (pieces.length === rule.keys.length) {
          rule.keys.forEach((k, idx) => setField(k, field(pieces[idx], row.page, quote)));
        } else {
          setField(rule.keys[0], field(value, row.page, quote));
          warnings.push(`Page ${row.page}: "${quote}" could not be split into ${rule.keys.join(' and ')}; please check manually.`);
        }
      }
    }
  }
  closeLine();

  for (const [key, block] of Object.entries(party)) {
    if (block && block.lines.length) {
      setField(key, field(block.lines[0], block.page, block.lines.join('\n')));
    }
  }

  if (lines.length === 0) warnings.push('No goods-table rows were recognised. Enter the invoice lines manually.');
  for (const required of ['invoiceNumber', 'invoiceDate', 'currency']) {
    if (!fields[required]) warnings.push(`"${required}" was not found in the text layer.`);
  }
  return { fields, lines, textLines, warnings };
}
