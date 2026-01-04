import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// Mock WebSocket
global.WebSocket = vi.fn(() => ({
  onopen: null,
  onclose: null,
  onmessage: null,
  close: vi.fn(),
  send: vi.fn(),
})) as unknown as typeof WebSocket;

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
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({
          staff: [
            { id: '1', name: 'Manager Club', role: 'ADMIN' },
            { id: '2', name: 'Front Desk', role: 'STAFF' },
          ],
        }) } as any;
      }
      if (url.endsWith('/api/v1/inventory/summary')) {
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({
          byType: { STANDARD: { clean: 10, cleaning: 0, dirty: 0, total: 10 } },
          overall: { clean: 10, cleaning: 0, dirty: 0, total: 10 },
          lockers: { clean: 10, cleaning: 0, dirty: 0, total: 10 },
        }) } as any;
      }
      if (url.includes('/api/v1/metrics/waitlist')) {
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({
          activeCount: 0,
          offeredCount: 0,
          averageWaitTimeMinutes: 0,
        }) } as any;
      }
      if (url.includes('/api/v1/admin/reports/cash-totals')) {
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({
          date: '2026-01-01',
          total: 0,
          byPaymentMethod: { CASH: 0, CREDIT: 0 },
          byRegister: { 'Register 1': 0, 'Register 2': 0, Unassigned: 0 },
        }) } as any;
      }
      if (url.includes('/api/v1/admin/register-sessions')) {
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ([
          { registerNumber: 1, active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null, secondsSinceHeartbeat: null },
          { registerNumber: 2, active: false, sessionId: null, employee: null, deviceId: null, createdAt: null, lastHeartbeatAt: null, secondsSinceHeartbeat: null },
        ]) } as any;
      }
      if (url.includes('/api/v1/checkin/lane-sessions')) {
        return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ sessions: [] }) } as any;
      }
      return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) } as any;
    });
  });

  it('renders lock screen when not authenticated', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );
    // When not authenticated, LockScreen is shown
    expect(screen.getByText('Club Operations')).toBeDefined();
  });

  it('shows employee selection on the lock screen', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText('Select your account to continue')).toBeDefined();
    expect(await screen.findByText('Manager Club')).toBeDefined();
  });

  it('renders dashboard when authenticated', () => {
    // Mock a session in localStorage
    const mockSession = {
      staffId: '1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'ADMIN',
    };
    window.localStorage.setItem('staff_session', JSON.stringify(mockSession));
    
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Administrative Demo Overview')).toBeDefined();
  });
});

