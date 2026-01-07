import { describe, it, expect } from 'vitest';
import { generateDemoData } from '../src/db/demo-data.js';
import { RoomStatus, RoomType, RentalType } from '@club-ops/shared';
import { calculatePriceQuote } from '../src/pricing/engine.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const mockRooms = [
  { id: 'room-1', number: '101', type: RoomType.STANDARD, status: RoomStatus.CLEAN },
  { id: 'room-2', number: '102', type: RoomType.STANDARD, status: RoomStatus.CLEAN },
  { id: 'room-3', number: '201', type: RoomType.SPECIAL, status: RoomStatus.CLEAN },
  { id: 'room-4', number: '216', type: RoomType.DOUBLE, status: RoomStatus.CLEAN },
  { id: 'room-5', number: '225', type: RoomType.DOUBLE, status: RoomStatus.CLEAN },
  { id: 'room-6', number: '232', type: RoomType.SPECIAL, status: RoomStatus.CLEANING },
  { id: 'room-7', number: '104', type: RoomType.STANDARD, status: RoomStatus.DIRTY },
  { id: 'room-8', number: '105', type: RoomType.STANDARD, status: RoomStatus.CLEAN },
] as const;

const mockLockers = Array.from({ length: 20 }, (_, idx) => ({
  id: `locker-${idx + 1}`,
  number: String(idx + 1).padStart(3, '0'),
  status: RoomStatus.CLEAN,
}));

function weekKey(date: Date): string {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

describe('demo seed generator', () => {
  const now = new Date('2024-12-31T12:00:00Z');
  const demo = generateDemoData({
    now,
    rooms: [...mockRooms],
    lockers: mockLockers,
    minCustomers: 120,
    maxCustomers: 120,
  });

  it('produces 100-200 customers', () => {
    expect(demo.customers.length).toBeGreaterThanOrEqual(100);
    expect(demo.customers.length).toBeLessThanOrEqual(200);
  });

  it('uses curated male names (no random gender mix)', () => {
    const sample = demo.customers.slice(0, 5).map((c) => c.name);
    sample.forEach((name) => {
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    });
  });

  it('creates check-in blocks in 6-hour multiples', () => {
    for (const visit of demo.visits) {
      for (const block of visit.blocks) {
        const duration = block.ends_at.getTime() - block.starts_at.getTime();
        expect(duration % SIX_HOURS_MS).toBe(0);
      }
    }
  });

  it('limits visits to 3 starts per week per customer and no overlaps', () => {
    const visitsByCustomer = new Map<string, typeof demo.visits>();
    for (const visit of demo.visits) {
      const list = visitsByCustomer.get(visit.customer_id) ?? [];
      list.push(visit);
      visitsByCustomer.set(visit.customer_id, list);
    }

    for (const [, visits] of visitsByCustomer) {
      visits.sort((a, b) => a.started_at.getTime() - b.started_at.getTime());

      const weekCounts = new Map<string, number>();
      let lastEnd: Date | null = null;

      for (const visit of visits) {
        const wk = weekKey(visit.started_at);
        weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
        expect(weekCounts.get(wk)).toBeLessThanOrEqual(3);

        const visitEnd = visit.ended_at ?? visit.blocks[visit.blocks.length - 1]!.ends_at;
        if (lastEnd) {
          expect(visit.started_at.getTime()).toBeGreaterThanOrEqual(lastEnd.getTime());
        }
        lastEnd = visitEnd;
      }
    }
  });

  it('creates a waitlist long enough to show "More.."', () => {
    expect(demo.waitlistEntries.length).toBeGreaterThanOrEqual(7);
  });

  it('does not surface any late room charge line items in demo pricing', () => {
    const rentals = [
      RentalType.LOCKER,
      RentalType.GYM_LOCKER,
      RentalType.STANDARD,
      RentalType.DOUBLE,
      RentalType.SPECIAL,
    ];

    for (const rentalType of rentals) {
      const quote = calculatePriceQuote({
        rentalType,
        checkInTime: now,
        customerAge: 30,
      });
      expect(
        quote.lineItems.some((li) => li.description.toLowerCase().includes('late'))
      ).toBe(false);
    }
  });
});

