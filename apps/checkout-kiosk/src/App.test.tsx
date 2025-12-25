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

