import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomCleaningModal } from './RoomCleaningModal';

global.fetch = vi.fn();

describe('RoomCleaningModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows DIRTY and CLEANING columns and filters out other statuses', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          rooms: [
            { id: 'r1', number: '101', status: 'CLEANING' },
            { id: 'r2', number: '102', status: 'CLEAN' },
          ],
          lockers: [],
        }),
    });

    render(
      <RoomCleaningModal
        isOpen={true}
        sessionToken="tok"
        staffId="staff-1"
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    );

    expect(await screen.findByText(/Select rooms to begin or finish cleaning/i)).toBeDefined();
    expect(screen.getByText(/DIRTY \(ready to begin cleaning\)/i)).toBeDefined();
    expect(screen.getByText(/CLEANING \(ready to finish cleaning\)/i)).toBeDefined();
    expect(await screen.findByRole('button', { name: /Room 101/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Room 102/i })).toBeNull();
  });

  it('multi-select CLEANING rooms enables Finish Cleaning and calls /v1/cleaning/batch with expected payload', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            rooms: [
              { id: 'r1', number: '101', status: 'CLEANING' },
              { id: 'r2', number: '103', status: 'CLEANING' },
            ],
            lockers: [],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ batchId: 'b1', summary: { total: 2, success: 2, failed: 0 }, rooms: [] }),
      });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <RoomCleaningModal
        isOpen={true}
        sessionToken="tok"
        staffId="staff-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const primaryBtn = await screen.findByRole('button', { name: 'Continue' });
    expect(primaryBtn).toHaveProperty('disabled', true);

    fireEvent.click(await screen.findByRole('button', { name: /Room 101/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Room 103/i }));
    const finishBtn = await screen.findByRole('button', { name: 'Finish Cleaning' });
    expect(finishBtn).toHaveProperty('disabled', false);

    fireEvent.click(finishBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/cleaning/batch',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            roomIds: ['r1', 'r2'],
            targetStatus: 'CLEAN',
            staffId: 'staff-1',
            override: false,
          }),
        })
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('Rooms marked CLEAN');
  });
});


