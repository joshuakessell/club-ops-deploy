import { useState } from 'react';
import type { InventoryDrawerSection } from '../../../components/inventory/InventoryDrawer';

type InventorySelection = {
  type: 'room' | 'locker';
  id: string;
  number: string;
  tier: string;
};

type CustomerConfirmationType = {
  requested: string;
  selected: string;
  number: string;
};

type Params = {
  customerSelectedType: string | null;
};

export function useInventorySelectionState({ customerSelectedType }: Params) {
  const [inventoryForcedSection, setInventoryForcedSection] =
    useState<InventoryDrawerSection>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventorySelection | null>(
    null
  );
  const [showCustomerConfirmationPending, setShowCustomerConfirmationPending] = useState(false);
  const [customerConfirmationType, setCustomerConfirmationType] =
    useState<CustomerConfirmationType | null>(null);

  const handleInventorySelect = (
    type: 'room' | 'locker',
    id: string,
    number: string,
    tier: string
  ) => {
    if (customerSelectedType && tier !== customerSelectedType) {
      setCustomerConfirmationType({
        requested: customerSelectedType,
        selected: tier,
        number,
      });
      setShowCustomerConfirmationPending(true);
    }

    setSelectedInventoryItem({ type, id, number, tier });
  };

  return {
    inventoryForcedSection,
    setInventoryForcedSection,
    selectedInventoryItem,
    setSelectedInventoryItem,
    showCustomerConfirmationPending,
    setShowCustomerConfirmationPending,
    customerConfirmationType,
    setCustomerConfirmationType,
    handleInventorySelect,
  };
}
