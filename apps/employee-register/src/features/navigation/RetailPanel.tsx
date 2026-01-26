import { useEffect, useMemo, useState } from 'react';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { RetailSaleCard } from '../../components/retail/RetailSaleCard';
import {
  RETAIL_CATALOG,
  buildRetailCartItems,
  getRetailCartTotal,
  type RetailCart,
} from '../../components/retail/retailCatalog';
import { PanelShell } from '../../views/PanelShell';

export function RetailPanel() {
  const { setSuccessToastMessage } = useEmployeeRegisterState();
  const [cart, setCart] = useState<RetailCart>({});
  const [showTenderOptions, setShowTenderOptions] = useState(false);

  const cartItems = useMemo(() => buildRetailCartItems(cart), [cart]);
  const total = useMemo(() => getRetailCartTotal(cartItems), [cartItems]);

  useEffect(() => {
    if (cartItems.length === 0) {
      setShowTenderOptions(false);
    }
  }, [cartItems.length]);

  const addItem = (itemId: string) => {
    setCart((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
  };

  const removeItem = (itemId: string) => {
    setCart((prev) => {
      const next = { ...prev };
      const current = next[itemId] ?? 0;
      if (current <= 1) {
        delete next[itemId];
      } else {
        next[itemId] = current - 1;
      }
      return next;
    });
  };

  const resetSale = () => {
    setCart({});
    setShowTenderOptions(false);
  };

  const handleSaleSuccess = (methodLabel: string) => {
    setSuccessToastMessage(`Retail sale complete (${methodLabel}).`);
    resetSale();
  };

  return (
    <PanelShell align="top">
      <RetailSaleCard
        title="Retail"
        items={RETAIL_CATALOG}
        cartItems={cartItems}
        total={total}
        onAddItem={addItem}
        onRemoveItem={removeItem}
        footer={
          showTenderOptions ? (
            <div className="er-retail-tender-options">
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={() => handleSaleSuccess('Credit')}
                disabled={cartItems.length === 0}
              >
                Credit Success
              </button>
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--danger"
                onClick={() => setShowTenderOptions(true)}
                disabled={cartItems.length === 0}
              >
                Credit Failure
              </button>
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={() => handleSaleSuccess('Cash')}
                disabled={cartItems.length === 0}
              >
                Cash Success
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="cs-liquid-button"
              onClick={() => setShowTenderOptions(true)}
              disabled={cartItems.length === 0}
            >
              Sale
            </button>
          )
        }
      />
    </PanelShell>
  );
}
