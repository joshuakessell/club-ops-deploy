import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';

// Mock fetch and WebSocket
global.fetch = vi.fn();
type MockWebSocket = {
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onmessage: ((ev: { data: string }) => unknown) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
let lastWs: MockWebSocket | null = null;
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
    Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : '';
      if (u.includes('/health')) {
        return Promise.resolve({
          json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }
      if (u.includes('/v1/inventory/available')) {
        return Promise.resolve({ json: () => Promise.resolve({ rooms: {}, lockers: 0 }) } as unknown as Response);
      }
      return Promise.resolve({ json: () => Promise.resolve({}) } as unknown as Response);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders logo-only idle screen', () => {
    render(<App />);
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    // Idle should be logo-only; implementation details (class names) may change with layout/watermark updates.
    expect(screen.queryByText(/Welcome,/i)).toBeNull();
    expect(screen.queryByText(/Select Language/i)).toBeNull();
  });

  it('shows idle state when no session exists', () => {
    render(<App />);
    // Should show logo-only idle screen
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    // Should not show customer info
    expect(screen.queryByText(/Membership:/)).toBeNull();
    expect(screen.queryByText(/Choose your experience/i)).toBeNull();
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

  it('persists language: after set-language, reload does not show language prompt again', async () => {
    // Make set-language succeed
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : '';
      if (u.includes('/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }
      if (u.includes('/v1/inventory/available')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ rooms: {}, lockers: 0 }) } as unknown as Response);
      }
      if (u.includes('/v1/checkin/lane/') && u.includes('/set-language')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    const { unmount } = render(<App />);

    // Initial session with no language set should show language prompt.
    act(() => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: null,
            allowedRentals: ['LOCKER'],
            pastDueBlocked: false,
            // customerPrimaryLanguage intentionally omitted
          },
        }),
      });
    });

    expect(await screen.findByText(/select language/i)).toBeDefined();

    // Select English.
    const englishBtn = await screen.findByText(/english/i);
    act(() => {
      (englishBtn as HTMLButtonElement).click();
    });

    // Server broadcasts updated session with language set; kiosk should not show language prompt.
    act(() => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: null,
            allowedRentals: ['LOCKER'],
            pastDueBlocked: false,
            customerPrimaryLanguage: 'EN',
          },
        }),
      });
    });

    expect(screen.queryByText(/select language/i)).toBeNull();

    // "Reload": unmount + remount. When the same customer/session arrives with language already set,
    // the language prompt must not reappear.
    unmount();
    render(<App />);
    act(() => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: null,
            allowedRentals: ['LOCKER'],
            pastDueBlocked: false,
            customerPrimaryLanguage: 'EN',
          },
        }),
      });
    });

    expect(screen.queryByText(/select language/i)).toBeNull();
  });
});

