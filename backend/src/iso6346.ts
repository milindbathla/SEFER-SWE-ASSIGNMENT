/**
 * ISO 6346 container-number check digit.
 * Owner code (3 letters) + category (U/J/Z) + 6-digit serial + 1 check digit.
 * Letter values start at A=10 and skip multiples of 11; position weights are 2^i; sum mod 11, then mod 10.
 */

const LETTER_VALUES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v++;
    map[ch] = v++;
  }
  return map;
})();

export interface ContainerCheck {
  normalized: string;
  wellFormed: boolean;
  expectedCheckDigit: number | null;
  actualCheckDigit: number | null;
  valid: boolean;
}

export function checkContainerNumber(raw: string): ContainerCheck {
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const wellFormed = /^[A-Z]{3}[UJZ]\d{7}$/.test(normalized);
  if (!wellFormed) return { normalized, wellFormed, expectedCheckDigit: null, actualCheckDigit: null, valid: false };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = normalized[i];
    const value = i < 4 ? LETTER_VALUES[ch] : Number(ch);
    sum += value * 2 ** i;
  }
  const expected = (sum % 11) % 10;
  const actual = Number(normalized[10]);
  return { normalized, wellFormed, expectedCheckDigit: expected, actualCheckDigit: actual, valid: expected === actual };
}
