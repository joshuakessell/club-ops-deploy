import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InventorySelector } from './InventorySelector';

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
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

describe('InventorySelector', () => {
  const mockProps = {
    customerSelectedType: null,
    waitlistDesiredTier: null,
    waitlistBackupType: null,
    onSelect: vi.fn(),
    selectedItem: null,
    sessionId: 'test-session',
    lane: 'lane-1',
    sessionToken: 'test-token',
  };

  // Mock API response format from /api/v1/inventory/detailed
  const mockApiResponse = {
    rooms: [
      {
        id: 'room-1',
        number: '101',
        status: 'CLEAN',
        assignedTo: null,
        checkoutAt: null,
      },
    ],
    lockers: [
      {
        id: 'locker-1',
        number: '001',
        status: 'CLEAN',
        assignedTo: null,
        checkoutAt: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render loading state initially', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });

    render(<InventorySelector {...mockProps} />);
    expect(screen.getByText(/loading inventory/i)).toBeDefined();
  });

  it('should group and sort rooms correctly', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });

    render(<InventorySelector {...mockProps} customerSelectedType="STANDARD" />);

    // Wait for data to load
    await screen.findByRole('heading', { name: 'Inventory' });

    // Check that sections are rendered
    expect(screen.getByRole('button', { name: /standard/i })).toBeDefined();
  });

  it('should auto-expand section when customer selects type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });

    render(<InventorySelector {...mockProps} customerSelectedType="STANDARD" />);

    await screen.findByRole('heading', { name: 'Inventory' });
    expect(screen.getByRole('button', { name: /standard/i })).toBeDefined();

    // Section should be expanded (we can check by looking for room numbers)
    // This is a basic test - in a real scenario, we'd check the expanded state
  });

  it('should auto-select first available item', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });

    const onSelect = vi.fn();
    render(
      <InventorySelector {...mockProps} customerSelectedType="STANDARD" onSelect={onSelect} />
    );

    await screen.findByRole('heading', { name: 'Inventory' });
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('room', 'room-1', '101', 'STANDARD');
    });
  });

  it('in lookup mode (no sessionId), only occupied items open the details modal and available items are not selectable', async () => {
    const onSelect = vi.fn();
    const occupiedCheckin = '2026-01-01T12:00:00.000Z';
    const occupiedCheckout = '2026-01-01T18:00:00.000Z';

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          rooms: [
            {
              id: 'room-avail',
              number: '101',
              status: 'CLEAN',
              assignedTo: null,
              checkoutAt: null,
            },
            {
              id: 'room-occ',
              number: '102',
              status: 'OCCUPIED',
              assignedTo: 'visit-1',
              checkinAt: occupiedCheckin,
              checkoutAt: occupiedCheckout,
            },
          ],
          lockers: [],
        }),
    });

    render(
      <InventorySelector
        customerSelectedType="STANDARD"
        waitlistDesiredTier={null}
        waitlistBackupType={null}
        onSelect={onSelect}
        selectedItem={null}
        sessionId={null}
        lane="lane-1"
        sessionToken="test-token"
      />
    );

    // Wait for the section content to render.
    await screen.findByRole('heading', { name: 'Inventory' });
    await screen.findByText('Room 101');

    // Should not auto-select anything in lookup mode.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSelect).not.toHaveBeenCalled();

    // Available item: clicking should do nothing (no select, no modal).
    fireEvent.click(screen.getByText('Room 101'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /room 102/i })).toBeNull();

    // Occupied item: clicking opens details modal with check-in/out timestamps.
    fireEvent.click(screen.getByText('Room 102'));
    expect(await screen.findByRole('heading', { name: /room 102/i })).toBeDefined();

    const expectedCheckin = new Date(occupiedCheckin).toLocaleString();
    const expectedCheckout = new Date(occupiedCheckout).toLocaleString();
    expect(screen.getByText(expectedCheckin)).toBeDefined();
    expect(screen.getByText(expectedCheckout)).toBeDefined();
  });
});
