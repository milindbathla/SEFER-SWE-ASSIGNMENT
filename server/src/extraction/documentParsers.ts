import type { ContainerReading, DocumentLine, SourceField } from '@sefer/shared';
import { byLabel, columnsBelow, fieldsFrom, findRow, norm, partyBelow, toField, type Reading } from './layout.js';
import { parsePackingTable } from './packingListTable.js';
import type { TextRow } from './pdfText.js';

/**
 * Readers for packing lists and bills of lading. They look for common printed labels ("P/L No.", "TOTAL G.W.",
 * "Ocean Vessel / Voy. No.", "Port of Discharge", ...) and column headings, tolerating OCR noise around them.
 * Only what is found next to such a label is returned; anything else stays empty for the user to enter.
 * Validated on the supplied sample layouts only (see README); other layouts may leave more fields empty.
 */

export interface ParsedDocument {
  fields: Record<string, SourceField>;
  containers: ContainerReading[];
  /** Packing list only: goods rows that passed the arithmetic check (see packingListTable.ts). */
  lines?: DocumentLine[];
  warnings: string[];
}

const AMOUNT = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Splits "PACIFIC ARGOS 041E" into vessel and voyage when the last token looks like a voyage number. */
function vesselVoyage(r: Reading | null): { vessel: Reading | null; voyage: Reading | null } {
  if (!r) return { vessel: null, voyage: null };
  const m = /^(.*?[A-Za-z].*?)\s+(\d{2,4}[A-Z]?)$/.exec(r.value);
  if (!m) return { vessel: r, voyage: null };
  return { vessel: { ...r, value: m[1].trim() }, voyage: { ...r, value: m[2] } };
}

