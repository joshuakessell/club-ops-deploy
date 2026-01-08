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
      <p style={{ marginBottom: '1rem', color: '#94a3b8' }}>
        Payment was accepted for a 6 month membership. Scan or type the membership number from the
        physical card, then press Enter.
      </p>

      {membershipPurchaseIntent === 'RENEW' && membershipNumber ? (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button
              onClick={() => onModeChange('KEEP_EXISTING')}
              disabled={isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                background: membershipIdMode === 'KEEP_EXISTING' ? '#3b82f6' : 'transparent',
                color: membershipIdMode === 'KEEP_EXISTING' ? 'white' : '#cbd5e1',
                border: '1px solid #475569',
                borderRadius: '6px',
                fontWeight: 700,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Keep Same ID
            </button>
            <button
              onClick={() => onModeChange('ENTER_NEW')}
              disabled={isSubmitting}
              style={{
                flex: 1,
                padding: '0.6rem',
                background: membershipIdMode === 'ENTER_NEW' ? '#3b82f6' : 'transparent',
                color: membershipIdMode === 'ENTER_NEW' ? 'white' : '#cbd5e1',
                border: '1px solid #475569',
                borderRadius: '6px',
                fontWeight: 700,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              Enter New ID
            </button>
          </div>

          {membershipIdMode === 'KEEP_EXISTING' && (
            <div
              style={{
                padding: '0.75rem',
                background: '#0f172a',
                border: '1px solid #475569',
                borderRadius: '6px',
                color: 'white',
                fontSize: '1.25rem',
                letterSpacing: '0.04em',
              }}
            >
              {membershipNumber}
            </div>
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
                  ? membershipNumber ?? undefined
                  : undefined
              );
            }
          }}
          placeholder="Membership ID"
          disabled={isSubmitting}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: '#0f172a',
            border: '1px solid #475569',
            borderRadius: '6px',
            color: 'white',
            fontSize: '1.25rem',
            letterSpacing: '0.04em',
            marginBottom: '0.75rem',
          }}
        />
      )}

      {error && <div style={{ color: '#fecaca', marginBottom: '0.75rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={() =>
            onConfirm(
              membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                ? membershipNumber ?? undefined
                : undefined
            )
          }
          disabled={
            isSubmitting ||
            (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
              ? !membershipNumber
              : !membershipIdInput.trim())
          }
          style={{
            flex: 1,
            padding: '0.75rem',
            background:
              (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                ? membershipNumber
                : membershipIdInput.trim())
                ? '#3b82f6'
                : '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '1rem',
            fontWeight: 700,
            cursor:
              isSubmitting ||
              (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                ? !membershipNumber
                : !membershipIdInput.trim())
                ? 'not-allowed'
                : 'pointer',
          }}
        >
          {isSubmitting ? 'Saving…' : 'Save Membership'}
        </button>
        <button
          onClick={onNotNow}
          disabled={isSubmitting}
          style={{
            padding: '0.75rem 1rem',
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: '6px',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </ModalFrame>
  );
}

