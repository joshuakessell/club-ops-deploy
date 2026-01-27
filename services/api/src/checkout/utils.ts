export function calculateLateFee(
  lateMinutes: number
): { feeAmount: number; banApplied: boolean } {
  // In demo mode, suppress late fees/bans to keep flows lightweight
  if (process.env.DEMO_MODE === 'true') {
    return { feeAmount: 0, banApplied: false };
  }
  if (lateMinutes < 30) {
    return { feeAmount: 0, banApplied: false };
  } else if (lateMinutes < 60) {
    return { feeAmount: 15, banApplied: false };
  } else if (lateMinutes < 90) {
    return { feeAmount: 35, banApplied: false };
  } else {
    return { feeAmount: 35, banApplied: true };
  }
}

export function looksLikeUuid(value: string): boolean {
  // Good enough for deciding whether to write staff_id; DB will still enforce UUID shape.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
