import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RequiredTenderOutcomeModal } from './RequiredTenderOutcomeModal';

describe('RequiredTenderOutcomeModal', () => {
  it('confirms immediately when an option is selected', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <RequiredTenderOutcomeModal
        isOpen={true}
        totalAmount={10}
        isSubmitting={false}
        onConfirm={onConfirm}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /process payment/i });
    const m = within(dialog);
    expect(m.queryByRole('button', { name: 'Continue' })).toBeNull();

    const creditButton = dialog.querySelector(
      'button[data-choice="CREDIT_SUCCESS"]'
    ) as HTMLButtonElement | null;
    expect(creditButton).toBeTruthy();
    if (!creditButton) throw new Error('Expected credit success button');
    fireEvent.click(creditButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('CREDIT_SUCCESS');

    // Clicking outside should not dismiss (modal remains rendered)
    const overlay = container.querySelector('.er-required-modal__overlay');
    expect(overlay).toBeTruthy();
    if (!overlay) throw new Error('Expected overlay to exist');
    fireEvent.click(overlay);
    expect(m.getByText('Process Payment')).toBeDefined();

    // ESC should not dismiss or change selection
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(m.getByText('Process Payment')).toBeDefined();
  });
});
