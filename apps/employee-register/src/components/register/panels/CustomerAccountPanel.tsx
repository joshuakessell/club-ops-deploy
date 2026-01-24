import type { CheckinStage } from '../CustomerProfileCard';
import { CustomerProfileCard } from '../CustomerProfileCard';
import { EmployeeAssistPanel } from '../EmployeeAssistPanel';
import { useStartLaneCheckinForCustomerIfNotVisiting } from '../../../app/useStartLaneCheckinForCustomerIfNotVisiting';

function formatLocal(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
}

export function CustomerAccountPanel(props: {
  lane: string;
  sessionToken: string | null | undefined;
  customerId: string;
  customerLabel?: string | null;
  onStartCheckout: (prefill?: { number?: string | null }) => void;
  onClearSession: () => void;

  // lane session state (server-authoritative via WS)
  currentSessionId: string | null;
  currentSessionCustomerId: string | null;
  customerName: string;
  membershipNumber: string;
  customerMembershipValidUntil: string | null;
  membershipPurchaseIntent: 'PURCHASE' | 'RENEW' | null;
  membershipChoice: 'ONE_TIME' | 'SIX_MONTH' | null;
  allowedRentals: string[];
  proposedRentalType: string | null;
  proposedBy: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionConfirmed: boolean;
  customerPrimaryLanguage: 'EN' | 'ES' | undefined;
  customerDobMonthDay: string | undefined;
  customerLastVisitAt: string | undefined;
  hasEncryptedLookupMarker: boolean;
  waitlistDesiredTier: string | null;
  waitlistBackupType: string | null;
  inventoryAvailable: null | { rooms: Record<string, number>; lockers: number };
  isSubmitting: boolean;
  checkinStage: CheckinStage | null;

  // callbacks to apply immediate REST response (WS will still be source-of-truth)
  onStartedSession: (payload: {
    sessionId?: string;
    customerName?: string;
    membershipNumber?: string;
    mode?: 'CHECKIN' | 'RENEWAL';
    blockEndsAt?: string;
    activeAssignedResourceType?: 'room' | 'locker';
    activeAssignedResourceNumber?: string;
    customerHasEncryptedLookupMarker?: boolean;
  }) => void;

  // employee-side lane actions
  onHighlightLanguage: (lang: 'EN' | 'ES' | null) => void;
  onConfirmLanguage: (lang: 'EN' | 'ES') => void;
  onHighlightMembership: (choice: 'ONE_TIME' | 'SIX_MONTH' | null) => void;
  onConfirmMembershipOneTime: () => void;
  onConfirmMembershipSixMonth: () => void;
  onHighlightRental: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => void;
  onSelectRentalAsCustomer: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => void;
  onHighlightWaitlistBackup: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null) => void;
  onSelectWaitlistBackupAsCustomer: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => void;
  onApproveRental: () => void;
}) {
  const { state, retry } = useStartLaneCheckinForCustomerIfNotVisiting({
    lane: props.lane,
    sessionToken: props.sessionToken,
    customerId: props.customerId,
    currentLaneSession: { currentSessionId: props.currentSessionId, customerId: props.currentSessionCustomerId },
    onStarted: props.onStartedSession,
  });

  return (
    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 950, fontSize: '1.05rem' }}>Customer Account</div>
        {props.customerLabel ? (
          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
            {props.customerLabel}
          </div>
        ) : null}
      </div>

      {state.mode === 'ALREADY_VISITING' ? (
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.75rem' }}>
          <div
            className="cs-liquid-card"
            style={{
              padding: '0.85rem',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              background: 'rgba(34, 197, 94, 0.10)',
            }}
          >
            <div style={{ fontWeight: 950, marginBottom: '0.35rem' }}>Currently Checked In</div>
            <div className="er-text-sm" style={{ color: '#cbd5e1', fontWeight: 700, lineHeight: 1.45 }}>
              This customer already has an active visit. No new check-in was started.
            </div>
          </div>

          <div className="cs-liquid-card" style={{ padding: '0.85rem' }}>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div>
                <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                  Assigned
                </div>
                <div style={{ fontWeight: 900 }}>
                  {state.activeCheckin.assignedResourceType && state.activeCheckin.assignedResourceNumber
                    ? `${state.activeCheckin.assignedResourceType === 'room' ? 'Room' : 'Locker'} ${
                        state.activeCheckin.assignedResourceNumber
                      }`
                    : '—'}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                      Check-in
                    </div>
                    <div style={{ fontWeight: 800 }}>{formatLocal(state.activeCheckin.checkinAt)}</div>
                  </div>
                  <div>
                    <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                      Checkout
                    </div>
                    <div style={{ fontWeight: 800 }}>
                      {formatLocal(state.activeCheckin.checkoutAt)}{' '}
                      {state.activeCheckin.overdue ? <span style={{ color: '#f59e0b' }}>(overdue)</span> : null}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minWidth: 220 }}>
                  <button
                    type="button"
                    className="cs-liquid-button"
                    onClick={() => props.onStartCheckout({ number: state.activeCheckin.assignedResourceNumber })}
                    style={{ width: '100%', maxWidth: 260, padding: '0.7rem', fontWeight: 900 }}
                  >
                    Checkout
                  </button>
                </div>
              </div>

              {state.activeCheckin.waitlist ? (
                <div>
                  <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                    Pending upgrade request
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {state.activeCheckin.waitlist.desiredTier} (backup: {state.activeCheckin.waitlist.backupTier}) •{' '}
                    {state.activeCheckin.waitlist.status}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : state.mode === 'ERROR' ? (
        <div style={{ marginTop: '0.75rem' }}>
          <div
            className="cs-liquid-card"
            style={{
              padding: '0.85rem',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#fecaca',
              fontWeight: 800,
            }}
          >
            {state.errorMessage}
          </div>
          <button
            type="button"
            onClick={retry}
            className="cs-liquid-button"
            style={{ marginTop: '0.75rem', width: '100%', padding: '0.75rem', fontWeight: 900 }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
          {props.currentSessionId && props.customerName ? (
            <>
              <CustomerProfileCard
                name={props.customerName}
                preferredLanguage={props.customerPrimaryLanguage || null}
                dobMonthDay={props.customerDobMonthDay || null}
                membershipNumber={props.membershipNumber || null}
                membershipValidUntil={props.customerMembershipValidUntil || null}
                lastVisitAt={props.customerLastVisitAt || null}
                hasEncryptedLookupMarker={Boolean(props.hasEncryptedLookupMarker)}
                checkinStage={props.checkinStage}
                waitlistDesiredTier={props.waitlistDesiredTier}
                waitlistBackupType={props.waitlistBackupType}
                footer={
                  props.checkinStage ? (
                    <button
                      type="button"
                      className="cs-liquid-button cs-liquid-button--danger"
                      onClick={props.onClearSession}
                      style={{ width: '100%', maxWidth: 320, padding: '0.7rem', fontWeight: 900 }}
                    >
                      Clear Session
                    </button>
                  ) : null
                }
              />

              <EmployeeAssistPanel
                sessionId={props.currentSessionId}
                customerName={props.customerName}
                customerPrimaryLanguage={props.customerPrimaryLanguage}
                membershipNumber={props.membershipNumber || null}
                customerMembershipValidUntil={props.customerMembershipValidUntil}
                membershipPurchaseIntent={props.membershipPurchaseIntent}
                membershipChoice={props.membershipChoice}
                allowedRentals={props.allowedRentals}
                proposedRentalType={props.proposedRentalType}
                proposedBy={props.proposedBy}
                selectionConfirmed={props.selectionConfirmed}
                waitlistDesiredTier={props.waitlistDesiredTier}
                waitlistBackupType={props.waitlistBackupType}
                inventoryAvailable={props.inventoryAvailable}
                isSubmitting={props.isSubmitting}
                onHighlightLanguage={props.onHighlightLanguage}
                onConfirmLanguage={props.onConfirmLanguage}
                onHighlightMembership={props.onHighlightMembership}
                onConfirmMembershipOneTime={props.onConfirmMembershipOneTime}
                onConfirmMembershipSixMonth={props.onConfirmMembershipSixMonth}
                onHighlightRental={props.onHighlightRental}
                onSelectRentalAsCustomer={props.onSelectRentalAsCustomer}
                onHighlightWaitlistBackup={props.onHighlightWaitlistBackup}
                onSelectWaitlistBackupAsCustomer={props.onSelectWaitlistBackupAsCustomer}
                onApproveRental={props.onApproveRental}
              />
            </>
          ) : (
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
              {state.isStarting ? 'Starting check-in…' : 'Waiting for lane session…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
