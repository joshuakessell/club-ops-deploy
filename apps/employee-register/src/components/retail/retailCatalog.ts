export type RetailCatalogItem = {
  id: string;
  label: string;
  price: number;
};

export type RetailCart = Record<string, number>;

export type RetailCartItem = RetailCatalogItem & {
  quantity: number;
  lineTotal: number;
};

export const RETAIL_CATALOG: RetailCatalogItem[] = [
  { id: 'swiss-navy-lube', label: 'Swiss Navy', price: 10 },
  { id: 'wet-platinum-lube', label: 'Wet Platinum', price: 10 },
  { id: 'large-aroma', label: 'Large Aroma', price: 10 },
  { id: 'small-aroma', label: 'Small Aroma', price: 10 },
  { id: 'sundries', label: 'Sundries', price: 10 },
  { id: 'chargers', label: 'Chargers', price: 10 },
  { id: 'flip-flops', label: 'Flip Flops', price: 10 },
  { id: 'monster', label: 'Monster', price: 10 },
  { id: 'gatorade', label: 'Gatorade', price: 10 },
  { id: 'water', label: 'Water', price: 10 },
];

export function buildRetailCartItems(
  cart: RetailCart,
  catalog: RetailCatalogItem[] = RETAIL_CATALOG
): RetailCartItem[] {
  return catalog
    .map((item) => {
      const quantity = cart[item.id] ?? 0;
      if (quantity <= 0) return null;
      return {
        ...item,
        quantity,
        lineTotal: item.price * quantity,
      };
    })
    .filter((item): item is RetailCartItem => Boolean(item));
}

export function getRetailCartTotal(items: RetailCartItem[]): number {
  return items.reduce((sum, item) => sum + item.lineTotal, 0);
}
