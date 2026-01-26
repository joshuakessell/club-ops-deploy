import type { ReactNode } from 'react';
import './KioskNoticeBanner.css';

export interface KioskNoticeBannerProps {
  tone?: 'info' | 'success' | 'muted';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function KioskNoticeBanner({
  tone = 'muted',
  title,
  children,
  className,
}: KioskNoticeBannerProps) {
  const classes = ['ck-notice', `ck-notice--${tone}`, className].filter(Boolean).join(' ');
  const showBody = Boolean(children);

  return (
    <div className={classes}>
      {title ? (
        <div className={`ck-notice__title${showBody ? '' : ' ck-notice__title--solo'}`}>
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}
