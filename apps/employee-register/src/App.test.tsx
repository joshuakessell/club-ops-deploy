import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';

// Mock WebSocket
type MockWebSocket = {
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onmessage: ((ev: { data: string }) => unknown) | null;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
let lastWs: MockWebSocket | null = null;
global.WebSocket = vi.fn(() => {
  lastWs = {
    onopen: null,
    onclose: null,
    onmessage: null,
    close: vi.fn(),
    send: vi.fn(),
  };
  return lastWs;
}) as unknown as typeof WebSocket;

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

  it('renders lock screen when not authenticated', async () => {
    await act(async () => {
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

    await act(async () => {
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

    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByText('Lane Session')).toBeDefined();
  });

  it('updates agreement status when receiving SESSION_UPDATED with agreementSigned=true', async () => {
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

    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByText('Lane Session')).toBeDefined();

    // Wait until App has attached its onmessage handler, then simulate an agreement-signed update.
    // React StrictMode can create multiple WS instances; use the one that has the handler attached.
    let wsWithHandler: MockWebSocket | null = null;
    await waitFor(() => {
      const results = (global.WebSocket as unknown as ReturnType<typeof vi.fn>).mock.results;
      const instances = results
        .map((r: { value: unknown }) => r.value as MockWebSocket | undefined)
        .filter((w): w is MockWebSocket => !!w);
      wsWithHandler = instances.find((w) => typeof w?.onmessage === 'function') ?? null;
      expect(wsWithHandler).not.toBeNull();
    });

    await act(async () => {
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

    await waitFor(() => {
      expect(screen.getByText(/Current Session:/i)).toBeDefined();
      expect(screen.getByText(/Name:\s*Alex Rivera/i)).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText(/Agreement signed/i)).toBeDefined();
    });
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
          json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByText('Lane Session')).toBeDefined();

    let wsWithHandler: MockWebSocket | null = null;
    await waitFor(() => {
      const results = (global.WebSocket as unknown as ReturnType<typeof vi.fn>).mock.results;
      const instances = results
        .map((r: { value: unknown }) => r.value as MockWebSocket | undefined)
        .filter((w): w is MockWebSocket => !!w);
      wsWithHandler = instances.find((w) => typeof w?.onmessage === 'function') ?? null;
      expect(wsWithHandler).not.toBeNull();
    });

    await act(async () => {
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

    await act(async () => {
      render(<App />);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });

    // Allow debounced search to fire
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const suggestion = await screen.findByText(/Rivera, Alex/);
    await act(async () => {
      fireEvent.click(suggestion);
    });

    const confirmButton = await screen.findByText(/Confirm/);
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });
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

      if (u.includes('/v1/checkin/lane/lane-1/propose-selection')) {
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

    await act(async () => {
      render(<App />);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const suggestion = await screen.findByText(/Rivera, Alex/);
    await act(async () => {
      fireEvent.click(suggestion);
    });
    const confirmButton = await screen.findByText(/Confirm/);
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });

    const proposeButtons = screen.getAllByText(/Propose/);
    await act(async () => {
      fireEvent.click(proposeButtons[0]!); // first tap proposes
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Proposed:/).length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(proposeButtons[0]!); // second tap forces (confirm)
    });

    await waitFor(() => {
      // Confirming selection triggers payment intent creation; the quote total is surfaced
      expect(screen.queryAllByText(/\$10\.00/).length).toBeGreaterThan(0);
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

    await act(async () => {
      render(<App />);
    });

    const searchInput = await screen.findByPlaceholderText('Start typing name...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Ale' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const suggestion = await screen.findByText(/Rivera, Alex/);
    await act(async () => {
      fireEvent.click(suggestion);
    });
    const confirmButton = await screen.findByText(/Confirm/);
    await act(async () => {
      fireEvent.click(confirmButton);
    });
    await waitFor(() => {
      expect(screen.queryAllByText(/Alex Rivera/).length).toBeGreaterThan(0);
    });

    // Upgrades now live in the left drawer; they should remain accessible during an active session.
    const upgradesTab = await screen.findByRole('button', { name: 'Upgrades' });
    await act(async () => {
      fireEvent.click(upgradesTab);
    });

    expect(await screen.findByText(/Upgrade Waitlist/i)).toBeDefined();
    expect(screen.queryByText(/Active session present — waitlist actions are disabled/i)).toBeNull();

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

    const calls: Array<{ url: string; body?: any }> = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url instanceof Request
              ? url.url
              : '';

      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
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
          json: () => Promise.resolve({ status: 'ok', timestamp: new Date().toISOString(), uptime: 0 }),
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
          json: () => Promise.resolve({ sessionId: 'sess-1', customerName: 'John Smith', membershipNumber: null }),
        } as unknown as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    });

    await act(async () => {
      render(<App />);
    });

    // Open manual entry
    fireEvent.click(await screen.findByText(/First Time Customer/i));

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
      expect(startCall?.body?.customerId).toBe('cust-1');
    });
  });
});
