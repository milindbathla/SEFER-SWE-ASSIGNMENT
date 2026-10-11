/**
 * Format constraints copied from the official NetCHB schemas (see docs/research-log.md, RL-3/RL-8).
 *   data_type.xsd: https://www.netchb.com/xml/data/data_type.xsd
 *   entry.xsd:     https://www.netchb.com/xml/entry/entry.xsd
 * XSD patterns are implicitly anchored, so every RegExp here is wrapped in ^...$.
 * These checks let the UI give early feedback; the vendored XSD stays the authority.
 */

export const NETCHB_ENTRY_NAMESPACE = 'http://www.netchb.com/xml/entry';

export const PATTERNS = {
  /** data:portType */
  port: /^\d{4}$/,
  /** data:foreignPortType (line-item lading-port) */
  foreignPort: /^\d{5}$/,
  /** data:taxIdType */
  taxId: /^(\d{2}-\d{7}[\dA-Za-z]?[\dA-Za-z]?|\d{6}-\d{5}|\d{3}-\d{2}-\d{4})$/,
  /** data:invoiceNoType */
  invoiceNo: /^[A-Za-z\d-]{1,17}$/,
  /** data:tariffNoType */
  tariffNo: /^\d{5,10}$/,
  /** data:billNoType */
  billNo: /^[\dA-Za-z]{0,50}$/,
  /** data:carrierCodeType (XSD \w also matches Unicode word characters) */
  carrierCode: /^(\w{2}|\w{4}|\*[*\w])$/u,
  /** data:countryCodeType */
  country: /^[A-Za-z]{2}$/,
  /** data:entryNoType */
  entryNo: /^\d{7,8}$/,
  /** data:filerCodeType */
  filerCode: /^[A-Za-z0-9]{3}$/,
  /** xsd:date lexical form (validity of the calendar date is checked separately) */
  date: /^\d{4}-\d{2}-\d{2}$/,
} as const;

export const MAX_LENGTH = {
  manufacturerId: 15, // data:manufacturerIdType
  suretyCode: 3, // data:suretyCodeType
  vesselName: 20, // header vessel-name
  voyageNo: 5, // header voyage-no
  locationOfGoods: 4, // header location-of-goods
  billOfLadingUnit: 5, // manifest bill-of-lading unit
  headerDescription: 70, // header description
} as const;

/** data:entryType enumeration */
export const ENTRY_TYPES = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '20', '21', '22', '23', '24', '25', '26',
  '30', '31', '32', '33', '34', '38', '40', '41', '42', '43', '44', '45', '46', '50', '51', '52', '60', '61', '62',
  '63', '64', '65', '66', '86',
] as const;

/** entry:bondType enumeration (header bond-type) */
export const BOND_TYPES = ['00', '08', '09'] as const;

/** data:modeTransportType enumeration */
export const MODES_OF_TRANSPORT = ['10', '11', '12', '20', '21', '30', '31', '32', '33', '34', '40', '41', '50', '60', '70'] as const;

/** data:usStateType enumeration */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'AS', 'FM', 'GU', 'MH', 'MP', 'PW', 'PR', 'VI',
] as const;

/** xsd:token whitespace handling: collapse runs of whitespace and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isValidIsoDate(value: string): boolean {
  if (!PATTERNS.date.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** data:dollarAmountType: decimal, at most 2 fraction digits, >= 0; tariff value also < 10,000,000,000. */
export function isDollarAmount(value: string): boolean {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
  return Number(value) < 10_000_000_000;
}
