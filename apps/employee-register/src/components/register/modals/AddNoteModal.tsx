import { ModalFrame } from './ModalFrame';

export interface AddNoteModalProps {
  isOpen: boolean;
  noteText: string;
  onChangeNoteText: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function AddNoteModal({
  isOpen,
  noteText,
  onChangeNoteText,
  onSubmit,
  onCancel,
  isSubmitting,
}: AddNoteModalProps) {
  return (
    <ModalFrame isOpen={isOpen} title="Add Note" onClose={onCancel}>
      <textarea
        value={noteText}
        onChange={(e) => onChangeNoteText(e.target.value)}
        placeholder="Enter note..."
        rows={4}
        style={{
          width: '100%',
          padding: '0.75rem',
          background: '#0f172a',
          border: '1px solid #475569',
          borderRadius: '6px',
          color: 'white',
          fontSize: '1rem',
          marginBottom: '1rem',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={onSubmit}
          disabled={isSubmitting || !noteText.trim()}
          style={{
            flex: 1,
            padding: '0.75rem',
            background: noteText.trim() ? '#3b82f6' : '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: noteText.trim() && !isSubmitting ? 'pointer' : 'not-allowed',
          }}
        >
          {isSubmitting ? 'Adding...' : 'Add Note'}
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '0.75rem',
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </ModalFrame>
  );
}

