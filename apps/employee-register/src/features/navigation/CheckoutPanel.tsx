import { ManualCheckoutPanel } from '../../components/register/panels/ManualCheckoutPanel';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelShell } from '../../views/PanelShell';

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
    <PanelShell align="top" scroll="hidden" card={false}>
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
    </PanelShell>
  );
}
