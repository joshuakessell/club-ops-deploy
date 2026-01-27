import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

// Mock WebSocket
const createMockWebSocket = () => {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    readyState: 1,
    close: vi.fn(),
    send: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const bucket = listeners.get(type) ?? new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      const bucket = listeners.get(type);
      if (!bucket) return;
      bucket.delete(listener);
      if (bucket.size === 0) {
        listeners.delete(type);
      }
    }),
  };
};

const mockWebSocket = vi.fn(() => createMockWebSocket()) as unknown as typeof WebSocket;
(mockWebSocket as any).CONNECTING = 0;
(mockWebSocket as any).OPEN = 1;
(mockWebSocket as any).CLOSING = 2;
(mockWebSocket as any).CLOSED = 3;

global.WebSocket = mockWebSocket;

// Mock fetch
global.fetch = vi.fn();

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure a Web Storage-like API exists in this environment.
    const store = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    window.localStorage.clear();

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      // Minimal happy-path mocks for the demo dashboard
      if (url.endsWith('/api/v1/auth/staff')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            staff: [
              { id: '1', name: 'Manager Club', role: 'ADMIN' },
              { id: '2', name: 'Front Desk', role: 'STAFF' },
            ],
          }),
        } as any;
      }
      if (url.endsWith('/api/v1/inventory/summary')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            byType: { STANDARD: { clean: 10, cleaning: 0, dirty: 0, total: 10 } },
            overall: { clean: 10, cleaning: 0, dirty: 0, total: 10 },
            lockers: { clean: 10, cleaning: 0, dirty: 0, total: 10 },
          }),
        } as any;
      }
      if (url.includes('/api/v1/metrics/waitlist')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            activeCount: 0,
            offeredCount: 0,
            averageWaitTimeMinutes: 0,
          }),
        } as any;
      }
      if (url.includes('/api/v1/admin/reports/cash-totals')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            date: '2026-01-01',
            total: 0,
            byPaymentMethod: { CASH: 0, CREDIT: 0 },
            byRegister: { 'Register 1': 0, 'Register 2': 0, Unassigned: 0 },
          }),
        } as any;
      }
      if (url.includes('/api/v1/admin/register-sessions')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [
            {
              registerNumber: 1,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
              secondsSinceHeartbeat: null,
            },
            {
              registerNumber: 2,
              active: false,
              sessionId: null,
              employee: null,
              deviceId: null,
              createdAt: null,
              lastHeartbeatAt: null,
              secondsSinceHeartbeat: null,
            },
          ],
        } as any;
      }
      if (url.includes('/api/v1/checkin/lane-sessions')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ sessions: [] }),
        } as any;
      }
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as any;
    });
  });

  it('renders lock screen when not authenticated', async () => {
    await act(async () => {
      render(
        <MemoryRouter future={routerFuture}>
          <App />
        </MemoryRouter>
      );
    });
    // When not authenticated, LockScreen is shown
    expect(await screen.findByText('Club Operations')).toBeDefined();
  });

  it('shows employee selection on the lock screen', async () => {
    render(
      <MemoryRouter future={routerFuture}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText('Select your account to continue')).toBeDefined();
    expect(await screen.findByText('Manager Club')).toBeDefined();
  });

  it('renders dashboard when authenticated', async () => {
    // Mock a session in localStorage
    const mockSession = {
      staffId: '1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'ADMIN',
    };
    window.localStorage.setItem('staff_session', JSON.stringify(mockSession));

    await act(async () => {
      render(
        <MemoryRouter future={routerFuture} initialEntries={['/']}>
          <App />
        </MemoryRouter>
      );
    });
    expect(await screen.findByText('Administrative Demo Overview')).toBeDefined();
  });
});
