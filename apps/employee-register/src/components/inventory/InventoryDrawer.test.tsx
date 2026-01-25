import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InventoryDrawer } from './InventoryDrawer';

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket for useReconnectingWebSocket usage inside InventorySelector
type MockWebSocket = {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
};
global.WebSocket = vi.fn(
  () =>
    ({
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    }) satisfies MockWebSocket
) as unknown as typeof WebSocket;

describe('InventoryDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          rooms: [
            {
              id: 'room-101',
              number: '101',
              status: 'CLEAN',
              assignedTo: 'm1',
              assignedMemberName: 'John Smith',
              floor: 1,
              lastStatusChange: new Date().toISOString(),
              overrideFlag: false,
            },
            {
              id: 'room-216',
              number: '216',
              status: 'CLEAN',
              assignedTo: null,
              assignedMemberName: null,
              floor: 2,
              lastStatusChange: new Date().toISOString(),
              overrideFlag: false,
            },
            {
              id: 'room-102',
              number: '102',
              status: 'CLEAN',
              assignedTo: 'm2',
              assignedMemberName: 'Jane Doe',
              floor: 1,
              lastStatusChange: new Date().toISOString(),
              overrideFlag: false,
            },
          ],
          lockers: [
            {
              id: 'locker-001',
              number: '001',
              status: 'CLEAN',
              assignedTo: null,
              assignedMemberName: null,
            },
          ],
        }),
    });
  });

  it('only allows one section expanded at a time (Standard then Double collapses Standard)', async () => {
    render(<InventoryDrawer lane="lane-1" sessionToken="test-token" />);

    // Wait for inventory to load and render.
    await screen.findByText('Rentals');

    const standardBtn = screen.getByRole('button', { name: /Standard/i });
    const doubleBtn = screen.getByRole('button', { name: /Double/i });

    fireEvent.click(standardBtn);
    expect(await screen.findByText(/^101$/)).toBeDefined();
    expect(screen.queryByText(/^216$/)).toBeNull();

    fireEvent.click(doubleBtn);
    expect(await screen.findByText(/^216$/)).toBeDefined();
    expect(screen.queryByText(/^101$/)).toBeNull();
  });

  it('search filters by assignedMemberName (case-insensitive substring)', async () => {
    render(<InventoryDrawer lane="lane-1" sessionToken="test-token" />);
    await screen.findByText('Rentals');

    const search = screen.getByLabelText('Inventory search');
    fireEvent.change(search, { target: { value: 'smith' } });

    const standardBtn = screen.getByRole('button', { name: /Standard/i });
    fireEvent.click(standardBtn);

    expect(await screen.findByText(/^101$/)).toBeDefined();
    expect(screen.queryByText(/^102$/)).toBeNull();
  });

  it('search filters by number as well (typing 101 shows room 101)', async () => {
    render(<InventoryDrawer lane="lane-1" sessionToken="test-token" />);
    await screen.findByText('Rentals');

    const search = screen.getByLabelText('Inventory search');
    fireEvent.change(search, { target: { value: '101' } });

    const standardBtn = screen.getByRole('button', { name: /Standard/i });
    fireEvent.click(standardBtn);

    expect(await screen.findByText(/^101$/)).toBeDefined();
    expect(screen.queryByText(/^102$/)).toBeNull();
  });
});
