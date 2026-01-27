import { useCallback, useEffect, useState } from 'react';
import type { PasskeyCredential, StaffMember } from './types';
import { UploadDocumentModal } from './UploadDocumentModal';

interface StaffDetailModalProps {
  staff: StaffMember;
  passkeys: PasskeyCredential[];
  onClose: () => void;
  onRevokePasskey: (credentialId: string) => void;
  onPinReset: () => void;
  sessionToken: string;
  apiBase: string;
}

export function StaffDetailModal({
  staff,
  passkeys,
  onClose,
  onRevokePasskey,
  onPinReset,
  sessionToken,
  apiBase,
}: StaffDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'passkeys' | 'documents'>('details');
  const [documents, setDocuments] = useState<
    Array<{
      id: string;
      docType: string;
      filename: string;
      mimeType: string;
      uploadedAt: string;
      notes: string | null;
    }>
  >([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const response = await fetch(`${apiBase}/v1/admin/employees/${staff.id}/documents`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoadingDocs(false);
    }
  }, [apiBase, sessionToken, staff.id]);

  useEffect(() => {
    if (activeTab === 'documents') {
      fetchDocuments();
    }
  }, [activeTab, fetchDocuments]);

  const handleUpload = async (file: File, docType: string, notes?: string) => {
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const response = await fetch(`${apiBase}/v1/admin/employees/${staff.id}/documents`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            docType,
            filename: file.name,
            mimeType: file.type,
            fileData: base64,
            notes,
          }),
        });
        if (response.ok) {
          await fetchDocuments();
          setShowUploadModal(false);
        } else {
          alert('Failed to upload document');
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert('Failed to upload document');
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
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        overflow: 'auto',
        padding: '2rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f2937',
          padding: '2rem',
          borderRadius: '12px',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.5rem' }}>{staff.name}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1.5rem',
            borderBottom: '1px solid #374151',
          }}
        >
          <button
            onClick={() => setActiveTab('details')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'details' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'details' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('passkeys')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'passkeys' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'passkeys' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Passkeys
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === 'documents' ? '#374151' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'documents' ? '2px solid #10b981' : '2px solid transparent',
              color: '#f9fafb',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Documents
          </button>
        </div>

        {activeTab === 'details' && (
          <>
            <div style={{ marginBottom: '2rem' }}>
              <p>
                <strong>Role:</strong> {staff.role}
              </p>
              <p>
                <strong>Status:</strong> {staff.active ? 'Active' : 'Inactive'}
              </p>
              <p>
                <strong>Created:</strong> {new Date(staff.createdAt).toLocaleString()}
              </p>
              <p>
                <strong>Last Login:</strong>{' '}
                {staff.lastLogin ? new Date(staff.lastLogin).toLocaleString() : 'Never'}
              </p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <button
                onClick={onPinReset}
                className="cs-liquid-button cs-liquid-button--secondary"
                style={{ marginRight: '1rem' }}
              >
                Reset PIN
              </button>
            </div>
          </>
        )}

        {activeTab === 'passkeys' && (
          <>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Passkeys</h3>
            {passkeys.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No passkeys registered</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Credential ID</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Device</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Created</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Last Used</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {passkeys.map((pk) => (
                    <tr key={pk.id} style={{ borderBottom: '1px solid #374151' }}>
                      <td
                        style={{
                          padding: '0.75rem',
                          fontFamily: 'monospace',
                          fontSize: '0.875rem',
                        }}
                      >
                        {pk.credentialId.slice(0, 16)}...
                      </td>
                      <td style={{ padding: '0.75rem' }}>{pk.deviceId}</td>
                      <td style={{ padding: '0.75rem', color: '#9ca3af' }}>
                        {new Date(pk.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '0.75rem', color: '#9ca3af' }}>
                        {pk.lastUsedAt ? new Date(pk.lastUsedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span
                          style={{
                            padding: '0.25rem 0.75rem',
                            borderRadius: '4px',
                            fontSize: '0.875rem',
                            background: pk.isActive ? '#10b981' : '#ef4444',
                            color: '#f9fafb',
                          }}
                        >
                          {pk.isActive ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {pk.isActive && (
                          <button
                            onClick={() => onRevokePasskey(pk.credentialId)}
                            className="cs-liquid-button cs-liquid-button--danger"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 'documents' && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ fontSize: '1.25rem' }}>Documents</h3>
              <button onClick={() => setShowUploadModal(true)} className="cs-liquid-button">
                Upload Document
              </button>
            </div>
            {loadingDocs ? (
              <p style={{ color: '#9ca3af' }}>Loading documents...</p>
            ) : documents.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No documents uploaded</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Filename</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Uploaded</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} style={{ borderBottom: '1px solid #374151' }}>
                      <td style={{ padding: '0.75rem' }}>{doc.docType}</td>
                      <td style={{ padding: '0.75rem' }}>{doc.filename}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                        {new Date(doc.uploadedAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <a
                          href={`${apiBase}/v1/admin/documents/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '0.5rem 1rem',
                            background: '#374151',
                            borderRadius: '6px',
                            color: '#f9fafb',
                            textDecoration: 'none',
                            fontSize: '0.875rem',
                          }}
                        >
                          Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {showUploadModal && (
        <UploadDocumentModal onClose={() => setShowUploadModal(false)} onUpload={handleUpload} />
      )}
    </div>
  );
}
