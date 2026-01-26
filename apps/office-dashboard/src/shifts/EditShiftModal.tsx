import { useState } from 'react';
import type { Shift } from './types';

interface EditShiftModalProps {
  shift: Shift;
  onClose: () => void;
  onSave: (updates: {
    starts_at: string;
    ends_at: string;
    status: string | undefined;
    notes: string | null;
  }) => Promise<void>;
}

export function EditShiftModal({ shift, onClose, onSave }: EditShiftModalProps) {
  const [startsAt, setStartsAt] = useState(shift.scheduledStart.slice(0, 16));
  const [endsAt, setEndsAt] = useState(shift.scheduledEnd.slice(0, 16));
  const [status, setStatus] = useState(shift.status);
  const [notes, setNotes] = useState(shift.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        status,
        notes: notes || null,
      });
    } finally {
      setSaving(false);
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
        background: 'rgba(0, 0, 0, 0.75)',
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
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          border: '1px solid #374151',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Edit Shift</h2>
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Start Time
          </label>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
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
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            End Time
          </label>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
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
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
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
            <option value="SCHEDULED">Scheduled</option>
            <option value="UPDATED">Updated</option>
            <option value="CANCELED">Canceled</option>
          </select>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
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
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#374151',
              border: 'none',
              borderRadius: '6px',
              color: '#f9fafb',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.75rem 1.5rem',
              background: saving ? '#6b7280' : '#10b981',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
