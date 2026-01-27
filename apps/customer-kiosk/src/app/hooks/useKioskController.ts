import { useCallback } from 'react';
import { getApiUrl } from '@club-ops/shared';
import { useKioskLane } from './useKioskLane';
import { useOrientationOverlay } from './useOrientationOverlay';
import { useKioskSessionState } from './useKioskSessionState';
import { useKioskInventory } from './useKioskInventory';
import { useKioskWebSocket } from './useKioskWebSocket';
import { useKioskActions } from './useKioskActions';
import { usePulseHighlightStyles } from './usePulseHighlightStyles';

export function useKioskController() {
  usePulseHighlightStyles();
  const apiBase = getApiUrl('/api');
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;

  const kioskAuthHeaders = useCallback(
    (extra?: Record<string, string>) => {
      return {
        ...(extra ?? {}),
        ...(kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
      };
    },
    [kioskToken]
  );

  const { lane, handleLaneSelection } = useKioskLane();
  const sessionState = useKioskSessionState();
  const { orientationOverlay } = useOrientationOverlay(sessionState.session.customerPrimaryLanguage);
  const inventoryState = useKioskInventory({ apiBase, enabled: Boolean(lane) });

  useKioskWebSocket({
    lane,
    kioskToken,
    sessionIdRef: sessionState.sessionIdRef,
    applySessionUpdatedPayload: sessionState.applySessionUpdatedPayload,
    setProposedRentalType: sessionState.setProposedRentalType,
    setProposedBy: sessionState.setProposedBy,
    setSelectionConfirmed: sessionState.setSelectionConfirmed,
    setSelectionConfirmedBy: sessionState.setSelectionConfirmedBy,
    setSelectedRental: sessionState.setSelectedRental,
    setSelectionAcknowledged: sessionState.setSelectionAcknowledged,
    setHighlightedLanguage: sessionState.setHighlightedLanguage,
    setHighlightedMembershipChoice: sessionState.setHighlightedMembershipChoice,
    setHighlightedWaitlistBackup: sessionState.setHighlightedWaitlistBackup,
    setCustomerConfirmationData: sessionState.setCustomerConfirmationData,
    setShowCustomerConfirmation: sessionState.setShowCustomerConfirmation,
    setSession: sessionState.setSession,
    setView: sessionState.setView,
    applyInventoryUpdate: inventoryState.applyInventoryUpdate,
    resetToIdle: sessionState.resetToIdle,
    apiBase,
    kioskAuthHeaders,
  });

  const actions = useKioskActions({
    apiBase,
    lane,
    kioskAuthHeaders,
    session: sessionState.session,
    isSubmitting: sessionState.isSubmitting,
    setIsSubmitting: sessionState.setIsSubmitting,
    setView: sessionState.setView,
    resetToIdle: sessionState.resetToIdle,
  });

  return {
    apiBase,
    kioskToken,
    kioskAuthHeaders,
    lane,
    handleLaneSelection,
    orientationOverlay,
    inventory: inventoryState.inventory,
    refreshInventory: inventoryState.refreshInventory,
    ...sessionState,
    ...actions,
  };
}
