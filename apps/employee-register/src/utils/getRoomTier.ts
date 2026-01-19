import { getRoomTierFromNumber } from '@club-ops/shared';

export type RoomTier = 'STANDARD' | 'DOUBLE' | 'SPECIAL';

export function getRoomTier(roomNumber: string): RoomTier {
  const numeric = parseInt(roomNumber, 10);
  try {
    return getRoomTierFromNumber(numeric);
  } catch {
    // In some UI contexts/tests we may be given non-contract room numbers (e.g. "101").
    // Treat unknown rooms as STANDARD for display tiering.
    return 'STANDARD';
  }
}

