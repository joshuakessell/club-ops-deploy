import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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

  const modal = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 4000,
      }}
      role="presentation"
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={modalRef}
        className="cs-liquid-card"
        style={{
          maxWidth,
          width: '90%',
          maxHeight,
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div style={{ padding: '2rem', paddingBottom: '1rem', flex: '0 0 auto' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{title}</h2>
            {showCloseButton && (
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
            )}
          </div>
        </div>
        <div
          style={{
            padding: '0 2rem 2rem',
            overflowY: maxHeight ? 'auto' : undefined,
            flex: maxHeight ? '1 1 auto' : undefined,
            minHeight: maxHeight ? 0 : undefined,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );

  // Render in a portal so it's not clipped/stacked under panels that use overflow/transform.
  return createPortal(modal, document.body);
}
