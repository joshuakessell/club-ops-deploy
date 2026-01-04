import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock fetch
global.fetch = vi.fn();

// Mock getUserMedia
const mockStream = {
  getTracks: () => [
    {
      stop: vi.fn(),
    },
  ],
} as unknown as MediaStream;

Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockStream),
  },
});

// Mock video element
Object.defineProperty(HTMLVideoElement.prototype, 'play', {
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
  writable: true,
  value: HTMLMediaElement.HAVE_ENOUGH_DATA,
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure a Web Storage-like API exists for device ID persistence in tests.
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
      json: () => Promise.resolve({
        rooms: [],
        statusCounts: { DIRTY: 0, CLEANING: 0, CLEAN: 0 },
        isMixedStatus: false,
        primaryAction: null,
        totalResolved: 0,
        totalRequested: 0,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders lock screen when not authenticated', () => {
    render(<App />);
    // When not authenticated, LockScreen is shown
    expect(screen.getByText('Staff Login')).toBeDefined();
  });

  it('shows lock screen with PIN input', () => {
    render(<App />);
    // Lock screen should show PIN input
    expect(screen.getByPlaceholderText('Enter PIN')).toBeDefined();
  });
});

