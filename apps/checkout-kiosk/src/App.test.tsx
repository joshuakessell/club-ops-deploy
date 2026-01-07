import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

// Mock fetch and WebSocket
global.fetch = vi.fn();
global.WebSocket = vi.fn(() => ({
  onopen: null,
  onclose: null,
  onmessage: null,
  send: vi.fn(),
  close: vi.fn(),
})) as unknown as typeof WebSocket;

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Vitest+Node can expose a non-browser localStorage; ensure a Web Storage-like API exists.
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

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the checkout kiosk without crashing', () => {
    render(<App />);
    // Basic smoke test - verify the app renders without crashing
    expect(document.body).toBeDefined();
  });
});
