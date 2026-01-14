import { describe, it, expect } from 'vitest';
import { extractDobDigits, formatDobMmDdYyyy, parseDobDigitsToIso } from './dob';

describe('dob utils', () => {
  it('extractDobDigits strips non-digits and clamps to 8', () => {
    expect(extractDobDigits('01/02/1988')).toBe('01021988');
    expect(extractDobDigits('010219881234')).toBe('01021988');
    expect(extractDobDigits('ab')).toBe('');
  });

  it('formatDobMmDdYyyy formats progressively', () => {
    expect(formatDobMmDdYyyy('')).toBe('');
    expect(formatDobMmDdYyyy('1')).toBe('1');
    expect(formatDobMmDdYyyy('12')).toBe('12');
    expect(formatDobMmDdYyyy('123')).toBe('12/3');
    expect(formatDobMmDdYyyy('1234')).toBe('12/34');
    expect(formatDobMmDdYyyy('12345')).toBe('12/34/5');
    expect(formatDobMmDdYyyy('12345678')).toBe('12/34/5678');
    expect(formatDobMmDdYyyy('01/02/1988')).toBe('01/02/1988');
  });

  it('parseDobDigitsToIso returns ISO date for valid input', () => {
    expect(parseDobDigitsToIso('01021988')).toBe('1988-01-02');
    expect(parseDobDigitsToIso('01/02/1988')).toBe('1988-01-02');
  });

  it('parseDobDigitsToIso returns null for invalid or incomplete dates', () => {
    expect(parseDobDigitsToIso('')).toBeNull();
    expect(parseDobDigitsToIso('0102198')).toBeNull();
    expect(parseDobDigitsToIso('13312000')).toBeNull(); // invalid month
    expect(parseDobDigitsToIso('02302000')).toBeNull(); // Feb 30 invalid
  });
});

