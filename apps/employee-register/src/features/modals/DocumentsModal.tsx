import { ModalFrame } from '../../components/register/modals/ModalFrame';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function DocumentsModal() {
  const {
    documentsModalOpen,
    setDocumentsModalOpen,
    documentsLoading,
    documentsError,
    documentsForSession,
    setDocumentsError,
    currentSessionIdRef,
    fetchDocumentsBySession,
    downloadAgreementPdf,
  } = useEmployeeRegisterState();

  return (
    <ModalFrame
      isOpen={documentsModalOpen}
      title="Agreement artifacts"
      onClose={() => setDocumentsModalOpen(false)}
      maxWidth="720px"
      maxHeight="70vh"
    >
      <div className="u-grid u-gap-12">
        <div className="er-docs-session">
          Session:{' '}
          <span className="u-font-mono">{currentSessionIdRef.current || '—'}</span>
        </div>

        {documentsError && (
          <div className="er-modal-error">{documentsError}</div>
        )}

        <div className="u-flex u-gap-8 u-flex-wrap">
          <button
            className="cs-liquid-button cs-liquid-button--secondary"
            disabled={documentsLoading || !currentSessionIdRef.current}
            onClick={() => {
              const sid = currentSessionIdRef.current;
              if (!sid) return;
              void fetchDocumentsBySession(sid);
            }}
          >
            {documentsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {documentsForSession === null ? (
          <div className="er-text-sm er-text-muted">No data loaded yet.</div>
        ) : documentsForSession.length === 0 ? (
          <div className="er-text-sm er-text-muted">No documents found for this session.</div>
        ) : (
          <div className="u-grid u-gap-8">
            {documentsForSession.map(
              (doc: {
                id: string;
                doc_type: string;
                created_at: string;
                has_signature: boolean;
                signature_hash_prefix?: string;
                has_pdf?: boolean;
              }) => (
                <div
                  key={doc.id}
                  className="er-surface er-docs-item"
                >
                  <div className="er-docs-item-header">
                    <div className="u-fw-900">
                      {doc.doc_type}{' '}
                      <span className="u-font-mono u-fw-700 er-text-muted">
                        {doc.id}
                      </span>
                    </div>
                    <div className="er-text-muted">{new Date(doc.created_at).toLocaleString()}</div>
                  </div>
                  <div className="er-docs-meta">
                    PDF stored: {doc.has_pdf ? 'yes' : 'no'} • Signature stored:{' '}
                    {doc.has_signature ? 'yes' : 'no'}
                    {doc.signature_hash_prefix ? ` • sig hash: ${doc.signature_hash_prefix}…` : ''}
                  </div>
                  <div className="u-flex u-gap-8 u-flex-wrap">
                    <button
                      className="cs-liquid-button"
                      disabled={!doc.has_pdf}
                      onClick={() => {
                        void downloadAgreementPdf(doc.id).catch((e: unknown) => {
                          setDocumentsError(
                            e instanceof Error ? e.message : 'Failed to download PDF'
                          );
                        });
                      }}
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
