import { useCallback, useState } from 'react';
import type { RetailCart } from '../../../components/retail/retailCatalog';

export function useAddOnSaleState() {
  const [showAddOnSaleModal, setShowAddOnSaleModal] = useState(false);
  const [addOnCart, setAddOnCart] = useState<RetailCart>({});

  const resetAddOnCart = useCallback(() => setAddOnCart({}), []);

  const addAddOnItem = useCallback((itemId: string) => {
    setAddOnCart((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
  }, []);

  const removeAddOnItem = useCallback((itemId: string) => {
    setAddOnCart((prev) => {
      const next = { ...prev };
      const current = next[itemId] ?? 0;
      if (current <= 1) {
        delete next[itemId];
      } else {
        next[itemId] = current - 1;
      }
      return next;
    });
  }, []);

  const openAddOnSaleModal = useCallback(() => {
    setShowAddOnSaleModal(true);
  }, []);

  const closeAddOnSaleModal = useCallback(() => {
    setShowAddOnSaleModal(false);
    resetAddOnCart();
  }, [resetAddOnCart]);

  return {
    showAddOnSaleModal,
    setShowAddOnSaleModal,
    addOnCart,
    setAddOnCart,
    resetAddOnCart,
    addAddOnItem,
    removeAddOnItem,
    openAddOnSaleModal,
    closeAddOnSaleModal,
  };
}
