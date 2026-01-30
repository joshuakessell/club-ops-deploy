import type { ReactNode } from 'react';
import { PanelHeader } from '../../views/PanelHeader';

export type UpgradeWaitlistStatus = string;

export type UpgradeWaitlistEntry = {
  id: string;
  visitId: string;
  checkinBlockId: string;
  customerId?: string;
  desiredTier: string;
  backupTier: string;
  status: string;
  createdAt: string;
  checkinAt?: string;
  checkoutAt?: string;
  offeredAt?: string;
  roomId?: string | null;
  offeredRoomNumber?: string | null;
  displayIdentifier: string;
  currentRentalType: string;
  customerName?: string;
};

export interface UpgradesDrawerContentProps {
  waitlistEntries: UpgradeWaitlistEntry[];
  hasEligibleEntries: boolean;
  isEntryOfferEligible: (entryId: string, status: string, desiredTier: string) => boolean;
  onOffer: (entryId: string, desiredTier: string, customerLabel: string) => void;
  onStartPayment: (entry: UpgradeWaitlistEntry) => void;
  onCancelOffer: (entryId: string) => void;
  onOpenCustomerAccount?: (customerId: string, customerLabel?: string) => void;
  isSubmitting?: boolean;
  headerRightSlot?: ReactNode;
}

export function UpgradesDrawerContent({
  waitlistEntries,
  hasEligibleEntries: _hasEligibleEntries,
  isEntryOfferEligible,
  onOffer,
  onStartPayment,
  onCancelOffer,
  onOpenCustomerAccount,
  isSubmitting = false,
  headerRightSlot,
}: UpgradesDrawerContentProps) {
  const active = waitlistEntries.filter((e) => e.status === 'ACTIVE');
  const offered = waitlistEntries.filter((e) => e.status === 'OFFERED');

  return (
    <div className="er-surface er-upgrades-drawer">
      <PanelHeader title="Upgrade Waitlist" spacing="sm" action={headerRightSlot} />

      <div
        className={[
          'er-upgrades-body',
          waitlistEntries.length === 0 ? 'er-upgrades-body--empty' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {waitlistEntries.length === 0 ? (
          <div className="er-upgrades-empty">
            <div className="er-upgrades-empty-text">No active waitlist entries</div>
          </div>
        ) : (
          <div className="u-flex u-flex-col u-gap-16">
            {(
              [
                ['OFFERED', offered],
                ['ACTIVE', active],
              ] as const
            ).map(([status, entries]) => {
              if (entries.length === 0) return null;

              return (
                <section key={status}>
                  <h3
                    className={[
                      'er-upgrades-section-title',
                      status === 'OFFERED'
                        ? 'er-upgrades-section-title--offered'
                        : 'er-upgrades-section-title--active',
                    ].join(' ')}
                  >
                    {status === 'OFFERED' ? '⚠️ Offered' : '⏳ Active'} ({entries.length})
                  </h3>

                  <div className="er-upgrades-list">
                    {entries.map((entry) => {
                      const customerLabel = entry.customerName || entry.displayIdentifier;
                      const eligible = isEntryOfferEligible(
                        entry.id,
                        entry.status,
                        entry.desiredTier
                      );
                      const canOpenCustomer = Boolean(entry.customerId && onOpenCustomerAccount);

                      return (
                        <div
                          key={entry.id}
                          className="er-surface er-upgrades-card"
                        >
                          <div
                            className="er-upgrades-card-header"
                          >
                            <div>
                              <div className="er-upgrades-card-title">
                                <button
                                  type="button"
                                  disabled={!canOpenCustomer}
                                  onClick={() => {
                                    if (!entry.customerId) return;
                                    onOpenCustomerAccount?.(entry.customerId, customerLabel);
                                  }}
                                  className={[
                                    'cs-liquid-button',
                                    'cs-liquid-button--secondary',
                                    'er-upgrades-customer-btn',
                                    !canOpenCustomer ? 'er-upgrades-customer-btn--disabled' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  title={
                                    canOpenCustomer
                                      ? 'Open Customer Account'
                                      : 'Customer id not available'
                                  }
                                >
                                  {customerLabel}
                                </button>
                                <span aria-hidden="true" className="er-text-muted">
                                  →
                                </span>
                                <span>{entry.desiredTier}</span>
                              </div>
                              <div className="er-upgrades-meta">
                                Assigned: {entry.displayIdentifier} • Backup: {entry.backupTier} •
                                Current: {entry.currentRentalType} • Check-in:{' '}
                                {entry.checkinAt
                                  ? new Date(entry.checkinAt).toLocaleTimeString()
                                  : '—'}{' '}
                                • Checkout:{' '}
                                {entry.checkoutAt
                                  ? new Date(entry.checkoutAt).toLocaleTimeString()
                                  : '—'}
                              </div>
                            </div>
                          </div>

                          {status === 'ACTIVE' ? (
                            <button
                              onClick={() => onOffer(entry.id, entry.desiredTier, customerLabel)}
                              className={[
                                'cs-liquid-button',
                                eligible
                                  ? 'cs-liquid-button--success'
                                  : 'cs-liquid-button--secondary',
                                'er-upgrades-action-btn',
                              ].join(' ')}
                              disabled={!eligible || isSubmitting}
                            >
                              Offer Upgrade
                            </button>
                          ) : (
                            <div className="er-upgrades-actions">
                              <button
                                onClick={() => onStartPayment(entry)}
                                disabled={!eligible || isSubmitting}
                                className="cs-liquid-button er-upgrades-action-btn"
                              >
                                Start Payment
                              </button>
                              <button
                                onClick={() => onCancelOffer(entry.id)}
                                disabled={isSubmitting}
                                className="cs-liquid-button cs-liquid-button--danger er-upgrades-action-btn"
                              >
                                Cancel Offer
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
