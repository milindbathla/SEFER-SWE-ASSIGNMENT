import {
  BOND_TYPES, ENTRY_TYPES, MAX_LENGTH, MODES_OF_TRANSPORT, PATTERNS, US_STATES, collapseWhitespace, isDollarAmount, isValidIsoDate,
  type BrokerInput, type Evidence, type Issue, type ResolvedField,
} from '@sefer/shared';
import { formatMoney, normalizeKey, parseDate, parseNumber } from '../normalize.js';
import { countryCode, countryFromPlace, lookupPort, usStateFromPlace } from '../reference.js';
import { checkContainerNumber } from '../iso6346.js';
import { allLines, evidence, type ShipmentContext } from './context.js';
import { containerSlots, proposeInvoiceNumber } from './rules.js';

type Group = ResolvedField['group'];
type Requirement = ResolvedField['requirement'];

interface FieldSpec {
  path: string;
  label: string;
  xmlPath: string;
  group: Group;
  requirement: Requirement;
  requirementNote: string;
  brokerOnly: boolean;
  inputHint: string;
  validate: (v: string) => string | null;
  docValue?: { value: string; evidence: Evidence[]; provenance: 'extracted' | 'calculated' };
  proposal?: { value: string; reason: string; evidence: Evidence[]; kind: 'proposal' | 'transformation' };
  evidence?: Evidence[];
}

// ----- validators (mirror the vendored XSD; the XSD itself remains the authority) -----
const pattern = (re: RegExp, name: string) => (v: string) => (re.test(v) ? null : `Does not match NetCHB ${name} ${re.source}`);
const maxLen = (n: number) => (v: string) => (v.length <= n ? null : `Longer than ${n} characters (schema maxLength)`);
const oneOf = (values: readonly string[], name: string) => (v: string) => (values.includes(v) ? null : `Not in the NetCHB ${name} enumeration`);
const date = (v: string) => (isValidIsoDate(v) ? null : 'Must be a valid date in yyyy-mm-dd format (xsd:date)');
const dollar = (v: string) => (isDollarAmount(v) ? null : 'Must be a decimal amount ≥ 0 with at most 2 decimals (data:dollarAmountType)');
const xsdLong = (v: string) => (/^\d+$/.test(v) && Number(v) <= Number.MAX_SAFE_INTEGER ? null : 'Must be a whole number (xsd:long)');
const xsdInteger = (v: string) => (/^\d+$/.test(v) ? null : 'Must be a whole number ≥ 0');
const xsdDouble = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? null : 'Must be a number');
const nonEmpty = (v: string) => (v.length ? null : 'Must not be empty');

/** Issue rules whose presence still allows a proposal to be offered for an affected field. */
const PROPOSAL_COMPATIBLE_RULES = new Set(['CIF_DEDUCTIONS', 'CONTAINER_NUMBER', 'INVOICE_NUMBER_FORMAT', 'CARRIER_CODE_UNRESOLVED', 'HTS_INCOMPLETE', 'MID_MISSING', 'PARTIES_UNRESOLVED']);

function consistentField(ctx: ShipmentContext, key: string): { value: string; evidence: Evidence[] } | null {
  const present = ctx.documents.filter((d) => d.fields[key]?.value);
  if (!present.length) return null;
  const keys = new Set(present.map((d) => normalizeKey(d.fields[key]!.value)));
  if (keys.size > 1) return null;
  return { value: collapseWhitespace(present[0].fields[key]!.value!), evidence: present.map((d) => evidence(d, d.fields[key], key)) };
}

