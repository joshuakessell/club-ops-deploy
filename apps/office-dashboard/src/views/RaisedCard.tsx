import type { HTMLAttributes, ReactNode } from 'react';
import './RaisedCard.css';

type RaisedCardPadding = 'md' | 'lg' | 'none';

export interface RaisedCardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: RaisedCardPadding;
  children: ReactNode;
}

export function RaisedCard({
  padding = 'md',
  className,
  children,
  ...rest
}: RaisedCardProps) {
  const classes = [
    'csRaisedCard',
    'cs-liquid-card',
    padding !== 'md' ? `csRaisedCard--${padding}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
