import { describe, expect, it } from 'vitest';
import { checkContainerNumber } from '../src/iso6346.js';
import { compositionNumbers, parseDate, parseNumber, toCents } from '../src/normalize.js';
import { countryCode, countryFromPlace, lookupPort, usStateFromPlace } from '../src/reference.js';
import { US_STATES } from '@sefer/shared';

describe('parseNumber', () => {
  it('parses printed amounts without changing them', () => {
    expect(parseNumber('6,480.00')).toMatchObject({ value: 6480, parenthesized: false });
    expect(parseNumber('1,930.000 KGS')).toMatchObject({ value: 1930, unit: 'KGS' });
    expect(parseNumber('2.10 *')).toMatchObject({ value: 2.1, marker: '*' });
    expect(parseNumber('5,100 PCS')).toMatchObject({ value: 5100, unit: 'PCS' });
  });
  it('flags parenthesized (no-charge style) amounts', () => {
    expect(parseNumber('(24.00)')).toMatchObject({ value: 24, parenthesized: true });
  });
  it('returns null for non-numbers and missing values', () => {
    expect(parseNumber('N/A')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber('1,23,4')).toBeNull();
  });
  it('compares money in integer cents', () => {
    expect(toCents(2400 * 2.85)).toBe(684000);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe('parseDate', () => {
  it('reports both readings for ambiguous numeric dates', () => {
    expect(parseDate('12/09/2026')).toMatchObject({ ambiguous: true, iso: null, candidates: ['2026-09-12', '2026-12-09'] });
  });
  it('is unambiguous when only one reading is a valid date', () => {
    expect(parseDate('24/09/2026')).toMatchObject({ ambiguous: false, iso: '2026-09-24' });
  });
  it('parses month-name formats', () => {
    expect(parseDate('24-SEP-2026')?.iso).toBe('2026-09-24');
    expect(parseDate('24 SEP 2026')?.iso).toBe('2026-09-24');
    expect(parseDate('20-Sep-2026')?.iso).toBe('2026-09-20');
    expect(parseDate('September 24, 2026')?.iso).toBe('2026-09-24');
    expect(parseDate('2026-09-24')?.iso).toBe('2026-09-24');
  });
  it('rejects impossible dates and unknown month words', () => {
    expect(parseDate('31-FEB-2026')).toBeNull();
    expect(parseDate('24-FOO-2026')).toBeNull();
  });
});

describe('compositionNumbers', () => {
  it('compares numbers only', () => {
    expect(compositionNumbers('60% Cotton 40% Polyester brushed fleece')).toEqual([60, 40]);
    expect(compositionNumbers('TC 65/35 FLEECE 280GSM')).toEqual([65, 35]);
    expect(compositionNumbers('98/2 COTTON/SPANDEX TWILL')).toEqual([98, 2]);
    expect(compositionNumbers('100% POLY CREPE')).toEqual([100]);
    expect(compositionNumbers('Size ratio 1-3-3-2-1')).toBeNull();
  });
});

describe('ISO 6346 container check digit', () => {
  it('validates the standard example CSQU3054383', () => {
    expect(checkContainerNumber('CSQU3054383')).toMatchObject({ wellFormed: true, expectedCheckDigit: 3, valid: true });
  });
  it('computes check digit 2 for OPLU304172 (handwritten correction is consistent, typed number is not)', () => {
    expect(checkContainerNumber('OPLU 304172 2')).toMatchObject({ expectedCheckDigit: 2, valid: true });
    expect(checkContainerNumber('OPLU3041728')).toMatchObject({ expectedCheckDigit: 2, actualCheckDigit: 8, valid: false });
  });
  it('rejects malformed numbers', () => {
    expect(checkContainerNumber('OPL304172').wellFormed).toBe(false);
  });
});

describe('reference data', () => {
  it('maps only researched ports and cites sources', () => {
    expect(lookupPort('TACOMA, WA, USA', 'us')?.code).toBe('3002');
    expect(lookupPort('CAT LAI, HCMC, VN', 'foreign')?.code).toBe('55224');
    expect(lookupPort('LONG BEACH, CA', 'us')).toBeNull();
    expect(lookupPort('SHANGHAI', 'foreign')).toBeNull();
  });
  it('country names and places', () => {
    expect(countryCode('VIETNAM')).toBe('VN');
    expect(countryCode('Bangladesh')).toBe('BD');
    expect(countryCode('Atlantis')).toBeNull();
    expect(countryFromPlace('CAT LAI, HO CHI MINH CITY, VN')).toBe('VN');
    expect(countryFromPlace('CAT LAI, HCMC')).toBeNull();
    expect(usStateFromPlace('KENT, WA (DOOR)', US_STATES)).toBe('WA');
  });
});
