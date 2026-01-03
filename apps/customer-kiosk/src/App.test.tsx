import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';

// Mock fetch and WebSocket
global.fetch = vi.fn();
let lastWs: any = null;
global.WebSocket = vi.fn(() => {
  lastWs = {
    onopen: null,
    onclose: null,
    onmessage: null,
    close: vi.fn(),
    send: vi.fn(),
  };
  return lastWs;
}) as unknown as typeof WebSocket;

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true });
    // Some environments expose localStorage only on window; App reads the global name.
    (globalThis as any).localStorage = storage;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/health')) {
        return { json: async () => ({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as any;
      }
      if (u.includes('/v1/inventory/available')) {
        return { json: async () => ({ rooms: {}, lockers: 0 }) } as any;
      }
      return { json: async () => ({}) } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders logo-only idle screen', () => {
    render(<App />);
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    expect(logo.className).toBe('logo-idle');
  });

  it('shows idle state when no session exists', () => {
    render(<App />);
    // Should show logo-only idle screen
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    expect(logo.className).toBe('logo-idle');
    // Should not show customer info
    expect(screen.queryByText(/Membership:/)).toBeNull();
  });

  it('never shows a payment decline reason (generic guidance only)', async () => {
    render(<App />);

    act(() => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: '123',
            allowedRentals: ['LOCKER'],
            customerPrimaryLanguage: 'EN',
            selectionConfirmed: true,
            paymentStatus: 'DUE',
            paymentTotal: 12.34,
            paymentFailureReason: 'CVV mismatch: 123',
          },
        }),
      });
    });

    // Payment screen should show total due
    expect(await screen.findByText('$12.34')).toBeDefined();

    // Generic customer-facing message is OK
    expect(screen.getByText(/please see attendant/i)).toBeDefined();

    // Decline reason must never be displayed to customer
    expect(screen.queryByText(/CVV mismatch/i)).toBeNull();
  });
});

