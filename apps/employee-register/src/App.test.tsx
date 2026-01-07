import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    vi.useRealTimers();
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
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
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
          json: () => Promise.resolve({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as unknown as Response);
      }
      if (u.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
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
          json: () => Promise.resolve({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as unknown as Response);
      }
      if (u.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });
    
    render(<App />);
    expect(await screen.findByText('Lane Session')).toBeDefined();
  });

  it('shows customer suggestions at 3+ characters and confirm triggers session', async () => {
    vi.useFakeTimers();

    localStorage.setItem('staff_session', JSON.stringify({
      staffId: 'staff-1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'STAFF',
    }));

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
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
          json: () => Promise.resolve({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/customers/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            suggestions: [
              { id: 'cust-1', name: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera', dobMonthDay: '03/14', membershipNumber: '700001', disambiguator: '0001' },
            ],
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/sessions/scan-id')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            membershipNumber: '700001',
          }),
        } as unknown as Response);
      }

      if (u.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as unknown as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    render(<App />);

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    fireEvent.change(searchInput, { target: { value: 'Ale' } });

    // advance debounce
    vi.advanceTimersByTime(250);

    const suggestion = await screen.findByText(/Rivera, Alex/);
    fireEvent.click(suggestion);

    const confirmButton = await screen.findByText(/Confirm/);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it('double tap on same proposal forces selection (to payment)', async () => {
    vi.useFakeTimers();

    localStorage.setItem('staff_session', JSON.stringify({
      staffId: 'staff-1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'STAFF',
    }));

    const fetchMock = (global.fetch as ReturnType<typeof vi.fn>);

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
          json: () => Promise.resolve({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/customers/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            suggestions: [
              { id: 'cust-1', name: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera', dobMonthDay: '03/14', membershipNumber: '700001', disambiguator: '0001' },
            ],
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/sessions/scan-id')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            membershipNumber: '700001',
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/propose-selection')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }

      if (u.includes('/v1/checkin/lane/lane-1/confirm-selection')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessionId: 'session-123',
            rentalType: 'STANDARD',
            confirmedBy: 'EMPLOYEE',
          }),
        } as unknown as Response);
      }

      if (u.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as unknown as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    render(<App />);

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    fireEvent.change(searchInput, { target: { value: 'Ale' } });
    vi.advanceTimersByTime(250);
    const suggestion = await screen.findByText(/Rivera, Alex/);
    fireEvent.click(suggestion);
    const confirmButton = await screen.findByText(/Confirm/);
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument();
    });

    const proposeButtons = screen.getAllByText(/Propose/);
    fireEvent.click(proposeButtons[0]!); // first tap proposes
    fireEvent.click(proposeButtons[0]!); // second tap forces (confirm)

    await waitFor(() => {
      // Payment section appears when selection confirmed/forced
      expect(screen.getByText(/Mark Paid in Square/)).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it('disables waitlist widget actions when a session is active', async () => {
    vi.useFakeTimers();

    localStorage.setItem('staff_session', JSON.stringify({
      staffId: 'staff-1',
      sessionToken: 'test-token',
      name: 'Test User',
      role: 'STAFF',
    }));

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
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
          json: () => Promise.resolve({
            signedIn: true,
            employee: { id: 'emp-1', name: 'Test Employee' },
            registerNumber: 1,
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/customers/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            suggestions: [
              { id: 'cust-1', name: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera', membershipNumber: '700001', disambiguator: '0001' },
            ],
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/sessions/scan-id')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sessionId: 'session-123',
            customerName: 'Alex Rivera',
            membershipNumber: '700001',
          }),
        } as unknown as Response);
      }

      if (u.includes('/v1/waitlist')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            entries: [
              {
                id: 'wait-1',
                visitId: 'visit-1',
                checkinBlockId: 'block-1',
                desiredTier: 'DOUBLE',
                backupTier: 'STANDARD',
                status: 'ACTIVE',
                createdAt: new Date().toISOString(),
                displayIdentifier: '218',
                currentRentalType: 'STANDARD',
                customerName: 'Test Customer',
              },
            ],
          }),
        } as unknown as Response);
      }

      if (u.includes('/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }) } as unknown as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    render(<App />);

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    fireEvent.change(searchInput, { target: { value: 'Ale' } });
    vi.advanceTimersByTime(250);
    const suggestion = await screen.findByText(/Rivera, Alex/);
    fireEvent.click(suggestion);
    const confirmButton = await screen.findByText(/Confirm/);
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument();
    });

    const waitlistButton = await screen.findByLabelText('Waitlist widget');
    fireEvent.click(waitlistButton);
    const confirmSpy = vi.spyOn(window, 'confirm');
    const keyButton = await screen.findByLabelText(/Begin upgrade/);
    fireEvent.click(keyButton);
    expect(confirmSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

