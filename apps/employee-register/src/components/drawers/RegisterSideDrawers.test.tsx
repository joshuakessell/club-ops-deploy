import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { RegisterSideDrawers } from './RegisterSideDrawers';

function Harness() {
  const [upgradesOpen, setUpgradesOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  return (
    <RegisterSideDrawers
      upgradesOpen={upgradesOpen}
      onUpgradesOpenChange={setUpgradesOpen}
      inventoryOpen={inventoryOpen}
      onInventoryOpenChange={setInventoryOpen}
      upgradesContent={<div>Upgrades content</div>}
      inventoryContent={<div>Inventory content</div>}
    />
  );
}

describe('RegisterSideDrawers', () => {
  it('renders both tabs', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Upgrades' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Inventory' })).toBeDefined();
  });

  it('clicking Upgrades opens upgrades and closes inventory', () => {
    render(<Harness />);

    const upgrades = screen.getByRole('button', { name: 'Upgrades' });
    const inventory = screen.getByRole('button', { name: 'Inventory' });

    fireEvent.click(upgrades);
    expect(upgrades.getAttribute('aria-expanded')).toBe('true');
    expect(inventory.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(inventory);
    expect(inventory.getAttribute('aria-expanded')).toBe('true');
    expect(upgrades.getAttribute('aria-expanded')).toBe('false');
  });
});


