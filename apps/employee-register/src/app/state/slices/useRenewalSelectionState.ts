import { useCallback, useState } from 'react';
import type { ActiveCheckinDetails } from '../../../components/register/modals/AlreadyCheckedInModal';
import { startLaneCheckin } from '../../startLaneCheckin';
import type { RegisterLaneSessionState } from '../../registerLaneSessionReducer';
import type { StaffSession } from '../shared/types';

type LaneSessionActions = {
  patch: (payload: Partial<RegisterLaneSessionState>) => void;
};

type Params = {
  lane: string;
  session: StaffSession | null;
  accountCustomerId: string | null;
  setIsSubmitting: (value: boolean) => void;
  laneSessionActions: LaneSessionActions;
};

export function useRenewalSelectionState({
  lane,
  session,
  accountCustomerId,
  setIsSubmitting,
  laneSessionActions,
}: Params) {
  const [renewalSelection, setRenewalSelection] = useState<ActiveCheckinDetails | null>(null);
  const [renewalSelectionError, setRenewalSelectionError] = useState<string | null>(null);

  const openRenewalSelection = useCallback((activeCheckin: ActiveCheckinDetails) => {
    setRenewalSelection(activeCheckin);
    setRenewalSelectionError(null);
  }, []);

  const closeRenewalSelection = useCallback(() => {
    setRenewalSelection(null);
    setRenewalSelectionError(null);
  }, []);

  const handleStartRenewal = useCallback(
    async (hours: 2 | 6) => {
      if (!renewalSelection) return;
      if (!session?.sessionToken) {
        setRenewalSelectionError('Not authenticated');
        return;
      }
      if (!accountCustomerId) {
        setRenewalSelectionError('No customer selected');
        return;
      }

      setIsSubmitting(true);
      setRenewalSelectionError(null);
      try {
        const result = await startLaneCheckin({
          lane,
          sessionToken: session.sessionToken,
          customerId: accountCustomerId,
          visitId: renewalSelection.visitId,
          renewalHours: hours,
        });

        if (result.kind === 'error') {
          setRenewalSelectionError(result.message);
          return;
        }

        if (result.kind === 'already-visiting') {
          setRenewalSelection(result.activeCheckin);
          setRenewalSelectionError('Customer already has an active check-in.');
          return;
        }

        if (result.payload) {
          const patch: Partial<RegisterLaneSessionState> = {};
          if (accountCustomerId) patch.customerId = accountCustomerId;
          if (result.payload.customerName) patch.customerName = result.payload.customerName;
          if (result.payload.membershipNumber) patch.membershipNumber = result.payload.membershipNumber;
          if (result.payload.sessionId) patch.currentSessionId = result.payload.sessionId;
          if (result.payload.mode) patch.mode = result.payload.mode;
          if (result.payload.renewalHours) patch.renewalHours = result.payload.renewalHours;
          if (result.payload.customerHasEncryptedLookupMarker !== undefined) {
            patch.customerHasEncryptedLookupMarker = Boolean(
              result.payload.customerHasEncryptedLookupMarker
            );
          }
          if (result.payload.mode === 'RENEWAL' && typeof result.payload.blockEndsAt === 'string') {
            patch.checkoutAt = result.payload.blockEndsAt;
            if (result.payload.activeAssignedResourceType)
              patch.assignedResourceType = result.payload.activeAssignedResourceType;
            if (result.payload.activeAssignedResourceNumber)
              patch.assignedResourceNumber = result.payload.activeAssignedResourceNumber;
          }

          if (Object.keys(patch).length > 0) {
            laneSessionActions.patch(patch);
          }
        }

        closeRenewalSelection();
      } catch (error) {
        setRenewalSelectionError(
          error instanceof Error ? error.message : 'Failed to renew check-in'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      accountCustomerId,
      closeRenewalSelection,
      lane,
      laneSessionActions,
      renewalSelection,
      session?.sessionToken,
      setIsSubmitting,
    ]
  );

  return {
    renewalSelection,
    renewalSelectionError,
    openRenewalSelection,
    closeRenewalSelection,
    handleStartRenewal,
  };
}
