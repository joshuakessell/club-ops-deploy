import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';
import { PanelHeader } from '../../views/PanelHeader';
import { PanelShell } from '../../views/PanelShell';

export function SearchPanel() {
  const {
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
    openCustomerAccount,
    isSubmitting,
  } = useEmployeeRegisterState();

  return (
    <PanelShell align="top" className="typeahead-section">
      <PanelHeader
        layout="inline"
        spacing="sm"
        title={<label htmlFor="customer-search">Search Customer</label>}
        subtitle="(type at least 3 letters)"
      />
      <input
        id="customer-search"
        type="text"
        className="cs-liquid-input"
        value={customerSearch}
        onChange={(e) => setCustomerSearch(e.target.value)}
        placeholder="Start typing name..."
        disabled={isSubmitting}
      />
      {customerSearchLoading && (
        <div className="er-text-sm er-text-muted u-mt-4">Searching...</div>
      )}
      {customerSuggestions.length > 0 && (
        <div className="cs-liquid-card er-search-suggestions">
          {customerSuggestions.map(
            (s: {
              id: string;
              firstName: string;
              lastName: string;
              dobMonthDay?: string;
              membershipNumber?: string;
            }) => {
              const label = `${s.lastName}, ${s.firstName}`;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="cs-liquid-button cs-liquid-button--secondary er-search-suggestion"
                  onClick={() => {
                    openCustomerAccount(s.id, label);
                    setCustomerSearch('');
                    setCustomerSuggestions([]);
                  }}
                >
                  <div className="u-fw-600">{label}</div>
                  <div className="er-text-sm er-text-muted u-flex u-gap-12 u-flex-wrap">
                    {s.dobMonthDay && <span>DOB: {s.dobMonthDay}</span>}
                    {s.membershipNumber && <span>Membership: {s.membershipNumber}</span>}
                  </div>
                </button>
              );
            }
          )}
        </div>
      )}
    </PanelShell>
  );
}
