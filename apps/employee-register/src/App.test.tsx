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

  it('renders lock screen when not authenticated', () => {
    act(() => {
      render(<App />);
    });
    // When not authenticated, LockScreen is shown instead of the main app
    // The LockScreen component should be rendered
    expect(screen.queryByText('Employee Register')).toBeNull();
  });

  it('renders the register header when authenticated', async () => {
    // Mock a signed-in register + staff session
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
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
    expect(await screen.findByText('Employee Register')).toBeDefined();
  });

  it('shows lane session section when authenticated', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
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
    expect(await screen.findByText('Scan Now')).toBeDefined();
  });

  it('updates agreement status when receiving SESSION_UPDATED with agreementSigned=true', async () => {
    const STEP_TIMEOUT_MS = 1000;
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
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
    expect(
      await screen.findByText('Scan Now', undefined, { timeout: STEP_TIMEOUT_MS })
    ).toBeDefined();

    // Wait until App has attached its onmessage handler, then simulate an agreement-signed update.
    // React StrictMode can create multiple WS instances; use the one that has the handler attached.
    let wsWithHandler: MockWebSocket | null = null;
    // Fail fast if no websocket instance was created; retry loops can hang if timers are misbehaving.
    expect(createdWs.length).toBeGreaterThan(0);
    wsWithHandler = createdWs.find((w) => w.url.includes('lane=lane-1')) ?? createdWs[0] ?? null;
    expect(wsWithHandler).not.toBeNull();

    act(() => {
      wsWithHandler?.onmessage?.({
        data: JSON.stringify({
          type: 'SESSION_UPDATED',
          timestamp: new Date().toISOString(),
          payload: {
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            membershipNumber: '700001',
            allowedRentals: ['LOCKER'],
            agreementSigned: true,
          },
        }),
      });
    });
    expect(
      await screen.findByText('Customer Profile', undefined, { timeout: STEP_TIMEOUT_MS })
    ).toBeDefined();
  });

  it('shows transaction completion modal (with PDF verify + complete) after assignment + agreement signed', async () => {
    localStorage.setItem(
      'staff_session',
      JSON.stringify({
        staffId: 'staff-1',
        sessionToken: 'test-token',
        name: 'Test User',
        role: 'STAFF',
      })
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL) => {
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
    expect(await screen.findByText('Scan Now')).toBeDefined();

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
            agreementSigned: true,
            selectionConfirmed: true,
            paymentStatus: 'PAID',
            assignedResourceType: 'locker',
            assignedResourceNumber: '012',
            checkoutAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Transaction Ready')).toBeDefined();
      expect(screen.getByText('Verify agreement PDF + signature saved')).toBeDefined();
      expect(screen.getByText('Complete Transaction')).toBeDefined();
    });

    // Overlay should exist (blocks clicks on underlying UI)
    expect(document.querySelector('.er-txn-complete-modal__overlay')).not.toBeNull();
  });
});
