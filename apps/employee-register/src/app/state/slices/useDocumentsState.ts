import { useCallback, useState } from 'react';
import { getErrorMessage } from '@club-ops/ui';
import { API_BASE } from '../shared/api';
import type { StaffSession } from '../shared/types';

type SessionDocument = {
  id: string;
  doc_type: string;
  mime_type: string;
  created_at: string;
  has_signature: boolean;
  signature_hash_prefix?: string;
  has_pdf?: boolean;
};

export function useDocumentsState(session: StaffSession | null) {
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsForSession, setDocumentsForSession] = useState<SessionDocument[] | null>(null);

  const fetchDocumentsBySession = useCallback(
    async (laneSessionId: string) => {
      if (!session?.sessionToken) return;
      setDocumentsLoading(true);
      setDocumentsError(null);
      try {
        const res = await fetch(`${API_BASE}/v1/documents/by-session/${laneSessionId}`, {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
        });
        if (!res.ok) {
          const errPayload: unknown = await res.json().catch(() => null);
          throw new Error(getErrorMessage(errPayload) || 'Failed to load documents');
        }
        const data = (await res.json()) as { documents?: SessionDocument[] };
        setDocumentsForSession(Array.isArray(data.documents) ? data.documents : []);
      } catch (e) {
        setDocumentsForSession(null);
        setDocumentsError(e instanceof Error ? e.message : 'Failed to load documents');
      } finally {
        setDocumentsLoading(false);
      }
    },
    [session?.sessionToken]
  );

  const downloadAgreementPdf = useCallback(
    async (documentId: string) => {
      if (!session?.sessionToken) return;
      const res = await fetch(`${API_BASE}/v1/documents/${documentId}/download`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      if (!res.ok) {
        const errPayload: unknown = await res.json().catch(() => null);
        throw new Error(getErrorMessage(errPayload) || 'Failed to download PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [session?.sessionToken]
  );

  return {
    documentsModalOpen,
    setDocumentsModalOpen,
    documentsLoading,
    documentsError,
    documentsForSession,
    setDocumentsError,
    fetchDocumentsBySession,
    downloadAgreementPdf,
  };
}
