import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import './PanelCard.css';

export type PanelCardProps<T extends ElementType = 'div'> = {
  as?: T;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

export function PanelCard<T extends ElementType = 'div'>({
  as,
  className,
  children,
  ...rest
}: PanelCardProps<T>) {
  const Component = as ?? 'div';
  const classes = ['cs-liquid-card', 'er-panel-card', className].filter(Boolean).join(' ');

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
