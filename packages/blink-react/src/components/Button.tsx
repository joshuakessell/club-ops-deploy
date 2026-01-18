import type { ButtonHTMLAttributes } from 'react';

export type ButtonSize = 'kiosk' | 'touch' | 'md';
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
};

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(' ');
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  touch: 'h-12 px-5 text-base',
  kiosk: 'h-14 px-6 text-lg',
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-neutral',
  danger: 'btn btn-error',
  ghost: 'btn btn-ghost',
};

export function Button({ size = 'md', variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn('inline-flex items-center justify-center gap-2 font-semibold', SIZE_CLASS[size], VARIANT_CLASS[variant], className)}
      {...props}
    />
  );
}

