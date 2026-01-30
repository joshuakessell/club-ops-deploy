import { ModalFrame } from './ModalFrame';

export interface IdScanBlockedModalProps {
  isOpen: boolean;
  issue: 'ID_EXPIRED' | 'UNDERAGE' | null;
  onClose: () => void;
}

export function IdScanBlockedModal({ isOpen, issue, onClose }: IdScanBlockedModalProps) {
  if (!issue) return null;

  const title = issue === 'ID_EXPIRED' ? 'ID Expired' : 'Customer Under 18';
  const message =
    issue === 'ID_EXPIRED'
      ? 'This ID is expired. Please scan an unexpired ID to continue.'
      : 'This customer is under 18. Please provide an ID showing they are 18 or older.';

  return (
    <ModalFrame isOpen={isOpen} title={title} onClose={onClose} closeOnOverlayClick={false}>
      <div className="u-grid u-gap-12">
        <div className="er-modal-alert">{message}</div>
        <div className="u-flex u-justify-end">
          <button type="button" className="cs-liquid-button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
