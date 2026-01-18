import type { HTMLAttributes, PropsWithChildren } from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export type CardProps = PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & {
    padding?: CardPadding;
  }
>;

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(' ');
}

const PADDING_CLASS: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({ padding = 'md', className, children, ...props }: CardProps) {
  return (
    <div className={cn('card bg-base-100 shadow-sm', PADDING_CLASS[padding], className)} {...props}>
      {children}
    </div>
  );
}

