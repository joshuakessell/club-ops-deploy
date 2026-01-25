import { ModalFrame } from './ModalFrame';
import { RetailSaleCard } from '../../retail/RetailSaleCard';
import {
  RETAIL_CATALOG,
  buildRetailCartItems,
  getRetailCartTotal,
  type RetailCart,
} from '../../retail/retailCatalog';

export function AddOnSaleModal({
  isOpen,
  cart,
  onAddItem,
  onRemoveItem,
  onAddToCheckin,
  onClose,
  isSubmitting,
}: {
  isOpen: boolean;
  cart: RetailCart;
  onAddItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAddToCheckin: () => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const cartItems = buildRetailCartItems(cart);
  const total = getRetailCartTotal(cartItems);

  return (
    <ModalFrame
      isOpen={isOpen}
      title="Add-On Sale"
      onClose={onClose}
      maxWidth="760px"
    >
      <RetailSaleCard
        title="Add items to check-in"
        items={RETAIL_CATALOG}
        cartItems={cartItems}
        total={total}
        onAddItem={onAddItem}
        onRemoveItem={onRemoveItem}
        footer={
          <button
            type="button"
            className="cs-liquid-button"
            onClick={onAddToCheckin}
            disabled={cartItems.length === 0 || isSubmitting}
          >
            {isSubmitting ? 'Adding…' : 'Add to Checkin'}
          </button>
        }
      />
    </ModalFrame>
  );
}
