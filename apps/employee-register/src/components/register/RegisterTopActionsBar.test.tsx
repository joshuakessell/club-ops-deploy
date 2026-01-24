import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegisterTopActionsBar } from './RegisterTopActionsBar';

describe('RegisterTopActionsBar', () => {
  it('renders the Checkout and Room Cleaning buttons', () => {
    render(<RegisterTopActionsBar onCheckout={() => undefined} onRoomCleaning={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Room Cleaning' })).toBeDefined();
  });

  it('calls callbacks when clicked', () => {
    const onCheckout = vi.fn();
    const onRoomCleaning = vi.fn();
    render(<RegisterTopActionsBar onCheckout={onCheckout} onRoomCleaning={onRoomCleaning} />);

    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(onCheckout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Room Cleaning' }));
    expect(onRoomCleaning).toHaveBeenCalledTimes(1);
  });
});
