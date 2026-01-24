import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmployeeAssistPanel } from './EmployeeAssistPanel';

function baseProps() {
  return {
    sessionId: 'session-1',
    customerName: 'Test Customer',
    customerPrimaryLanguage: null,
    membershipNumber: null,
    customerMembershipValidUntil: null,
    membershipPurchaseIntent: null,
    membershipChoice: null,
    allowedRentals: ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'],
    proposedRentalType: null,
    proposedBy: null,
    selectionConfirmed: false,
    waitlistDesiredTier: null,
    waitlistBackupType: null,
    inventoryAvailable: { rooms: { STANDARD: 10, DOUBLE: 8, SPECIAL: 2 }, lockers: 12 },
    isSubmitting: false,
    onHighlightLanguage: vi.fn(),
    onConfirmLanguage: vi.fn(),
    onHighlightMembership: vi.fn(),
    onConfirmMembershipOneTime: vi.fn(),
    onConfirmMembershipSixMonth: vi.fn(),
    onHighlightRental: vi.fn(),
    onSelectRentalAsCustomer: vi.fn(),
    onHighlightWaitlistBackup: vi.fn(),
    onSelectWaitlistBackupAsCustomer: vi.fn(),
    onApproveRental: vi.fn(),
  };
}

describe('EmployeeAssistPanel', () => {
  it('LANGUAGE step: first tap highlights, second tap confirms', () => {
    const props = baseProps();
    render(<EmployeeAssistPanel {...props} />);

    const english = screen.getByRole('button', { name: 'English' });
    fireEvent.click(english);
    expect(props.onHighlightLanguage).toHaveBeenCalledWith('EN');
    expect(props.onConfirmLanguage).not.toHaveBeenCalled();

    fireEvent.click(english);
    expect(props.onHighlightLanguage).toHaveBeenCalledWith(null);
    expect(props.onConfirmLanguage).toHaveBeenCalledWith('EN');
  });

  it('Skips MEMBERSHIP when customer is already a member (ACTIVE)', () => {
    const props = {
      ...baseProps(),
      customerPrimaryLanguage: 'EN' as const,
      membershipNumber: '12345',
      customerMembershipValidUntil: '2999-01-01',
      membershipChoice: null,
    };
    render(<EmployeeAssistPanel {...props} />);
    expect(screen.queryByRole('button', { name: 'One-time Membership' })).toBeNull();
    expect(screen.getByText('Step: RENTAL')).toBeTruthy();
  });

  it('MEMBERSHIP step: first tap highlights, second tap confirms ONE_TIME', () => {
    const props = {
      ...baseProps(),
      customerPrimaryLanguage: 'EN' as const,
    };
    render(<EmployeeAssistPanel {...props} />);

    const oneTime = screen.getByRole('button', { name: 'One-time Membership' });
    fireEvent.click(oneTime);
    expect(props.onHighlightMembership).toHaveBeenCalledWith('ONE_TIME');
    expect(props.onConfirmMembershipOneTime).not.toHaveBeenCalled();

    fireEvent.click(oneTime);
    expect(props.onHighlightMembership).toHaveBeenCalledWith(null);
    expect(props.onConfirmMembershipOneTime).toHaveBeenCalled();
  });

  it('RENTAL step: buttons are in required order and show exact counts', () => {
    const props = {
      ...baseProps(),
      customerPrimaryLanguage: 'EN' as const,
      membershipChoice: 'ONE_TIME' as const,
    };
    render(<EmployeeAssistPanel {...props} />);

    const buttons = screen.getAllByRole('button');
    const rentalButtons = buttons.filter((b) =>
      /Propose (Locker|Standard|Double|Special)/.test(b.textContent || '')
    );

    expect(rentalButtons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Propose Locker'),
      expect.stringContaining('Propose Standard'),
      expect.stringContaining('Propose Double'),
      expect.stringContaining('Propose Special'),
    ]);

    expect(screen.getByText(/\b12 remaining\b/)).toBeTruthy();
    expect(screen.getByText(/\b10 remaining\b/)).toBeTruthy();
    expect(screen.getByText(/\b8 remaining\b/)).toBeTruthy();
    expect(screen.getByText(/\b2 remaining\b/)).toBeTruthy();
  });

  it('RENTAL step: first tap proposes, second tap confirms', () => {
    const props = {
      ...baseProps(),
      customerPrimaryLanguage: 'EN' as const,
      membershipChoice: 'ONE_TIME' as const,
    };
    render(<EmployeeAssistPanel {...props} />);

    const locker = screen.getByRole('button', { name: /Propose Locker/i });
    fireEvent.click(locker);
    expect(props.onHighlightRental).toHaveBeenCalledWith('LOCKER');
    expect(props.onApproveRental).not.toHaveBeenCalled();

    fireEvent.click(locker);
    expect(props.onApproveRental).toHaveBeenCalled();
  });

  it('APPROVAL step: shows green OK and calls approve', () => {
    const props = {
      ...baseProps(),
      customerPrimaryLanguage: 'EN' as const,
      membershipChoice: 'ONE_TIME' as const,
      proposedBy: 'CUSTOMER' as const,
      proposedRentalType: 'LOCKER',
      selectionConfirmed: false,
    };
    render(<EmployeeAssistPanel {...props} />);

    expect(screen.getByText('Step: APPROVAL')).toBeTruthy();
    const ok = screen.getByRole('button', { name: 'OK' });
    fireEvent.click(ok);
    expect(props.onApproveRental).toHaveBeenCalled();
  });
});
