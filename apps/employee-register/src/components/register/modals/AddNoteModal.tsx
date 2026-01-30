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
        className="cs-liquid-card er-modal-textarea"
      />
      <div className="u-flex u-gap-8">
        <button
          onClick={onSubmit}
          disabled={isSubmitting || !noteText.trim()}
          className="cs-liquid-button er-modal-button u-flex-1"
        >
          {isSubmitting ? 'Adding...' : 'Add Note'}
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
