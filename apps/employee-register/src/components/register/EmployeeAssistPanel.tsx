import { useEffect, useMemo, useState } from 'react';
import { getCustomerMembershipStatus } from '@club-ops/shared';

export type EmployeeAssistStep =
  | 'LANGUAGE'
  | 'MEMBERSHIP'
  | 'UPGRADE'
  | 'RENTAL'
  | 'DONE';

type Pending =
  | { step: 'LANGUAGE'; option: 'EN' | 'ES' }
  | { step: 'MEMBERSHIP'; option: 'ONE_TIME' | 'SIX_MONTH' }
  | { step: 'WAITLIST_BACKUP'; option: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' }
  | { step: 'RENTAL'; option: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' };

type PendingState = Pending | null;

export interface EmployeeAssistPanelProps {
  sessionId: string;
  customerName: string;
  customerPrimaryLanguage?: 'EN' | 'ES' | null;
  membershipNumber?: string | null;
  customerMembershipValidUntil?: string | null;
  membershipPurchaseIntent?: 'PURCHASE' | 'RENEW' | null;
  membershipChoice?: 'ONE_TIME' | 'SIX_MONTH' | null;

  allowedRentals?: string[];

  proposedRentalType?: string | null;
  proposedBy?: 'CUSTOMER' | 'EMPLOYEE' | null;
  selectionConfirmed?: boolean;

  waitlistDesiredTier?: string | null;
  waitlistBackupType?: string | null;

  inventoryAvailable?: {
    rooms: Record<string, number>;
    lockers: number;
  } | null;

  isSubmitting?: boolean;

  onHighlightLanguage: (lang: 'EN' | 'ES' | null) => void;
  onConfirmLanguage: (lang: 'EN' | 'ES') => Promise<void> | void;

  onHighlightMembership: (choice: 'ONE_TIME' | 'SIX_MONTH' | null) => void;
  onConfirmMembershipOneTime: () => Promise<void> | void;
  onConfirmMembershipSixMonth: () => Promise<void> | void;

  onHighlightRental: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => Promise<void> | void;
  onSelectRentalAsCustomer: (
    rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => Promise<void> | void;
  onHighlightWaitlistBackup: (rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL' | null) => void;
  onSelectWaitlistBackupAsCustomer: (
    rental: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => Promise<void> | void;
  onApproveRental: () => Promise<void> | void;
}

function remainingCountLabel(count: number): { label: string; tone: 'ok' | 'low' | 'none' } {
  if (count <= 0) return { label: '0 remaining', tone: 'none' };
  if (count <= 5) return { label: `${count} remaining (low)`, tone: 'low' };
  return { label: `${count} remaining`, tone: 'ok' };
}

export function EmployeeAssistPanel(props: EmployeeAssistPanelProps) {
  const {
    sessionId,
    customerName,
    customerPrimaryLanguage,
    membershipNumber,
    customerMembershipValidUntil,
    membershipPurchaseIntent,
    membershipChoice,
    allowedRentals,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    waitlistDesiredTier,
    waitlistBackupType,
    inventoryAvailable,
    isSubmitting = false,
    onHighlightLanguage,
    onConfirmLanguage,
    onHighlightMembership,
    onConfirmMembershipOneTime,
    onConfirmMembershipSixMonth,
    onHighlightRental,
    onSelectRentalAsCustomer,
    onHighlightWaitlistBackup,
    onSelectWaitlistBackupAsCustomer,
    onApproveRental,
  } = props;

  const [pending, setPending] = useState<PendingState>(null);

  const runTwoStep = (
    step: Pending['step'],
    option: Pending['option'],
    isPending: boolean,
    onFirst: () => void,
    onSecond: () => void,
    onCancel?: () => void
  ) => {
    if (isSubmitting) return;
    if (isPending) {
      setPending(null);
      onCancel?.();
      void onSecond();
      return;
    }
    setPending({ step, option } as Pending);
    void onFirst();
  };

  const isLanguageNeeded = !customerPrimaryLanguage;
  const membershipStatus = useMemo(() => {
    if (membershipPurchaseIntent) return 'PENDING' as const;
    const base = getCustomerMembershipStatus(
      {
        membershipNumber: membershipNumber || null,
        membershipValidUntil: customerMembershipValidUntil || null,
      },
      new Date()
    );
    if (base === 'ACTIVE') return 'ACTIVE' as const;
    if (base === 'EXPIRED') return 'EXPIRED' as const;
    return 'NON_MEMBER' as const;
  }, [membershipPurchaseIntent, membershipNumber, customerMembershipValidUntil]);

  const isMember = membershipStatus === 'ACTIVE' || membershipStatus === 'PENDING';
  const isMembershipNeeded = !isMember && !membershipChoice;

  const step: EmployeeAssistStep = useMemo(() => {
    if (!sessionId || !customerName) return 'DONE';
    if (isLanguageNeeded) return 'LANGUAGE';
    if (isMembershipNeeded) return 'MEMBERSHIP';
    if (waitlistDesiredTier && !waitlistBackupType) return 'UPGRADE';
    if (selectionConfirmed) return 'DONE';
    if (proposedBy === 'CUSTOMER' && proposedRentalType) return 'DONE';
    return 'RENTAL';
  }, [
    customerName,
    isLanguageNeeded,
    isMembershipNeeded,
    proposedBy,
    proposedRentalType,
    selectionConfirmed,
    sessionId,
    waitlistBackupType,
    waitlistDesiredTier,
  ]);

  // Clear pending state when the session or step changes.
  useEffect(() => {
    setPending(null);
    // Clear kiosk highlights for step-driven (language/membership) highlights.
    onHighlightLanguage(null);
    onHighlightMembership(null);
    onHighlightWaitlistBackup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, step]);

  const rentalButtons = useMemo(() => {
    const lockers = Number(inventoryAvailable?.lockers ?? 0);
    const standard = Number(inventoryAvailable?.rooms?.STANDARD ?? 0);
    const deluxe = Number(inventoryAvailable?.rooms?.DOUBLE ?? 0);
    const special = Number(inventoryAvailable?.rooms?.SPECIAL ?? 0);

    const allowed = new Set(
      Array.isArray(allowedRentals) ? allowedRentals : ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL']
    );

    return [
      {
        id: 'LOCKER' as const,
        label: 'Propose Locker',
        count: lockers,
        allowed: allowed.has('LOCKER'),
      },
      {
        id: 'STANDARD' as const,
        label: 'Propose Standard',
        count: standard,
        allowed: allowed.has('STANDARD'),
      },
      {
        id: 'DOUBLE' as const,
        label: 'Propose Double',
        count: deluxe,
        allowed: allowed.has('DOUBLE'),
      },
      {
        id: 'SPECIAL' as const,
        label: 'Propose Special',
        count: special,
        allowed: allowed.has('SPECIAL'),
      },
    ];
  }, [allowedRentals, inventoryAvailable]);

  const waitlistBackupButtons = useMemo(() => {
    if (!waitlistDesiredTier) return [];
    const lockers = Number(inventoryAvailable?.lockers ?? 0);
    const standard = Number(inventoryAvailable?.rooms?.STANDARD ?? 0);
    const deluxe = Number(inventoryAvailable?.rooms?.DOUBLE ?? 0);
    const special = Number(inventoryAvailable?.rooms?.SPECIAL ?? 0);

    const allowed = new Set(
      Array.isArray(allowedRentals) ? allowedRentals : ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL']
    );
    const candidates = [
      {
        id: 'LOCKER' as const,
        label: 'Backup Locker',
        count: lockers,
        allowed: allowed.has('LOCKER'),
      },
      {
        id: 'STANDARD' as const,
        label: 'Backup Standard',
        count: standard,
        allowed: allowed.has('STANDARD'),
      },
      {
        id: 'DOUBLE' as const,
        label: 'Backup Double',
        count: deluxe,
        allowed: allowed.has('DOUBLE'),
      },
      {
        id: 'SPECIAL' as const,
        label: 'Backup Special',
        count: special,
        allowed: allowed.has('SPECIAL'),
      },
    ];

    return candidates.filter((c) => c.id !== waitlistDesiredTier);
  }, [allowedRentals, inventoryAvailable, waitlistDesiredTier]);

  return (
    <div
      className="cs-liquid-card"
      style={{
        padding: '0.9rem',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          alignItems: 'baseline',
        }}
      >
        <div style={{ fontWeight: 950, fontSize: '1rem' }}>Employee Assist</div>
        <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
          Step: {step}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          marginTop: '0.75rem',
          overflowY: 'auto',
          paddingRight: '0.25rem',
        }}
      >
        {step === 'LANGUAGE' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
              Tap once to set the language (it will also highlight on the kiosk).
            </div>
            {(
              [
                { id: 'EN' as const, label: 'English' },
                { id: 'ES' as const, label: 'Español' },
              ] as const
            ).map((opt) => {
              const isPending = pending?.step === 'LANGUAGE' && pending.option === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={[
                    'cs-liquid-button',
                    isPending ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                  ].join(' ')}
                  disabled={isSubmitting}
                  onClick={() => {
                    if (isSubmitting) return;
                    setPending({ step: 'LANGUAGE', option: opt.id });
                    onHighlightLanguage(opt.id);
                    void onConfirmLanguage(opt.id);
                  }}
                  style={{ width: '100%', padding: '0.9rem 1rem', fontWeight: 900 }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {step === 'MEMBERSHIP' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
              Tap once to highlight on kiosk, tap again to confirm.
            </div>
            {(
              [
                { id: 'ONE_TIME' as const, label: 'One-time Membership' },
                { id: 'SIX_MONTH' as const, label: '6-Month Membership' },
              ] as const
            ).map((opt) => {
              const isPending = pending?.step === 'MEMBERSHIP' && pending.option === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={[
                    'cs-liquid-button',
                    isPending ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                  ].join(' ')}
                  disabled={isSubmitting}
                  onClick={() => {
                    runTwoStep(
                      'MEMBERSHIP',
                      opt.id,
                      isPending,
                      () => onHighlightMembership(opt.id),
                      () => {
                        if (opt.id === 'ONE_TIME') return onConfirmMembershipOneTime();
                        return onConfirmMembershipSixMonth();
                      },
                      () => onHighlightMembership(null)
                    );
                  }}
                  style={{ width: '100%', padding: '0.9rem 1rem', fontWeight: 900 }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {step === 'UPGRADE' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
              Customer selected {waitlistDesiredTier}. Choose a backup rental.
            </div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {waitlistBackupButtons.map((btn) => {
                const isPending = pending?.step === 'WAITLIST_BACKUP' && pending.option === btn.id;
                const { label: countLabel, tone } = remainingCountLabel(btn.count);
                const disabled = isSubmitting || !btn.allowed || btn.count <= 0;
                const toneClass =
                  tone === 'none'
                    ? 'cs-liquid-button--secondary'
                    : tone === 'low'
                      ? 'cs-liquid-button--warning'
                      : 'cs-liquid-button--secondary';
                return (
                  <button
                    key={btn.id}
                    type="button"
                    className={[
                      'cs-liquid-button',
                      isPending ? 'cs-liquid-button--selected' : toneClass,
                    ].join(' ')}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      runTwoStep(
                        'WAITLIST_BACKUP',
                        btn.id,
                        isPending,
                        () => onHighlightWaitlistBackup(btn.id),
                        () => onSelectWaitlistBackupAsCustomer(btn.id),
                        () => onHighlightWaitlistBackup(null)
                      );
                    }}
                    style={{
                      width: '100%',
                      padding: '0.85rem 1rem',
                      fontWeight: 950,
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '0.75rem',
                    }}
                  >
                    <span>{btn.label}</span>
                    <span
                      className="er-text-sm"
                      style={{
                        fontWeight: 900,
                        color: tone === 'none' ? '#ef4444' : tone === 'low' ? '#f59e0b' : '#94a3b8',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {countLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'RENTAL' && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
              Tap once to propose on kiosk, tap again to confirm.
            </div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {rentalButtons.map((btn) => {
                const isPending = pending?.step === 'RENTAL' && pending.option === btn.id;
                const { label: countLabel, tone } = remainingCountLabel(btn.count);
                const disabled = isSubmitting || !btn.allowed;
                const toneClass =
                  tone === 'none'
                    ? 'cs-liquid-button--secondary'
                    : tone === 'low'
                      ? 'cs-liquid-button--warning'
                      : 'cs-liquid-button--secondary';
                return (
                  <button
                    key={btn.id}
                    type="button"
                    className={[
                      'cs-liquid-button',
                      isPending ? 'cs-liquid-button--selected' : toneClass,
                    ].join(' ')}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      runTwoStep(
                        'RENTAL',
                        btn.id,
                        isPending,
                        () => onHighlightRental(btn.id),
                        () => onApproveRental()
                      );
                    }}
                    style={{
                      width: '100%',
                      padding: '0.85rem 1rem',
                      fontWeight: 950,
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '0.75rem',
                    }}
                  >
                    <span>{btn.label}</span>
                    <span
                      className="er-text-sm"
                      style={{
                        fontWeight: 900,
                        color: tone === 'none' ? '#ef4444' : tone === 'low' ? '#f59e0b' : '#94a3b8',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {countLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'DONE' && (
          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
            Waiting for next customer action…
          </div>
        )}
      </div>
    </div>
  );
}
