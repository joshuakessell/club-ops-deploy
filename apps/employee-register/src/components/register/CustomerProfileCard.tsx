import type { ReactNode } from 'react';
import { getCustomerMembershipStatus } from '@club-ops/shared';

export type CheckinStage = { number: 1 | 2 | 3 | 4 | 5 | 6; label: string };

export interface CustomerProfileCardProps {
  name: string;
  preferredLanguage?: 'EN' | 'ES' | null;
  dobMonthDay?: string | null; // MM/DD
  membershipNumber?: string | null;
  membershipValidUntil?: string | null; // YYYY-MM-DD
  lastVisitAt?: string | null; // ISO timestamp
  hasEncryptedLookupMarker?: boolean;
  checkinStage?: CheckinStage | null;
  waitlistDesiredTier?: string | null;
  waitlistBackupType?: string | null;
  footer?: ReactNode;
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.15rem', fontWeight: 800 }}>
        {label}
      </div>
      <div
        className="er-text-md"
        style={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {value}
      </div>
    </div>
  );
}

function formatMmYy(value: Date | null): string {
  if (!value) return '—';
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const yy = String(value.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function CustomerProfileCard(props: CustomerProfileCardProps) {
  const membershipStatus = getCustomerMembershipStatus(
    { membershipNumber: props.membershipNumber || null, membershipValidUntil: props.membershipValidUntil || null },
    new Date()
  );
  const isMember = membershipStatus === 'ACTIVE';
  const expires = parseIsoDate(props.membershipValidUntil || null);
  const lastVisit = parseIsoDate(props.lastVisitAt || null);

  const languageLabel =
    props.preferredLanguage === 'EN' ? 'English' : props.preferredLanguage === 'ES' ? 'Español' : '—';

  return (
    <div className="cs-liquid-card" style={{ padding: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 950, fontSize: '1rem' }}>Customer Profile</div>
        {props.checkinStage ? (
          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 900 }}>
            Check-in Stage: {props.checkinStage.number} — {props.checkinStage.label}
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: '0.6rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '0.65rem 0.9rem',
          alignItems: 'start',
        }}
      >
        <Detail label="Name" value={props.name || '—'} />
        <Detail label="Preferred Language" value={languageLabel} />
        <Detail label="DOB (MM/DD)" value={props.dobMonthDay || '—'} />
        <Detail label="Member" value={isMember ? 'Yes' : 'No'} />
        <Detail label="Membership Exp (MM/YY)" value={isMember ? formatMmYy(expires) : '—'} />
        <Detail label="Last Visit (MM/YY)" value={formatMmYy(lastVisit)} />
      </div>

      <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="checkbox"
          checked={Boolean(props.hasEncryptedLookupMarker)}
          readOnly
          aria-label="Encrypted Lookup Marker"
        />
        <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
          Encrypted Lookup Marker (DL hash)
        </div>
      </div>

      {props.waitlistDesiredTier && props.waitlistBackupType ? (
        <div
          className="cs-liquid-card"
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: '10px',
            color: '#92400e',
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: '0.35rem' }}>Customer Waitlisted</div>
          <div className="er-text-sm" style={{ fontWeight: 800 }}>
            Requested <strong>{props.waitlistDesiredTier}</strong>; backup <strong>{props.waitlistBackupType}</strong>.
          </div>
        </div>
      ) : null}

      {props.footer ? (
        <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'center' }}>{props.footer}</div>
      ) : null}
    </div>
  );
}

