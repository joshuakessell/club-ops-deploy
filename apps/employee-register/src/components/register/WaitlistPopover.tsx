export interface WaitlistPopoverItem {
  id: string;
  title: string; // entry.customerName || entry.displayIdentifier
  subtitle: string; // `${entry.displayIdentifier} → ${entry.desiredTier}`
  eligible: boolean;
  customerName?: string | null;
}

export interface WaitlistPopoverProps {
  open: boolean;
  disabledReason?: string | null; // when sessionActive
  items: WaitlistPopoverItem[];
  hasMore: boolean;
  onClose: () => void;
  onAction: (id: string, customerName?: string | null) => void;
  onMore: () => void;
}

export function WaitlistPopover({
  open,
  disabledReason,
  items,
  hasMore,
  onClose,
  onAction,
  onMore,
}: WaitlistPopoverProps) {
  if (!open) return null;

  return (
    <div style={{ position: 'relative', marginTop: '0.5rem' }}>
      <div
        className="cs-liquid-card"
        style={{
          position: 'absolute',
          right: 0,
          zIndex: 1500,
          width: '320px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            padding: '0.75rem',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontWeight: 700, color: '#f59e0b' }}>Waitlist</div>
          <button
            onClick={onClose}
            className="cs-liquid-button cs-liquid-button--secondary"
            style={{
              fontSize: '0.9rem',
              padding: '0.25rem 0.6rem',
            }}
          >
            Close
          </button>
        </div>
        <div
          style={{
            maxHeight: '260px',
            overflowY: 'auto',
            opacity: disabledReason ? 0.65 : 1,
            pointerEvents: disabledReason ? 'none' : 'auto',
          }}
        >
          {items.length === 0 && (
            <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No waitlist entries</div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: '0.75rem',
                borderBottom: '1px solid #1f2937',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{item.subtitle}</div>
              </div>
              <button
                aria-label={`Begin upgrade for ${item.title}`}
                onClick={() => onAction(item.id, item.customerName)}
                className={[
                  'cs-liquid-button',
                  item.eligible ? '' : 'cs-liquid-button--secondary',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  padding: '0.4rem 0.55rem',
                  fontWeight: 700,
                }}
                disabled={!item.eligible}
              >
                🔑
              </button>
            </div>
          ))}
          {hasMore && (
            <div
              onClick={onMore}
              style={{
                padding: '0.75rem',
                borderTop: '1px solid #1f2937',
                color: '#f59e0b',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              More..
            </div>
          )}
        </div>
        {disabledReason && (
          <div
            style={{
              padding: '0.65rem 0.75rem',
              color: '#f59e0b',
              fontSize: '0.85rem',
              borderTop: '1px solid #1f2937',
            }}
          >
            {disabledReason}
          </div>
        )}
      </div>
    </div>
  );
}

