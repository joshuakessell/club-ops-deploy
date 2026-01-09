import { ReactNode } from 'react';

export interface ModalFrameProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  closeOnOverlayClick?: boolean;
}

export function ModalFrame({
  isOpen,
  title,
  onClose,
  children,
  maxWidth = '500px',
  closeOnOverlayClick = true,
}: ModalFrameProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        className="cs-liquid-card"
        style={{
          padding: '2rem',
          maxWidth,
          width: '90%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{title}</h2>
          <button
            onClick={onClose}
            className="cs-liquid-button cs-liquid-button--secondary"
            style={{
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

