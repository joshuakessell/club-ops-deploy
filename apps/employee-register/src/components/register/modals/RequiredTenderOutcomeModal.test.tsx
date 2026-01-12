import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequiredTenderOutcomeModal } from './RequiredTenderOutcomeModal';

describe('RequiredTenderOutcomeModal', () => {
  it('requires selecting exactly one option before continuing', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <RequiredTenderOutcomeModal
        isOpen={true}
        totalLabel="Total: $10.00"
        isSubmitting={false}
        onConfirm={onConfirm}
      />
    );

    const continueBtn = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Credit Success' }));
    expect(continueBtn.disabled).toBe(false);

    fireEvent.click(continueBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('CREDIT_SUCCESS');

    // Clicking outside should not dismiss (modal remains rendered)
    fireEvent.click(container.querySelector('.er-required-modal__overlay') as Element);
    expect(screen.getByText('Select Tender Outcome')).toBeDefined();

    // ESC should not dismiss or change selection
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Select Tender Outcome')).toBeDefined();
  });
});

