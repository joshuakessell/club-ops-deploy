import { useEffect, useRef, type ReactNode } from 'react';
import './KioskModal.css';

export interface KioskModalProps {
  isOpen: boolean;
  title: ReactNode;
  onClose?: () => void;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  lockFocus?: boolean;
  children: ReactNode;
  className?: string;
}

export function KioskModal({
  isOpen,
  title,
  onClose,
  closeOnOverlayClick = false,
  closeOnEscape = false,
  lockFocus = true,
  children,
  className,
}: KioskModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || !lockFocus) return;
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    (focusables[0] ?? root).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && !root.contains(active)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (closeOnEscape) onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const nextFocusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (nextFocusables.length === 0) return;
      const idx = active ? nextFocusables.indexOf(active) : -1;
      const nextIdx = e.shiftKey
        ? idx <= 0
          ? nextFocusables.length - 1
          : idx - 1
        : idx === -1 || idx === nextFocusables.length - 1
          ? 0
          : idx + 1;
      e.preventDefault();
      nextFocusables[nextIdx]?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closeOnEscape, isOpen, lockFocus, onClose]);

  const handleOverlayClick = () => {
    if (!closeOnOverlayClick) return;
    onClose?.();
  };

  if (!isOpen) return null;

  return (
    <div className="ck-modal-overlay" onClick={handleOverlayClick} role="presentation">
      <div
        ref={modalRef}
        className={['ck-modal-content', 'cs-liquid-card', className].filter(Boolean).join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <h2 className="ck-modal-title">{title}</h2>
        <div className="ck-modal-body">{children}</div>
      </div>
    </div>
  );
}
