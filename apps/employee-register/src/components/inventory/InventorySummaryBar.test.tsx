import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InventorySummaryBar } from './InventorySummaryBar';

describe('InventorySummaryBar', () => {
  it('renders correct X / Y values from counts', () => {
    render(
      <InventorySummaryBar
        counts={{
          lockers: 12,
          rooms: { STANDARD: 3, DOUBLE: 1, SPECIAL: 0 },
          rawRooms: { STANDARD: 5, DOUBLE: 2, SPECIAL: 1 },
        }}
        onOpenInventorySection={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: /Lockers/i }).textContent).toContain('12 / 12');
    expect(screen.getByRole('button', { name: /Standard/i }).textContent).toContain('3 / 5');
    expect(screen.getByRole('button', { name: /Double/i }).textContent).toContain('1 / 2');
    expect(screen.getByRole('button', { name: /Special/i }).textContent).toContain('0 / 1');
  });

  it('clicking Standard calls onOpenInventorySection(STANDARD)', () => {
    const onOpen = vi.fn();
    render(
      <InventorySummaryBar
        counts={{
          lockers: 0,
          rooms: { STANDARD: 0, DOUBLE: 0, SPECIAL: 0 },
          rawRooms: { STANDARD: 0, DOUBLE: 0, SPECIAL: 0 },
        }}
        onOpenInventorySection={onOpen}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Standard/i }));
    expect(onOpen).toHaveBeenCalledWith('STANDARD');
  });
});


