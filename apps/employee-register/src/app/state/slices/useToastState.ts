import { useCallback, useEffect, useRef, useState } from 'react';
import type { BottomToast } from '../../../components/register/toasts/BottomToastStack';

export function useToastState() {
  const [successToastMessage, setSuccessToastMessage] = useState<string | null>(null);
  const successToastTimerRef = useRef<number | null>(null);

  const [bottomToasts, setBottomToasts] = useState<BottomToast[]>([]);
  const bottomToastTimersRef = useRef<Record<string, number>>({});

  const dismissBottomToast = useCallback((id: string) => {
    const timer = bottomToastTimersRef.current[id];
    if (timer) window.clearTimeout(timer);
    delete bottomToastTimersRef.current[id];
    setBottomToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushBottomToast = useCallback(
    (toast: Omit<BottomToast, 'id'> & { id?: string }, ttlMs = 12_000) => {
      const id = toast.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setBottomToasts((prev) =>
        [{ id, message: toast.message, tone: toast.tone }, ...prev].slice(0, 4)
      );
      if (bottomToastTimersRef.current[id]) window.clearTimeout(bottomToastTimersRef.current[id]);
      bottomToastTimersRef.current[id] = window.setTimeout(() => dismissBottomToast(id), ttlMs);
    },
    [dismissBottomToast]
  );

  useEffect(() => {
    if (!successToastMessage) return;
    if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    successToastTimerRef.current = window.setTimeout(() => setSuccessToastMessage(null), 3000);
    return () => {
      if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    };
  }, [successToastMessage]);

  useEffect(() => {
    return () => {
      for (const id of Object.keys(bottomToastTimersRef.current)) {
        const timer = bottomToastTimersRef.current[id];
        if (timer) window.clearTimeout(timer);
      }
      bottomToastTimersRef.current = {};
    };
  }, []);

  return {
    successToastMessage,
    setSuccessToastMessage,
    bottomToasts,
    dismissBottomToast,
    pushBottomToast,
  };
}
