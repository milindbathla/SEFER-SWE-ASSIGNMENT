import { ISSUE_STATES, PATTERNS, isUnverifiedOcr, type ContainerReading, type Evidence, type ExtractedDocument, type Issue, type IssueKind } from '@sefer/shared';
import { checkContainerNumber } from '../iso6346.js';
import { compositionNumbers, formatMoney, normalizeKey, normalizeWeightUnit, parseDate, parseNumber, toCents } from '../normalize.js';
import { countryCode } from '../reference.js';
import { allLines, evidence, scanTexts, textEvidence, type InvoiceLineView, type ShipmentContext } from './context.js';

export type DraftIssue = Omit<Issue, 'acknowledged' | 'acknowledgementNote' | 'state' | 'resolution' | 'pendingFields'>;

function issue(kind: IssueKind, i: Omit<DraftIssue, 'kind'>): DraftIssue {
  return { kind, ...i };
}

export function withState(i: DraftIssue): Omit<Issue, 'acknowledged' | 'acknowledgementNote' | 'resolution' | 'pendingFields'> {
  return { ...i, state: ISSUE_STATES[i.kind] };
}

export const linePath = (l: InvoiceLineView, element: string) => `${l.path}/${element}`;
const lineLabel = (l: InvoiceLineView) => `Invoice ${l.invoiceIndex}, line ${l.lineNo}${l.cells.style?.value ? ` (${l.cells.style.value})` : ''}`;
const cellEv = (l: InvoiceLineView, cell: string, label?: string) => evidence(l.doc, l.cells[cell], label ?? cell);

