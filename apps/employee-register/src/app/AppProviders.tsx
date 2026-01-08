import React from 'react';
import { AppErrorBoundary } from './AppErrorBoundary';

type Props = { children: React.ReactNode };

export function AppProviders({ children }: Props) {
  return <AppErrorBoundary>{children}</AppErrorBoundary>;
}
