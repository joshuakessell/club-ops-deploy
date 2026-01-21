import { useEffect, useRef, useState } from 'react';
import { SuccessToast } from './toasts/SuccessToast';
import { ManualCheckoutModal } from './modals/ManualCheckoutModal';
import { RoomCleaningModal } from './modals/RoomCleaningModal';

export function useRegisterTopActionsOverlays(opts: {
  sessionToken: string | null;
  staffId: string | null;
}) {
  const { sessionToken, staffId } = opts;

  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showRoomCleaningModal, setShowRoomCleaningModal] = useState(false);
  const [successToastMessage, setSuccessToastMessage] = useState<string | null>(null);
  const successToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!successToastMessage) return;
    if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    successToastTimerRef.current = window.setTimeout(() => setSuccessToastMessage(null), 3000);
    return () => {
      if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    };
  }, [successToastMessage]);

  const openCheckout = () => {
    if (!sessionToken) return;
    setShowCheckoutModal(true);
  };

  const openRoomCleaning = () => {
    if (!sessionToken || !staffId) return;
    setShowRoomCleaningModal(true);
  };

  const overlays = (
    <>
      <SuccessToast message={successToastMessage} onDismiss={() => setSuccessToastMessage(null)} />

      {showCheckoutModal && sessionToken && (
        <ManualCheckoutModal
          isOpen={true}
          sessionToken={sessionToken}
          onClose={() => setShowCheckoutModal(false)}
          onSuccess={(message) => {
            setShowCheckoutModal(false);
            setSuccessToastMessage(message);
          }}
        />
      )}

      {showRoomCleaningModal && sessionToken && staffId && (
        <RoomCleaningModal
          isOpen={true}
          sessionToken={sessionToken}
          staffId={staffId}
          onClose={() => setShowRoomCleaningModal(false)}
          onSuccess={(message) => {
            setShowRoomCleaningModal(false);
            setSuccessToastMessage(message);
          }}
        />
      )}
    </>
  );

  return { openCheckout, openRoomCleaning, overlays };
}