type Choice = NonNullable<Issue['choices']>[number];
/** A source's value offered as a choice; an unverified OCR reading is labelled as such. */
function choice(field: string, value: string, source: string, ev: Evidence | null, caution?: string): Choice {
  const ocr = ev?.ocr && !ev.ocr.verified ? `Unverified OCR reading${ev.ocr.confidence !== null ? ` (${Math.round(ev.ocr.confidence)}% confidence)` : ''}: check the page.` : undefined;
  const text = [caution, ocr].filter(Boolean).join(' ');
  return { field, value, source, ...(text ? { caution: text } : {}) };
}
/** Distinct values only (two sources stating the same value need one choice). */
function distinctChoices(list: Choice[]): Choice[] {
  const seen = new Map<string, Choice>();
  for (const c of list) {
    const key = `${c.field}|${c.value}`;
    const prev = seen.get(key);
    if (prev) seen.set(key, { ...prev, source: `${prev.source}; ${c.source}` });
    else seen.set(key, c);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------
// Document coverage
// ---------------------------------------------------------------------------------------------

function documentCoverage(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  if (ctx.invoices.length === 0) {
    out.push(issue('missing_broker', {
      id: 'MISSING_DOCUMENT:commercial_invoice', rule: 'MISSING_DOCUMENT', title: 'No commercial invoice provided',
      explanation: 'An entry needs at least one invoice (invoice number and line items are required by entry.xsd).',
      evidence: [], requiredAction: 'Upload the commercial invoice, or enter its data manually.', blocking: true, affects: [],
    }));
  }
  if (ctx.billsOfLading.length === 0) {
    out.push(issue('missing_broker', {
      id: 'MISSING_DOCUMENT:bill_of_lading', rule: 'MISSING_DOCUMENT', title: 'No bill of lading provided',
      explanation: 'Manifest data (bill numbers, package count, vessel/voyage, containers) normally comes from the bill of lading. Cross-document checks that need it were not run.',
      evidence: [], requiredAction: 'Upload the bill of lading or enter the manifest values manually.', blocking: true, affects: ['manifest/bill-of-lading/master-bill', 'manifest/bill-of-lading/house-bill'],
    }));
  }
  if (ctx.packingLists.length === 0) {
    out.push(issue('uncertain', {
      id: 'MISSING_DOCUMENT:packing_list', rule: 'MISSING_DOCUMENT', title: 'No packing list provided',
      explanation: 'Quantity, fibre and weight cross-checks against the packing list could not be run.',
      evidence: [], requiredAction: 'Upload the packing list if one exists, or confirm that none is available.', blocking: false, affects: [],
    }));
  }
  if (ctx.billsOfLading.length > 1) {
    out.push(issue('uncertain', {
      id: 'MULTIPLE_BILLS_OF_LADING', rule: 'MULTIPLE_BILLS_OF_LADING', title: 'More than one bill of lading',
      explanation: 'This version maps only the first bill of lading into the manifest section. The others are not represented in the XML.',
      evidence: ctx.billsOfLading.map((d) => evidence(d, d.fields.blNumber, 'B/L number')), requiredAction: 'Add the remaining bills of lading in NetCHB or reduce the upload to one B/L.', blocking: true, affects: [],
    }));
  }
  for (const doc of ctx.documents) {
    if (doc.method === 'unavailable') {
      out.push(issue('uncertain', {
        id: `DOCUMENT_NOT_READ:${doc.id}`, rule: 'DOCUMENT_NOT_READ', title: `${doc.fileName}: not read (manual entry required)`,
        explanation: 'This document has no text layer and no automatic extraction is configured. Its values are missing until they are entered manually or a transcription file is imported. Checks that depend on it cannot detect discrepancies.',
        evidence: [], requiredAction: 'Enter the document values manually (or import a transcription), then re-run the review.', blocking: true, affects: [],
      }));
    }
    if (doc.docType === 'unknown') {
      out.push(issue('uncertain', {
        id: `UNKNOWN_DOCUMENT_TYPE:${doc.id}`, rule: 'UNKNOWN_DOCUMENT_TYPE', title: `${doc.fileName}: document type unknown`,
        explanation: 'The document was not recognised as an invoice, packing list or bill of lading, so it is ignored by the review.',
        evidence: [], requiredAction: 'Select the document type, or remove the file.', blocking: false, affects: [],
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-1 style: invoice arithmetic
// ---------------------------------------------------------------------------------------------

function lineArithmetic(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const l of allLines(ctx)) {
    if (!l.quantity || !l.unitPrice || !l.amount) continue;
    if (l.unitPrice.parenthesized || l.amount.parenthesized) continue; // handled by NO_COMMERCIAL_VALUE
    const computed = toCents(l.quantity.value * l.unitPrice.value);
    const printed = toCents(l.amount.value);
    if (computed !== printed) {
      out.push(issue('conflict', {
        id: `LINE_ARITHMETIC:${l.path}`, rule: 'LINE_ARITHMETIC', title: `${lineLabel(l)}: quantity × unit price ≠ printed amount`,
        explanation: `${l.cells.quantity?.value} × ${l.cells.unitPrice?.value} = ${formatMoney(computed / 100)}, but the invoice prints ${l.cells.amount?.value}. The source amount is NOT corrected; the line value is withheld from the XML.`,
        evidence: [cellEv(l, 'quantity'), cellEv(l, 'unitPrice', 'unit price'), cellEv(l, 'amount')],
        requiredAction: 'Confirm the correct line amount with the seller or broker and enter the confirmed line value.',
        blocking: true, affects: [linePath(l, 'value')],
        choices: [
          choice(linePath(l, 'value'), formatMoney(printed / 100), `Amount printed on the invoice (${l.cells.amount?.value})`, cellEv(l, 'amount')),
          choice(linePath(l, 'value'), formatMoney(computed / 100), `Calculated: ${l.cells.quantity?.value} × ${l.cells.unitPrice?.value}`, cellEv(l, 'quantity')),
        ].map((c) => ({ ...c, caution: [c.caution, 'Other valuation issues on this line (price terms, assists) still need their own decision.'].filter(Boolean).join(' ') })),
      }));
    }
  }
  return out;
}

function invoiceTotals(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const inv of ctx.invoices) {
    const f = inv.doc.fields;
    const commercial = inv.lines.filter((l) => l.amount && !l.amount.parenthesized);
    if (commercial.length === 0) continue;
    const printedSum = (lines: InvoiceLineView[]) => lines.reduce((s, l) => s + toCents(l.amount!.value), 0);
    const computedSum = (lines: InvoiceLineView[]) =>
      lines.reduce((s, l) => s + (l.quantity && l.unitPrice ? toCents(l.quantity.value * l.unitPrice.value) : toCents(l.amount!.value)), 0);
    const findings: string[] = [];
    const ev: Evidence[] = [];

    const subtotal = parseNumber(f.subtotal?.value);
    if (subtotal && f.subtotal?.page) {
      const covered = commercial.filter((l) => (l.cells.amount?.page ?? 0) <= f.subtotal!.page!);
      const p = printedSum(covered);
      const c = computedSum(covered);
      if (toCents(subtotal.value) !== p) {
        findings.push(`Sub-total ${f.subtotal.value} ≠ sum of the printed line amounts on pages ≤ ${f.subtotal.page} (${formatMoney(p / 100)})${toCents(subtotal.value) === c ? `; it equals the sum of quantity × unit price (${formatMoney(c / 100)})` : ''}.`);
        ev.push(evidence(inv.doc, f.subtotal, 'sub-total'));
      }
    }
    const goods = parseNumber(f.totalGoodsValue?.value);
    if (goods) {
      const p = printedSum(commercial);
      const c = computedSum(commercial);
      if (toCents(goods.value) !== p) {
        findings.push(`Total goods value ${f.totalGoodsValue!.value} ≠ sum of the printed commercial line amounts (${formatMoney(p / 100)})${toCents(goods.value) === c ? `; it equals the sum of quantity × unit price (${formatMoney(c / 100)})` : ''}.`);
        ev.push(evidence(inv.doc, f.totalGoodsValue, 'total goods value'));
      }
      const freight = parseNumber(f.freight?.value);
      const insurance = parseNumber(f.insurance?.value);
      const total = parseNumber(f.totalInvoiceValue?.value);
      if (total && (freight || insurance)) {
        const expected = toCents(goods.value) + (freight ? toCents(freight.value) : 0) + (insurance ? toCents(insurance.value) : 0);
        if (expected !== toCents(total.value)) {
          findings.push(`Invoice total ${f.totalInvoiceValue!.value} ≠ goods value + freight + insurance (${formatMoney(expected / 100)}).`);
          ev.push(evidence(inv.doc, f.totalInvoiceValue, 'invoice total'));
        }
      }
    }
    if (findings.length) {
      out.push(issue('conflict', {
        id: `INVOICE_TOTALS:${inv.path}`, rule: 'INVOICE_TOTALS', title: `Invoice ${inv.index}: totals do not reconcile with the printed line amounts`,
        explanation: findings.join(' ') + ' No value has been changed.',
        evidence: ev, requiredAction: 'Confirm which figures are correct (line amounts or totals) before values are used.', blocking: true,
        affects: inv.lines.map((l) => linePath(l, 'value')),
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-2 / C-3 style: invoice vs packing list per style
// ---------------------------------------------------------------------------------------------

function quantityAndFibre(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  if (ctx.packingRows.length === 0) {
    // Never skip the comparison silently: without packing-list rows, quantity and fibre differences cannot be detected.
    const lines = allLines(ctx);
    if (ctx.packingLists.length && lines.length) {
      out.push(issue('uncertain', {
        id: 'PACKING_LIST_ROWS_NOT_READ', rule: 'PACKING_LIST_ROWS_NOT_READ', title: 'Invoice lines could not be compared with the packing list',
        explanation: `The packing list's goods table was not read (${ctx.packingLists.map((d) => `${d.fileName}: ${d.method === 'ocr' ? 'OCR does not read this table reliably' : 'no rows'}`).join('; ')}), so the ${lines.length} invoice line(s) were NOT checked for quantity or fibre-composition differences.`,
        evidence: ctx.packingLists.map((d) => textEvidence(d, null, `${d.fileName}: 0 goods rows`, 'packing-list goods table')),
        requiredAction: 'Enter the packing-list rows (style, quantity, description) in 1. Documents so the checks run, or compare them with the invoice yourself and record what you found.',
        blocking: true, affects: [],
      }));
    }
    return out;
  }
  for (const l of allLines(ctx)) {
    if (!l.style) continue;
    const rows = ctx.packingRows.filter((r) => r.style === l.style);
    if (rows.length === 0) {
      out.push(issue('uncertain', {
        id: `STYLE_NOT_ON_PACKING_LIST:${l.path}`, rule: 'STYLE_NOT_ON_PACKING_LIST', title: `${lineLabel(l)}: style not found on the packing list`,
        explanation: 'The invoice line could not be matched to a packing-list row by style number, so its quantity and description were not cross-checked.',
        evidence: [cellEv(l, 'style')], requiredAction: 'Confirm that these goods were shipped and how they are packed.', blocking: true, affects: [linePath(l, 'invoice-quantity')],
      }));
      continue;
    }
    const plQty = rows.reduce((s, r) => s + (r.quantity?.value ?? 0), 0);
    if (l.quantity && rows.every((r) => r.quantity) && Math.abs(plQty - l.quantity.value) > 1e-9) {
      out.push(issue('conflict', {
        id: `QUANTITY_MISMATCH:${l.path}`, rule: 'QUANTITY_MISMATCH', title: `${lineLabel(l)}: invoice quantity ≠ packing-list quantity`,
        explanation: `Invoice: ${l.cells.quantity?.value} ${l.cells.unit?.value ?? ''}; packing list: ${rows.map((r) => r.cells.quantity?.value).join(' + ')}. Quantity and value for this line are withheld until confirmed.`,
        evidence: [cellEv(l, 'quantity', 'invoice quantity'), ...rows.map((r) => evidence(r.doc, r.cells.quantity, 'packing-list quantity'))],
        requiredAction: 'Confirm the quantity actually shipped (and the invoice value that corresponds to it).',
        blocking: true, affects: [linePath(l, 'invoice-quantity'), linePath(l, 'value')],
        choices: distinctChoices([
          choice(linePath(l, 'invoice-quantity'), String(l.quantity.value), `Invoice quantity (${l.cells.quantity?.value})`, cellEv(l, 'quantity')),
          choice(linePath(l, 'invoice-quantity'), String(plQty), `Packing-list quantity (${rows.map((r) => r.cells.quantity?.value).join(' + ')})`, evidence(rows[0].doc, rows[0].cells.quantity)),
        ]),
      }));
    }
    const invComp = compositionNumbers(l.cells.description?.value);
    for (const r of rows) {
      const plComp = compositionNumbers(r.cells.description?.value);
      if (invComp && plComp && invComp.join('/') !== plComp.join('/')) {
        out.push(issue('conflict', {
          id: `FIBRE_MISMATCH:${l.path}`, rule: 'FIBRE_MISMATCH', title: `${lineLabel(l)}: fibre composition differs between invoice and packing list`,
          explanation: `Composition percentages on the invoice (${invComp.join('/')}) differ from the packing list (${plComp.join('/')}). Only the numbers are compared; fibre names and abbreviations are not interpreted. Fibre content can affect classification, so classification for this line must not be finalised until confirmed.`,
          evidence: [cellEv(l, 'description', 'invoice description'), evidence(r.doc, r.cells.description, 'packing-list description')],
          requiredAction: 'Confirm the actual fibre composition (e.g. from the seller or a test report) before classifying this line.',
          blocking: true, affects: [linePath(l, 'tariff-no')],
        }));
        break;
      }
    }
  }
  for (const r of ctx.packingRows) {
    if (r.style && !allLines(ctx).some((l) => l.style === r.style)) {
      out.push(issue('uncertain', {
        id: `STYLE_NOT_ON_INVOICE:${r.doc.id}:${r.style}`, rule: 'STYLE_NOT_ON_INVOICE', title: `Packing-list style ${r.cells.style?.value} is not on any invoice`,
        explanation: 'Goods appear on the packing list without a matching invoice line.', evidence: [evidence(r.doc, r.cells.style, 'packing-list style')],
        requiredAction: 'Confirm whether these goods are part of the entry and obtain their invoice data.', blocking: true, affects: [],
      }));
    }
    const cartons = parseNumber(r.cells.cartons?.value);
    const per = parseNumber(r.cells.pcsPerCarton?.value);
    if (cartons && per && r.quantity && Math.abs(cartons.value * per.value - r.quantity.value) > 1e-9) {
      out.push(issue('conflict', {
        id: `PACKING_ROW_ARITHMETIC:${r.doc.id}:${r.style}`, rule: 'PACKING_ROW_ARITHMETIC', title: `Packing list ${r.cells.style?.value}: cartons × pieces per carton ≠ total pieces`,
        explanation: `${r.cells.cartons?.value} × ${r.cells.pcsPerCarton?.value} ≠ ${r.cells.quantity?.value}.`,
        evidence: [evidence(r.doc, r.cells.cartons, 'cartons'), evidence(r.doc, r.cells.pcsPerCarton, 'pcs/carton'), evidence(r.doc, r.cells.quantity, 'total pcs')],
        requiredAction: 'Confirm the packed quantity.', blocking: true, affects: [],
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-4 style: weights, packages, volume, vessel/voyage across documents
// ---------------------------------------------------------------------------------------------

interface Reading {
  doc: ExtractedDocument;
  field: string;
  label: string;
}

function compareNumeric(ctx: ShipmentContext, id: string, title: string, readings: Reading[], affects: string[], blocking: boolean, kind: 'weight' | 'count' | 'volume'): DraftIssue[] {
  const present = readings.filter((r) => r.doc.fields[r.field]?.value);
  if (present.length < 2) return [];
  const parsed = present.map((r) => {
    const n = parseNumber(r.doc.fields[r.field]!.value);
    return { r, n, unit: kind === 'weight' ? normalizeWeightUnit(n?.unit ?? null) : null };
  });
  if (parsed.some((p) => !p.n)) return [];
  const units = new Set(parsed.map((p) => p.unit));
  const values = new Set(parsed.map((p) => Math.round(p.n!.value * 1000)));
  if (kind === 'weight' && units.size > 1) {
    return [issue('uncertain', {
      id: `${id}:units`, rule: id, title: `${title}: different weight units`, explanation: 'The documents state the weight in different units; no conversion is performed.',
      evidence: present.map((r) => evidence(r.doc, r.doc.fields[r.field], r.label)), requiredAction: 'Confirm the weight and its unit.', blocking, affects,
    })];
  }
  if (values.size <= 1) return [];
  // The affected entry fields hold whole numbers (xsd:long / integer), so only whole-number readings are offered.
  const choices = affects.length === 1
    ? distinctChoices(parsed.filter((p) => Number.isInteger(p.n!.value)).map((p) => choice(affects[0], String(p.n!.value), `${p.r.label} (${p.r.doc.fields[p.r.field]!.value})`, evidence(p.r.doc, p.r.doc.fields[p.r.field]))))
    : [];
  return [issue('conflict', {
    id, rule: id, title: `${title} differs between documents`,
    explanation: present.map((r) => `${r.label}: ${r.doc.fields[r.field]!.value}`).join('; ') + '. Neither value is preferred automatically.',
    evidence: present.map((r) => evidence(r.doc, r.doc.fields[r.field], r.label)), requiredAction: `Confirm the correct ${title.toLowerCase()} (e.g. with the carrier or shipper).`, blocking, affects,
    ...(choices.length > 1 ? { choices } : {}),
  })];
}

function crossDocumentTotals(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  const pl = ctx.packingLists[0];
  const bol = ctx.bol;
  const inv = ctx.invoices[0]?.doc;
  const readings = (pairs: [ExtractedDocument | undefined | null, string, string][]): Reading[] =>
    pairs.filter((p): p is [ExtractedDocument, string, string] => Boolean(p[0])).map(([doc, field, label]) => ({ doc, field, label }));

  out.push(...compareNumeric(ctx, 'GROSS_WEIGHT_MISMATCH', 'Gross weight', readings([[pl, 'totalGrossWeight', 'Packing list total G.W.'], [bol, 'grossWeight', 'B/L gross weight']]), ['header/gross-weight'], true, 'weight'));
  out.push(...compareNumeric(ctx, 'PACKAGE_COUNT_MISMATCH', 'Package count', readings([[inv, 'totalPackages', 'Invoice total packages'], [pl, 'totalCartons', 'Packing list cartons'], [bol, 'packages', 'B/L packages']]), ['manifest/bill-of-lading/quantity'], true, 'count'));
  out.push(...compareNumeric(ctx, 'VOLUME_MISMATCH', 'Volume', readings([[pl, 'totalVolume', 'Packing list measurement'], [bol, 'measurement', 'B/L measurement']]), [], false, 'volume'));

  // Packing-list rows vs its own total gross weight.
  if (pl && pl.fields.totalGrossWeight?.value && pl.lines.length) {
    const total = parseNumber(pl.fields.totalGrossWeight.value);
    const rows = pl.lines.map((l) => parseNumber(l.cells.grossWeight?.value));
    if (total && rows.every(Boolean)) {
      const sum = rows.reduce((s, n) => s + Math.round(n!.value * 1000), 0);
      if (sum !== Math.round(total.value * 1000)) {
        out.push(issue('conflict', {
          id: 'PACKING_LIST_WEIGHT_SUM', rule: 'PACKING_LIST_WEIGHT_SUM', title: 'Packing-list row gross weights do not add up to its total',
          explanation: `Rows add up to ${(sum / 1000).toFixed(3)}, total printed ${pl.fields.totalGrossWeight.value}.`,
          evidence: [evidence(pl, pl.fields.totalGrossWeight, 'total G.W.')], requiredAction: 'Confirm the gross weight.', blocking: true, affects: ['header/gross-weight'],
        }));
      }
    }
  }

  // Vessel / voyage text comparison.
  for (const [field, label, path] of [['vesselName', 'Vessel name', 'header/vessel-name'], ['voyageNumber', 'Voyage number', 'header/voyage-no']] as const) {
    const present = ctx.documents.filter((d) => d.fields[field]?.value);
    const keys = new Set(present.map((d) => normalizeKey(d.fields[field]!.value)));
    if (keys.size > 1) {
      out.push(issue('conflict', {
        id: `VESSEL_VOYAGE_MISMATCH:${field}`, rule: 'VESSEL_VOYAGE_MISMATCH', title: `${label} differs between documents`,
        explanation: present.map((d) => `${d.fileName}: ${d.fields[field]!.value}`).join('; '),
        evidence: present.map((d) => evidence(d, d.fields[field], label)), requiredAction: `Confirm the ${label.toLowerCase()}.`, blocking: true, affects: [path],
      }));
    }
  }

  // Invoice number references on other documents.
  for (const invView of ctx.invoices) {
    const no = invView.doc.fields.invoiceNumber?.value;
    if (!no) continue;
    for (const d of [...ctx.packingLists, ...ctx.billsOfLading]) {
      const ref = d.fields.invoiceReference?.value;
      if (ref && ctx.invoices.length === 1 && normalizeKey(ref) !== normalizeKey(no)) {
        out.push(issue('conflict', {
          id: `INVOICE_REFERENCE_MISMATCH:${d.id}`, rule: 'INVOICE_REFERENCE_MISMATCH', title: `${d.fileName}: invoice reference differs from the invoice number`,
          explanation: `Invoice number ${no}; ${d.fileName} references ${ref}.`, evidence: [evidence(invView.doc, invView.doc.fields.invoiceNumber, 'invoice number'), evidence(d, d.fields.invoiceReference, 'invoice reference')],
          requiredAction: 'Confirm that the documents belong to the same shipment.', blocking: true, affects: [],
        }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-5 style: container numbers
// ---------------------------------------------------------------------------------------------

export interface ContainerSlot {
  reading: ContainerReading;
  correctedFrom: ContainerReading[];
}

/** A struck-through reading is attached to the next reading that is not struck through. */
export function containerSlots(doc: ExtractedDocument | null): ContainerSlot[] {
  if (!doc) return [];
  const slots: ContainerSlot[] = [];
  let pending: ContainerReading[] = [];
  for (const r of doc.containers) {
    if (r.struckThrough) {
      pending.push(r);
    } else {
      slots.push({ reading: r, correctedFrom: pending });
      pending = [];
    }
  }
  if (pending.length) slots.push(...pending.map((r) => ({ reading: r, correctedFrom: [] })));
  return slots;
}

function containers(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  const doc = ctx.bol;
  if (!doc) return out;
  containerSlots(doc).forEach((slot, idx) => {
    const n = idx + 1;
    const path = `containers/container[${n}]/container-number`;
    const value = slot.reading.number.value ?? '';
    const check = checkContainerNumber(value);
    const describe = (r: ContainerReading) => {
      if (!r.number.value) return `no reliable reading${r.number.quote ? ` (source text: "${r.number.quote}")` : ''}; a handwritten correction, if any, is not read automatically`;
      const c = checkContainerNumber(r.number.value ?? '');
      return `${r.number.value} (${r.marking}${r.struckThrough ? ', struck through' : ''}): ${c.wellFormed ? `ISO 6346 check digit expected ${c.expectedCheckDigit}, printed ${c.actualCheckDigit} → ${c.valid ? 'valid' : 'INVALID'}` : 'not a well-formed ISO 6346 number'}`;
    };
    const ev = [...slot.correctedFrom, slot.reading].map((r) => ({ ...evidence(doc, r.number, r.struckThrough ? 'struck-through reading' : `${r.marking} reading`), value: r.number.value }));
    const choices = distinctChoices([...slot.correctedFrom, slot.reading].filter((r) => r.number.value).map((r, k) => {
      const c = checkContainerNumber(r.number.value!);
      const caution = [r.struckThrough ? 'Struck through on the document.' : '', !c.valid ? 'ISO 6346 check digit does NOT match.' : ''].filter(Boolean).join(' ') || undefined;
      return choice(path, c.normalized, `${r.marking}${r.struckThrough ? ', struck through' : ''} reading "${r.number.value}"`, ev[k], caution);
    }));
    if (slot.reading.struckThrough || slot.correctedFrom.length || slot.reading.marking === 'handwritten') {
      out.push(issue('provisional', {
        id: `CONTAINER_NUMBER:${n}`, rule: 'CONTAINER_NUMBER', title: `Container ${n}: number was corrected by hand`,
        explanation: [...slot.correctedFrom, slot.reading].map(describe).join('; ') + '. The check digit supports, but does not prove, the corrected reading.',
        evidence: ev, requiredAction: 'Confirm the container number with the carrier (e.g. the master B/L or arrival notice) before accepting it.', blocking: true, affects: [path], choices,
      }));
    } else if (!check.valid) {
      out.push(issue('uncertain', {
        id: `CONTAINER_NUMBER:${n}`, rule: 'CONTAINER_NUMBER', title: `Container ${n}: check digit does not validate`,
        explanation: describe(slot.reading), evidence: ev, requiredAction: 'Confirm the container number with the carrier.', blocking: true, affects: [path], choices,
      }));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-6 / C-8 / C-12 style: valuation indicators (flag for broker review, never decide)
// ---------------------------------------------------------------------------------------------

const ASSIST_RE = /buyer[-\s]?(supplied|furnished|provided)|supplied\s+free\s+of\s+charge\s+by\s+(the\s+)?buyer|\bCMT\b|cut,?\s*make\s*(&|and)\s*trim|buyer'?s?\s+fabric|\bassists?\b/i;
const NCV_RE = /\bF\.?O\.?C\.?\b|free\s+of\s+charge|no\s+commercial\s+value|\bN\.?C\.?V\.?\b|for\s+customs\s+purposes?\s+only/i;

/** Evidence of an assist for one invoice line: its own description, packing-list rows of the
 * same style, and notes/remarks that mention the style number (plus the note's continuation line). */
function assistEvidence(ctx: ShipmentContext, l: InvoiceLineView): Evidence[] {
  const out: Evidence[] = [];
  const desc = l.cells.description?.value ?? '';
  if (ASSIST_RE.test(desc)) out.push(evidence(l.doc, l.cells.description, 'invoice line description'));
  for (const r of ctx.packingRows) {
    if (r.style === l.style && ASSIST_RE.test(r.cells.description?.value ?? '')) out.push(evidence(r.doc, r.cells.description, 'packing-list description'));
  }
  const style = l.cells.style?.value?.trim();
  if (style) {
    for (const doc of ctx.documents) {
      doc.textLines.forEach((t, i) => {
        if (!t.text.toUpperCase().includes(style.toUpperCase()) || !ASSIST_RE.test(t.text)) return;
        const next = doc.textLines[i + 1];
        const continues = next && next.page === t.page && !/^\s*(\(|\d+\.|[A-Z ]+:)/.test(next.text);
        out.push(textEvidence(doc, t.page, continues ? `${t.text} ${next.text}` : t.text, 'note / remark'));
      });
    }
  }
  return out;
}

/** A money amount stated next to the word "value", e.g. "value USD 4,180.00" (quoted as printed). */
const STATED_VALUE_RE = /\bvalue\s*(?:of\s*)?(?:USD|US\$|\$|EUR|€)\s*[\d,]+(?:\.\d+)?/gi;

function valuation(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const l of allLines(ctx)) {
    const all = assistEvidence(ctx, l);
    if (all.length) {
      const stated = [...new Set(all.flatMap((e) => [...`${e.quote ?? ''} ${e.value ?? ''}`.matchAll(STATED_VALUE_RE)].map((m) => m[0].trim())))];
      out.push(issue('missing_broker', {
        id: `ASSIST_INDICATOR:${l.path}`, rule: 'ASSIST_INDICATOR', title: `${lineLabel(l)}: possible assist (buyer-supplied materials / CMT pricing)`,
        explanation: `The documents indicate materials supplied by the buyer or a cut-make-trim price.${stated.length ? ` Value stated in the documents (as printed, not added to anything): ${stated.map((x) => `"${x}"`).join(', ')}.` : ' No value for the materials is stated.'} Under 19 U.S.C. §1401a(b)(1)(C) the value of an assist is added to the transaction value. Whether any stated amount is the assist value, and how to apportion it, is a broker decision, so the line value is withheld.`,
        evidence: all, requiredAction: 'Broker to determine the assist value and apportionment, then enter the line value.',
        blocking: true, affects: [linePath(l, 'value')], reference: 'docs/research-log.md RL-13; 19 U.S.C. §1401a(b)(1)(C)',
      }));
    }
    const desc = l.cells.description?.value ?? '';
    const parenthesized = Boolean(l.unitPrice?.parenthesized || l.amount?.parenthesized);
    if (parenthesized || NCV_RE.test(desc)) {
      out.push(issue('missing_broker', {
        id: `NO_COMMERCIAL_VALUE:${l.path}`, rule: 'NO_COMMERCIAL_VALUE', title: `${lineLabel(l)}: free-of-charge / no-commercial-value goods`,
        explanation: `The line is described as free of charge or of no commercial value${parenthesized ? ` and its price/amount is printed in parentheses (${l.cells.unitPrice?.value} / ${l.cells.amount?.value})` : ''}. A stated "value for customs" is not automatically the entered value.`,
        evidence: [cellEv(l, 'description'), cellEv(l, 'unitPrice', 'unit price'), cellEv(l, 'amount')],
        requiredAction: 'Broker to determine the value to declare for these goods and enter it.', blocking: true, affects: [linePath(l, 'value')], reference: 'docs/research-log.md RL-13',
      }));
    }
  }
  for (const inv of ctx.invoices) {
    const f = inv.doc.fields;
    const terms = f.incoterms?.value ?? '';
    const cTerm = /^\s*(CIF|CIP|CFR|CPT|DAP|DPU|DDP)\b/i.exec(terms);
    if (cTerm || f.freight?.value || f.insurance?.value) {
      const [goods, freight, insurance, total] = [f.totalGoodsValue, f.freight, f.insurance, f.totalInvoiceValue].map((x) => parseNumber(x?.value));
      let arithmetic = '';
      const printed = [['total goods value', f.totalGoodsValue], ['freight', f.freight], ['insurance', f.insurance], ['invoice total', f.totalInvoiceValue]] as const;
      const unreadable = printed.filter(([, x], i) => x?.value && ![goods, freight, insurance, total][i]).map(([name]) => name);
      const signed = [goods, freight, insurance, total].some((n) => n && (n.value < 0 || n.parenthesized));
      if (unreadable.length || signed) {
        // Never guess a number format or a sign: say the check was not made, and why.
        arithmetic = ` Arithmetic check not made: ${unreadable.length ? `${unreadable.join(', ')} could not be read as a plain amount` : 'an amount is negative or in parentheses'}.`;
      } else if (goods && total && (freight || insurance)) {
        const sum = toCents(goods.value) + toCents(freight?.value ?? 0) + toCents(insurance?.value ?? 0);
        const parts = [f.totalGoodsValue!.value, freight && f.freight!.value, insurance && f.insurance!.value].filter(Boolean).join(' + ');
        arithmetic = sum === toCents(total.value)
          ? ` Arithmetic check: goods ${parts} = ${formatMoney(sum / 100)}, which equals the printed invoice total ${f.totalInvoiceValue!.value}.`
          : ` Arithmetic check: goods ${parts} = ${formatMoney(sum / 100)}, which does NOT equal the printed invoice total ${f.totalInvoiceValue!.value}.`;
      }
      out.push(issue('missing_broker', {
        id: `CIF_DEDUCTIONS:${inv.path}`, rule: 'CIF_DEDUCTIONS', title: `Invoice ${inv.index}: price terms include international freight and/or insurance`,
        explanation: `Terms: ${terms || 'not stated'}${f.freight?.value ? `; freight ${f.freight.value}` : ''}${f.insurance?.value ? `; insurance ${f.insurance.value}` : ''}.${arithmetic} Under 19 U.S.C. §1401a(b)(4)(A) international freight and insurance are excluded from transaction value, and deductions must be actual costs. The treatment is a broker decision: no amount is deducted or adjusted automatically, and each line value must be entered by the broker.`,
        evidence: [evidence(inv.doc, f.incoterms, 'terms'), evidence(inv.doc, f.totalGoodsValue, 'total goods value'), evidence(inv.doc, f.freight, 'freight'), evidence(inv.doc, f.insurance, 'insurance'), evidence(inv.doc, f.totalInvoiceValue, 'invoice total')].filter((e) => e.value),
        requiredAction: 'Broker to confirm the entered value basis for each line (and whether the freight/insurance figures are actual costs).',
        blocking: true, affects: inv.lines.map((l) => linePath(l, 'value')), reference: 'docs/research-log.md RL-13; 19 U.S.C. §1401a(b)(4)(A)',
      }));
    }
    const currency = f.currency?.value?.trim().toUpperCase();
    if (!currency) {
      out.push(issue('uncertain', {
        id: `CURRENCY_MISSING:${inv.path}`, rule: 'CURRENCY_MISSING', title: `Invoice ${inv.index}: currency not stated`, explanation: 'Values cannot be used without knowing their currency.',
        evidence: [], requiredAction: 'Confirm the invoice currency.', blocking: true, affects: inv.lines.map((l) => linePath(l, 'value')),
      }));
    } else if (currency !== 'USD') {
      out.push(issue('missing_broker', {
        id: `FOREIGN_CURRENCY:${inv.path}`, rule: 'FOREIGN_CURRENCY', title: `Invoice ${inv.index}: invoice currency is ${currency}`,
        explanation: 'No currency conversion is performed and this version does not generate the <foreign-currency> element. Values are kept in the source currency.',
        evidence: [evidence(inv.doc, f.currency, 'currency')], requiredAction: 'Broker to provide converted values / exchange-rate handling in NetCHB.', blocking: true, affects: inv.lines.map((l) => linePath(l, 'value')),
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-7 style: origin
// ---------------------------------------------------------------------------------------------

function origin(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  const headerOrigins = ctx.documents
    .filter((d) => d.fields.countryOfOrigin?.value)
    .map((d) => ({ doc: d, code: countryCode(d.fields.countryOfOrigin!.value), field: d.fields.countryOfOrigin! }));
  const statements = ctx.documents.flatMap((doc) =>
    scanTexts(doc)
      .filter((t) => /made\s+in\s+[A-Za-z]|\borigin\b/i.test(t.text))
      .map((t) => textEvidence(doc, t.page, t.text, 'origin statement')),
  );
  const uniqueStatements = [...new Map(statements.map((s) => [`${s.documentId}|${s.quote}`, s])).values()];
  const headerCodes = new Set(headerOrigins.map((h) => h.code));
  if (headerCodes.size > 1 || headerOrigins.some((h) => !h.code)) {
    out.push(issue(headerCodes.size > 1 ? 'conflict' : 'uncertain', {
      id: 'HEADER_ORIGIN', rule: 'ORIGIN_CONFLICT', title: 'Country of origin differs between documents or cannot be coded',
      explanation: headerOrigins.map((h) => `${h.doc.fileName}: ${h.field.value} → ${h.code ?? 'unknown code'}`).join('; '),
      evidence: headerOrigins.map((h) => evidence(h.doc, h.field, 'country of origin')), requiredAction: 'Confirm the country of origin for every line.', blocking: true,
      affects: allLines(ctx).map((l) => linePath(l, 'country-origin')),
    }));
  }
  for (const l of allLines(ctx)) {
    const lineOrigin = l.cells.origin?.value;
    if (!lineOrigin) continue;
    const code = countryCode(lineOrigin);
    const headerForInvoice = headerOrigins.find((h) => h.doc === l.doc);
    if (!code || (headerForInvoice && headerForInvoice.code !== code)) {
      out.push(issue('conflict', {
        id: `ORIGIN_CONFLICT:${l.path}`, rule: 'ORIGIN_CONFLICT', title: `${lineLabel(l)}: line origin differs from the document-level origin`,
        explanation: `The line states origin "${lineOrigin}"${code ? ` (${code})` : ''}, while the document-level origin is ${headerOrigins.map((h) => `"${h.field.value}" on ${h.doc.fileName}`).join(', ') || 'not stated'}. Origin statements found: ${uniqueStatements.length}. The origin for this line is not finalised.`,
        evidence: [cellEv(l, 'origin', 'line origin'), ...headerOrigins.map((h) => evidence(h.doc, h.field, 'document-level origin')), ...uniqueStatements],
        requiredAction: 'Confirm the country of origin for this line (and how carton marks and the origin declaration apply to it).',
        blocking: true, affects: [linePath(l, 'country-origin')],
        choices: distinctChoices([
          ...(code ? [choice(linePath(l, 'country-origin'), code, `Line origin ("${lineOrigin}")`, cellEv(l, 'origin'))] : []),
          ...headerOrigins.filter((h) => h.code).map((h) => choice(linePath(l, 'country-origin'), h.code!, `Document-level origin on ${h.doc.fileName} ("${h.field.value}")`, evidence(h.doc, h.field))),
        ]),
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C-9 style: parties
// ---------------------------------------------------------------------------------------------

function parties(ctx: ShipmentContext): DraftIssue[] {
  const ev: Evidence[] = [];
  for (const inv of ctx.invoices) {
    if (inv.doc.fields.soldTo?.value) ev.push(evidence(inv.doc, inv.doc.fields.soldTo, 'invoice sold to'));
    if (inv.doc.fields.shipTo?.value) ev.push(evidence(inv.doc, inv.doc.fields.shipTo, 'invoice ship to'));
  }
  for (const d of ctx.packingLists) {
    if (d.fields.consignee?.value) ev.push(evidence(d, d.fields.consignee, 'packing-list consignee/buyer'));
    if (d.fields.deliverTo?.value) ev.push(evidence(d, d.fields.deliverTo, 'packing-list deliver to'));
  }
  for (const d of ctx.billsOfLading) {
    if (d.fields.consignee?.value) ev.push(evidence(d, d.fields.consignee, 'B/L consignee'));
    if (d.fields.notifyParty?.value) ev.push(evidence(d, d.fields.notifyParty, 'B/L notify party'));
  }
  const names = new Set(ev.map((e) => normalizeKey(e.value)));
  return [issue('missing_broker', {
    id: 'PARTIES_UNRESOLVED', rule: 'PARTIES_UNRESOLVED', title: 'Importer of record and ultimate consignee not identified',
    explanation: `The documents name ${names.size} different part${names.size === 1 ? 'y' : 'ies'} (buyer, consignee, notify, deliver-to) and contain no IRS/EIN/CBP-assigned tax IDs. Which party is the importer of record and which is the ultimate consignee is a broker determination.`,
    evidence: ev, requiredAction: 'Broker to identify the importer of record and ultimate consignee and enter their tax IDs.',
    blocking: true, affects: ['header/importer-tax-id', 'header/ultimate-consignee/tax-id'],
  })];
}

// ---------------------------------------------------------------------------------------------
// C-10 / C-11 style: identifiers and dates
// ---------------------------------------------------------------------------------------------

export function proposeInvoiceNumber(raw: string): string | null {
  const transformed = raw.replace(/[^A-Za-z\d-]/g, '');
  return PATTERNS.invoiceNo.test(transformed) ? transformed : null;
}

function identifiersAndDates(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const inv of ctx.invoices) {
    const f = inv.doc.fields.invoiceNumber;
    if (!f?.value) continue;
    if (!PATTERNS.invoiceNo.test(f.value)) {
      const proposal = proposeInvoiceNumber(f.value);
      out.push(issue('transformation', {
        id: `INVOICE_NUMBER_FORMAT:${inv.path}`, rule: 'INVOICE_NUMBER_FORMAT', title: `Invoice ${inv.index}: invoice number "${f.value}" does not fit the NetCHB format`,
        explanation: `NetCHB data:invoiceNoType only allows [A-Za-z\\d\\-]{1,17}. ${proposal ? `Proposed transformation: remove every character outside A–Z, a–z, 0–9 and "-" → "${proposal}". The original number is preserved in the report.` : 'No automatic transformation fits the pattern.'} The transformed value is used only after explicit approval.`,
        evidence: [evidence(inv.doc, f, 'invoice number as printed')],
        requiredAction: proposal ? 'Approve the proposed transformation, or enter the invoice number exactly as it should appear in NetCHB.' : 'Enter the invoice number as it should appear in NetCHB.',
        blocking: true, affects: [`${inv.path}/invoice-no`], reference: 'entry.xsd / data_type.xsd invoiceNoType',
      }));
    }
  }
  const dated: [string, string][] = [['invoiceDate', 'invoice date'], ['packingListDate', 'packing-list date'], ['etd', 'ETD'], ['eta', 'ETA'], ['shippedOnBoardDate', 'shipped-on-board date']];
  const context = ctx.documents.flatMap((d) =>
    dated.filter(([k]) => d.fields[k]?.value && !parseDate(d.fields[k]!.value)?.ambiguous).map(([k, label]) => ({ ...evidence(d, d.fields[k], `${label} (context only)`) })),
  );
  for (const d of ctx.documents) {
    for (const [key, label] of dated) {
      const f = d.fields[key];
      const parsed = parseDate(f?.value);
      if (f?.value && parsed?.ambiguous) {
        out.push(issue('uncertain', {
          id: `AMBIGUOUS_DATE:${d.id}:${key}`, rule: 'AMBIGUOUS_DATE', title: `${d.fileName}: ${label} "${f.value}" is ambiguous`,
          explanation: `Possible readings: ${parsed.candidates.join(' or ')} (day-first vs month-first). Other dates in the documents are shown for context only; they make one reading plausible but do not confirm it.`,
          evidence: [evidence(d, f, label), ...context], requiredAction: `Confirm the ${label} with the issuer.`, blocking: true, affects: [],
        }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Broker-only data that documents cannot provide
// ---------------------------------------------------------------------------------------------

function brokerOnly(ctx: ShipmentContext): DraftIssue[] {
  const lines = allLines(ctx);
  if (lines.length === 0) return [];
  const out: DraftIssue[] = [];
  const short = lines.filter((l) => (l.cells.hsCode?.value ?? '').replace(/\D/g, '').length < 10);
  if (short.length) {
    out.push(issue('missing_broker', {
      id: 'HTS_INCOMPLETE', rule: 'HTS_INCOMPLETE', title: 'Full 10-digit HTSUS numbers are not on the documents',
      explanation: `${short.length} line(s) carry only ${[...new Set(short.map((l) => (l.cells.hsCode?.value ?? '').replace(/\D/g, '').length))].join('/')}-digit HS codes. The full 10-digit HTSUS number must be reported; the remaining digits are a classification decision and are never generated by this tool.`,
      evidence: short.map((l) => cellEv(l, 'hsCode', `${lineLabel(l)} HS code`)), requiredAction: 'Broker to classify each line and enter the 10-digit HTSUS number.',
      blocking: true, affects: short.map((l) => linePath(l, 'tariff-no')), reference: 'docs/research-log.md RL-14 (USITC HTS FAQ)',
    }));
  }
  out.push(issue('missing_broker', {
    id: 'MID_MISSING', rule: 'MID_MISSING', title: 'Manufacturer identification codes (MID) not provided',
    explanation: 'No document states an MID. MIDs are built from the manufacturer that performs the origin-conferring operations (CBP Directive 3550-055); identifying that manufacturer is a broker task, so no MID is constructed automatically.',
    evidence: [], requiredAction: 'Broker to enter the MID for each line.', blocking: true, affects: lines.map((l) => linePath(l, 'manufacturer-id')), reference: 'docs/research-log.md RL-15',
  }));
  if (ctx.bol && ctx.bol.fields.issuerScac?.value && ctx.bol.fields.carrier?.value) {
    out.push(issue('uncertain', {
      id: 'CARRIER_CODE_UNRESOLVED', rule: 'CARRIER_CODE_UNRESOLVED', title: 'Which carrier code (SCAC) to report is unresolved',
      explanation: 'The house B/L issuer and the ocean carrier are different companies. Which code belongs in header carrier-code (and whether the carrier\'s code printed in parentheses is its SCAC) is not inferred.',
      evidence: [evidence(ctx.bol, ctx.bol.fields.issuerScac, 'B/L issuer SCAC'), evidence(ctx.bol, ctx.bol.fields.carrier, 'ocean carrier')],
      requiredAction: 'Broker to enter the carrier code (and master SCAC, if used).', blocking: false, affects: ['header/carrier-code', 'manifest/bill-of-lading/master-scac'],
    }));
  }
  return out;
}

/** Every OCR reading is unverified until a person confirms or corrects it; until then it is not a fact. */
function ocrVerification(ctx: ShipmentContext): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const doc of ctx.documents.filter((d) => d.method === 'ocr')) {
    const pending: Evidence[] = [];
    for (const [key, f] of Object.entries(doc.fields)) if (isUnverifiedOcr(doc.method, f)) pending.push(evidence(doc, f, key));
    doc.lines.forEach((l, i) => {
      for (const [key, f] of Object.entries(l.cells)) if (isUnverifiedOcr(doc.method, f)) pending.push(evidence(doc, f, `line ${i + 1} ${key}`));
    });
    doc.containers.forEach((c, i) => {
      if (isUnverifiedOcr(doc.method, c.number)) pending.push(evidence(doc, c.number, `container reading ${i + 1}`));
      if (isUnverifiedOcr(doc.method, c.seal)) pending.push(evidence(doc, c.seal, `container reading ${i + 1} seal`));
    });
    if (!pending.length) continue;
    out.push(issue('uncertain', {
      id: `OCR_UNVERIFIED:${doc.id}`, rule: 'OCR_UNVERIFIED', title: `${doc.fileName}: ${pending.length} OCR reading(s) not yet verified`,
      explanation: 'These values were read by OCR from a scanned page. OCR is not ground truth: characters can be misread (e.g. "WN" for "VN"), and handwriting, stamps and strike-throughs are not read reliably. Until each reading is confirmed or corrected, no entry field uses it.',
      evidence: pending,
      requiredAction: 'In 1. Documents, compare each reading with the page and confirm it, correct it, or reject it.',
      blocking: true, affects: [],
    }));
  }
  return out;
}

export function runRules(ctx: ShipmentContext): DraftIssue[] {
  const all = [
    ...documentCoverage(ctx),
    ...ocrVerification(ctx),
    ...lineArithmetic(ctx),
    ...invoiceTotals(ctx),
    ...quantityAndFibre(ctx),
    ...crossDocumentTotals(ctx),
    ...containers(ctx),
    ...valuation(ctx),
    ...origin(ctx),
    ...parties(ctx),
    ...identifiersAndDates(ctx),
    ...brokerOnly(ctx),
  ];
  const seen = new Set<string>();
  return all.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
