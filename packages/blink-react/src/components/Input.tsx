import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(' ');
}

export function Input({ className, ...props }: InputProps) {
  return <input className={cn('input input-bordered w-full', className)} {...props} />;
}

