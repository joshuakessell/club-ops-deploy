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
        className="cs-liquid-card"
        style={{
          width: '100%',
          padding: '0.75rem',
          fontSize: '1rem',
          marginBottom: '1rem',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={onSubmit}
          disabled={isSubmitting || !noteText.trim()}
          className="cs-liquid-button"
          style={{
            flex: 1,
            padding: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          {isSubmitting ? 'Adding...' : 'Add Note'}
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

