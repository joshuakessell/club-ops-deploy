import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    (globalThis as any).localStorage = storage;
    localStorage.clear();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
    });
  });

  it('renders lock screen when not authenticated', () => {
    render(<App />);
    // When not authenticated, LockScreen is shown instead of the main app
    // The LockScreen component should be rendered
    expect(screen.queryByText('Employee Register')).toBeNull();
  });

  it('renders the register header when authenticated', async () => {
    // Mock a signed-in register + staff session
    localStorage.setItem('staff_session', JSON.stringify({
      staffId: 'staff-1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'STAFF',
    }));

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/v1/registers/status')) {
        return {
          ok: true,
          json: async () => ({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as any;
      }
      if (u.includes('/health')) {
        return { ok: true, json: async () => ({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    
    render(<App />);
    expect(await screen.findByText('Employee Register')).toBeDefined();
  });

  it('shows lane session section when authenticated', async () => {
    localStorage.setItem('staff_session', JSON.stringify({
      staffId: 'staff-1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'STAFF',
    }));

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/v1/registers/status')) {
        return {
          ok: true,
          json: async () => ({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as any;
      }
      if (u.includes('/health')) {
        return { ok: true, json: async () => ({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    
    render(<App />);
    expect(await screen.findByText('Lane Session')).toBeDefined();
  });
});

