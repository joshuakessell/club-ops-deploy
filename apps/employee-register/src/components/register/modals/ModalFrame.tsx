import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const MODAL_WIDTH_CLASS: Record<string, string> = {
  '420px': 'er-modal-frame--w-420',
  '500px': 'er-modal-frame--w-500',
  '520px': 'er-modal-frame--w-520',
  '560px': 'er-modal-frame--w-560',
  '640px': 'er-modal-frame--w-640',
  '720px': 'er-modal-frame--w-720',
  '760px': 'er-modal-frame--w-760',
};

const MODAL_HEIGHT_CLASS: Record<string, string> = {
  '50vh': 'er-modal-frame--h-50vh',
  '70vh': 'er-modal-frame--h-70vh',
  '80vh': 'er-modal-frame--h-80vh',
};

export interface ModalFrameProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  lockFocus?: boolean;
  showCloseButton?: boolean;
}

export function ModalFrame({
  isOpen,
  title,
  onClose,
  children,
  maxWidth = '500px',
  maxHeight,
  closeOnOverlayClick = false,
  closeOnEscape = false,
  lockFocus = true,
  showCloseButton = true,
}: ModalFrameProps) {
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
        if (closeOnEscape) onClose();
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

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const widthClass = MODAL_WIDTH_CLASS[maxWidth];
  const heightClass = maxHeight ? MODAL_HEIGHT_CLASS[maxHeight] : undefined;

  const modal = (
    <div
      className="er-modal-overlay"
      role="presentation"
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={modalRef}
        className={['cs-liquid-card', 'er-modal-frame', widthClass, heightClass]
          .filter(Boolean)
          .join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="er-modal-header">
          <div className="er-modal-header-row">
            <h2 className="er-modal-title">{title}</h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="cs-liquid-button cs-liquid-button--secondary er-modal-close"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div
          className={['er-modal-body', maxHeight ? 'er-modal-body--scroll' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </div>
    </div>
  );

  // Render in a portal so it's not clipped/stacked under panels that use overflow/transform.
  return createPortal(modal, document.body);
}
