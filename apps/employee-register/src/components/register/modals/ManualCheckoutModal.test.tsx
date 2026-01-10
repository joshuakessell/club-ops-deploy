import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManualCheckoutModal } from './ManualCheckoutModal';

global.fetch = vi.fn();

describe('ManualCheckoutModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads candidates and renders them', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              occupancyId: 'occ-1',
              resourceType: 'ROOM',
              number: '101',
              customerName: 'John Smith',
              checkinAt: new Date().toISOString(),
              scheduledCheckoutAt: new Date().toISOString(),
              isOverdue: true,
            },
          ],
        }),
    });

    render(
      <ManualCheckoutModal
        isOpen={true}
        sessionToken="tok"
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    );

    expect(await screen.findByText(/Suggested/i)).toBeDefined();
    expect(await screen.findByRole('button', { name: /Room 101/i })).toBeDefined();
    expect(screen.getByText(/John Smith/i)).toBeDefined();
  });

  it('typing in number input clears selected candidate and gates Continue', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              occupancyId: 'occ-1',
              resourceType: 'ROOM',
              number: '101',
              customerName: 'John Smith',
              checkinAt: new Date().toISOString(),
              scheduledCheckoutAt: new Date().toISOString(),
              isOverdue: false,
            },
          ],
        }),
    });

    render(
      <ManualCheckoutModal
        isOpen={true}
        sessionToken="tok"
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    );

    const continueBtn = await screen.findByRole('button', { name: 'Continue' });
    expect(continueBtn).toHaveProperty('disabled', true);

    const candidateBtn = await screen.findByRole('button', { name: /Room 101/i });
    fireEvent.click(candidateBtn);
    expect(continueBtn).toHaveProperty('disabled', false);
    expect(candidateBtn.getAttribute('aria-pressed')).toBe('true');

    const input = screen.getByLabelText('Checkout number');
    fireEvent.change(input, { target: { value: '102' } });
    expect(candidateBtn.getAttribute('aria-pressed')).toBe('false');
    expect(continueBtn).toHaveProperty('disabled', false);
  });

  it('continue resolves, shows confirm step, and close during confirm shows warning dialog', async () => {
    // candidates
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                occupancyId: 'occ-1',
                resourceType: 'ROOM',
                number: '101',
                customerName: 'John Smith',
                checkinAt: new Date().toISOString(),
                scheduledCheckoutAt: new Date().toISOString(),
                isOverdue: false,
              },
            ],
          }),
      })
      // resolve
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            occupancyId: 'occ-1',
            resourceType: 'ROOM',
            number: '101',
            customerName: 'John Smith',
            checkinAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
            scheduledCheckoutAt: new Date('2026-01-01T11:00:00.000Z').toISOString(),
            lateMinutes: 65,
            fee: 35,
            banApplied: false,
          }),
      });

    render(
      <ManualCheckoutModal
        isOpen={true}
        sessionToken="tok"
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    );

    const candidateBtn = await screen.findByRole('button', { name: /Room 101/i });
    fireEvent.click(candidateBtn);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Confirm checkout/i)).toBeDefined();
    expect(screen.getByText(/John Smith/i)).toBeDefined();
    expect(
      screen.getAllByText((_, el) => (el?.textContent ?? '').includes('Fee $35.00')).length
    ).toBeGreaterThan(0);

    // Close (X) triggers warning instead of closing
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);

    expect(await screen.findByRole('heading', { name: /Cancel checkout/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Return to confirm checkout/i })).toBeDefined();
  });

  it('confirm completes checkout and calls onSuccess', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                occupancyId: 'occ-1',
                resourceType: 'ROOM',
                number: '101',
                customerName: 'John Smith',
                checkinAt: new Date().toISOString(),
                scheduledCheckoutAt: new Date().toISOString(),
                isOverdue: false,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            occupancyId: 'occ-1',
            resourceType: 'ROOM',
            number: '101',
            customerName: 'John Smith',
            checkinAt: new Date().toISOString(),
            scheduledCheckoutAt: new Date().toISOString(),
            lateMinutes: 5,
            fee: 0,
            banApplied: false,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ alreadyCheckedOut: false }),
      });

    render(<ManualCheckoutModal isOpen={true} sessionToken="tok" onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole('button', { name: /Room 101/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Confirm checkout/i);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('Checkout completed');
    });
  });
});


