import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function HomeTabs() {
  const {
    homeTab,
    selectHomeTab,
    inventoryHasLate,
    hasEligibleEntries,
    dismissUpgradePulse,
    startCheckoutFromHome,
  } = useEmployeeRegisterState();

  return (
    <nav className="er-home-tabs" aria-label="Home actions">
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'account'
            ? 'cs-liquid-button--selected'
            : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('account')}
      >
        Customer Account
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'scan' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('scan')}
      >
        Scan
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'search' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('search')}
      >
        Search Customer
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'firstTime' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('firstTime')}
      >
        Manual Entry
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          inventoryHasLate ? 'er-home-tab-btn--late er-pulse-danger' : '',
          homeTab === 'inventory'
            ? 'cs-liquid-button--selected'
            : inventoryHasLate
              ? 'cs-liquid-button--danger'
              : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('inventory')}
      >
        Rentals
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'upgrades'
            ? 'cs-liquid-button--selected'
            : hasEligibleEntries
              ? 'cs-liquid-button--success'
              : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => {
          dismissUpgradePulse();
          selectHomeTab('upgrades');
        }}
      >
        Upgrades
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          'er-home-tab-btn--checkout',
          homeTab === 'checkout'
            ? 'cs-liquid-button--selected'
            : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => startCheckoutFromHome()}
      >
        Checkout
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'roomCleaning'
            ? 'cs-liquid-button--selected'
            : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('roomCleaning')}
      >
        Room Cleaning
      </button>
      <button
        type="button"
        className={[
          'er-home-tab-btn',
          'cs-liquid-button',
          homeTab === 'retail' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
        ].join(' ')}
        onClick={() => selectHomeTab('retail')}
      >
        Retail
      </button>
    </nav>
  );
}
