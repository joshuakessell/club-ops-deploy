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
    <ModalFrame isOpen={isOpen} title="Waiting for Customer Confirmation" onClose={() => {}} closeOnOverlayClick={false}>
      <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
        Staff selected a different option: {data.selected} {data.number}. Waiting for customer to
        accept or decline on their device.
      </p>
      {onCancel && (
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      )}
    </ModalFrame>
  );
}

