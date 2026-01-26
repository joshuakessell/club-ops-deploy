import { useState, type FormEvent } from 'react';

interface CreateStaffModalProps {
  onClose: () => void;
  onCreate: (data: { name: string; role: 'STAFF' | 'ADMIN'; pin: string; active: boolean }) => void;
}

export function CreateStaffModal({ onClose, onCreate }: CreateStaffModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'STAFF' | 'ADMIN'>('STAFF');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pin.match(/^\d{6}$/)) {
      return;
    }
    onCreate({ name: name.trim(), role, pin, active });
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
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '500px',
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>Create Staff Member</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
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
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              Role *
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'STAFF' | 'ADMIN')}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#f9fafb',
                fontSize: '1rem',
              }}
            >
              <option value="STAFF">STAFF</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
              PIN (6 digits) *
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
          <div style={{ marginBottom: '1.5rem' }}>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
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
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
