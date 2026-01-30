import { ModalFrame } from './ModalFrame';

export type MultipleMatchCandidate = {
  id: string;
  name: string;
  dob: string | null;
  membershipNumber: string | null;
  matchScore: number;
};

export type MultipleMatchesModalProps = {
  isOpen: boolean;
  candidates: MultipleMatchCandidate[];
  errorMessage?: string | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onSelect: (customerId: string) => void;
};

export function MultipleMatchesModal({
  isOpen,
  candidates,
  errorMessage,
  isSubmitting = false,
  onCancel,
  onSelect,
}: MultipleMatchesModalProps) {
  return (
    <ModalFrame
      isOpen={isOpen}
      title="Multiple matches found"
      onClose={onCancel}
      maxWidth="720px"
      maxHeight="70vh"
      closeOnOverlayClick={false}
    >
      <div className="u-grid u-gap-12">
        <div className="er-text-muted">Select the correct customer to continue.</div>

        {errorMessage ? (
          <div className="er-modal-error">{errorMessage}</div>
        ) : null}

        <div className="cs-liquid-card er-matches-card">
          {candidates.length === 0 ? (
            <div className="er-matches-empty">No candidates.</div>
          ) : (
            <div className="u-grid">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  disabled={isSubmitting}
                  className="cs-liquid-button cs-liquid-button--secondary er-matches-button"
                >
                  <div className="er-matches-name">{c.name}</div>
                  <div className="er-matches-meta">
                    {c.dob && <span>DOB: {c.dob}</span>}
                    {c.membershipNumber && <span>Membership: {c.membershipNumber}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="u-flex u-justify-end">
          <button
            className="cs-liquid-button cs-liquid-button--danger"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
