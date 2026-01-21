import { RoomStatus } from '@club-ops/shared';
import { OverrideModal } from '../components/OverrideModal';

const CLEANING_FLOW_STATUSES: readonly RoomStatus[] = [
  RoomStatus.DIRTY,
  RoomStatus.CLEANING,
  RoomStatus.CLEAN,
];

export interface ScannedItem {
  tagCode: string;
  room: {
    roomId: string;
    roomNumber: string;
    roomType: string;
    status: RoomStatus;
    floor: number;
    tagCode: string;
    tagType: string;
    overrideFlag: boolean;
  };
  timestamp: number;
}

export interface OverrideModalState {
  roomId: string;
  roomNumber: string;
  fromStatus: RoomStatus;
  toStatus: RoomStatus;
  rowIndex: number;
}

export interface ResolveViewProps {
  scannedItems: ScannedItem[];
  resolveStatuses: Record<string, RoomStatus>;
  onChangeResolveStatus: (roomId: string, newStatus: RoomStatus, rowIndex: number) => void;
  overrideReasons: Record<string, string>;
  overrideModal: OverrideModalState | null;
  overrideReason: string;
  onChangeOverrideReason: (reason: string) => void;
  onOpenOverrideModal: (modal: OverrideModalState, reason: string) => void;
  onCloseOverrideModal: () => void;
  onConfirmOverride: () => void;
  onSubmitResolved: () => void;
  onBackToScan: () => void;
  isProcessing: boolean;
}

export function ResolveView({
  scannedItems,
  resolveStatuses,
  onChangeResolveStatus,
  overrideReasons,
  overrideModal,
  overrideReason,
  onChangeOverrideReason,
  onOpenOverrideModal,
  onCloseOverrideModal,
  onConfirmOverride,
  onSubmitResolved,
  onBackToScan,
  isProcessing,
}: ResolveViewProps) {
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
                      max={CLEANING_FLOW_STATUSES.length - 1}
                      value={Math.max(0, CLEANING_FLOW_STATUSES.indexOf(newStatus))}
                      onChange={(e) => {
                        const statusIndex = parseInt(e.target.value, 10);
                        const targetStatus = CLEANING_FLOW_STATUSES[statusIndex] ?? RoomStatus.DIRTY;
                        onChangeResolveStatus(item.room.roomId, targetStatus, index);
                      }}
                      className="status-range-input"
                    />
                    <div className="status-labels">
                      {CLEANING_FLOW_STATUSES.map((status) => (
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
                        onOpenOverrideModal(
                          {
                            roomId: item.room.roomId,
                            roomNumber: item.room.roomNumber,
                            fromStatus: currentStatus,
                            toStatus: newStatus,
                            rowIndex: index,
                          },
                          overrideReasons[item.room.roomId] || ''
                        );
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
          <button className="button-secondary" onClick={onBackToScan}>
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={onSubmitResolved}
            disabled={isProcessing}
          >
            Save Changes
          </button>
        </div>
      </div>

      {overrideModal && (
        <OverrideModal
          isOpen={!!overrideModal}
          roomNumber={overrideModal.roomNumber}
          fromStatus={overrideModal.fromStatus}
          toStatus={overrideModal.toStatus}
          reason={overrideReason}
          onChangeReason={onChangeOverrideReason}
          onConfirm={onConfirmOverride}
          onCancel={onCloseOverrideModal}
        />
      )}
    </div>
  );
}

