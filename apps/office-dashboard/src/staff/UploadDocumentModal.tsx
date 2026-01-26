import { useState } from 'react';

interface UploadDocumentModalProps {
  onClose: () => void;
  onUpload: (file: File, docType: string, notes?: string) => void;
}

export function UploadDocumentModal({ onClose, onUpload }: UploadDocumentModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('OTHER');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async () => {
    if (!file) {
      alert('Please select a file');
      return;
    }
    setUploading(true);
    try {
      await onUpload(file, docType, notes || undefined);
    } finally {
      setUploading(false);
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
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
          Upload Document
        </h2>
        <div style={{ marginBottom: '1rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Document Type
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
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
            <option value="ID">ID</option>
            <option value="W4">W4</option>
            <option value="I9">I9</option>
            <option value="OFFER_LETTER">Offer Letter</option>
            <option value="NDA">NDA</option>
            <option value="OTHER">Other</option>
          </select>
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
            File
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
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
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Notes (optional)
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
            disabled={uploading}
            className="cs-liquid-button cs-liquid-button--secondary"
          >
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={uploading || !file} className="cs-liquid-button">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
