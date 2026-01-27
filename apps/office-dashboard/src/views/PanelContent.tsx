import type { HTMLAttributes, ReactNode } from 'react';
import './PanelContent.css';

type PanelPadding = 'lg' | 'md' | 'compact' | 'none';

export interface PanelContentProps extends HTMLAttributes<HTMLDivElement> {
  padding?: PanelPadding;
  children: ReactNode;
}

export function PanelContent({
  padding = 'lg',
  className,
  children,
  ...rest
}: PanelContentProps) {
  const classes = [
    'panel-content',
    padding !== 'lg' ? `panel-content--${padding}` : '',
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
