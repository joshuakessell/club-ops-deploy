import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RequiredTenderOutcomeModal } from './RequiredTenderOutcomeModal';

describe('RequiredTenderOutcomeModal', () => {
  it('confirms immediately when an option is selected', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <RequiredTenderOutcomeModal
        isOpen={true}
        totalLabel="Total: $10.00"
        isSubmitting={false}
        onConfirm={onConfirm}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /select tender outcome/i });
    const m = within(dialog);
    expect(m.queryByRole('button', { name: 'Continue' })).toBeNull();

    fireEvent.click(m.getByRole('button', { name: 'Credit Success' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('CREDIT_SUCCESS');

    // Clicking outside should not dismiss (modal remains rendered)
    const overlay = container.querySelector('.er-required-modal__overlay');
    expect(overlay).toBeTruthy();
    if (!overlay) throw new Error('Expected overlay to exist');
    fireEvent.click(overlay);
    expect(m.getByText('Select Tender Outcome')).toBeDefined();

    // ESC should not dismiss or change selection
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(m.getByText('Select Tender Outcome')).toBeDefined();
  });
});
