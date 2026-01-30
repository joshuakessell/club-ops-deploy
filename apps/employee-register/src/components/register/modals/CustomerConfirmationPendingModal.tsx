import { ModalFrame } from './ModalFrame';

export interface CustomerConfirmationPendingModalProps {
  isOpen: boolean;
  data: {
    requested: string;
    selected: string;
    number: string;
  };
  onCancel?: () => void;
}

export function CustomerConfirmationPendingModal({
  isOpen,
  data,
  onCancel,
}: CustomerConfirmationPendingModalProps) {
  return (
    <ModalFrame
      isOpen={isOpen}
      title="Waiting for Customer Confirmation"
      onClose={() => {}}
      closeOnOverlayClick={false}
    >
      <p className="er-modal-copy">
        Staff selected a different option: {data.selected} {data.number}. Waiting for customer to
        accept or decline on their device.
      </p>
      {onCancel && (
        <button
          onClick={onCancel}
          className="cs-liquid-button cs-liquid-button--danger er-modal-action-btn"
        >
          Cancel
        </button>
      )}
    </ModalFrame>
  );
}
