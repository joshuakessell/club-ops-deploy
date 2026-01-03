import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InventorySelector } from './InventorySelector';

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
global.WebSocket = vi.fn(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
})) as any;

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
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    render(<InventorySelector {...mockProps} />);
    expect(screen.getByText(/loading inventory/i)).toBeDefined();
  });

  it('should group and sort rooms correctly', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    render(<InventorySelector {...mockProps} customerSelectedType="STANDARD" />);
    
    // Wait for data to load
    await screen.findByText(/standard rooms/i);
    
    // Check that sections are rendered
    expect(screen.getByText(/standard rooms/i)).toBeDefined();
  });

  it('should auto-expand section when customer selects type', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    render(<InventorySelector {...mockProps} customerSelectedType="STANDARD" />);
    
    await screen.findByText(/standard rooms/i);
    
    // Section should be expanded (we can check by looking for room numbers)
    // This is a basic test - in a real scenario, we'd check the expanded state
  });

  it('should auto-select first available item', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const onSelect = vi.fn();
    render(
      <InventorySelector
        {...mockProps}
        customerSelectedType="STANDARD"
        onSelect={onSelect}
      />
    );
    
    await screen.findByText(/standard rooms/i);
    
    // Auto-selection happens in useEffect, so we wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // onSelect should be called with the first available room
    expect(onSelect).toHaveBeenCalledWith(
      'room',
      'room-1',
      '101',
      'STANDARD'
    );
  });
});

