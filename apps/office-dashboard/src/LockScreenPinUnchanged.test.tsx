import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LockScreen } from './LockScreen';

describe('Office Dashboard PIN flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.fetch = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/v1/auth/staff')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            staff: [{ id: '1', name: 'Manager Club', role: 'ADMIN' }],
          }),
        } as any;
      }
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as any;
    }) as any;
  });

  it('renders the LiquidGlass numpad for PIN entry', async () => {
    const onLogin = vi.fn();

    const { container } = render(
      <LockScreen onLogin={onLogin} deviceType="desktop" deviceId="office-1" />
    );

    // Wait for staff to load and render
    const manager = await screen.findByText('Manager Club');
    fireEvent.click(manager);

    await waitFor(() => {
      expect(container.querySelector('.cs-liquid-numpad')).not.toBeNull();
    });
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});
