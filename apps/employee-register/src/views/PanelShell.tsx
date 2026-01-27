import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import './PanelCard.css';
import './PanelShell.css';

type PanelAlign = 'top' | 'center';
type PanelScroll = 'auto' | 'hidden';

export type PanelShellProps<T extends ElementType = 'div'> = {
  as?: T;
  align?: PanelAlign;
  scroll?: PanelScroll;
  card?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

export function PanelShell<T extends ElementType = 'div'>({
  as,
  align = 'top',
  scroll = 'auto',
  card = true,
  className,
  children,
  ...rest
}: PanelShellProps<T>) {
  const Component = as ?? 'div';
  const classes = [
    'er-panel-shell',
    align === 'center' ? 'er-panel-shell--center' : 'er-panel-shell--top',
    scroll === 'hidden' ? 'er-panel-shell--no-scroll' : '',
    card ? 'cs-liquid-card er-panel-card' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
