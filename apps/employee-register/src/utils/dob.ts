export function extractDobDigits(input: string): string {
  return String(input ?? '')
    .replace(/\D/g, '')
    .slice(0, 8);
}

/**
 * Format DOB digits as MM/DD/YYYY while the employee types.
 * Accepts digits-only or any input; non-digits are stripped and length is clamped to 8.
 */
export function formatDobMmDdYyyy(digitsRaw: string): string {
  const digits = extractDobDigits(digitsRaw);
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return mm;
  if (digits.length <= 4) return `${mm}/${dd}`;
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Parse 8 DOB digits (MMDDYYYY) into ISO date string (YYYY-MM-DD).
 * Returns null if incomplete or invalid.
 */
export function parseDobDigitsToIso(digitsRaw: string): string | null {
  const digits = extractDobDigits(digitsRaw);
  if (digits.length !== 8) return null;
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Validate this is a real calendar date.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(d.getTime())) return null;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    return null;
  return `${yyyy}-${mm}-${dd}`;
}
