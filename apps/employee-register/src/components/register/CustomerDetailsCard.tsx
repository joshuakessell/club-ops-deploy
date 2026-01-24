import type { ReactNode } from 'react';

export interface CustomerDetailsCardProps {
  name: string;
  dobMonthDay?: string | null;
  language?: string | null;
  membershipNumber?: string | null;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.15rem' }}>
        {label}
      </div>
      <div
        className="er-text-md"
        style={{
          fontWeight: 800,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
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
    <div className="cs-liquid-card" style={{ padding: '0.9rem' }}>
      <div style={{ fontWeight: 950, fontSize: '1rem', marginBottom: '0.6rem' }}>
        Customer Details
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.65rem 0.9rem',
          alignItems: 'start',
        }}
      >
        <DetailRow label="Name" value={name || '—'} />
        <DetailRow label="DOB" value={dobMonthDay || '—'} />
        <DetailRow label="Language" value={language || '—'} />
        {membershipNumber ? <DetailRow label="Member #" value={membershipNumber} /> : null}
      </div>
    </div>
  );
}
