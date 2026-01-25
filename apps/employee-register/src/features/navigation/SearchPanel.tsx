import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

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
    <div
      className="er-home-panel er-home-panel--top typeahead-section cs-liquid-card er-main-panel-card"
      style={{ marginTop: 0 }}
    >
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <label htmlFor="customer-search" className="er-card-title">
          Search Customer
        </label>
        <span className="er-card-subtitle">(type at least 3 letters)</span>
      </div>
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
        <div className="er-text-sm" style={{ marginTop: '0.25rem', color: '#94a3b8' }}>
          Searching...
        </div>
      )}
      {customerSuggestions.length > 0 && (
        <div
          className="cs-liquid-card"
          style={{
            marginTop: '0.5rem',
            maxHeight: '180px',
            overflowY: 'auto',
          }}
        >
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
                className="cs-liquid-button cs-liquid-button--secondary"
                onClick={() => {
                  openCustomerAccount(s.id, label);
                  setCustomerSearch('');
                  setCustomerSuggestions([]);
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  border: 'none',
                  borderBottom: '1px solid #1f2937',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ fontWeight: 600 }}>{label}</div>
                <div
                  className="er-text-sm"
                  style={{
                    color: '#94a3b8',
                    display: 'flex',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {s.dobMonthDay && <span>DOB: {s.dobMonthDay}</span>}
                  {s.membershipNumber && <span>Membership: {s.membershipNumber}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
