/**
 * Reference data. Each entry cites its source; codes not listed here are never guessed.
 * Port mappings are offered only as PROPOSALS that the user must confirm (port roles are a
 * broker determination, docs/research-log.md RL-11/RL-12).
 */

export interface PortReference {
  code: string;
  kind: 'us' | 'foreign';
  match: RegExp;
  name: string;
  source: string;
  caveat: string | null;
}

export const PORTS: PortReference[] = [
  {
    code: '3002',
    kind: 'us',
    match: /\btacoma\b/i,
    name: 'Tacoma, Washington',
    source: 'CBP port page "Tacoma, Washington – 3002" (research log RL-11)',
    caveat: 'Whether this port is also the entry, processing or unlading port is the broker\'s determination.',
  },
  {
    code: '55224',
    kind: 'foreign',
    match: /\b(ho\s*chi\s*minh|hcmc|saigon|cat\s*lai)\b/i,
    name: 'Ho Chi Minh City (Schedule K)',
    source: 'CBP ACE Appendix F – Schedule K (Aug 2024), "55224 – Ho Chi Minh City" (research log RL-12)',
    caveat: 'Cat Lai is a Ho Chi Minh City terminal but is not listed separately in Schedule K; this mapping is provisional.',
  },
];

export function lookupPort(text: string | null | undefined, kind: PortReference['kind']): PortReference | null {
  if (!text) return null;
  return PORTS.find((p) => p.kind === kind && p.match.test(text)) ?? null;
}

/**
 * Country names to ISO 3166-1 alpha-2 codes (the format of NetCHB data:countryCodeType).
 * A deliberately small table; an unknown name yields null and the field is flagged.
 */
const COUNTRIES: Record<string, string> = {
  VIETNAM: 'VN', 'VIET NAM': 'VN', BANGLADESH: 'BD', CHINA: 'CN', "PEOPLE'S REPUBLIC OF CHINA": 'CN', PRC: 'CN',
  'HONG KONG': 'HK', INDIA: 'IN', INDONESIA: 'ID', CAMBODIA: 'KH', THAILAND: 'TH', MALAYSIA: 'MY', PHILIPPINES: 'PH',
  'SRI LANKA': 'LK', PAKISTAN: 'PK', TAIWAN: 'TW', 'SOUTH KOREA': 'KR', KOREA: 'KR', JAPAN: 'JP', SINGAPORE: 'SG',
  MEXICO: 'MX', CANADA: 'CA', 'UNITED STATES': 'US', USA: 'US', 'U.S.A.': 'US', TURKEY: 'TR', 'TÜRKIYE': 'TR', ITALY: 'IT',
  GERMANY: 'DE', FRANCE: 'FR', SPAIN: 'ES', PORTUGAL: 'PT', 'UNITED KINGDOM': 'GB', UK: 'GB', MYANMAR: 'MM',
  EGYPT: 'EG', MOROCCO: 'MA', GUATEMALA: 'GT', HONDURAS: 'HN', 'EL SALVADOR': 'SV', NICARAGUA: 'NI', PERU: 'PE',
  BRAZIL: 'BR', COLOMBIA: 'CO', JORDAN: 'JO', ETHIOPIA: 'ET', KENYA: 'KE',
};

export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[.,]$/, '');
  if (/^[A-Z]{2}$/.test(key) && Object.values(COUNTRIES).includes(key)) return key;
  return COUNTRIES[key] ?? null;
}

/** Trailing country token of an address-like string, e.g. "CAT LAI, HCMC, VN" -> "VN". */
export function countryFromPlace(text: string | null | undefined): string | null {
  if (!text) return null;
  const last = text.split(',').pop()?.trim() ?? '';
  return countryCode(last);
}

/** US state from text such as "Kent, WA 98032" or "KENT, WA (DOOR)". */
export function usStateFromPlace(text: string | null | undefined, states: readonly string[]): string | null {
  if (!text) return null;
  const m = /,\s*([A-Z]{2})\b/.exec(text.toUpperCase());
  return m && states.includes(m[1]) ? m[1] : null;
}
