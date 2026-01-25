import { ManualCheckoutPanel } from '../../components/register/panels/ManualCheckoutPanel';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function CheckoutPanel() {
  const {
    session,
    checkoutEntryMode,
    checkoutPrefill,
    exitCheckout,
    setSuccessToastMessage,
    checkoutReturnToTabRef,
    setInventoryRefreshNonce,
  } = useEmployeeRegisterState();

  if (!session?.sessionToken) return null;

  return (
    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
      <ManualCheckoutPanel
        sessionToken={session.sessionToken}
        entryMode={checkoutEntryMode}
        prefill={checkoutPrefill ?? undefined}
        onExit={exitCheckout}
        onSuccess={(message) => {
          setSuccessToastMessage(message);
          if (checkoutReturnToTabRef.current) {
            setInventoryRefreshNonce((prev: number) => prev + 1);
            exitCheckout();
          }
        }}
      />
    </div>
  );
}
