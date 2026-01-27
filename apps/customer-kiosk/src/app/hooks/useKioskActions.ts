import { useCallback } from 'react';
import type { Language } from '../../i18n';
import { t } from '../../i18n';
import { getErrorMessage, readJson } from '@club-ops/ui';
import type { SessionState } from '../../utils/membership';

type KioskAuthHeaders = (extra?: Record<string, string>) => Record<string, string>;

export function useKioskActions({
  apiBase,
  lane,
  kioskAuthHeaders,
  session,
  isSubmitting,
  setIsSubmitting,
  setView,
  resetToIdle,
}: {
  apiBase: string;
  lane: string | null;
  kioskAuthHeaders: KioskAuthHeaders;
  session: SessionState;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  setView: (view: 'idle' | 'language' | 'selection' | 'payment' | 'agreement' | 'agreement-bypass' | 'complete') => void;
  resetToIdle: () => void;
}) {
  const handleLanguageSelection = useCallback(
    async (language: Language) => {
      if (!session.sessionId) {
        return;
      }
      if (!lane) return;

      setIsSubmitting(true);
      try {
        const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/set-language`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...kioskAuthHeaders(),
          },
          body: JSON.stringify({
            language,
            sessionId: session.sessionId,
            customerName: session.customerName || undefined,
          }),
        });

        if (!response.ok) {
          const errorPayload: unknown = await response.json().catch(() => null);
          throw new Error(getErrorMessage(errorPayload) || 'Failed to set language');
        }
      } catch (error) {
        console.error('Failed to set language:', error);
        alert(t(session.customerPrimaryLanguage, 'error.setLanguage'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [apiBase, kioskAuthHeaders, lane, session, setIsSubmitting]
  );

  const handleKioskAcknowledge = useCallback(async () => {
    if (!lane) return;
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/kiosk-ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
      });

      if (!response.ok) {
        const errorPayload = await readJson(response);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to acknowledge completion');
      }

      setView('idle');
    } catch (error) {
      console.error('Failed to acknowledge completion:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [apiBase, isSubmitting, kioskAuthHeaders, lane, setIsSubmitting, setView]);

  const handleIdScanIssueDismiss = useCallback(async () => {
    if (!lane) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
      });

      if (!response.ok) {
        const errorPayload = await readJson(response);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to reset');
      }

      resetToIdle();
    } catch (error) {
      console.error('Failed to reset after ID scan issue:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [apiBase, isSubmitting, kioskAuthHeaders, lane, resetToIdle, setIsSubmitting]);

  return { handleLanguageSelection, handleKioskAcknowledge, handleIdScanIssueDismiss };
}
