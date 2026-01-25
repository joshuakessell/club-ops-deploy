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
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
          Session:{' '}
          <span style={{ fontFamily: 'monospace' }}>{currentSessionIdRef.current || '—'}</span>
        </div>

        {documentsError && (
          <div
            style={{
              padding: '0.75rem',
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 12,
              color: '#fecaca',
              fontWeight: 700,
            }}
          >
            {documentsError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
          <div style={{ color: '#94a3b8' }}>No data loaded yet.</div>
        ) : documentsForSession.length === 0 ? (
          <div style={{ color: '#94a3b8' }}>No documents found for this session.</div>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
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
                className="er-surface"
                style={{ padding: '0.75rem', borderRadius: 12, display: 'grid', gap: '0.35rem' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ fontWeight: 900 }}>
                    {doc.doc_type}{' '}
                    <span
                      style={{ fontFamily: 'monospace', fontWeight: 700, color: '#94a3b8' }}
                    >
                      {doc.id}
                    </span>
                  </div>
                  <div style={{ color: '#94a3b8' }}>{new Date(doc.created_at).toLocaleString()}</div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                  PDF stored: {doc.has_pdf ? 'yes' : 'no'} • Signature stored:{' '}
                  {doc.has_signature ? 'yes' : 'no'}
                  {doc.signature_hash_prefix ? ` • sig hash: ${doc.signature_hash_prefix}…` : ''}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
            ))}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
