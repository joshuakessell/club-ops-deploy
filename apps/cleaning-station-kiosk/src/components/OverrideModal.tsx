import { RoomStatus } from '@club-ops/shared';

export interface OverrideModalProps {
  isOpen: boolean;
  roomNumber: string;
  fromStatus: RoomStatus;
  toStatus: RoomStatus;
  reason: string;
  onChangeReason: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OverrideModal({
  isOpen,
  roomNumber,
  fromStatus,
  toStatus,
  reason,
  onChangeReason,
  onConfirm,
  onCancel,
}: OverrideModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="modal-content">
        <h2>Override Required</h2>
        <p>
          Room {roomNumber}: {fromStatus} → {toStatus}
        </p>
        <p className="modal-warning">This transition skips a step and requires a reason.</p>
        <textarea
          className="modal-textarea"
          placeholder="Enter reason for override..."
          value={reason}
          onChange={(e) => onChangeReason(e.target.value)}
          rows={4}
        />
        <div className="modal-actions">
          <button className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={onConfirm}
            disabled={!reason.trim()}
          >
            Confirm Override
          </button>
        </div>
      </div>
    </div>
  );
}

