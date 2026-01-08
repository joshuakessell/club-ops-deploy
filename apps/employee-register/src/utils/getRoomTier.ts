const SPECIAL_ROOMS = new Set([201, 232, 256]);
const DOUBLE_ROOMS = new Set([216, 218, 232, 252, 256, 262, 225]);

export type RoomTier = 'STANDARD' | 'DOUBLE' | 'SPECIAL';

export function getRoomTier(roomNumber: string): RoomTier {
  const numeric = parseInt(roomNumber, 10);
  if (SPECIAL_ROOMS.has(numeric)) {
    return 'SPECIAL';
  }
  if (DOUBLE_ROOMS.has(numeric)) {
    return 'DOUBLE';
  }
  return 'STANDARD';
}

