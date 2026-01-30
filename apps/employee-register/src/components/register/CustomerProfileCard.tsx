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
    <div className="u-min-w-0">
      <div className="er-text-sm er-text-muted u-fw-800 er-details-label">{label}</div>
      <div className="er-text-md u-fw-900 u-truncate">{value}</div>
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
    {
      membershipNumber: props.membershipNumber || null,
      membershipValidUntil: props.membershipValidUntil || null,
    },
    new Date()
  );
  const isMember = membershipStatus === 'ACTIVE';
  const expires = parseIsoDate(props.membershipValidUntil || null);
  const lastVisit = parseIsoDate(props.lastVisitAt || null);

  const languageLabel =
    props.preferredLanguage === 'EN'
      ? 'English'
      : props.preferredLanguage === 'ES'
        ? 'Español'
        : '—';

  return (
    <div className="cs-liquid-card er-profile-card">
      <div className="er-profile-header">
        <div className="er-profile-title">Customer Profile</div>
        {props.checkinStage ? (
          <div className="er-text-sm er-text-muted u-fw-900">
            Check-in Stage: {props.checkinStage.number} — {props.checkinStage.label}
          </div>
        ) : null}
      </div>

      <div className="er-profile-grid">
        <Detail label="Name" value={props.name || '—'} />
        <Detail label="Preferred Language" value={languageLabel} />
        <Detail label="DOB (MM/DD)" value={props.dobMonthDay || '—'} />
        <Detail label="Member" value={isMember ? 'Yes' : 'No'} />
        <Detail label="Membership Exp (MM/YY)" value={isMember ? formatMmYy(expires) : '—'} />
        <Detail label="Last Visit (MM/YY)" value={formatMmYy(lastVisit)} />
      </div>

      <div className="er-profile-marker">
        <input
          type="checkbox"
          checked={Boolean(props.hasEncryptedLookupMarker)}
          readOnly
          aria-label="Encrypted Lookup Marker"
        />
        <div className="er-text-sm er-text-muted u-fw-800">
          Encrypted Lookup Marker (DL hash)
        </div>
      </div>

      {props.waitlistDesiredTier && props.waitlistBackupType ? (
        <div className="cs-liquid-card er-waitlist-card">
          <div className="er-waitlist-title">Customer Waitlisted</div>
          <div className="er-text-sm u-fw-800">
            Requested <strong>{props.waitlistDesiredTier}</strong>; backup{' '}
            <strong>{props.waitlistBackupType}</strong>.
          </div>
        </div>
      ) : null}

      {props.footer ? (
        <div className="er-profile-footer">{props.footer}</div>
      ) : null}
    </div>
  );
}
