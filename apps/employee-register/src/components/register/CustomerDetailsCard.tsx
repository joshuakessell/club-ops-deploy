import type { ReactNode } from 'react';

export interface CustomerDetailsCardProps {
  name: string;
  dobMonthDay?: string | null;
  language?: string | null;
  membershipNumber?: string | null;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="u-min-w-0">
      <div className="er-text-sm er-text-muted er-details-label">{label}</div>
      <div className="er-text-md u-fw-800 u-truncate">{value}</div>
    </div>
  );
}

export function CustomerDetailsCard({
  name,
  dobMonthDay,
  language,
  membershipNumber,
}: CustomerDetailsCardProps) {
  return (
    <div className="cs-liquid-card er-details-card">
      <div className="er-details-title">Customer Details</div>
      <div className="er-details-grid">
        <DetailRow label="Name" value={name || '—'} />
        <DetailRow label="DOB" value={dobMonthDay || '—'} />
        <DetailRow label="Language" value={language || '—'} />
        {membershipNumber ? <DetailRow label="Member #" value={membershipNumber} /> : null}
      </div>
    </div>
  );
}