/** `tableRows`: rows to read the goods table from (for scans, a second OCR pass with the ruling lines removed). */
export function parsePackingList(rows: TextRow[], tableRows: TextRow[] = rows): ParsedDocument {
  const warnings: string[] = [];
  const grand = byLabel(rows, new RegExp(String.raw`GRAND\s+TOTAL\s*[:.]?\s*(${AMOUNT})\s+(${AMOUNT})`, 'i'));
  const vessel = byLabel(rows, /Vessel\s*[:.]?\s*([A-Z][A-Z .'-]*?[A-Z])\s+(\d{2,4}[A-Z]?)\b/i);
  const ports = byLabel(rows, /\bFrom\s*[:.]?\s*(.+?)\s+To\s*[:.]?\s*(.+?)(?:\s{2,}|$)/i);
  const partiesRow = findRow(rows, /SHIPPER\b.*CONSIGNEE/i);
  const [shipper, consignee] = partiesRow >= 0 ? columnsBelow(rows, partiesRow, [/SHIPPER/i, /CONSIGNEE/i, /REFERENCES?/i]) : [null, null];

  const fields = fieldsFrom({
    packingListNumber: byLabel(rows, /P\s*\/\s*L\s*No\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{3,})/i),
    packingListDate: byLabel(rows, /P\s*\/\s*L\s*No\.?.*?\bDate\s*[:.]?\s*(\d{1,2}[-/ .][A-Za-z]{3,9}[-/ .]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i),
    invoiceReference: byLabel(rows, /Ref\.?\s*Invoice\s*(?:No\.?)?\s*[:.]?\s*([A-Z0-9]+(?:[/-][A-Z0-9]+)+)/i),
    buyerPo: byLabel(rows, /Buyer\s*P\.?\s*O\.?\s*(?:No\.?)?\s*[:.]?\s*([A-Z0-9]+(?:-[A-Z0-9]+)+)/i),
    shipper,
    consignee,
    deliverTo: byLabel(rows, /Deliver\s+to\s*[:.]?\s*(.+?)(?:,|\s{2,}|$)/i),
    vesselName: vessel && { ...vessel, value: vessel.value },
    voyageNumber: vessel && { ...vessel, value: /Vessel\s*[:.]?\s*[A-Z][A-Z .'-]*?[A-Z]\s+(\d{2,4}[A-Z]?)\b/i.exec(norm(vessel.quote))![1] },
    portOfLoading: ports,
    portOfDischarge: ports && { ...ports, value: /\bTo\s*[:.]?\s*(.+?)(?:\s{2,}|$)/i.exec(norm(ports.quote))![1].trim() },
    containerSummary: byLabel(rows, /Cntr\.?\s*[:.]?\s*(\d+\s*[xX×]\s*\d{2}\s*'?\s*[A-Z]{2})/),
    totalCartons: grand,
    totalQuantity: grand && { ...grand, value: new RegExp(String.raw`GRAND\s+TOTAL\s*[:.]?\s*(?:${AMOUNT})\s+(${AMOUNT})`, 'i').exec(norm(grand.quote))![1] },
    totalNetWeight: byLabel(rows, new RegExp(String.raw`TOTAL\s+N\.?\s*W\.?\s*[:.]?\s*((?:${AMOUNT})\s*KGS?)\b`, 'i')),
    totalGrossWeight: byLabel(rows, new RegExp(String.raw`TOTAL\s+G\.?\s*W\.?\s*[:.]?\s*((?:${AMOUNT})\s*KGS?)\b`, 'i')),
    totalVolume: byLabel(rows, new RegExp(String.raw`TOTAL\s+MEAS\.?\s*[:.]?\s*((?:${AMOUNT})\s*CBM)\b`, 'i')),
  });
  const table = parsePackingTable(tableRows);
  if (table.lines.length) {
    warnings.push(`${table.lines.length} goods row(s) read from the table. A row is listed only where cartons × pieces per carton = total pieces among the numbers read; check every row against the page.`);
  } else {
    warnings.push('No goods row of the packing list could be read (no row with a style code where cartons × pieces per carton = total pieces). Enter the lines in the form; the text of every row is listed below.');
  }
  warnings.push(...table.warnings);
  const sum = (k: string) => table.lines.reduce((n, l) => n + Number(l.cells[k]?.value?.replace(/,/g, '') ?? NaN), 0);
  const total = (f?: SourceField) => (f?.value ? Number(/[\d,.]+/.exec(f.value)?.[0].replace(/,/g, '')) : NaN);
  if (table.lines.length && (sum('quantity') !== total(fields.totalQuantity) || sum('cartons') !== total(fields.totalCartons))) {
    warnings.push(`The rows read add up to ${sum('cartons')} cartons and ${sum('quantity')} pieces; the grand total reads ${fields.totalCartons?.value ?? '?'} cartons and ${fields.totalQuantity?.value ?? '?'} pieces. Rows may be missing or misread: check the table.`);
  }
  if (!fields.shipper || !fields.consignee) warnings.push('Shipper and/or consignee could not be read from a labelled column. Enter them from the page.');
  return { fields, containers: [], lines: table.lines, warnings };
}

// ISO 6346: 3-letter owner code + equipment category U, J or Z, 6-digit serial, check digit. The category letter keeps
// B/L or booking numbers of the same length from being taken for containers.
const CONTAINER_RE = /\b([A-Z]{3}[UJZ])\s?(\d{6})\s?(\d)\b/g;

export function parseBillOfLading(rows: TextRow[]): ParsedDocument {
  const warnings: string[] = [];
  const blHeader = findRow(rows, /\bB\s*\/?\s*L\s*No\b.*Booking/i);
  const [bl, booking] = blHeader >= 0 ? columnsBelow(rows, blHeader, [/B\s*\/?\s*L\s*No/i, /Booking\s*No/i]) : [null, null];
  const firstToken = (r: Reading | null, re: RegExp) => {
    const t = r?.value.split(/\s+/).find((x) => re.test(x));
    return r && t ? { ...r, value: t } : null;
  };

  const routeRow = findRow(rows, /Ocean\s+Vessel.*Port\s+of\s+Loading/i);
  const [, receipt, vesselCol, loading] = routeRow >= 0 ? columnsBelow(rows, routeRow, [/Pre-?\s*carriage/i, /Place\s+of\s+Receipt/i, /Ocean\s+Vessel/i, /Port\s+of\s+Loading/i]) : [];
  const { vessel, voyage } = vesselVoyage(vesselCol ?? null);
  const destRow = findRow(rows, /Port\s+of\s+Discharge.*Place\s+of\s+Delivery/i);
  const [discharge, delivery] = destRow >= 0 ? columnsBelow(rows, destRow, [/Port\s+of\s+Discharge/i, /Place\s+of\s+Delivery/i, /Final\s+Destination/i, /Type\s+of\s+Move/i]) : [];
  const originRow = findRow(rows, /Country\s+of\s+Origin/i);
  const [origin] = originRow >= 0 ? columnsBelow(rows, originRow, [/Point\s+and\s+Country\s+of\s+Origin|Country\s+of\s+Origin/i]) : [null];

  // Weight and measurement are often printed as two numbers with their units on the next line.
  let grossWeight: Reading | null = byLabel(rows, new RegExp(String.raw`((?:${AMOUNT})\s*KGS?)\b`, 'i'));
  let measurement: Reading | null = byLabel(rows, new RegExp(String.raw`((?:${AMOUNT})\s*CBM)\b`, 'i'));
  if (!grossWeight || !measurement) {
    for (let i = 0; i + 1 < rows.length; i++) {
      const m = /(\d{1,3}(?:,\d{3})*\.\d{1,3})\s+(\d{1,3}(?:,\d{3})*\.\d{1,3})\s*\S*$/.exec(norm(rows[i].text));
      const units = norm(rows[i + 1].text);
      if (m && /\bKGS?\b/i.test(units) && /\bCBM\b/i.test(units)) {
        const quote = `${norm(rows[i].text)} / ${units}`;
        const note = 'Unit read from the following line.';
        grossWeight ??= { value: `${m[1]} KGS`, page: rows[i].page, quote, note, confidence: rowConfidence(rows[i], m[1]) };
        measurement ??= { value: `${m[2]} CBM`, page: rows[i].page, quote, note, confidence: rowConfidence(rows[i], m[2]) };
        break;
      }
    }
  }
  const sob = findRow(rows, /SHIPPED\s+ON\s+BOARD/i);
  const issueRow = findRow(rows, /Place\s+and\s+Date\s+of\s+Issue/i);

  const fields = fieldsFrom({
    blNumber: firstToken(bl, /^[A-Z0-9-]{8,}$/),
    bookingNumber: firstToken(booking, /^[A-Z0-9-]{6,}$/),
    masterBlNumber: byLabel(rows, /\bM\.?\s*B\.?\s*\/?\s*L\.?\s*(?:No\.?)?\s*[:.]?\s*([A-Z]{4}[A-Z0-9]{6,})\b/),
    issuerScac: byLabel(rows, /\bSCAC\s*[:.]?\s*([A-Z]{4})\b/),
    carrier: byLabel(rows, /\bCARRIER\s*[:.]\s*(.+?\([A-Z]{4}\)|.+?)(?:\s{2,}|$)/),
    shipper: partyBelow(rows, /Shipper\s*\/?\s*Exporter/i),
    consignee: partyBelow(rows, /Consignee\s*\(?complete/i) ?? partyBelow(rows, /^Consignee\b/i),
    notifyParty: partyBelow(rows, /Notify\s+Party/i),
    invoiceReference: byLabel(rows, /\bINV(?:OICE)?\.?\s*(?:NO\.?)?\s*[:.]?\s*([A-Z0-9]+(?:\/[A-Z0-9-]+)+)/),
    buyerPo: byLabel(rows, /\bP\.?\s*O\.?\s*(?:NO\.?|#)?\s*[:.]?\s*([A-Z0-9]{2,}-[A-Z0-9-]{3,})/),
    countryOfOrigin: origin ?? null,
    vesselName: vessel,
    voyageNumber: voyage,
    portOfLoading: loading ?? null,
    portOfDischarge: discharge ?? null,
    placeOfReceipt: receipt ?? null,
    placeOfDelivery: delivery ?? null,
    packages: byLabel(rows, /\b(\d[\d,]*\s+(?:CARTONS|CTNS|PACKAGES|PKGS|PALLETS))\s+OF\b/i),
    grossWeight,
    measurement,
    shippedOnBoardDate: sob >= 0 ? byLabel(rows.slice(0, sob + 4), /\bDATE\s*[:.]?\s*(\d{1,2}[\s-][A-Z]{3}[\s-]\d{2,4})/i, 1, sob) : null,
    placeDateOfIssue: issueRow >= 0 ? byLabel(rows.slice(0, issueRow + 5), /([A-Z][A-Z .]{2,}?),\s*(\d{1,2}[- ][A-Z]{3}[- ]\d{4})\s*$/, 0, issueRow + 1) : null,
    hsCodes: byLabel(rows, /\bHS\s*(?:CODES?)?\s*[:.]\s*(\d{4}\.\d{2}(?:\s*\/\s*\d{4}\.\d{2})*)/),
    freightTerms: byLabel(rows, /\b((?:OCEAN\s+)?FREIGHT\s+(?:PREPAID|COLLECT))\b/i),
  });
  if (fields.placeDateOfIssue) {
    const m = /([A-Z][A-Z .]{2,}?),\s*(\d{1,2}[- ][A-Z]{3}[- ]\d{4})\s*$/.exec(fields.placeDateOfIssue.value!);
    if (m) fields.placeDateOfIssue = { ...fields.placeDateOfIssue, value: `${m[1].trim()}, ${m[2]}` };
  }

  // Container numbers: every token shaped like an ISO 6346 number. Whether one is printed, handwritten or struck
  // through cannot be told from text, so that is never inferred.
  const seal = byLabel(rows, /\bSEAL\s*(?:NO\.?)?\s*[:.]?\s*([A-Z0-9]{6,})\b/);
  const containers: ContainerReading[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const m of norm(r.text).matchAll(CONTAINER_RE)) {
      const number = `${m[1]}${m[2]}${m[3]}`;
      if (seen.has(number)) continue;
      seen.add(number);
      containers.push({
        number: { ...toField({ value: number, page: r.page, quote: norm(r.text), confidence: rowConfidence(r, m[0]) })!, note: 'Printed, handwritten or struck through cannot be told from the text: compare with the page.' },
        ...(seal ? { seal: toField(seal) } : {}),
        marking: 'unknown',
        struckThrough: false,
      });
    }
  }
  if (!containers.length) warnings.push('No container number was recognised. Enter it from the page.');
  warnings.push('Handwritten corrections, stamps and signatures are not read reliably. Check the page for corrections (e.g. to the container number) and record them as separate container readings.');
  return { fields, containers, warnings };
}

function rowConfidence(row: TextRow, text: string): number | undefined {
  const scored = row.items.filter((i) => i.confidence !== undefined);
  if (!scored.length) return row.confidence;
  const hits = scored.filter((i) => text.includes(i.text) || i.text.includes(text));
  return hits.length ? Math.min(...hits.map((i) => i.confidence!)) : row.confidence;
}
