import { ModalFrame } from './ModalFrame';
import { LiquidGlassPinInput } from '@club-ops/ui';

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
      <div className="u-mb-16">
        <label className="er-modal-label">Select Manager</label>
        <select
          value={managerId}
          onChange={(e) => onChangeManagerId(e.target.value)}
          className="cs-liquid-input er-modal-select"
        >
          <option value="">Select a manager...</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      </div>
      <div className="u-mb-24">
        <label className="er-modal-label">PIN</label>
        <LiquidGlassPinInput
          length={6}
          value={managerPin}
          onChange={onChangeManagerPin}
          onSubmit={() => {
            if (!managerId) return;
            if (managerPin.trim().length !== 6) return;
            onBypass();
          }}
          submitLabel={isSubmitting ? 'Processing…' : 'Bypass'}
          submitDisabled={isSubmitting || !managerId}
          disabled={isSubmitting}
          displayAriaLabel="Manager PIN"
        />
      </div>
      <div className="u-flex u-gap-8">
        <button
          onClick={onBypass}
          disabled={isSubmitting || !managerId || managerPin.trim().length !== 6}
          className="cs-liquid-button er-modal-button u-flex-1"
        >
          {isSubmitting ? 'Processing...' : 'Bypass'}
        </button>
        <button
          onClick={onCancel}
          className="cs-liquid-button cs-liquid-button--danger er-modal-button u-flex-1"
        >
          Cancel
        </button>
      </div>
    </ModalFrame>
  );
}
