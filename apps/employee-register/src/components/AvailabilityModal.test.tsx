import { describe, expect, it } from 'vitest';
import { RoomStatus } from '@club-ops/shared';
import { sortInventoryItems, type AvailabilityInventoryItem } from './AvailabilityModal';

describe('sortInventoryItems', () => {
  it('orders items by availability groups and checkout timestamps', () => {
    const items: AvailabilityInventoryItem[] = [
      {
        id: 'locker-1',
        number: '305',
        kind: 'room',
        status: RoomStatus.CLEAN,
      },
      {
        id: 'room-cleaning',
        number: '101',
        kind: 'room',
        status: RoomStatus.CLEANING,
      },
      {
        id: 'room-dirty',
        number: '104',
        kind: 'room',
        status: RoomStatus.DIRTY,
      },
      {
        id: 'room-occupied-soon',
        number: '215',
        kind: 'room',
        status: RoomStatus.OCCUPIED,
        assignedTo: 'staff',
        checkoutAt: '2026-01-09T10:00:00Z',
      },
      {
        id: 'room-occupied-later',
        number: '210',
        kind: 'room',
        status: RoomStatus.OCCUPIED,
        assignedTo: 'staff',
        checkoutAt: '2026-01-10T10:00:00Z',
      },
      {
        id: 'room-occupied-no-checkout',
        number: '220',
        kind: 'room',
        status: RoomStatus.OCCUPIED,
        assignedTo: 'staff',
      },
    ];

    const sorted = sortInventoryItems(items);
    expect(sorted.map((item) => item.number)).toEqual(['305', '101', '104', '215', '210', '220']);
  });
});

