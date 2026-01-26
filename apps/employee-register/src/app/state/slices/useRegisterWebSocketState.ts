import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AssignmentFailedPayload,
  CheckoutChecklist,
  CheckoutRequestSummary,
  SessionUpdatedPayload,
} from '@club-ops/shared';
import { useRegisterWebSocketEvents } from '../../useRegisterWebSocketEvents';
import type { BottomToast } from '../../../components/register/toasts/BottomToastStack';
import type { HomeTab } from '../shared/types';

type LaneSessionActions = {
  applySessionUpdated: (payload: SessionUpdatedPayload) => void;
  applySelectionProposed: (payload: { rentalType: string; proposedBy: 'CUSTOMER' | 'EMPLOYEE' }) => void;
  applySelectionLocked: (payload: { rentalType: string; confirmedBy: 'CUSTOMER' | 'EMPLOYEE' }) => void;
  applySelectionForced: (payload: { rentalType: string }) => void;
  selectionAcknowledged: () => void;
};

type InventorySelection = {
  type: 'room' | 'locker';
  id: string;
  number: string;
  tier: string;
};

type CustomerConfirmationType = {
  requested: string;
  selected: string;
  number: string;
};

type Params = {
  lane: string;
  currentSessionId: string | null;
  selectedCheckoutRequest: string | null;
  customerSelectedType: string | null;
  laneSessionActions: LaneSessionActions;
  setCheckoutRequests: Dispatch<SetStateAction<Map<string, CheckoutRequestSummary>>>;
  setCheckoutItemsConfirmed: Dispatch<SetStateAction<boolean>>;
  setCheckoutFeePaid: Dispatch<SetStateAction<boolean>>;
  setSelectedCheckoutRequest: Dispatch<SetStateAction<string | null>>;
  setCheckoutChecklist: Dispatch<SetStateAction<CheckoutChecklist>>;
  refreshWaitlistAndInventory: () => void;
  refreshInventoryAvailable: () => void;
  setSelectedInventoryItem: (value: InventorySelection | null) => void;
  setShowAddOnSaleModal: (value: boolean) => void;
  resetAddOnCart: () => void;
  resetMembershipPrompt: () => void;
  setShowWaitlistModal: (value: boolean) => void;
  setCurrentSessionCustomerId: (value: string | null) => void;
  setAccountCustomerId: (value: string | null) => void;
  setAccountCustomerLabel: (value: string | null) => void;
  selectHomeTab: (value: HomeTab) => void;
  pushBottomToast: (toast: Omit<BottomToast, 'id'> & { id?: string }, ttlMs?: number) => void;
  setShowCustomerConfirmationPending: (value: boolean) => void;
  setCustomerConfirmationType: (value: CustomerConfirmationType | null) => void;
};

export function useRegisterWebSocketState({
  lane,
  currentSessionId,
  selectedCheckoutRequest,
  customerSelectedType,
  laneSessionActions,
  setCheckoutRequests,
  setCheckoutItemsConfirmed,
  setCheckoutFeePaid,
  setSelectedCheckoutRequest,
  setCheckoutChecklist,
  refreshWaitlistAndInventory,
  refreshInventoryAvailable,
  setSelectedInventoryItem,
  setShowAddOnSaleModal,
  resetAddOnCart,
  resetMembershipPrompt,
  setShowWaitlistModal,
  setCurrentSessionCustomerId,
  setAccountCustomerId,
  setAccountCustomerLabel,
  selectHomeTab,
  pushBottomToast,
  setShowCustomerConfirmationPending,
  setCustomerConfirmationType,
}: Params) {
  const selectedCheckoutRequestRef = useRef<string | null>(null);
  useEffect(() => {
    selectedCheckoutRequestRef.current = selectedCheckoutRequest;
  }, [selectedCheckoutRequest]);

  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const customerSelectedTypeRef = useRef<string | null>(null);
  useEffect(() => {
    customerSelectedTypeRef.current = customerSelectedType;
  }, [customerSelectedType]);

  const ws = useRegisterWebSocketEvents({
    lane,
    currentSessionIdRef,
    selectedCheckoutRequestRef,
    customerSelectedTypeRef,
    laneSessionActions: {
      applySessionUpdated: laneSessionActions.applySessionUpdated,
      applySelectionProposed: ({ rentalType, proposedBy }) =>
        laneSessionActions.applySelectionProposed({ rentalType, proposedBy }),
      applySelectionLocked: ({ rentalType, confirmedBy }) =>
        laneSessionActions.applySelectionLocked({ rentalType, confirmedBy }),
      applySelectionForced: ({ rentalType }) =>
        laneSessionActions.applySelectionForced({ rentalType }),
      selectionAcknowledged: laneSessionActions.selectionAcknowledged,
    },
    setCheckoutRequests,
    setCheckoutItemsConfirmed,
    setCheckoutFeePaid,
    setSelectedCheckoutRequest,
    setCheckoutChecklist,
    onWaitlistUpdated: () => {
      refreshWaitlistAndInventory();
    },
    onInventoryUpdated: () => {
      refreshInventoryAvailable();
    },
    onLaneSessionCleared: () => {
      setSelectedInventoryItem(null);
      setShowAddOnSaleModal(false);
      resetAddOnCart();
      resetMembershipPrompt();
      setShowWaitlistModal(false);
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
      selectHomeTab('scan');
    },
    pushBottomToast,
    onAssignmentFailed: (payload: AssignmentFailedPayload) => {
      alert('Assignment failed: ' + payload.reason);
      setSelectedInventoryItem(null);
    },
    onCustomerConfirmed: () => {
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
    },
    onCustomerDeclined: () => {
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
      if (customerSelectedTypeRef.current) {
        setSelectedInventoryItem(null);
      }
    },
  });

  const [wsConnected, setWsConnected] = useState(false);
  useEffect(() => {
    setWsConnected(ws.connected);
  }, [ws.connected]);

  return { wsConnected, currentSessionIdRef };
}
