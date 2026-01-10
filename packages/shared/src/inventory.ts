export type RoomKind = 'STANDARD' | 'DELUXE' | 'SPECIAL';

export const LOCKER_NUMBERS: string[] = Array.from({ length: 108 }, (_, idx) =>
  String(idx + 1).padStart(3, '0')
);

// Nominal room range is 200..262 inclusive, but some rooms do NOT exist at all.
export const NONEXISTENT_ROOM_NUMBERS = [
  247, 249, 251, 253, 255, 257, 259, 261,
] as const;

export const DELUXE_ROOM_NUMBERS = [216, 218, 225, 252, 262] as const;
export const SPECIAL_ROOM_NUMBERS = [201, 232, 256] as const;

const NONEXISTENT_ROOM_SET = new Set<number>(NONEXISTENT_ROOM_NUMBERS);
const DELUXE_ROOM_SET = new Set<number>(DELUXE_ROOM_NUMBERS);
const SPECIAL_ROOM_SET = new Set<number>(SPECIAL_ROOM_NUMBERS);

export function isExistingRoomNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 200 && n <= 262 && !NONEXISTENT_ROOM_SET.has(n);
}

export function isDeluxeRoom(n: number): boolean {
  return DELUXE_ROOM_SET.has(n);
}

export function isSpecialRoom(n: number): boolean {
  return SPECIAL_ROOM_SET.has(n);
}

export function getRoomKind(n: number): RoomKind {
  if (!isExistingRoomNumber(n)) {
    throw new Error(`Invalid/non-existent room number: ${n}`);
  }
  if (isSpecialRoom(n)) return 'SPECIAL';
  if (isDeluxeRoom(n)) return 'DELUXE';
  return 'STANDARD';
}

export const ROOM_NUMBERS: number[] = Array.from({ length: 262 - 200 + 1 }, (_, i) => 200 + i).filter(
  isExistingRoomNumber
);

export const ROOMS: Array<{ number: number; kind: RoomKind }> = ROOM_NUMBERS.map((n) => ({
  number: n,
  kind: getRoomKind(n),
}));


