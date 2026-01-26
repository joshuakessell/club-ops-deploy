import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
let App: (typeof import('./App'))['default'];

// Mock WebSocket
type MockWebSocket = {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onmessage: ((ev: { data: string }) => unknown) | null;
  addEventListener: (
    type: 'open' | 'close' | 'message' | 'error',
    handler: (ev: unknown) => void
  ) => void;
  removeEventListener: (
    type: 'open' | 'close' | 'message' | 'error',
    handler: (ev: unknown) => void
  ) => void;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
const createdWs: MockWebSocket[] = [];
const WebSocketMock = vi.fn((url?: string) => {
  const listeners: Record<'open' | 'close' | 'message' | 'error', Array<(ev: unknown) => void>> = {
    open: [],
    close: [],
    message: [],
    error: [],
  };

  let assignedOnMessage: ((ev: { data: string }) => unknown) | null = null;

  const ws: MockWebSocket = {
    url: typeof url === 'string' ? url : 'ws://test/ws',
    readyState: 0,
    // Always provide dispatchers so tests can locate the instance and trigger events.
    onopen: (ev) => {
      ws.readyState = 1;
      for (const fn of listeners.open) fn(ev);
    },
    onclose: (ev) => {
      ws.readyState = 3;
      for (const fn of listeners.close) fn(ev);
    },
    onmessage: null,
    addEventListener: vi.fn(
      (type: 'open' | 'close' | 'message' | 'error', handler: (ev: unknown) => void) => {
        listeners[type].push(handler);
      }
    ),
    removeEventListener: vi.fn(
      (type: 'open' | 'close' | 'message' | 'error', handler: (ev: unknown) => void) => {
        listeners[type] = listeners[type].filter((h) => h !== handler);
      }
    ),
    close: vi.fn(),
    send: vi.fn(),
  };

  // Keep `.onmessage` usable by tests even if production code overwrites it:
  // calling `ws.onmessage(...)` should dispatch to both the assigned handler and any addEventListener handlers.
  Object.defineProperty(ws, 'onmessage', {
    configurable: true,
    get() {
      return (ev: { data: string }) => {
        assignedOnMessage?.(ev);
        for (const fn of listeners.message) fn(ev);
      };
    },
    set(fn: ((ev: { data: string }) => unknown) | null) {
      assignedOnMessage = fn;
    },
  });

  createdWs.push(ws);
  return ws;
}) as unknown as typeof WebSocket;
(
  WebSocketMock as unknown as { OPEN: number; CONNECTING: number; CLOSING: number; CLOSED: number }
).OPEN = 1;
(
  WebSocketMock as unknown as { OPEN: number; CONNECTING: number; CLOSING: number; CLOSED: number }
).CONNECTING = 0;
(
  WebSocketMock as unknown as { OPEN: number; CONNECTING: number; CLOSING: number; CLOSED: number }
).CLOSING = 2;
(
  WebSocketMock as unknown as { OPEN: number; CONNECTING: number; CLOSING: number; CLOSED: number }
).CLOSED = 3;
Object.defineProperty(globalThis, 'WebSocket', {
  value: WebSocketMock,
  configurable: true,
  writable: true,
});
Object.defineProperty(window, 'WebSocket', {
  value: WebSocketMock,
  configurable: true,
  writable: true,
});
Object.defineProperty(global, 'WebSocket', {
  value: WebSocketMock,
  configurable: true,
  writable: true,
});

// Mock fetch
global.fetch = vi.fn();

describe('App', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Prevent cross-test contamination from module singletons (event buses, cached clients, etc).
    // This also helps avoid memory growth across the suite.
    vi.resetModules();
    vi.useRealTimers();
    createdWs.length = 0;
    const store: Record<string, string> = {};
    const storage = {
      getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
    };
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true });
    localStorage.clear();
    // Ensure lane-scoped realtime wiring uses a stable lane id in tests.
    sessionStorage.setItem('lane', 'lane-1');

    // Ensure the shared WS guard does not leak singletons across tests.
    try {
      const shared = await import('@club-ops/shared');
      shared.closeLaneSessionClient('lane-1', 'employee');
      shared.closeLaneSessionClient('', 'employee');
    } catch {
      // ignore
    }
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
    });

    // Tests rely on realtime handlers; the app now fail-fast disables WS init without a kiosk token.
    try {
      const current = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
      Object.defineProperty(import.meta, 'env', {
        value: { ...current, VITE_KIOSK_TOKEN: 'test-kiosk-token' },
        configurable: true,
      });
    } catch {
      // ignore
    }

    // Import after env + WebSocket mocks are in place (Vite can inline import.meta.env at load time).
    App = (await import('./App')).default;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    createdWs.length = 0;
  });

  it('shows customer suggestions at 3+ characters and confirm triggers session', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const u =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : url instanceof Request
                ? url.url
                : '';

        if (u.includes('/v1/registers/status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                signedIn: true,
                employee: { id: 'emp-1', name: 'Test Employee' },
                registerNumber: 1,
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/customers/search')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                suggestions: [
                  {
                    id: 'c0ffee00-0000-4000-8000-000000000001',
                    name: 'Alex Rivera',
                    firstName: 'Alex',
                    lastName: 'Rivera',
                    dobMonthDay: '03/14',
                    membershipNumber: '700001',
                    disambiguator: '0001',
                  },
                ],
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/checkin/lane/lane-1/start')) {
          expect(init?.method).toBe('POST');
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sessionId: 'session-123',
                customerName: 'Alex Rivera',
                membershipNumber: '700001',
              }),
          } as unknown as Response);
        }

        if (u.includes('/health')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
          } as unknown as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
    );

    act(() => {
      render(<App />);
    });

    const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
    act(() => {
      fireEvent.click(searchTab);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });

    // Allow debounced search to fire
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const suggestion = await screen.findByText(/Rivera, Alex/);
    act(() => {
      fireEvent.click(suggestion);
    });

    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });
  });

  it('Customer Account: if customer is already checked in, shows inline status (no modal)', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const u =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : url instanceof Request
                ? url.url
                : '';

        if (u.includes('/v1/registers/status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                signedIn: true,
                employee: { id: 'emp-1', name: 'Test Employee' },
                registerNumber: 1,
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/customers/search')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                suggestions: [
                  {
                    id: 'c0ffee00-0000-4000-8000-000000000001',
                    name: 'Alex Rivera',
                    firstName: 'Alex',
                    lastName: 'Rivera',
                    dobMonthDay: '03/14',
                    membershipNumber: '700001',
                    disambiguator: '0001',
                  },
                ],
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/checkin/lane/lane-1/start')) {
          expect(init?.method).toBe('POST');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                code: 'ALREADY_CHECKED_IN',
                alreadyCheckedIn: true,
                activeCheckin: {
                  visitId: 'visit-1',
                  rentalType: 'LOCKER',
                  assignedResourceType: 'locker',
                  assignedResourceNumber: '012',
                  checkinAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                  checkoutAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
                  overdue: false,
                  waitlist: null,
                },
              }),
          } as unknown as Response);
        }

        if (u.includes('/health')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
          } as unknown as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
    );

    act(() => {
      render(<App />);
    });

    const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
    act(() => {
      fireEvent.click(searchTab);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const suggestion = await screen.findByText(/Rivera, Alex/);
    act(() => {
      fireEvent.click(suggestion);
    });

    expect(await screen.findByText('Currently Checked In')).toBeDefined();
    expect(screen.queryByText('Already Checked In')).toBeNull();
    expect(screen.queryByText('Customer Profile')).toBeNull();
  });

  it('checkout from already visiting customer returns to scan and clears account', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : '';

      if (u.includes('/v1/registers/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              signedIn: true,
              employee: { id: 'emp-1', name: 'Test Employee' },
              registerNumber: 1,
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/registers/heartbeat')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }

      if (u.includes('/v1/customers/search')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              suggestions: [
                {
                  id: 'c0ffee00-0000-4000-8000-000000000001',
                  name: 'Alex Rivera',
                  firstName: 'Alex',
                  lastName: 'Rivera',
                  dobMonthDay: '03/14',
                  membershipNumber: '700001',
                  disambiguator: '0001',
                },
              ],
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/start')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              code: 'ALREADY_CHECKED_IN',
              alreadyCheckedIn: true,
              activeCheckin: {
                visitId: 'visit-1',
                rentalType: 'LOCKER',
                assignedResourceType: 'locker',
                assignedResourceNumber: '012',
                checkinAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                checkoutAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
                overdue: false,
                waitlist: null,
              },
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkout/manual-resolve')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              occupancyId: 'occ-1',
              resourceType: 'LOCKER',
              number: '012',
              customerName: 'Alex Rivera',
              checkinAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
              scheduledCheckoutAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
              lateMinutes: 0,
              fee: 0,
              banApplied: false,
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkout/manual-complete')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ alreadyCheckedOut: false }),
        } as unknown as Response);
      }

      if (u.includes('/health')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    });

    act(() => {
      render(<App />);
    });

    const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
    act(() => {
      fireEvent.click(searchTab);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const suggestion = await screen.findByText(/Rivera, Alex/);
    act(() => {
      fireEvent.click(suggestion);
    });

    expect(await screen.findByText('Currently Checked In')).toBeDefined();
    const accountPanel = document.querySelector('.er-account-already-visiting');
    expect(accountPanel).not.toBeNull();

    const checkoutButton = within(accountPanel as HTMLElement).getByRole('button', {
      name: 'Checkout',
    });
    act(() => {
      fireEvent.click(checkoutButton);
    });

    const completeButton = await screen.findByRole('button', { name: /Complete checkout/i });
    act(() => {
      fireEvent.click(completeButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Scan Now')).toBeDefined();
    });
    expect(screen.queryByText('Customer Profile')).toBeNull();
    expect(document.querySelector('.er-account-already-visiting')).toBeNull();
  });

  it('double tap on same proposal forces selection (to payment)', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    let proposedRental: string | null = null;

    fetchMock.mockImplementation((url: RequestInfo | URL, _init?: RequestInit) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : '';

      if (u.includes('/v1/registers/status')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              signedIn: true,
              employee: { id: 'emp-1', name: 'Test Employee' },
              registerNumber: 1,
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/customers/search')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              suggestions: [
                {
                  id: 'c0ffee00-0000-4000-8000-000000000001',
                  name: 'Alex Rivera',
                  firstName: 'Alex',
                  lastName: 'Rivera',
                  dobMonthDay: '03/14',
                  membershipNumber: '700001',
                  disambiguator: '0001',
                },
              ],
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/start')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'session-123',
              customerName: 'Alex Rivera',
              membershipNumber: '700001',
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/session-snapshot')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              session: {
                sessionId: 'session-123',
                customerName: 'Alex Rivera',
                membershipNumber: '700001',
                allowedRentals: ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'],
                customerPrimaryLanguage: 'EN',
                membershipChoice: 'ONE_TIME',
                selectionConfirmed: false,
                proposedRentalType: proposedRental ?? undefined,
                proposedBy: proposedRental ? 'EMPLOYEE' : undefined,
              },
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/propose-selection')) {
        proposedRental = 'LOCKER';
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/confirm-selection')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              sessionId: 'session-123',
              rentalType: 'STANDARD',
              confirmedBy: 'EMPLOYEE',
            }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/create-payment-intent')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              paymentIntentId: 'pi-123',
              quote: { total: 10, lineItems: [], messages: [] },
            }),
        } as unknown as Response);
      }

      if (u.includes('/health')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    act(() => {
      render(<App />);
    });

    const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
    act(() => {
      fireEvent.click(searchTab);
    });
    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const suggestion = await screen.findByText(/Rivera, Alex/);
    act(() => {
      fireEvent.click(suggestion);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });

    // The app auto-switches to Scan tab when a session becomes active.
    await waitFor(() => {
      expect(screen.getByText('Customer Profile')).toBeDefined();
    });

    // Simulate kiosk prerequisites already resolved (language + membership choice) so we land on RENTAL step.
    // React StrictMode can create multiple WS instances; use the one that has the handler attached.
    let wsWithHandler: MockWebSocket | null = null;
    await waitFor(() => {
      expect(createdWs.length).toBeGreaterThan(0);
      wsWithHandler = createdWs.find((w) => w.url.includes('lane=lane-1')) ?? createdWs[0] ?? null;
      expect(wsWithHandler).not.toBeNull();
    });

    act(() => {
      wsWithHandler?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            allowedRentals: ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'],
            customerPrimaryLanguage: 'EN',
            membershipChoice: 'ONE_TIME',
            selectionConfirmed: false,
          },
        }),
      });
    });

    const proposeLocker = await screen.findByRole('button', { name: /Propose Locker/i });
    act(() => {
      fireEvent.click(proposeLocker); // first tap highlights
    });

    // Server snapshot updates with the proposed rental so we can confirm it.
    act(() => {
      wsWithHandler?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            allowedRentals: ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'],
            customerPrimaryLanguage: 'EN',
            membershipChoice: 'ONE_TIME',
            selectionConfirmed: false,
            proposedRentalType: 'LOCKER',
            proposedBy: 'EMPLOYEE',
          },
        }),
      });
    });

    await waitFor(() => {
      expect(proposeLocker).toHaveProperty('disabled', false);
    });

    act(() => {
      fireEvent.click(proposeLocker); // second tap confirms selection
    });

    // Confirmation triggers /confirm-selection and then payment intent creation.
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/v1/checkin/lane/lane-1/confirm-selection'))).toBe(true);
      expect(urls.some((u) => u.includes('/v1/checkin/lane/lane-1/create-payment-intent'))).toBe(
        true
      );
    });
  });

  it('keeps upgrades/waitlist accessible even when a check-in session is active', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const u =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : url instanceof Request
                ? url.url
                : '';

        if (u.includes('/v1/registers/status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                signedIn: true,
                employee: { id: 'emp-1', name: 'Test Employee' },
                registerNumber: 1,
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/customers/search')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                suggestions: [
                  {
                    id: 'c0ffee00-0000-4000-8000-000000000001',
                    name: 'Alex Rivera',
                    firstName: 'Alex',
                    lastName: 'Rivera',
                    membershipNumber: '700001',
                    disambiguator: '0001',
                  },
                ],
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/checkin/lane/lane-1/start')) {
          expect(init?.method).toBe('POST');
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sessionId: 'session-123',
                customerName: 'Alex Rivera',
                membershipNumber: '700001',
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/waitlist')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                entries: [
                  {
                    id: 'wait-1',
                    visitId: 'visit-1',
                    checkinBlockId: 'block-1',
                    desiredTier: 'DOUBLE',
                    backupTier: 'STANDARD',
                    status: 'ACTIVE',
                    createdAt: new Date().toISOString(),
                    checkinAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                    checkoutAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
                    displayIdentifier: '218',
                    currentRentalType: 'STANDARD',
                    customerName: 'Test Customer',
                  },
                ],
              }),
          } as unknown as Response);
        }

        if (u.includes('/v1/inventory/available')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                rooms: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
                rawRooms: { SPECIAL: 0, DOUBLE: 1, STANDARD: 0 },
                waitlistDemand: { SPECIAL: 0, DOUBLE: 0, STANDARD: 0 },
                lockers: 0,
                total: 0,
              }),
          } as unknown as Response);
        }

        if (u.includes('/health')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
          } as unknown as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
    );

    act(() => {
      render(<App />);
    });

    const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
    act(() => {
      fireEvent.click(searchTab);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const suggestion = await screen.findByText(/Rivera, Alex/);
    act(() => {
      fireEvent.click(suggestion);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });

    // Upgrades now live in the left drawer; they should remain accessible during an active session.
    const upgradesTab = await screen.findByRole('button', { name: 'Upgrades' });
    act(() => {
      fireEvent.click(upgradesTab);
    });

    expect(await screen.findByText(/Upgrade Waitlist/i)).toBeDefined();
    expect(
      screen.queryByText(/Active session present — waitlist actions are disabled/i)
    ).toBeNull();

    const offerUpgrade = await screen.findByRole('button', { name: 'Offer Upgrade' });
    expect(offerUpgrade).toHaveProperty('disabled', false);
  });

  it('First Time Customer: if identity matches an existing customer, prompts and allows loading existing customer', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    const calls: Array<{ url: string; body?: unknown }> = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const u =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : url instanceof Request
                ? url.url
                : '';

        let body: unknown = undefined;
        if (typeof init?.body === 'string') {
          body = JSON.parse(init.body) as unknown;
        }
        calls.push({ url: u, body });

        if (u.includes('/v1/registers/status')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                signedIn: true,
                employee: { id: 'emp-1', name: 'Test Employee' },
                registerNumber: 1,
              }),
          } as unknown as Response);
        }
        if (u.includes('/health')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
          } as unknown as Response);
        }
        if (u.includes('/v1/customers/match-identity')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                matchCount: 1,
                bestMatch: {
                  id: 'cust-1',
                  name: 'John Smith',
                  dob: '1988-01-02',
                  membershipNumber: null,
                },
              }),
          } as unknown as Response);
        }
        if (u.includes('/v1/checkin/lane/lane-1/start')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                sessionId: 'sess-1',
                customerName: 'John Smith',
                membershipNumber: null,
              }),
          } as unknown as Response);
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
    );

    act(() => {
      render(<App />);
    });

    // Open manual entry
    const manualEntryTab = await screen.findByRole('button', { name: /Manual Entry/i });
    fireEvent.click(manualEntryTab);
    expect(await screen.findByText(/First Time Customer/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'John' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Smith' } });
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), { target: { value: '01021988' } });

    const addBtn = screen.getByRole('button', { name: /Add Customer/i });
    expect(addBtn).toHaveProperty('disabled', false);

    fireEvent.click(addBtn);

    // Prompt appears
    expect(await screen.findByRole('heading', { name: /Existing customer found/i })).toBeDefined();
    expect(screen.getByText(/John Smith/i)).toBeDefined();

    // Choose existing customer
    fireEvent.click(screen.getByRole('button', { name: /Existing Customer/i }));

    await waitFor(() => {
      const startCall = calls.find((c) => c.url.includes('/v1/checkin/lane/lane-1/start'));
      expect(startCall).toBeDefined();
      const b = startCall?.body;
      expect(b).toBeDefined();
      if (!b || typeof b !== 'object' || !('customerId' in b)) {
        throw new Error('Expected start call body to include customerId');
      }
      expect((b as { customerId?: unknown }).customerId).toBe('cust-1');
    });
  });
});
