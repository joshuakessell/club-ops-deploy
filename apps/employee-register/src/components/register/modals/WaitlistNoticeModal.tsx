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
      <p className="er-modal-copy">
        Customer requested waitlist for {desiredTier}. Assigning a {backupType} in the meantime.
      </p>
      <button
        onClick={onClose}
        className="cs-liquid-button er-modal-action-btn"
      >
        OK
      </button>
    </ModalFrame>
  );
}
