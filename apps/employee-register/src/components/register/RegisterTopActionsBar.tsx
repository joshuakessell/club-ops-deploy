export interface RegisterTopActionsBarProps {
  onCheckout(): void;
  onRoomCleaning(): void;
}

export function RegisterTopActionsBar({ onCheckout, onRoomCleaning }: RegisterTopActionsBarProps) {
  return (
    <div
      className="cs-liquid-card"
      style={{
        marginTop: '0.75rem',
        padding: '0.75rem',
        display: 'flex',
        justifyContent: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
      aria-label="Register top actions"
    >
      <button type="button" className="cs-liquid-button" onClick={onCheckout}>
        Checkout
      </button>
      <button type="button" className="cs-liquid-button cs-liquid-button--secondary" onClick={onRoomCleaning}>
        Room Cleaning
      </button>
    </div>
  );
}


