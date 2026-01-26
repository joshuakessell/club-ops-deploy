import { useScanOverlayState } from './useScanOverlayState';
import { useScanResolutionState } from './useScanResolutionState';
import type { HomeTab, ScanResult, StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  homeTab: HomeTab;
  manualEntry: boolean;
  isSubmitting: boolean;
  externalBlocking: boolean;
  startLaneSessionByCustomerId: (
    customerId: string,
    opts?: { suppressAlerts?: boolean; customerLabel?: string | null }
  ) => Promise<ScanResult>;
};

export function useScanState({
  session,
  lane,
  homeTab,
  manualEntry,
  isSubmitting,
  externalBlocking,
  startLaneSessionByCustomerId,
}: Params) {
  const resolution = useScanResolutionState({ session, lane, startLaneSessionByCustomerId });

  const blockingModalOpen =
    externalBlocking || !!resolution.pendingScanResolution || resolution.showCreateFromScanPrompt;

  const overlay = useScanOverlayState({
    session,
    homeTab,
    manualEntry,
    isSubmitting,
    blockingModalOpen,
    onBarcodeCaptured: resolution.onBarcodeCaptured,
    setCreateFromScanError: resolution.setCreateFromScanError,
    setShowCreateFromScanPrompt: resolution.setShowCreateFromScanPrompt,
  });

  return {
    scanOverlayMounted: overlay.scanOverlayMounted,
    scanOverlayActive: overlay.scanOverlayActive,
    scanToastMessage: overlay.scanToastMessage,
    setScanToastMessage: overlay.setScanToastMessage,
    pendingScanResolution: resolution.pendingScanResolution,
    scanResolutionError: resolution.scanResolutionError,
    scanResolutionSubmitting: resolution.scanResolutionSubmitting,
    setPendingScanResolution: resolution.setPendingScanResolution,
    setScanResolutionError: resolution.setScanResolutionError,
    setScanResolutionSubmitting: resolution.setScanResolutionSubmitting,
    resolvePendingScanSelection: resolution.resolvePendingScanSelection,
    showCreateFromScanPrompt: resolution.showCreateFromScanPrompt,
    pendingCreateFromScan: resolution.pendingCreateFromScan,
    createFromScanError: resolution.createFromScanError,
    createFromScanSubmitting: resolution.createFromScanSubmitting,
    setShowCreateFromScanPrompt: resolution.setShowCreateFromScanPrompt,
    setPendingCreateFromScan: resolution.setPendingCreateFromScan,
    setCreateFromScanError: resolution.setCreateFromScanError,
    setCreateFromScanSubmitting: resolution.setCreateFromScanSubmitting,
    handleCreateFromNoMatch: resolution.handleCreateFromNoMatch,
    blockingModalOpen,
  };
}
