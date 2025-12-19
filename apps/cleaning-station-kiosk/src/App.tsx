import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { RoomStatus, isAdjacentTransition } from '@club-ops/shared';
import { LockScreen, type StaffSession } from './LockScreen';

interface ResolvedRoom {
  roomId: string;
  roomNumber: string;
  roomType: string;
  status: RoomStatus;
  floor: number;
  tagCode: string;
  tagType: string;
  overrideFlag: boolean;
}

interface ScannedItem {
  tagCode: string;
  room: ResolvedRoom;
  timestamp: number;
}

type ViewMode = 'scan' | 'resolve';

interface OverrideModalState {
  roomId: string;
  roomNumber: string;
  fromStatus: RoomStatus;
  toStatus: RoomStatus;
  rowIndex: number;
}

const API_BASE = '/api';

function App() {
  // Session state - stored in memory only, not localStorage
  const [session, setSession] = useState<StaffSession | null>(null);
  
  const deviceId = useState(() => {
    // Generate or retrieve device ID
    let id = localStorage.getItem('device_id');
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      localStorage.setItem('device_id', id);
    }
    return id;
  })[0];

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningIntervalRef = useRef<number | null>(null);
  const handleScanRef = useRef<((tagCode: string) => Promise<void>) | null>(null);

  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const scannedItemsRef = useRef<ScannedItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('scan');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [isProcessing, setIsProcessing] = useState(false);
  const [overrideModal, setOverrideModal] = useState<OverrideModalState | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [resolveStatuses, setResolveStatuses] = useState<Record<string, RoomStatus>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});

  const handleLogin = (newSession: StaffSession) => {
    setSession(newSession);
  };

  const handleLogout = () => {
    setSession(null);
    setScannedItems([]);
    setViewMode('scan');
  };

  // Show lock screen if not authenticated
  if (!session) {
    return (
      <LockScreen
        onLogin={handleLogin}
        deviceType="kiosk"
        deviceId={deviceId}
      />
    );
  }

  // Keep ref in sync with state
  useEffect(() => {
    scannedItemsRef.current = scannedItems;
  }, [scannedItems]);

  // Initialize camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: cameraFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Initialize ZXing reader
        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;
        setCameraError(null);

        // Start continuous scanning
        startScanning();
      } catch (error) {
        console.error('Camera error:', error);
        setCameraError(
          error instanceof Error ? error.message : 'Failed to access camera'
        );
      }
    };

    initCamera();

    return () => {
      stopScanning();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [cameraFacingMode]);

  const startScanning = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !codeReaderRef.current) return;

    const scan = async () => {
      if (!videoRef.current || !canvasRef.current || !codeReaderRef.current) return;

      try {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const context = canvas.getContext('2d');

        if (!context || video.readyState !== video.HAVE_ENOUGH_DATA) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert canvas to image for ZXing
        const img = new Image();
        img.src = canvas.toDataURL();
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const result = await codeReaderRef.current.decodeFromImageElement(img);

        if (result && handleScanRef.current) {
          handleScanRef.current(result.getText());
        }
      } catch (error) {
        // NotFoundException is expected when no QR code is visible
        if (!(error instanceof NotFoundException)) {
          console.error('Scan error:', error);
        }
      }
    };

    // Scan every 500ms
    scanningIntervalRef.current = window.setInterval(scan, 500);
  }, []);

  const stopScanning = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    if (scanningIntervalRef.current) {
      clearInterval(scanningIntervalRef.current);
      scanningIntervalRef.current = null;
    }
  }, []);

  const handleScan = useCallback(async (tagCode: string) => {
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ token: tagCode }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to resolve key: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.roomId && data.roomNumber && data.status) {
        const room: ResolvedRoom = {
          roomId: data.roomId,
          roomNumber: data.roomNumber,
          roomType: data.roomType || 'STANDARD', // Fallback for backwards compatibility
          status: data.status as RoomStatus,
          floor: data.floor ?? 0, // Fallback for backwards compatibility
          tagCode: data.tagCode || tagCode, // Use API value if available, otherwise use scanned tagCode
          tagType: data.tagType || 'QR', // Fallback for backwards compatibility
          overrideFlag: data.overrideFlag ?? false, // Fallback for backwards compatibility
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
  }, [session]);

  // Keep handleScan ref in sync
  useEffect(() => {
    handleScanRef.current = handleScan;
  }, [handleScan]);

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
          'Authorization': `Bearer ${session.sessionToken}`,
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update rooms: ${response.statusText}`);
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
          'Authorization': `Bearer ${session.sessionToken}`,
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update rooms: ${response.statusText}`);
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
          overrideReason: needsOverride ? (reason || 'Override required') : undefined,
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          deviceId,
          scanned,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Some room updates failed');
      }

      const result = await response.json();
      
      // Check if any rooms failed
      const failed = result.rooms?.some((r: { success: boolean }) => !r.success);
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

  if (viewMode === 'resolve') {
    return (
      <div className="app-container">
        <div className="resolve-container">
          <h1 className="resolve-title">Resolve Room Statuses</h1>

          <div className="resolve-table">
            <div className="resolve-header">
              <div>Room</div>
              <div>Current</div>
              <div>New Status</div>
            </div>

            {scannedItems.map((item, index) => {
              const currentStatus = item.room.status;
              const newStatus = resolveStatuses[item.room.roomId] ?? currentStatus;
              const needsOverride = overrideReasons[item.room.roomId] !== undefined;

              return (
                <div key={item.room.roomId} className="resolve-row">
                  <div className="resolve-room-number">{item.room.roomNumber}</div>
                  <div className="resolve-current-status">{currentStatus}</div>
                  <div className="resolve-status-controls">
                    <div className="status-slider">
                      <input
                        type="range"
                        min="0"
                        max="2"
                        value={Object.values(RoomStatus).indexOf(newStatus)}
                        onChange={(e) => {
                          const statusIndex = parseInt(e.target.value, 10);
                          const targetStatus = Object.values(RoomStatus)[statusIndex] as RoomStatus;
                          handleStatusChange(item.room.roomId, targetStatus, index);
                        }}
                        className="status-range-input"
                      />
                      <div className="status-labels">
                        {Object.values(RoomStatus).map((status) => (
                          <span
                            key={status}
                            className={`status-label ${newStatus === status ? 'active' : ''}`}
                          >
                            {status}
                          </span>
                        ))}
                      </div>
                    </div>
                    {needsOverride && (
                      <button
                        className="button-override-edit"
                        onClick={() => {
                          setOverrideModal({
                            roomId: item.room.roomId,
                            roomNumber: item.room.roomNumber,
                            fromStatus: currentStatus,
                            toStatus: newStatus,
                            rowIndex: index,
                          });
                          setOverrideReason(overrideReasons[item.room.roomId] || '');
                        }}
                      >
                        Edit Override
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="resolve-actions">
            <button className="button-secondary" onClick={() => setViewMode('scan')}>
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={saveResolvedStatuses}
              disabled={isProcessing}
            >
              Save Changes
            </button>
          </div>
        </div>

        {overrideModal && (
          <div className="modal-overlay" onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOverrideModal(null);
              setOverrideReason('');
            }
          }}>
            <div className="modal-content">
              <h2>Override Required</h2>
              <p>
                Room {overrideModal.roomNumber}: {overrideModal.fromStatus} →{' '}
                {overrideModal.toStatus}
              </p>
              <p className="modal-warning">
                This transition skips a step and requires a reason.
              </p>
              <textarea
                className="modal-textarea"
                placeholder="Enter reason for override..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={4}
              />
              <div className="modal-actions">
                <button
                  className="button-secondary"
                  onClick={() => {
                    setOverrideModal(null);
                    setOverrideReason('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button-primary"
                  onClick={confirmOverride}
                  disabled={!overrideReason.trim()}
                >
                  Confirm Override
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="camera-container">
        <video ref={videoRef} className="camera-preview" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="camera-canvas" style={{ display: 'none' }} />
        {cameraError && (
          <div className="camera-error">
            <p>Camera Error: {cameraError}</p>
            <button
              className="button-secondary"
              onClick={() => {
                setCameraFacingMode(
                  cameraFacingMode === 'user' ? 'environment' : 'user'
                );
              }}
            >
              Switch Camera
            </button>
          </div>
        )}
        {!cameraError && (
          <button
            className="camera-switch-button"
            onClick={() => {
              setCameraFacingMode(
                cameraFacingMode === 'user' ? 'environment' : 'user'
              );
            }}
            title="Switch Camera"
          >
            🔄
          </button>
        )}
      </div>

      <div className="content-panel">
        <h1 className="panel-title">Scanned Rooms</h1>

        {scannedItems.length === 0 ? (
          <div className="empty-state">
            <p>Scan QR codes to add rooms</p>
          </div>
        ) : (
          <>
            <div className="scanned-list">
              {scannedItems.map((item) => (
                <div key={item.tagCode} className="scanned-item">
                  <div className="scanned-info">
                    <div className="scanned-room-number">Room {item.room.roomNumber}</div>
                    <div className={`scanned-status status-${item.room.status.toLowerCase()}`}>
                      {item.room.status}
                    </div>
                  </div>
                  <button
                    className="button-remove"
                    onClick={() => removeScannedItem(item.tagCode)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="control-buttons">
              <button className="button-secondary" onClick={undoLastScan}>
                Undo Last
              </button>
              <button className="button-secondary" onClick={clearAll}>
                Clear All
              </button>
            </div>

            <div className="action-buttons">
              {actionType === 'begin' && (
                <button
                  className="button-primary button-large"
                  onClick={handleBeginCleaning}
                  disabled={isProcessing}
                >
                  Begin Cleaning ({scannedItems.length})
                </button>
              )}

              {actionType === 'finish' && (
                <button
                  className="button-primary button-large"
                  onClick={handleFinishCleaning}
                  disabled={isProcessing}
                >
                  Finish Cleaning ({scannedItems.length})
                </button>
              )}

              {actionType === 'mixed' && (
                <>
                  <div className="warning-message">
                    ⚠️ Mixed statuses detected. Please resolve before proceeding.
                  </div>
                  <button
                    className="button-primary button-large"
                    onClick={handleResolveStatuses}
                    disabled={isProcessing}
                  >
                    Resolve Statuses
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;

