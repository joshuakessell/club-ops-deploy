import type { ReactNode } from 'react';

export type UpgradeWaitlistStatus = 'ACTIVE' | 'OFFERED' | string;

export type UpgradeWaitlistEntry = {
  id: string;
  visitId: string;
  checkinBlockId: string;
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
  isEntryOfferEligible(entryId: string, status: string, desiredTier: string): boolean;
  onOffer(entryId: string, desiredTier: string, customerLabel: string): void;
  onStartPayment(entry: UpgradeWaitlistEntry): void;
  onOpenPaymentQuote(entry: UpgradeWaitlistEntry): void;
  onCancelOffer(entryId: string): void;
  isSubmitting?: boolean;
  headerRightSlot?: ReactNode;
}

export function UpgradesDrawerContent({
  waitlistEntries,
  hasEligibleEntries,
  isEntryOfferEligible,
  onOffer,
  onStartPayment,
  onOpenPaymentQuote,
  onCancelOffer,
  isSubmitting = false,
  headerRightSlot,
}: UpgradesDrawerContentProps) {
  const active = waitlistEntries.filter((e) => e.status === 'ACTIVE');
  const offered = waitlistEntries.filter((e) => e.status === 'OFFERED');

  return (
    <div className="er-surface" style={{ padding: '1rem', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, marginBottom: '0.35rem', fontSize: '1.25rem', fontWeight: 800 }}>
            Upgrade Waitlist Entries
          </h2>
          <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
            {hasEligibleEntries
              ? 'Eligible offers available now.'
              : 'No eligible offers right now. Offered upgrades can still be fulfilled.'}
          </div>
        </div>
        {headerRightSlot}
      </div>

      <div style={{ marginTop: '1rem' }}>
        {waitlistEntries.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>No active waitlist entries</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {([
              ['OFFERED', offered],
              ['ACTIVE', active],
            ] as const).map(([status, entries]) => {
              if (entries.length === 0) return null;

              return (
                <section key={status}>
                  <h3
                    style={{
                      margin: 0,
                      marginBottom: '0.5rem',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: status === 'OFFERED' ? '#f59e0b' : '#94a3b8',
                    }}
                  >
                    {status === 'OFFERED' ? '⚠️ Offered' : '⏳ Active'} ({entries.length})
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {entries.map((entry) => {
                      const customerLabel = entry.customerName || entry.displayIdentifier;
                      const eligible = isEntryOfferEligible(entry.id, entry.status, entry.desiredTier);

                      return (
                        <div
                          key={entry.id}
                          className="er-surface"
                          style={{
                            padding: '1rem',
                            borderRadius: 8,
                            border: '1px solid rgba(148, 163, 184, 0.18)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'start',
                              gap: '0.75rem',
                              marginBottom: '0.75rem',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                                {entry.displayIdentifier} → {entry.desiredTier}
                              </div>
                              <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                                Current: {entry.currentRentalType} • Check-in:{' '}
                                {entry.checkinAt ? new Date(entry.checkinAt).toLocaleTimeString() : '—'} • Checkout:{' '}
                                {entry.checkoutAt ? new Date(entry.checkoutAt).toLocaleTimeString() : '—'}
                              </div>
                            </div>
                          </div>

                          {status === 'ACTIVE' ? (
                            <button
                              onClick={() => onOffer(entry.id, entry.desiredTier, customerLabel)}
                              className="cs-liquid-button cs-liquid-button--secondary"
                              disabled={!eligible || isSubmitting}
                              style={{
                                padding: '0.5rem 1rem',
                                fontSize: '0.875rem',
                                fontWeight: 700,
                              }}
                            >
                              Offer Upgrade
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => onStartPayment(entry)}
                                className="cs-liquid-button"
                                disabled={!eligible || isSubmitting}
                                style={{
                                  padding: '0.5rem 0.9rem',
                                  fontSize: '0.875rem',
                                  fontWeight: 700,
                                }}
                              >
                                Start Payment
                              </button>
                              <button
                                onClick={() => onOpenPaymentQuote(entry)}
                                className="cs-liquid-button cs-liquid-button--secondary"
                                disabled={isSubmitting}
                                style={{
                                  padding: '0.5rem 0.9rem',
                                  fontSize: '0.875rem',
                                  fontWeight: 700,
                                }}
                              >
                                View Payment Quote
                              </button>
                              <button
                                onClick={() => onCancelOffer(entry.id)}
                                className="cs-liquid-button cs-liquid-button--danger"
                                disabled={isSubmitting}
                                style={{
                                  padding: '0.5rem 0.9rem',
                                  fontSize: '0.875rem',
                                  fontWeight: 700,
                                }}
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


