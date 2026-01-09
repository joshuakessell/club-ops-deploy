import { ModalFrame } from './ModalFrame';

export interface WaitlistNoticeModalProps {
  isOpen: boolean;
  desiredTier: string;
  backupType: string;
  onClose: () => void;
}

export function WaitlistNoticeModal({
  isOpen,
  desiredTier,
  backupType,
  onClose,
}: WaitlistNoticeModalProps) {
  return (
    <ModalFrame isOpen={isOpen} title="Waitlist Notice" onClose={onClose}>
      <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
        Customer requested waitlist for {desiredTier}. Assigning a {backupType} in the meantime.
      </p>
      <button
        onClick={onClose}
        className="cs-liquid-button"
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        OK
      </button>
    </ModalFrame>
  );
}

