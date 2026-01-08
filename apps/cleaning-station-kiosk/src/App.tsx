import { useEffect, useRef, useState, useCallback } from 'react';
import { RoomStatus, isAdjacentTransition } from '@club-ops/shared';
import { isRecord, getErrorMessage } from '@club-ops/ui';
import { LockScreen, type StaffSession } from './LockScreen';
import { useZxingScanner } from './hooks/useZxingScanner';
import { ScanView } from './views/ScanView';
import { ResolveView, type ScannedItem, type OverrideModalState } from './views/ResolveView';

type ViewMode = 'scan' | 'resolve';

const API_BASE = '/api';

function App() {
  // Session state - stored in memory only, not localStorage
  const [session, setSession] = useState<StaffSession | null>(null);

  const deviceId = useState(() => {
    // Generate or retrieve device ID
    const storage = window.localStorage;
    let id = storage.getItem('device_id');
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      storage.setItem('device_id', id);
    }
    return id;
  })[0];

  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const scannedItemsRef = useRef<ScannedItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('scan');
  const [isProcessing, setIsProcessing] = useState(false);
  const [overrideModal, setOverrideModal] = useState<OverrideModalState | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [resolveStatuses, setResolveStatuses] = useState<Record<string, RoomStatus>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});

  // Use the scanner hook
  const scanner = useZxingScanner({
    enabled: !!session && viewMode === 'scan',
    facingMode: 'user',
    onScan: (tagCode) => {
      void handleScan(tagCode);
    },
  });

  const handleLogin = (newSession: StaffSession) => {
    setSession(newSession);
  };

  const handleLogout = () => {
    setSession(null);
    setScannedItems([]);
    setViewMode('scan');
  };

  // Keep ref in sync with state
  useEffect(() => {
    scannedItemsRef.current = scannedItems;
  }, [scannedItems]);

  const handleScan = useCallback(
    async (tagCode: string) => {
      if (!session?.sessionToken) {
        return;
      }

      // Deduplicate: check if already scanned
      if (scannedItemsRef.current.some((item) => item.tagCode === tagCode)) {
        return;
      }

      setIsProcessing(true);

      try {
        const response = await fetch(`${API_BASE}/v1/keys/resolve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ token: tagCode }),
        });

        if (!response.ok) {
          const errorPayload: unknown = await response.json().catch(() => null);
          throw new Error(
            getErrorMessage(errorPayload) || `Failed to resolve key: ${response.statusText}`
          );
        }

        const data: unknown = await response.json();
        const roomId = isRecord(data) && typeof data.roomId === 'string' ? data.roomId : null;
        const roomNumber =
          isRecord(data) && typeof data.roomNumber === 'string' ? data.roomNumber : null;
        const status =
          isRecord(data) &&
          typeof data.status === 'string' &&
          (Object.values(RoomStatus) as string[]).includes(data.status)
            ? (data.status as RoomStatus)
            : null;

        if (roomId && roomNumber && status) {
          const roomType =
            isRecord(data) && typeof data.roomType === 'string' ? data.roomType : 'STANDARD';
          const floor = isRecord(data) && typeof data.floor === 'number' ? data.floor : 0;
          const resolvedTagCode =
            isRecord(data) && typeof data.tagCode === 'string' ? data.tagCode : tagCode;
          const tagType = isRecord(data) && typeof data.tagType === 'string' ? data.tagType : 'QR';
          const overrideFlag =
            isRecord(data) && typeof data.overrideFlag === 'boolean' ? data.overrideFlag : false;

          const room = {
            roomId,
            roomNumber,
            roomType,
            status,
            floor,
            tagCode: resolvedTagCode,
            tagType,
            overrideFlag,
          };
          setScannedItems((prev) => [
            ...prev,
            {
              tagCode,
              room,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch (error) {
        console.error('Failed to resolve key:', error);
        // Could show error toast here
      } finally {
        setIsProcessing(false);
      }
    },
    [session]
  );

  const removeScannedItem = (tagCode: string) => {
    setScannedItems((prev) => prev.filter((item) => item.tagCode !== tagCode));
  };

  const undoLastScan = () => {
    setScannedItems((prev) => prev.slice(0, -1));
  };

  const clearAll = () => {
    setScannedItems([]);
    setViewMode('scan');
    setResolveStatuses({});
    setOverrideReasons({});
  };

  const getActionType = (): 'begin' | 'finish' | 'mixed' | null => {
    if (scannedItems.length === 0) return null;

    const statuses = scannedItems.map((item) => item.room.status);
    const uniqueStatuses = new Set(statuses);

    if (uniqueStatuses.size === 1) {
      const status = statuses[0];
      if (status === RoomStatus.DIRTY) return 'begin';
      if (status === RoomStatus.CLEANING) return 'finish';
    }

    if (uniqueStatuses.size > 1) return 'mixed';

    return null;
  };

  const handleBeginCleaning = async () => {
    if (scannedItems.length === 0 || !session?.sessionToken) return;

    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/v1/cleaning/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          deviceId,
          scanned: scannedItems.map((item) => ({
            token: item.tagCode,
            roomId: item.room.roomId,
            fromStatus: item.room.status,
            toStatus: RoomStatus.CLEANING,
            override: false,
          })),
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(errorPayload) || `Failed to update rooms: ${response.statusText}`
        );
      }

      clearAll();
      // Return to lock screen after successful action
      handleLogout();
    } catch (error) {
      console.error('Failed to begin cleaning:', error);
      alert(error instanceof Error ? error.message : 'Failed to begin cleaning');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinishCleaning = async () => {
    if (scannedItems.length === 0 || !session?.sessionToken) return;

    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/v1/cleaning/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          deviceId,
          scanned: scannedItems.map((item) => ({
            token: item.tagCode,
            roomId: item.room.roomId,
            fromStatus: item.room.status,
            toStatus: RoomStatus.CLEAN,
            override: false,
          })),
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(errorPayload) || `Failed to update rooms: ${response.statusText}`
        );
      }

      clearAll();
      // Return to lock screen after successful action
      handleLogout();
    } catch (error) {
      console.error('Failed to finish cleaning:', error);
      alert(error instanceof Error ? error.message : 'Failed to finish cleaning');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveStatuses = () => {
    // Initialize resolve statuses with current statuses
    const initialStatuses: Record<string, RoomStatus> = {};
    scannedItems.forEach((item) => {
      initialStatuses[item.room.roomId] = item.room.status;
    });
    setResolveStatuses(initialStatuses);
    setViewMode('resolve');
  };

  const handleStatusChange = (roomId: string, newStatus: RoomStatus, rowIndex: number) => {
    const currentItem = scannedItems.find((item) => item.room.roomId === roomId);
    if (!currentItem) return;

    const currentStatus = currentItem.room.status;

    // Check if transition requires override
    if (!isAdjacentTransition(currentStatus, newStatus) && currentStatus !== newStatus) {
      setOverrideModal({
        roomId,
        roomNumber: currentItem.room.roomNumber,
        fromStatus: currentStatus,
        toStatus: newStatus,
        rowIndex,
      });
      setOverrideReason('');
      return;
    }

    // Allow adjacent transition
    setResolveStatuses((prev) => ({
      ...prev,
      [roomId]: newStatus,
    }));
  };

  const confirmOverride = () => {
    if (!overrideModal || !overrideReason.trim()) return;

    setResolveStatuses((prev) => ({
      ...prev,
      [overrideModal.roomId]: overrideModal.toStatus,
    }));

    setOverrideReasons((prev) => ({
      ...prev,
      [overrideModal.roomId]: overrideReason.trim(),
    }));

    setOverrideModal(null);
    setOverrideReason('');
  };

  const saveResolvedStatuses = async () => {
    if (!session?.sessionToken) return;

    setIsProcessing(true);

    try {
      // Build scanned array with all rooms and their target statuses
      const scanned: Array<{
        token: string;
        roomId: string;
        fromStatus: RoomStatus;
        toStatus: RoomStatus;
        override: boolean;
        overrideReason?: string;
      }> = [];

      scannedItems.forEach((item) => {
        const targetStatus = resolveStatuses[item.room.roomId] ?? item.room.status;
        const currentStatus = item.room.status;

        if (targetStatus === currentStatus) {
          // No change needed, skip
          return;
        }

        // Check if override is needed
        const needsOverride = !isAdjacentTransition(currentStatus, targetStatus);
        const reason = overrideReasons[item.room.roomId];

        scanned.push({
          token: item.tagCode,
          roomId: item.room.roomId,
          fromStatus: currentStatus,
          toStatus: targetStatus,
          override: needsOverride,
          overrideReason: needsOverride ? reason || 'Override required' : undefined,
        });
      });

      if (scanned.length === 0) {
        clearAll();
        handleLogout();
        return;
      }

      // Single API call with all scanned rooms
      const response = await fetch(`${API_BASE}/v1/cleaning/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          deviceId,
          scanned,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Some room updates failed');
      }

      const result: unknown = await response.json();

      // Check if any rooms failed
      const failed =
        isRecord(result) &&
        Array.isArray(result.rooms) &&
        result.rooms.some((r) => isRecord(r) && r.success === false);
      if (failed) {
        throw new Error('Some room updates failed');
      }

      clearAll();
      // Return to lock screen after successful action
      handleLogout();
    } catch (error) {
      console.error('Failed to save resolved statuses:', error);
      alert(error instanceof Error ? error.message : 'Failed to save resolved statuses');
    } finally {
      setIsProcessing(false);
    }
  };

  const actionType = getActionType();

  // Show lock screen if not authenticated
  if (!session) {
    return <LockScreen onLogin={handleLogin} deviceType="kiosk" deviceId={deviceId} />;
  }

  if (viewMode === 'resolve') {
    return (
      <ResolveView
        scannedItems={scannedItems}
        resolveStatuses={resolveStatuses}
        onChangeResolveStatus={handleStatusChange}
        overrideReasons={overrideReasons}
        overrideModal={overrideModal}
        overrideReason={overrideReason}
        onChangeOverrideReason={setOverrideReason}
        onOpenOverrideModal={(modal, reason) => {
          setOverrideModal(modal);
          setOverrideReason(reason);
        }}
        onCloseOverrideModal={() => {
          setOverrideModal(null);
          setOverrideReason('');
        }}
        onConfirmOverride={confirmOverride}
        onSubmitResolved={() => void saveResolvedStatuses()}
        onBackToScan={() => setViewMode('scan')}
        isProcessing={isProcessing}
      />
    );
  }

  return (
    <ScanView
      videoRef={scanner.videoRef}
      canvasRef={scanner.canvasRef}
      cameraError={scanner.cameraError}
      cameraFacingMode={scanner.cameraFacingMode}
      onToggleFacingMode={() => {
        scanner.setFacingMode(scanner.cameraFacingMode === 'user' ? 'environment' : 'user');
      }}
      scannedItems={scannedItems}
      isProcessing={isProcessing}
      onLogout={handleLogout}
      onGoToResolve={handleResolveStatuses}
      actionType={actionType}
      onRemoveScannedItem={removeScannedItem}
      onUndoLastScan={undoLastScan}
      onClearAll={clearAll}
      onBeginCleaning={() => void handleBeginCleaning()}
      onFinishCleaning={() => void handleFinishCleaning()}
    />
  );
}

export default App;