function buildSpecs(ctx: ShipmentContext, broker: BrokerInput): FieldSpec[] {
  const specs: FieldSpec[] = [];
  const inv0 = ctx.invoices[0]?.doc;
  const bol = ctx.bol;
  const add = (s: Omit<FieldSpec, 'brokerOnly' | 'inputHint'> & Partial<Pick<FieldSpec, 'brokerOnly' | 'inputHint'>>) =>
    specs.push({ brokerOnly: false, inputHint: '', ...s });

  // ---------------- entry-no ----------------
  if (broker.entryNumberMode === 'user_specified') {
    add({ path: 'entry-no/filer-code', label: 'Filer code', xmlPath: 'entry-no/user-specified/filer-code', group: 'entry', requirement: 'conditional', requirementNote: 'Required when a user-specified entry number is chosen (entry.xsd).', validate: pattern(PATTERNS.filerCode, 'filerCodeType'), brokerOnly: true, inputHint: '3 characters, e.g. assigned by CBP to the filer.' });
    add({ path: 'entry-no/entry-no', label: 'Entry number', xmlPath: 'entry-no/user-specified/entry-no', group: 'entry', requirement: 'conditional', requirementNote: 'Required when a user-specified entry number is chosen (entry.xsd).', validate: pattern(PATTERNS.entryNo, 'entryNoType'), brokerOnly: true, inputHint: '7–8 digits.' });
  }

  // ---------------- header ----------------
  const H = (el: string) => `header/${el}`;
  add({ path: H('importer-tax-id'), label: 'Importer tax ID', xmlPath: H('importer-tax-id'), group: 'header', requirement: 'conditional', requirementNote: '"Required unless the entry type is 86" (entry.xsd).', validate: pattern(PATTERNS.taxId, 'taxIdType'), brokerOnly: true, inputHint: 'IRS/EIN (NN-NNNNNNN[XX]), CBP-assigned (NNNNNN-NNNNN) or SSN format.' });
  add({ path: H('importer-name'), label: 'Importer name (profile match)', xmlPath: H('importer-name'), group: 'header', requirement: 'optional', requirementNote: 'Optional; used by NetCHB to pick between importers sharing a tax ID (entry.xsd).', validate: nonEmpty, brokerOnly: true });
  add({ path: H('ultimate-consignee/tax-id'), label: 'Ultimate consignee tax ID', xmlPath: H('ultimate-consignee/tax-id'), group: 'header', requirement: 'optional', requirementNote: 'Optional in entry.xsd; identity is a broker determination (C-9).', validate: pattern(PATTERNS.taxId, 'taxIdType'), brokerOnly: true });
  add({ path: H('ultimate-consignee/consignee-name'), label: 'Ultimate consignee name (profile match)', xmlPath: H('ultimate-consignee/consignee-name'), group: 'header', requirement: 'optional', requirementNote: 'Optional (entry.xsd).', validate: nonEmpty, brokerOnly: true });
  add({ path: H('processing-port'), label: 'Processing port', xmlPath: H('processing-port'), group: 'header', requirement: 'schema_required', requirementNote: 'Required by entry.xsd (headerType).', validate: pattern(PATTERNS.port, 'portType'), brokerOnly: true, inputHint: '4-digit CBP port code. Port roles are a broker determination.' });

  const discharge = consistentPlace(ctx, 'portOfDischarge');
  const usPort = agreeingPort(discharge, 'us');
  const portProposal = usPort && discharge ? { value: usPort.code, reason: `Port of discharge "${discharge.text}" → ${usPort.code} (${usPort.source}). ${usPort.caveat ?? ''}`.trim(), evidence: discharge.evidence, kind: 'proposal' as const } : undefined;
  add({ path: H('entry-port'), label: 'Entry port', xmlPath: H('entry-port'), group: 'header', requirement: 'schema_required', requirementNote: 'Required by entry.xsd (headerType).', validate: pattern(PATTERNS.port, 'portType'), proposal: portProposal, evidence: discharge?.evidence, inputHint: '4-digit CBP port code.' });
  add({ path: H('entry-date'), label: 'Entry date', xmlPath: H('entry-date'), group: 'header', requirement: 'schema_required', requirementNote: 'Required by entry.xsd (headerType).', validate: date, brokerOnly: true, inputHint: 'yyyy-mm-dd. ETA on the invoice is only an estimate and is not used.' });
  add({ path: H('entry-type'), label: 'Entry type', xmlPath: H('entry-type'), group: 'header', requirement: 'schema_required', requirementNote: 'Required by entry.xsd (data:entryType).', validate: oneOf(ENTRY_TYPES, 'entryType'), brokerOnly: true, inputHint: `One of ${ENTRY_TYPES.join(', ')}.` });
  add({ path: H('bond-type'), label: 'Bond type', xmlPath: H('bond-type'), group: 'header', requirement: 'optional', requirementNote: 'Optional in entry.xsd; enumeration 00/08/09 (a schema comment also mentions "1 - Single 2 - Continuous", research log RL-5).', validate: oneOf(BOND_TYPES, 'bondType'), brokerOnly: true, inputHint: '00, 08 or 09.' });
  add({ path: H('surety-code'), label: 'Surety code', xmlPath: H('surety-code'), group: 'header', requirement: 'optional', requirementNote: 'Optional (data:suretyCodeType, max 3).', validate: maxLen(MAX_LENGTH.suretyCode), brokerOnly: true });

  const delivery = consistentPlace(ctx, 'placeOfDelivery') ?? consistentPlace(ctx, 'shipTo');
  const shipToQuote = inv0?.fields.shipTo?.quote ?? null;
  const stateText = delivery?.text ?? shipToQuote;
  const state = usStateFromPlace(stateText, US_STATES);
  add({ path: H('state-destination'), label: 'State of destination', xmlPath: H('state-destination'), group: 'header', requirement: 'conditional', requirementNote: '"required for formal entries" (NetCHB). Treated as required: the entry type is not yet known.', validate: oneOf(US_STATES, 'usStateType'),
    proposal: state ? { value: state, reason: `Delivery address "${collapseWhitespace(stateText ?? '')}" contains state ${state}. The state of destination is a broker confirmation.`, evidence: delivery?.evidence ?? (inv0 ? [evidence(inv0, inv0.fields.shipTo, 'ship to')] : []), kind: 'proposal' } : undefined });

  const containerised = Boolean(bol && (bol.containers.length || /\b\d{2}\s*'\s*(GP|HC|HQ|DV|DC|RF|OT|FR)\b/i.test(JSON.stringify(bol.fields))));
  const vessel = consistentField(ctx, 'vesselName');
  const voyage = consistentField(ctx, 'voyageNumber');
  const ocean = Boolean(bol && vessel);
  add({ path: H('mode-transportation'), label: 'Mode of transportation', xmlPath: H('mode-transportation'), group: 'header', requirement: 'conditional', requirementNote: '"required for formal entries or cargo release processing" (NetCHB).', validate: oneOf(MODES_OF_TRANSPORT, 'modeTransportType'),
    docValue: ocean ? { value: containerised ? '11' : '10', provenance: 'calculated', evidence: vessel!.evidence } : undefined,
    inputHint: 'CBP code: 11 = vessel, container; 10 = vessel, non-container (research log RL-10).' });
  add({ path: H('vessel-name'), label: 'Vessel name', xmlPath: H('vessel-name'), group: 'header', requirement: 'conditional', requirementNote: '"required for ocean shipments or 06 entry types, can be a maximum of 20 characters" (NetCHB).', validate: maxLen(MAX_LENGTH.vesselName), docValue: vessel ? { ...vessel, provenance: 'extracted' } : undefined });
  add({ path: H('voyage-no'), label: 'Voyage number', xmlPath: H('voyage-no'), group: 'header', requirement: 'conditional', requirementNote: '"voyage/flight-no is required for air or ocean shipments" (NetCHB); max 5.', validate: maxLen(MAX_LENGTH.voyageNo), docValue: voyage ? { ...voyage, provenance: 'extracted' } : undefined });
  add({ path: H('unlading-port'), label: 'Port of unlading', xmlPath: H('unlading-port'), group: 'header', requirement: 'conditional', requirementNote: '"port of unlading is required for ocean shipments" (NetCHB).', validate: pattern(PATTERNS.port, 'portType'), proposal: portProposal, evidence: discharge?.evidence });
  add({ path: H('carrier-code'), label: 'Carrier code (SCAC)', xmlPath: H('carrier-code'), group: 'header', requirement: 'optional', requirementNote: 'Optional (data:carrierCodeType). Which SCAC applies is unresolved.', validate: pattern(PATTERNS.carrierCode, 'carrierCodeType'), brokerOnly: true,
    evidence: bol ? [evidence(bol, bol.fields.issuerScac, 'B/L issuer SCAC'), evidence(bol, bol.fields.carrier, 'ocean carrier')].filter((e) => e.value) : [] });

  const gw = consistentWeight(ctx);
  add({ path: H('gross-weight'), label: 'Gross weight', xmlPath: H('gross-weight'), group: 'header', requirement: 'optional', requirementNote: 'Optional (xsd:long). The schema does not state the unit (unresolved, research log §2).', validate: xsdLong,
    proposal: gw && Number.isInteger(gw.value) ? { value: String(gw.value), reason: `Documents agree on ${gw.value} ${gw.unit}. The unit expected by NetCHB is not documented.`, evidence: gw.evidence, kind: 'proposal' } : undefined,
    evidence: gw?.evidence, inputHint: 'Whole number. Unit not specified by the schema (documents state KG).' });

  // ---------------- manifest ----------------
  if (bol) {
    const M = (el: string) => `manifest/bill-of-lading/${el}`;
    add({ path: M('master-scac'), label: 'Master SCAC', xmlPath: M('master-scac'), group: 'manifest', requirement: 'optional', requirementNote: 'Optional (data:carrierCodeType). Not printed as a SCAC on the B/L; not inferred.', validate: pattern(PATTERNS.carrierCode, 'carrierCodeType'), brokerOnly: true });
    const mbl = bol.fields.masterBlNumber?.value?.replace(/\s+/g, '');
    add({ path: M('master-bill'), label: 'Master bill number', xmlPath: M('master-bill'), group: 'manifest', requirement: 'conditional', requirementNote: 'CBP: the bill of lading number must be reported for modes 10/11 (research log RL-10).', validate: pattern(PATTERNS.billNo, 'billNoType'), docValue: mbl ? { value: mbl, provenance: 'extracted', evidence: [evidence(bol, bol.fields.masterBlNumber, 'master B/L')] } : undefined });
    const scac = bol.fields.issuerScac?.value?.trim();
    add({ path: M('house-scac'), label: 'House SCAC', xmlPath: M('house-scac'), group: 'manifest', requirement: 'optional', requirementNote: 'Optional (data:carrierCodeType).', validate: pattern(PATTERNS.carrierCode, 'carrierCodeType'), docValue: scac ? { value: scac, provenance: 'extracted', evidence: [evidence(bol, bol.fields.issuerScac, 'SCAC printed by the house B/L issuer')] } : undefined });
    const hbl = bol.fields.blNumber?.value?.replace(/\s+/g, '');
    add({ path: M('house-bill'), label: 'House bill number', xmlPath: M('house-bill'), group: 'manifest', requirement: 'conditional', requirementNote: 'CBP: the bill of lading number must be reported for modes 10/11 (research log RL-10).', validate: pattern(PATTERNS.billNo, 'billNoType'), docValue: hbl ? { value: hbl, provenance: 'extracted', evidence: [evidence(bol, bol.fields.blNumber, 'house B/L')] } : undefined });
    const pk = parseNumber(bol.fields.packages?.value);
    add({ path: M('quantity'), label: 'B/L quantity', xmlPath: M('quantity'), group: 'manifest', requirement: 'schema_required', requirementNote: 'Required in every <bill-of-lading> (entry.xsd).', validate: xsdInteger, docValue: pk && Number.isInteger(pk.value) ? { value: String(pk.value), provenance: 'extracted', evidence: [evidence(bol, bol.fields.packages, 'B/L packages')] } : undefined });
    const unitWord = pk?.unit ?? null;
    const unitProposal = unitWord && /^(CARTONS?|CTNS?)$/.test(unitWord) ? 'CTN' : null;
    add({ path: M('unit'), label: 'B/L unit', xmlPath: M('unit'), group: 'manifest', requirement: 'schema_required', requirementNote: 'Required in every <bill-of-lading> (entry.xsd, max 5 characters).', validate: maxLen(MAX_LENGTH.billOfLadingUnit),
      proposal: unitProposal ? { value: unitProposal, reason: `B/L states "${unitWord}". "CTN" is in NetCHB's unit-of-measure list; the manifest unit code still needs confirmation.`, evidence: [evidence(bol, bol.fields.packages, 'B/L packages')], kind: 'proposal' } : undefined });

    containerSlots(bol).forEach((slot, idx) => {
      const C = (el: string) => `containers/container[${idx + 1}]/${el}`;
      const check = checkContainerNumber(slot.reading.number.value ?? '');
      const ev = [...slot.correctedFrom, slot.reading].map((r) => evidence(bol, r.number, r.struckThrough ? 'struck-through reading' : `${r.marking} reading`));
      const corrected = slot.correctedFrom.length > 0 || slot.reading.marking === 'handwritten';
      add({ path: C('container-number'), label: `Container ${idx + 1} number`, xmlPath: 'containers/container/container-number', group: 'containers', requirement: 'optional', requirementNote: 'Optional (entry:containerType).', validate: nonEmpty,
        docValue: !corrected && check.valid ? { value: check.normalized, provenance: 'extracted', evidence: ev } : undefined,
        proposal: corrected && check.valid ? { value: check.normalized, reason: `Corrected reading; ISO 6346 check digit ${check.expectedCheckDigit} matches.`, evidence: ev, kind: 'proposal' } : undefined, evidence: ev });
      const seal = slot.reading.seal?.value?.trim();
      add({ path: C('seal-numbers'), label: `Container ${idx + 1} seal`, xmlPath: 'containers/container/seal-numbers', group: 'containers', requirement: 'optional', requirementNote: 'Optional (entry:containerType).', validate: nonEmpty, docValue: seal ? { value: seal, provenance: 'extracted', evidence: [evidence(bol, slot.reading.seal, 'seal')] } : undefined });
      const sizeText = [bol.fields.containerSummary?.value, ...bol.textLines.map((t) => t.text), ...ctx.packingLists.map((p) => p.fields.containerSummary?.value)].find((t) => t && /\b(20|40|45|53)\s*'/.test(t));
      const sm = sizeText ? /\b(20|40|45|53)\s*'\s*(GP|DV|DC|HC|HQ)?/i.exec(sizeText) : null;
      const size = sm ? `${sm[1]} ft${sm[2] && /H[CQ]/i.test(sm[2]) ? ' HC' : ''}` : null;
      add({ path: C('container-size'), label: `Container ${idx + 1} size`, xmlPath: 'containers/container/container-size', group: 'containers', requirement: 'optional', requirementNote: 'Optional; enumeration "20 ft", "20 ft HC", "40 ft", ... (entry:containerType).', validate: oneOf(['20 ft', '20 ft HC', '40 ft', '40 ft HC', '45 ft', '45 ft HC', '53 ft', '53 ft HC'], 'container-size'),
        proposal: size ? { value: size, reason: `Documents state "${sizeText!.match(/\b(20|40|45|53)\s*'\s*\w*/)?.[0]}".`, evidence: [], kind: 'proposal' } : undefined });
    });
  }

  // ---------------- invoices and lines ----------------
  const portOfLoading = consistentPlace(ctx, 'portOfLoading');
  const foreignPort = agreeingPort(portOfLoading, 'foreign');
  const exportCountries = new Set((portOfLoading?.evidence ?? []).map((e) => countryFromPlace(e.value)).filter((c): c is string => c !== null));
  const exportCountry = exportCountries.size === 1 ? [...exportCountries][0] : null;
  const exportDate = consistentDate(ctx, ['etd', 'shippedOnBoardDate']);
  const headerOrigin = consistentOrigin(ctx);

  for (const inv of ctx.invoices) {
    const no = inv.doc.fields.invoiceNumber;
    const raw = no?.value ? collapseWhitespace(no.value) : null;
    const valid = raw !== null && PATTERNS.invoiceNo.test(raw);
    const transformed = raw && !valid ? proposeInvoiceNumber(raw) : null;
    add({ path: `${inv.path}/invoice-no`, label: `Invoice ${inv.index} number`, xmlPath: 'invoices/invoice/invoice-no', group: 'invoice', requirement: 'schema_required', requirementNote: 'Required in every <invoice> (data:invoiceNoType [A-Za-z\\d\\-]{1,17}).', validate: pattern(PATTERNS.invoiceNo, 'invoiceNoType'),
      docValue: valid ? { value: raw, provenance: 'extracted', evidence: [evidence(inv.doc, no, 'invoice number')] } : undefined,
      proposal: transformed ? { value: transformed, reason: `Original "${raw}" contains characters outside [A-Za-z0-9-]; they are removed. The original is kept in the report.`, evidence: [evidence(inv.doc, no, 'invoice number as printed')], kind: 'transformation' } : undefined,
      evidence: no ? [evidence(inv.doc, no, 'invoice number as printed')] : [] });

    for (const l of inv.lines) {
      const L = (el: string) => `${l.path}/${el}`;
      const name = `Line ${l.lineNo}${l.cells.style?.value ? ` ${l.cells.style.value}` : ''}`;
      const lineOriginCode = countryCode(l.cells.origin?.value);
      const originValue = l.cells.origin?.value ? lineOriginCode : headerOrigin?.code ?? null;
      add({ path: L('country-origin'), label: `${name}: country of origin`, xmlPath: 'line-item/country-origin', group: 'line', requirement: 'schema_required', requirementNote: 'Required in every <line-item> (data:countryCodeType).', validate: pattern(PATTERNS.country, 'countryCodeType'),
        docValue: originValue ? { value: originValue, provenance: 'extracted', evidence: l.cells.origin?.value ? [evidence(l.doc, l.cells.origin, 'line origin')] : headerOrigin!.evidence } : undefined });
      add({ path: L('manufacturer-id'), label: `${name}: manufacturer ID (MID)`, xmlPath: 'line-item/manufacturer-id', group: 'line', requirement: 'optional', requirementNote: 'Optional in entry.xsd (max 15). MID construction: CBP Directive 3550-055 (RL-15).', validate: maxLen(MAX_LENGTH.manufacturerId), brokerOnly: true });
      add({ path: L('tariff-no'), label: `${name}: HTSUS number`, xmlPath: 'line-item/tariffs/tariff/tariff-no', group: 'line', requirement: 'schema_required', requirementNote: 'Required in every <tariff> (data:tariffNoType \\d{5,10}); the full 10-digit HTSUS number must be reported (RL-14).', validate: pattern(PATTERNS.tariffNo, 'tariffNoType'), brokerOnly: true,
        inputHint: l.cells.hsCode?.value ? `Invoice shows HS ${l.cells.hsCode.value}; that is not a complete HTSUS number.` : '', evidence: l.cells.hsCode?.value ? [evidence(l.doc, l.cells.hsCode, 'invoice HS code')] : [] });
      const amount = l.amount;
      const usd = (inv.doc.fields.currency?.value ?? '').trim().toUpperCase() === 'USD';
      add({ path: L('value'), label: `${name}: tariff value (USD)`, xmlPath: 'line-item/tariffs/tariff/value', group: 'line', requirement: 'schema_required', requirementNote: 'Required in every <tariff> (data:dollarAmountType).', validate: dollar,
        proposal: amount && !amount.parenthesized && usd ? { value: formatMoney(amount.value), reason: `Invoice line amount as printed (${l.cells.amount?.value} ${inv.doc.fields.currency?.value}). Valuation (e.g. freight/insurance, assists) is a broker decision.`, evidence: [evidence(l.doc, l.cells.amount, 'invoice amount')], kind: 'proposal' } : undefined,
        evidence: [evidence(l.doc, l.cells.amount, 'invoice amount')] });
      add({ path: L('country-export'), label: `${name}: country of export`, xmlPath: 'line-item/country-export', group: 'line', requirement: 'conditional', requirementNote: '"required for ocean/air shipments" (NetCHB).', validate: pattern(PATTERNS.country, 'countryCodeType'),
        proposal: exportCountry ? { value: exportCountry, reason: `Port of loading "${portOfLoading!.text}" is in ${exportCountry}. Country of export is a broker confirmation.`, evidence: portOfLoading!.evidence, kind: 'proposal' } : undefined });
      add({ path: L('lading-port'), label: `${name}: foreign port of lading`, xmlPath: 'line-item/lading-port', group: 'line', requirement: 'conditional', requirementNote: '"required for ocean shipments" (NetCHB; data:foreignPortType \\d{5}).', validate: pattern(PATTERNS.foreignPort, 'foreignPortType'),
        proposal: foreignPort && portOfLoading ? { value: foreignPort.code, reason: `"${portOfLoading.text}" → ${foreignPort.code} (${foreignPort.source}). ${foreignPort.caveat ?? ''}`.trim(), evidence: portOfLoading.evidence, kind: 'proposal' } : undefined });
      add({ path: L('export-date'), label: `${name}: export date`, xmlPath: 'line-item/export-date', group: 'line', requirement: 'optional', requirementNote: 'Optional (xsd:date).', validate: date,
        proposal: exportDate ? { value: exportDate.iso, reason: `ETD / shipped-on-board dates agree on ${exportDate.iso}. Using it as the export date needs confirmation.`, evidence: exportDate.evidence, kind: 'proposal' } : undefined });
      const descFirst = l.cells.description?.value?.split('\n')[0];
      add({ path: L('commercial-description'), label: `${name}: commercial description`, xmlPath: 'line-item/commercial-description', group: 'line', requirement: 'optional', requirementNote: 'Optional (xsd:string).', validate: nonEmpty,
        docValue: descFirst ? { value: collapseWhitespace(descFirst), provenance: 'extracted', evidence: [evidence(l.doc, l.cells.description, 'description (first line)')] } : undefined });
      add({ path: L('invoice-quantity'), label: `${name}: invoice quantity`, xmlPath: 'line-item/invoice-quantity', group: 'line', requirement: 'optional', requirementNote: 'Optional (xsd:double).', validate: xsdDouble,
        docValue: l.quantity && !l.quantity.parenthesized ? { value: String(l.quantity.value), provenance: 'extracted', evidence: [evidence(l.doc, l.cells.quantity, 'invoice quantity')] } : undefined });
      const po = inv.doc.fields.buyerPo?.value?.trim();
      add({ path: L('po-number'), label: `${name}: PO number`, xmlPath: 'line-item/po-number', group: 'line', requirement: 'optional', requirementNote: 'Optional (xsd:string).', validate: nonEmpty,
        docValue: po ? { value: po, provenance: 'extracted', evidence: [evidence(inv.doc, inv.doc.fields.buyerPo, 'buyer PO')] } : undefined });
    }
  }
  return specs;
}

// ----- consistency helpers -----

/** A port proposal is only offered when every document's wording maps to the same code. */
function agreeingPort(place: { text: string; evidence: Evidence[] } | null, kind: 'us' | 'foreign') {
  if (!place) return null;
  const refs = place.evidence.map((e) => lookupPort(e.value, kind));
  const codes = new Set(refs.map((r) => r?.code ?? null));
  return codes.size === 1 && refs[0] ? refs[0] : null;
}

function consistentPlace(ctx: ShipmentContext, key: string): { text: string; evidence: Evidence[] } | null {
  const present = ctx.documents.filter((d) => d.fields[key]?.value);
  if (!present.length) return null;
  return { text: collapseWhitespace(present[0].fields[key]!.value!), evidence: present.map((d) => evidence(d, d.fields[key], key)) };
}

function consistentWeight(ctx: ShipmentContext): { value: number; unit: string; evidence: Evidence[] } | null {
  const readings = [
    ...ctx.packingLists.map((d) => ({ d, f: d.fields.totalGrossWeight })),
    ...ctx.billsOfLading.map((d) => ({ d, f: d.fields.grossWeight })),
  ].filter((r) => r.f?.value);
  if (!readings.length) return null;
  const parsed = readings.map((r) => ({ ...r, n: parseNumber(r.f!.value) }));
  if (parsed.some((p) => !p.n)) return null;
  const values = new Set(parsed.map((p) => Math.round(p.n!.value * 1000)));
  const units = new Set(parsed.map((p) => (p.n!.unit ?? '').replace(/S$/, '')));
  if (values.size !== 1 || units.size !== 1) return null;
  return { value: parsed[0].n!.value, unit: parsed[0].n!.unit ?? '', evidence: parsed.map((p) => evidence(p.d, p.f, 'gross weight')) };
}

function consistentDate(ctx: ShipmentContext, keys: string[]): { iso: string; evidence: Evidence[] } | null {
  const ev: Evidence[] = [];
  const dates = new Set<string>();
  for (const d of ctx.documents) {
    for (const k of keys) {
      const f = d.fields[k];
      if (!f?.value) continue;
      const p = parseDate(f.value);
      if (!p?.iso) return null;
      dates.add(p.iso);
      ev.push(evidence(d, f, k));
    }
  }
  return dates.size === 1 ? { iso: [...dates][0], evidence: ev } : null;
}

function consistentOrigin(ctx: ShipmentContext): { code: string; evidence: Evidence[] } | null {
  const present = ctx.documents.filter((d) => d.fields.countryOfOrigin?.value);
  const codes = new Set(present.map((d) => countryCode(d.fields.countryOfOrigin!.value)));
  if (present.length === 0 || codes.size !== 1 || codes.has(null)) return null;
  return { code: [...codes][0]!, evidence: present.map((d) => evidence(d, d.fields.countryOfOrigin, 'country of origin')) };
}

// ----- resolution -----

export function resolveFields(ctx: ShipmentContext, broker: BrokerInput, issues: Pick<Issue, 'id' | 'rule' | 'kind' | 'affects'>[]): ResolvedField[] {
  const entryNo = resolveEntryNo(broker);
  return [entryNo, ...buildSpecs(ctx, broker).map((spec) => resolveOne(spec, broker, issues))];
}

function resolveEntryNo(broker: BrokerInput): ResolvedField {
  const base = {
    path: 'entry-no', label: 'Entry number option', xmlPath: 'entry-no', group: 'entry' as const, requirement: 'schema_required' as const,
    requirementNote: 'Required by entry.xsd: a choice of <user-specified> (filer code + entry number) or <system-generated/>.',
    proposal: null, proposalReason: null, evidence: [], issueIds: [], formatError: null, brokerOnly: true,
    inputHint: '<system-generated/> asks NetCHB to assign the entry number. Whether that suits the broker\'s workflow must be confirmed by the broker.',
  };
  if (broker.entryNumberMode === 'system_generated') return { ...base, value: 'system-generated', provenance: 'system_option' };
  if (broker.entryNumberMode === 'user_specified') return { ...base, value: 'user-specified', provenance: 'user_supplied' };
  return { ...base, value: null, provenance: 'missing' };
}

function resolveOne(spec: FieldSpec, broker: BrokerInput, issues: Pick<Issue, 'id' | 'rule' | 'kind' | 'affects'>[]): ResolvedField {
  // Document values AND proposals resting on an unverified OCR reading wait for that reading to be verified.
  const ocrIssueIds = new Set([...(spec.docValue?.evidence ?? []), ...(spec.proposal?.evidence ?? []), ...(spec.evidence ?? [])].filter((e) => e.ocr && !e.ocr.verified).map((e) => `OCR_UNVERIFIED:${e.documentId}`));
  const affecting = issues.filter((i) => i.affects.includes(spec.path) || ocrIssueIds.has(i.id));
  const withheld = affecting.length > 0;
  const proposalAllowed = affecting.every((i) => PROPOSAL_COMPATIBLE_RULES.has(i.rule));
  const proposal = spec.proposal && proposalAllowed ? spec.proposal : undefined;
  const evidenceList = dedupeEvidence([...(spec.docValue?.evidence ?? []), ...(proposal?.evidence ?? []), ...(spec.evidence ?? [])]);
  const base = {
    path: spec.path, label: spec.label, xmlPath: spec.xmlPath, group: spec.group, requirement: spec.requirement, requirementNote: spec.requirementNote,
    proposal: proposal?.value ?? null, proposalReason: proposal?.reason ?? null, evidence: evidenceList, issueIds: affecting.map((i) => i.id),
    brokerOnly: spec.brokerOnly, inputHint: spec.inputHint,
  };

  const typed = broker.values[spec.path]?.trim();
  if (typed) {
    const value = collapseWhitespace(typed);
    const err = spec.validate(value);
    return { ...base, value: err ? null : value, provenance: err ? 'missing' : 'user_supplied', formatError: err };
  }
  if (spec.docValue && !withheld) {
    const err = spec.validate(spec.docValue.value);
    return { ...base, value: err ? null : spec.docValue.value, provenance: err ? 'missing' : spec.docValue.provenance, formatError: err ? `Document value "${spec.docValue.value}": ${err}` : null };
  }
  if (proposal) {
    const accepted = proposal.kind === 'transformation' ? broker.approvedTransformations.includes(spec.path) : broker.acceptedProposals.includes(spec.path);
    if (accepted && !spec.validate(proposal.value)) {
      return { ...base, value: proposal.value, provenance: proposal.kind === 'transformation' ? 'approved_transformation' : 'approved_proposal', formatError: null };
    }
    return { ...base, value: null, provenance: 'proposed', formatError: null };
  }
  // Held back because the documents disagree or are uncertain, as opposed to simply having no value.
  const disputed = affecting.some((i) => i.kind !== 'missing_broker');
  return { ...base, value: null, provenance: disputed ? 'withheld' : 'missing', formatError: null };
}

function dedupeEvidence(list: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = `${e.documentId}|${e.page}|${e.label}|${e.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { allLines };
