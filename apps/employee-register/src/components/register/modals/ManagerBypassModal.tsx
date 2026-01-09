import { ModalFrame } from './ModalFrame';

export interface ManagerBypassModalProps {
  isOpen: boolean;
  managers: Array<{ id: string; name: string }>;
  managerId: string;
  managerPin: string;
  onChangeManagerId: (id: string) => void;
  onChangeManagerPin: (pin: string) => void;
  onBypass: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ManagerBypassModal({
  isOpen,
  managers,
  managerId,
  managerPin,
  onChangeManagerId,
  onChangeManagerPin,
  onBypass,
  onCancel,
  isSubmitting,
}: ManagerBypassModalProps) {
  return (
    <ModalFrame isOpen={isOpen} title="Manager Bypass" onClose={onCancel}>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          Select Manager
        </label>
        <select
          value={managerId}
          onChange={(e) => onChangeManagerId(e.target.value)}
          className="cs-liquid-input"
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '1rem',
          }}
        >
          <option value="">Select a manager...</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
          PIN
        </label>
        <input
          type="password"
          value={managerPin}
          onChange={(e) => onChangeManagerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Enter 6-digit PIN"
          maxLength={6}
          inputMode="numeric"
          pattern="[0-9]*"
          className="cs-liquid-input"
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '1rem',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={onBypass}
          disabled={isSubmitting || !managerId || managerPin.trim().length !== 6}
          className="cs-liquid-button"
          style={{
            flex: 1,
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          {isSubmitting ? 'Processing...' : 'Bypass'}
        </button>
        <button
          onClick={onCancel}
          className="cs-liquid-button cs-liquid-button--danger"
          style={{
            flex: 1,
            padding: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </ModalFrame>
  );
}

