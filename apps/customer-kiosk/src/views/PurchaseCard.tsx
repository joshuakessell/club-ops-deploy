import type { ReactNode } from 'react';
import './PurchaseCard.css';

export interface PurchaseCardProps {
  title: ReactNode;
  status?: ReactNode;
  variant?: 'membership' | 'rental';
  active?: boolean;
  className?: string;
  children: ReactNode;
}

export function PurchaseCard({
  title,
  status,
  variant,
  active = false,
  className,
  children,
}: PurchaseCardProps) {
  const classes = [
    'cs-liquid-card',
    'purchase-card',
    variant ? `purchase-card--${variant}` : '',
    active ? 'ck-step-active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <div className="purchase-card__header">
        <div className="purchase-card__title">{title}</div>
        {status ? <div className="purchase-card__status">{status}</div> : null}
      </div>
      <div className="purchase-card__body">{children}</div>
    </section>
  );
}
