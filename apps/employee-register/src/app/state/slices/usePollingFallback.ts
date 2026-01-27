import { useCallback, useEffect, useRef } from 'react';
import { SessionUpdatedPayloadSchema, type SessionUpdatedPayload } from '@club-ops/shared';
import { isRecord, readJson } from '@club-ops/ui';
import { API_BASE } from '../shared/api';

type LaneSessionActions = {
  applySessionUpdated: (payload: SessionUpdatedPayload) => void;
  resetCleared: () => void;
};

type Params = {
  lane: string;
  wsConnected: boolean;
  laneSessionActions: LaneSessionActions;
};

export function usePollingFallback({ lane, wsConnected, laneSessionActions }: Params) {
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;

  const pollOnce = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (typeof kioskToken === 'string' && kioskToken) {
        headers['x-kiosk-token'] = kioskToken;
      }
      const res = await fetch(
        `${API_BASE}/v1/checkin/lane/${encodeURIComponent(lane)}/session-snapshot`,
        { headers }
      );
      if (!res.ok) return;
      const data = await readJson<unknown>(res);
      if (!isRecord(data)) return;
      const sessionPayload = data['session'];
      if (sessionPayload == null) {
        laneSessionActions.resetCleared();
        return;
      }
      if (isRecord(sessionPayload)) {
        const parsed = SessionUpdatedPayloadSchema.safeParse(sessionPayload);
        if (parsed.success) {
          laneSessionActions.applySessionUpdated(parsed.data);
        }
      }
    } catch {
      // Best-effort; polling is a fallback.
    }
  }, [kioskToken, lane, laneSessionActions]);

  const pollingDelayTimerRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (pollingDelayTimerRef.current !== null) {
      window.clearTimeout(pollingDelayTimerRef.current);
      pollingDelayTimerRef.current = null;
    }
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (wsConnected) return;

    pollingDelayTimerRef.current = window.setTimeout(() => {
      if (wsConnected) return;
      void pollOnce();
      pollingIntervalRef.current = window.setInterval(() => {
        void pollOnce();
      }, 2000);
    }, 1200);

    return () => {
      if (pollingDelayTimerRef.current !== null) {
        window.clearTimeout(pollingDelayTimerRef.current);
        pollingDelayTimerRef.current = null;
      }
      if (pollingIntervalRef.current !== null) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [pollOnce, wsConnected]);

  return { pollOnce };
}
