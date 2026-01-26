import type { ReactNode } from 'react';
import './KioskModal.css';

export interface KioskModalActionsProps {
  children: ReactNode;
  className?: string;
}

export function KioskModalActions({ children, className }: KioskModalActionsProps) {
  return (
    <div className={['ck-modal-actions', className].filter(Boolean).join(' ')}>{children}</div>
  );
}
