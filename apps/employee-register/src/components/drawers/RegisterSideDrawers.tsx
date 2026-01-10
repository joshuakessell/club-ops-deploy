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
  const [inventoryWidthPx, setInventoryWidthPx] = useState<number>(() => {
    if (typeof window === 'undefined') return 520;
    return Math.max(420, Math.round(window.innerWidth * 0.45));
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () =>
      setInventoryWidthPx(
        Math.max(420, Math.min(window.innerWidth - 12, Math.round(window.innerWidth * 0.45)))
      );
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


