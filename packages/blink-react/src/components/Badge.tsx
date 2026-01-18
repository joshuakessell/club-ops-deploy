import type { HTMLAttributes, PropsWithChildren } from 'react';

export type BadgeVariant = 'info' | 'success' | 'error' | 'neutral';

export type BadgeProps = PropsWithChildren<
  HTMLAttributes<HTMLSpanElement> & {
    variant?: BadgeVariant;
  }
>;

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(' ');
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  info: 'badge-info',
  success: 'badge-success',
  error: 'badge-error',
  neutral: 'badge-neutral',
};

export function Badge({ variant = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('badge', VARIANT_CLASS[variant], className)} {...props}>
      {children}
    </span>
  );
}

