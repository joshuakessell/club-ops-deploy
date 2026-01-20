export interface RegisterTopActionsBarProps {
  onCheckout: () => void;
  onRoomCleaning: () => void;
}

export function RegisterTopActionsBar({ onCheckout, onRoomCleaning }: RegisterTopActionsBarProps) {
  return (
    <div className="action-buttons register-top-actions" aria-label="Register top actions">
      <button type="button" className="action-btn cs-liquid-button" onClick={onCheckout}>
        <span className="btn-icon" aria-hidden="true">
          ✅
        </span>
        Checkout
      </button>
      <button type="button" className="action-btn cs-liquid-button cs-liquid-button--secondary" onClick={onRoomCleaning}>
        <span className="btn-icon" aria-hidden="true">
          🧹
        </span>
        Room Cleaning
      </button>
    </div>
  );
}


