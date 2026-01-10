import { type ReactNode, useEffect, useState } from 'react';
import { SlideOutDrawer } from './SlideOutDrawer';

export interface RegisterSideDrawersProps {
  upgradesOpen: boolean;
  onUpgradesOpenChange(next: boolean): void;
  inventoryOpen: boolean;
  onInventoryOpenChange(next: boolean): void;
  upgradesAttention?: boolean;
  inventoryAttention?: boolean;
  upgradesContent: ReactNode;
  inventoryContent: ReactNode;
}

export function RegisterSideDrawers({
  upgradesOpen,
  onUpgradesOpenChange,
  inventoryOpen,
  onInventoryOpenChange,
  upgradesAttention = false,
  inventoryAttention = false,
  upgradesContent,
  inventoryContent,
}: RegisterSideDrawersProps) {
  // Keep the inventory drawer only as wide as it needs to be.
  // The previous "45% of viewport" sizing made the panel too wide on large displays.
  const INVENTORY_DRAWER_MIN_PX = 420;
  const INVENTORY_DRAWER_IDEAL_PX = 520;
  const VIEWPORT_EDGE_GAP_PX = 12;

  const computeInventoryWidthPx = (vw: number) => {
    // Ensure the drawer never exceeds the viewport width (leaves a small gap).
    const maxAllowed = Math.max(0, vw - VIEWPORT_EDGE_GAP_PX);
    const minAllowed = Math.min(INVENTORY_DRAWER_MIN_PX, maxAllowed);
    const clamped = Math.min(INVENTORY_DRAWER_IDEAL_PX, maxAllowed);
    return Math.max(minAllowed, clamped);
  };

  const [inventoryWidthPx, setInventoryWidthPx] = useState<number>(() => {
    if (typeof window === 'undefined') return INVENTORY_DRAWER_IDEAL_PX;
    return computeInventoryWidthPx(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setInventoryWidthPx(computeInventoryWidthPx(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <>
      <SlideOutDrawer
        side="left"
        label="Upgrades"
        isOpen={upgradesOpen}
        onOpenChange={(next) => {
          if (next) onInventoryOpenChange(false);
          onUpgradesOpenChange(next);
        }}
        attention={upgradesAttention}
      >
        {upgradesContent}
      </SlideOutDrawer>

      <SlideOutDrawer
        side="right"
        label="Inventory"
        isOpen={inventoryOpen}
        onOpenChange={(next) => {
          if (next) onUpgradesOpenChange(false);
          onInventoryOpenChange(next);
        }}
        attention={inventoryAttention}
        widthPx={inventoryWidthPx}
      >
        {inventoryContent}
      </SlideOutDrawer>
    </>
  );
}


