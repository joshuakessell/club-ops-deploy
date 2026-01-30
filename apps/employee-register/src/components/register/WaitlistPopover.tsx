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
    <div className="er-waitlist-popover">
      <div className="cs-liquid-card er-waitlist-popover-card">
        <div className="er-waitlist-popover-header">
          <div className="er-waitlist-popover-title">Waitlist</div>
          <button
            onClick={onClose}
            className="cs-liquid-button cs-liquid-button--secondary er-waitlist-popover-close"
          >
            Close
          </button>
        </div>
        <div
          className={[
            'er-waitlist-popover-list',
            disabledReason ? 'er-waitlist-popover-list--disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {items.length === 0 && (
            <div className="er-waitlist-empty">No waitlist entries</div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="er-waitlist-row"
            >
              <div>
                <div className="er-waitlist-item-title">{item.title}</div>
                <div className="er-waitlist-item-subtitle">{item.subtitle}</div>
              </div>
              <button
                aria-label={`Begin upgrade for ${item.title}`}
                onClick={() => onAction(item.id, item.customerName)}
                className={[
                  'cs-liquid-button',
                  item.eligible ? '' : 'cs-liquid-button--secondary',
                  'er-waitlist-action',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!item.eligible}
              >
                🔑
              </button>
            </div>
          ))}
          {hasMore && (
            <div
              onClick={onMore}
              className="er-waitlist-more"
            >
              More..
            </div>
          )}
        </div>
        {disabledReason && (
          <div className="er-waitlist-disabled-reason">{disabledReason}</div>
        )}
      </div>
    </div>
  );
}
