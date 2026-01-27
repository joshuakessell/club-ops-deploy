import type { ReactNode } from 'react';
import './KioskMessageCard.css';

type MessageCardTone = 'glass' | 'muted';
type MessageCardSize = 'compact' | 'wide';

export interface KioskMessageCardProps {
  title: ReactNode;
  body?: ReactNode;
  tone?: MessageCardTone;
  size?: MessageCardSize;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
}

export function KioskMessageCard({
  title,
  body,
  tone = 'glass',
  size = 'wide',
  className,
  titleClassName,
  bodyClassName,
}: KioskMessageCardProps) {
  const surfaceClasses = 'cs-liquid-card';
  const classes = [
    'ck-message-card',
    `ck-message-card--${tone}`,
    `ck-message-card--${size}`,
    surfaceClasses,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div
        className={['ck-message-title', `ck-message-title--${size}`, titleClassName]
          .filter(Boolean)
          .join(' ')}
      >
        {title}
      </div>
      {body ? (
        <div
          className={['ck-message-body', `ck-message-body--${size}`, bodyClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
