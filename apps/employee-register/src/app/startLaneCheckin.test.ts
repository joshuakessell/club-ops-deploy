import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLaneCheckin } from './startLaneCheckin';

type FetchResult = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function mockFetchResponse(status: number, payload: unknown) {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } satisfies FetchResult);
}

describe('startLaneCheckin', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockReset?.();
    globalThis.fetch = originalFetch;
  });

  it('returns started on success payload', async () => {
    mockFetchResponse(200, { sessionId: 's1', customerName: 'Sam' });

    const result = await startLaneCheckin({
      lane: 'lane-1',
      sessionToken: 'token',
      customerId: 'cust-1',
    });

    expect(result.kind).toBe('started');
    if (result.kind === 'started') {
      expect(result.payload).toEqual({ sessionId: 's1', customerName: 'Sam' });
    }
  });

  it('returns already-visiting when payload indicates active checkin (200)', async () => {
    mockFetchResponse(200, {
      code: 'ALREADY_CHECKED_IN',
      activeCheckin: { visitId: 'visit-1' },
    });

    const result = await startLaneCheckin({
      lane: 'lane-1',
      sessionToken: 'token',
      customerId: 'cust-1',
    });

    expect(result.kind).toBe('already-visiting');
  });

  it('returns already-visiting when payload indicates active checkin (409)', async () => {
    mockFetchResponse(409, {
      code: 'ALREADY_CHECKED_IN',
      activeCheckin: { visitId: 'visit-2' },
    });

    const result = await startLaneCheckin({
      lane: 'lane-2',
      sessionToken: 'token',
      customerId: 'cust-2',
    });

    expect(result.kind).toBe('already-visiting');
  });

  it('returns error with message when server provides error', async () => {
    mockFetchResponse(500, { error: 'Boom' });

    const result = await startLaneCheckin({
      lane: 'lane-3',
      sessionToken: 'token',
      customerId: 'cust-3',
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Boom');
    }
  });

  it('returns error with fallback message when server provides no message', async () => {
    mockFetchResponse(500, null);

    const result = await startLaneCheckin({
      lane: 'lane-4',
      sessionToken: 'token',
      customerId: 'cust-4',
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Failed to start check-in (HTTP 500)');
    }
  });
});
