import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpgradesDrawerContent, type UpgradeWaitlistEntry } from './UpgradesDrawerContent';

function makeEntry(partial: Partial<UpgradeWaitlistEntry>): UpgradeWaitlistEntry {
  return {
    id: partial.id ?? 'w1',
    visitId: partial.visitId ?? 'v1',
    checkinBlockId: partial.checkinBlockId ?? 'b1',
    desiredTier: partial.desiredTier ?? 'DOUBLE',
    backupTier: partial.backupTier ?? 'STANDARD',
    status: partial.status ?? 'ACTIVE',
    createdAt: partial.createdAt ?? new Date().toISOString(),
    checkinAt: partial.checkinAt,
    checkoutAt: partial.checkoutAt,
    offeredAt: partial.offeredAt,
    roomId: partial.roomId ?? null,
    offeredRoomNumber: partial.offeredRoomNumber ?? null,
    displayIdentifier: partial.displayIdentifier ?? '218',
    currentRentalType: partial.currentRentalType ?? 'STANDARD',
    customerName: partial.customerName,
  };
}

describe('UpgradesDrawerContent', () => {
  it('renders an ACTIVE entry with Offer Upgrade action', () => {
    const onOffer = vi.fn();
    render(
      <UpgradesDrawerContent
        waitlistEntries={[
          makeEntry({ status: 'ACTIVE', desiredTier: 'DOUBLE', customerName: 'Test Customer' }),
        ]}
        hasEligibleEntries={true}
        isEntryOfferEligible={() => true}
        onOffer={onOffer}
        onStartPayment={() => undefined}
        onCancelOffer={() => undefined}
      />
    );

    const offerBtn = screen.getByRole('button', { name: 'Offer Upgrade' });
    expect(offerBtn).toBeDefined();
    expect(offerBtn).toHaveProperty('disabled', false);

    fireEvent.click(offerBtn);
    expect(onOffer).toHaveBeenCalledWith('w1', 'DOUBLE', 'Test Customer');
  });

  it('renders an OFFERED entry with Start Payment action', () => {
    render(
      <UpgradesDrawerContent
        waitlistEntries={[
          makeEntry({
            id: 'w2',
            status: 'OFFERED',
            desiredTier: 'SPECIAL',
            displayIdentifier: '219',
            customerName: 'Customer 2',
            roomId: 'room-1',
            offeredRoomNumber: '302',
          }),
        ]}
        hasEligibleEntries={false}
        isEntryOfferEligible={() => true}
        onOffer={() => undefined}
        onStartPayment={() => undefined}
        onCancelOffer={() => undefined}
      />
    );

    const startPayment = screen.getByRole('button', { name: 'Start Payment' });

    expect(startPayment).toBeDefined();
    expect(startPayment).toHaveProperty('disabled', false);
  });
});
