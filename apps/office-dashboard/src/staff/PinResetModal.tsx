import { useState, type FormEvent } from 'react';

interface PinResetModalProps {
  staffId: string;
  staffName: string;
  onClose: () => void;
  onReset: (staffId: string, newPin: string) => void;
}

export function PinResetModal({ staffId, staffName, onClose, onReset }: PinResetModalProps) {
  const [newPin, setNewPin] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (newPin.match(/^\d{6}$/)) {
      onReset(staffId, newPin);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '400px',
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1rem' }}>Reset PIN for {staffName}</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              New PIN (6 digits) *
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              pattern="\d{6}"
              inputMode="numeric"
              maxLength={6}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              className="cs-liquid-button cs-liquid-button--secondary"
            >
              Cancel
            </button>
            <button type="submit" className="cs-liquid-button">
              Reset PIN
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
