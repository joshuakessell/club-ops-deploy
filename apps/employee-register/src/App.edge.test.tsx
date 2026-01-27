import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
let App: (typeof import('./App'))['default'];

// Mock WebSocket
// Copied from App.flow.test.tsx to keep WS behavior consistent across suites.
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

const SEARCH_DEBOUNCE_MS = 250;

function toUrlString(url: RequestInfo | URL) {
  return typeof url === 'string'
    ? url
    : url instanceof URL
      ? url.toString()
      : url instanceof Request
        ? url.url
        : '';
}

function mockAuthenticatedFetch() {
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
    const u = toUrlString(url);

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

    if (u.includes('/api/v1/inventory/detailed')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rooms: [] }),
      } as unknown as Response);
    }

    if (u.includes('/api/v1/checkout/manual-candidates')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ candidates: [] }),
      } as unknown as Response);
    }

    if (u.includes('/health')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
      } as unknown as Response);
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as unknown as Response);
  });
}

async function openAccountViaSearch() {
  const searchTab = await screen.findByRole('button', { name: 'Search Customer' });
  act(() => {
    fireEvent.click(searchTab);
  });

  const searchInput = await screen.findByPlaceholderText('Start typing name...');
  act(() => {
    fireEvent.change(searchInput, { target: { value: 'Ale' } });
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS));
  });

  const suggestion = await screen.findByText(/Rivera, Alex/);
  act(() => {
    fireEvent.click(suggestion);
  });

  expect(await screen.findByText('Customer Profile')).toBeDefined();
  expect(await screen.findByText('Alex Rivera')).toBeDefined();
}

describe('App edge flows', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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
    sessionStorage.setItem('lane', 'lane-1');

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

    try {
      const current = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
      Object.defineProperty(import.meta, 'env', {
        value: { ...current, VITE_KIOSK_TOKEN: 'test-kiosk-token' },
        configurable: true,
      });
    } catch {
      // ignore
    }

    App = (await import('./App')).default;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    createdWs.length = 0;
  });

  it('keeps the active account after jumping to Room Cleaning and back', async () => {
    mockAuthenticatedFetch();

    act(() => {
      render(<App />);
    });

    await openAccountViaSearch();

    const roomCleaningTab = await screen.findByRole('button', { name: 'Room Cleaning' });
    act(() => {
      fireEvent.click(roomCleaningTab);
    });

    expect(await screen.findByText('Select rooms to begin or finish cleaning')).toBeDefined();

    const accountTab = screen.getByRole('button', { name: 'Customer Account' });
    act(() => {
      fireEvent.click(accountTab);
    });

    expect(await screen.findByText('Customer Profile')).toBeDefined();
    expect(await screen.findByText('Alex Rivera')).toBeDefined();
  });

  it('keeps the active account after jumping to Checkout and back', async () => {
    mockAuthenticatedFetch();

    act(() => {
      render(<App />);
    });

    await openAccountViaSearch();

    const checkoutTab = await screen.findByRole('button', { name: 'Checkout' });
    act(() => {
      fireEvent.click(checkoutTab);
    });

    expect(await screen.findByPlaceholderText(/Enter room\/locker number/)).toBeDefined();

    const accountTab = screen.getByRole('button', { name: 'Customer Account' });
    act(() => {
      fireEvent.click(accountTab);
    });

    expect(await screen.findByText('Customer Profile')).toBeDefined();
    expect(await screen.findByText('Alex Rivera')).toBeDefined();
  });

  it('keeps the active account after jumping to Manual Entry and back', async () => {
    mockAuthenticatedFetch();

    act(() => {
      render(<App />);
    });

    await openAccountViaSearch();

    const manualEntryTab = await screen.findByRole('button', { name: 'Manual Entry' });
    act(() => {
      fireEvent.click(manualEntryTab);
    });

    expect(await screen.findByText('First Time Customer')).toBeDefined();

    const accountTab = screen.getByRole('button', { name: 'Customer Account' });
    act(() => {
      fireEvent.click(accountTab);
    });

    expect(await screen.findByText('Customer Profile')).toBeDefined();
    expect(await screen.findByText('Alex Rivera')).toBeDefined();
  });
});
