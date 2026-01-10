import type { ReactNode } from 'react';
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
      >
        {inventoryContent}
      </SlideOutDrawer>
    </>
  );
}


