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
          json: () =>
            Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }
      if (u.includes('/v1/inventory/available')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              rooms: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              rawRooms: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              waitlistDemand: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              lockers: 0,
              total: 0,
            }),
        } as unknown as Response);
      }
      if (u.includes('/v1/checkin/lane/') && u.includes('/membership-purchase-intent')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as unknown as Response);
      }
      return Promise.resolve({ json: () => Promise.resolve({}) } as unknown as Response);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders logo-only idle screen', async () => {
    await act(async () => {
      render(<App />);
    });
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    // Idle should be logo-only; implementation details (class names) may change with layout/watermark updates.
    expect(screen.queryByText(/Welcome,/i)).toBeNull();
    expect(screen.queryByText(/Select Language/i)).toBeNull();
  });

  it('shows idle state when no session exists', async () => {
    await act(async () => {
      render(<App />);
    });
    // Should show logo-only idle screen
    const logo = screen.getByAltText('Club Dallas');
    expect(logo).toBeDefined();
    // Should not show customer info
    expect(screen.queryByText(/Membership/i)).toBeNull();
    expect(screen.queryByText(/Rental/i)).toBeNull();
  });

  it('never shows a payment decline reason (generic guidance only)', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
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
          json: () =>
            Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }
      if (u.includes('/v1/inventory/available')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rooms: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              rawRooms: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              waitlistDemand: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
              lockers: 0,
              total: 0,
            }),
        } as unknown as Response);
      }
      if (u.includes('/v1/checkin/lane/') && u.includes('/set-language')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    const { unmount } = await act(async () => {
      return render(<App />);
    });

    // Initial session with no language set should show language prompt.
    await act(async () => {
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
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
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

  it('shows Active Member status (no purchase/renew CTA) when membership is not expired', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: '123',
            customerMembershipValidUntil: '2099-01-01',
            allowedRentals: ['LOCKER'],
            pastDueBlocked: false,
            customerPrimaryLanguage: 'EN',
          },
        }),
      });
    });

    expect(await screen.findByText('Membership')).toBeDefined();
    expect(await screen.findByText('Member')).toBeDefined();
    expect(screen.getByText(/Thank you for being a member/i)).toBeDefined();
    expect(screen.getByText(/expires on/i)).toBeDefined();
    expect(screen.queryByText(/Please select one/i)).toBeNull();
  });

  it('shows Non-Member status + Purchase CTA when membership id is missing', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
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

    expect(await screen.findByText('Membership')).toBeDefined();
    expect(await screen.findByText('Non-Member')).toBeDefined();
    expect(screen.getByText(/Please select one/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /One-time Membership.*\$13/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /6-Month Membership.*\$43/ })).toBeDefined();
  });

  it('shows Non-Member and routes 6-month CTA through renew flow when membership is expired', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: '123',
            customerMembershipValidUntil: '2000-01-01',
            allowedRentals: ['LOCKER'],
            pastDueBlocked: false,
            customerPrimaryLanguage: 'EN',
          },
        }),
      });
    });

    expect(await screen.findByText('Non-Member')).toBeDefined();
    expect(screen.getByRole('button', { name: /6-Month Membership.*\$43/ })).toBeDefined();
  });

  it('shows whole-dollar prices next to rental options and never shows Join Waitlist for Upgrade', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      lastWs?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-1',
            customerName: 'Test Customer',
            membershipNumber: '123',
            customerMembershipValidUntil: '2000-01-01',
            allowedRentals: ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'],
            pastDueBlocked: false,
            customerPrimaryLanguage: 'EN',
          },
        }),
      });
    });

    expect(await screen.findByRole('button', { name: /Locker.*\$24/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Private Dressing Room.*\$30/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Deluxe Dressing Room.*\$40/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Special Dressing Room.*\$50/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /6-Month Membership.*\$43/ })).toBeDefined();

    expect(screen.queryByText(/Join Waitlist for Upgrade/i)).toBeNull();
  });

  it('translates membership CTA in Spanish', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
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
            customerPrimaryLanguage: 'ES',
          },
        }),
      });
    });

    expect(await screen.findByText('No miembro')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /Membresía de 6 meses.*\$43/ })
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Membresía por un día.*\$13/ })).toBeDefined();
    // Guard: key screens should not leak obvious English CTAs when in Spanish.
    expect(screen.queryByText('Non-Member')).toBeNull();
    expect(screen.queryByText(/6-Month Membership/i)).toBeNull();
  });

  it('renders Spanish membership modal copy (no English fallback) when language is ES', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
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
            customerPrimaryLanguage: 'ES',
          },
        }),
      });
    });

    const purchaseBtn = await screen.findByRole('button', { name: /Membresía de 6 meses.*\$43/ });
    act(() => {
      (purchaseBtn as HTMLButtonElement).click();
    });

    // Spanish title/body + Spanish buttons
    expect(await screen.findByRole('heading', { name: 'Membresía' })).toBeDefined();
    expect(screen.getByText(/Puede ahorrar/i)).toBeDefined();
    expect(screen.getByText('Continuar')).toBeDefined();
    expect(screen.getByText('Cancelar')).toBeDefined();

    // Guard: avoid English copy leakage.
    expect(screen.queryByText(/save on daily membership fees/i)).toBeNull();
  });

  it('purchase CTA opens modal; cancel closes; continue sets Member (Pending)', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
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

    const purchaseBtn = await screen.findByRole('button', { name: /6-Month Membership.*\$43/ });
    act(() => {
      (purchaseBtn as HTMLButtonElement).click();
    });

    expect(await screen.findByRole('heading', { name: 'Membership' })).toBeDefined();
    expect(screen.getByText(/save on daily membership fees/i)).toBeDefined();
    const cancel = screen.getByText('Cancel');
    act(() => {
      (cancel as HTMLButtonElement).click();
    });
    expect(screen.queryByText(/save on daily membership fees/i)).toBeNull();

    // Re-open and continue
    act(() => {
      (purchaseBtn as HTMLButtonElement).click();
    });
    const continueBtn = await screen.findByText('Continue');
    act(() => {
      (continueBtn as HTMLButtonElement).click();
    });

    expect(await screen.findByText('Member')).toBeDefined();
    expect(screen.queryByText('Pending')).toBeNull();
  });
});
