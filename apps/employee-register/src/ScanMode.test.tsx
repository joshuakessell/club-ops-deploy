import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScanMode } from './ScanMode';

describe('ScanMode', () => {
  it('renders Exit button that calls onCancel', () => {
    const onCancel = vi.fn();
    const onBarcodeCaptured = vi.fn();
    render(
      <ScanMode isOpen={true} onCancel={onCancel} onBarcodeCaptured={onBarcodeCaptured} />
    );

    const exitButton = screen.getByRole('button', { name: /exit scan mode/i });
    fireEvent.click(exitButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

