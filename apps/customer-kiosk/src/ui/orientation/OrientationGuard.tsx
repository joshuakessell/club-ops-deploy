import React, { useEffect, useMemo, useRef } from 'react';
import { useOrientation, type DeviceOrientation } from './useOrientation';

export type OrientationGuardProps = {
  required: DeviceOrientation;
  title?: string;
  message?: string;
  children: React.ReactNode;
};

export function OrientationGuard({
  required,
  title,
  message,
  children,
}: OrientationGuardProps): React.ReactNode {
  const { orientation } = useOrientation();
  const mismatch = orientation !== required;

  const resolvedTitle = title ?? 'Rotate iPad';
  const resolvedMessage =
    message ??
    `This screen must be used in ${required === 'portrait' ? 'portrait' : 'landscape'} mode.`;

  const mismatchText = useMemo(
    () => `OrientationGuard: expected ${required}, got ${orientation}`,
    [required, orientation]
  );

  const lastMismatch = useRef<boolean | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (lastMismatch.current === mismatch) return;
    lastMismatch.current = mismatch;

    if (mismatch) console.info(mismatchText);
    else console.info(`OrientationGuard: orientation ok (${required})`);
  }, [mismatch, mismatchText, required]);

  if (!mismatch) return <>{children}</>;

  return (
    <div className="orientation-overlay" role="alert" aria-live="assertive">
      <div className="orientation-card">
        <div className="orientation-icon" aria-hidden="true">
          <div className="orientation-icon-home" />
        </div>
        <div className="orientation-title">{resolvedTitle}</div>
        <div className="orientation-message">{resolvedMessage}</div>
      </div>
    </div>
  );
}
