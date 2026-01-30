import { ModalFrame } from './ModalFrame';

export interface MembershipIdPromptModalProps {
  isOpen: boolean;
  membershipIdMode: 'KEEP_EXISTING' | 'ENTER_NEW';
  membershipIdInput: string;
  membershipNumber?: string | null;
  membershipPurchaseIntent?: 'PURCHASE' | 'RENEW' | null;
  error: string | null;
  isSubmitting: boolean;
  onModeChange: (mode: 'KEEP_EXISTING' | 'ENTER_NEW') => void;
  onInputChange: (value: string) => void;
  onConfirm: (membershipId?: string) => void;
  onNotNow: () => void;
}

export function MembershipIdPromptModal({
  isOpen,
  membershipIdMode,
  membershipIdInput,
  membershipNumber,
  membershipPurchaseIntent,
  error,
  isSubmitting,
  onModeChange,
  onInputChange,
  onConfirm,
  onNotNow,
}: MembershipIdPromptModalProps) {
  return (
    <ModalFrame isOpen={isOpen} title="Enter Membership ID" onClose={onNotNow} maxWidth="520px">
      <p className="er-text-muted u-mb-16">
        Payment was accepted for a 6 month membership. Scan or type the membership number from the
        physical card, then press Enter.
      </p>

      {membershipPurchaseIntent === 'RENEW' && membershipNumber ? (
        <div className="u-mb-12">
          <div className="u-flex u-gap-8 u-mb-12">
            <button
              onClick={() => onModeChange('KEEP_EXISTING')}
              disabled={isSubmitting}
              className={[
                'cs-liquid-button',
                'cs-liquid-button--secondary',
                membershipIdMode === 'KEEP_EXISTING' ? 'cs-liquid-button--selected' : '',
                'er-modal-button--compact',
                'u-flex-1',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              Keep Same ID
            </button>
            <button
              onClick={() => onModeChange('ENTER_NEW')}
              disabled={isSubmitting}
              className={[
                'cs-liquid-button',
                'cs-liquid-button--secondary',
                membershipIdMode === 'ENTER_NEW' ? 'cs-liquid-button--selected' : '',
                'er-modal-button--compact',
                'u-flex-1',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              Enter New ID
            </button>
          </div>

          {membershipIdMode === 'KEEP_EXISTING' && (
            <div className="cs-liquid-card er-membership-number">{membershipNumber}</div>
          )}
        </div>
      ) : null}

      {(membershipPurchaseIntent !== 'RENEW' ||
        !membershipNumber ||
        membershipIdMode === 'ENTER_NEW') && (
        <input
          type="text"
          value={membershipIdInput}
          autoFocus
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirm(
                membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                  ? (membershipNumber ?? undefined)
                  : undefined
              );
            }
          }}
          placeholder="Membership ID"
          disabled={isSubmitting}
          className="cs-liquid-input er-membership-input"
        />
      )}

      {error && <div className="er-modal-error-text">{error}</div>}

      <div className="u-flex u-gap-12">
        <button
          onClick={() =>
            onConfirm(
              membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                ? (membershipNumber ?? undefined)
                : undefined
            )
          }
          disabled={
            isSubmitting ||
            (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
              ? !membershipNumber
              : !membershipIdInput.trim())
          }
          className="cs-liquid-button er-modal-button er-modal-button--bold u-flex-1"
        >
          {isSubmitting ? 'Saving…' : 'Save Membership'}
        </button>
        <button
          onClick={onNotNow}
          disabled={isSubmitting}
          className="cs-liquid-button cs-liquid-button--secondary er-modal-button"
        >
          Not now
        </button>
      </div>
    </ModalFrame>
  );
}
