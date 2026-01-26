import type { ReactNode } from 'react';
import './KioskModal.css';

export interface KioskModalProps {
  isOpen: boolean;
  title: ReactNode;
  onClose?: () => void;
  closeOnOverlayClick?: boolean;
  children: ReactNode;
  className?: string;
}

export function KioskModal({
  isOpen,
  title,
  onClose,
  closeOnOverlayClick = true,
  children,
  className,
}: KioskModalProps) {
  if (!isOpen) return null;

  const handleOverlayClick = () => {
    if (!closeOnOverlayClick) return;
    onClose?.();
  };

  return (
    <div className="ck-modal-overlay" onClick={handleOverlayClick}>
      <div
        className={['ck-modal-content', 'cs-liquid-card', className].filter(Boolean).join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ck-modal-title">{title}</h2>
        <div className="ck-modal-body">{children}</div>
      </div>
    </div>
  );
}
