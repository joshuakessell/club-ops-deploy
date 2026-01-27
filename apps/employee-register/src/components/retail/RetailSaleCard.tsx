import type { ReactNode } from 'react';
import { PanelHeader } from '../../views/PanelHeader';
import type { RetailCatalogItem, RetailCartItem } from './retailCatalog';

export function RetailSaleCard({
  title,
  items,
  cartItems,
  total,
  onAddItem,
  onRemoveItem,
  footer,
}: {
  title: string;
  items: RetailCatalogItem[];
  cartItems: RetailCartItem[];
  total: number;
  onAddItem: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  footer: ReactNode;
}) {
  return (
    <div className="er-retail-card">
      <PanelHeader title={title} spacing="sm" />
      <div className="er-retail-section-title">
        Items <span className="er-retail-section-hint">(Scroll for more)</span>
      </div>
      <div className="er-retail-items">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="cs-liquid-button cs-liquid-button--secondary er-retail-item-button"
            onClick={() => onAddItem(item.id)}
          >
            <span>{item.label}</span>
            <span className="er-retail-price">${item.price.toFixed(2)}</span>
          </button>
        ))}
      </div>

      <div className="er-retail-section-title">Cart</div>
      <div className="er-retail-cart">
        {cartItems.length === 0 ? (
          <div className="er-retail-cart-empty">No items added.</div>
        ) : (
          cartItems.map((item) => (
            <div key={item.id} className="er-retail-cart-row">
              <button
                type="button"
                className="cs-liquid-button cs-liquid-button--danger er-retail-cart-remove"
                onClick={() => onRemoveItem(item.id)}
                aria-label={`Remove ${item.label}`}
              >
                −
              </button>
              <div className="er-retail-cart-label">
                <div className="er-retail-cart-name">{item.label}</div>
                <div className="er-retail-cart-meta">
                  Qty {item.quantity} • ${item.lineTotal.toFixed(2)}
                </div>
              </div>
              <div className="er-retail-cart-unit">${item.price.toFixed(2)}</div>
            </div>
          ))
        )}
      </div>

      <div className="er-retail-total">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      <div className="er-retail-actions">{footer}</div>
    </div>
  );
}
