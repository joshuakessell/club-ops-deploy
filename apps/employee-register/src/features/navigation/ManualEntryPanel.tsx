import { extractDobDigits, formatDobMmDdYyyy } from '../../utils/dob';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

export function ManualEntryPanel() {
  const {
    handleManualSubmit,
    manualFirstName,
    setManualFirstName,
    manualLastName,
    setManualLastName,
    manualDobDigits,
    setManualDobDigits,
    manualDobIso,
    manualIdNumber,
    setManualIdNumber,
    isSubmitting,
    manualEntrySubmitting,
    setManualEntry,
    selectHomeTab,
  } = useEmployeeRegisterState();

  return (
    <form
      className="er-home-panel er-home-panel--top manual-entry-form cs-liquid-card er-main-panel-card"
      onSubmit={(e) => void handleManualSubmit(e)}
    >
      <div className="er-card-title" style={{ marginBottom: '0.75rem' }}>
        First Time Customer
      </div>
      <div className="er-card-subtitle" style={{ marginBottom: '0.75rem' }}>
        Enter customer details from alternate ID.
      </div>
      <div className="form-group">
        <label htmlFor="manualFirstName">First Name *</label>
        <input
          id="manualFirstName"
          type="text"
          className="cs-liquid-input"
          value={manualFirstName}
          onChange={(e) => setManualFirstName(e.target.value)}
          placeholder="Enter first name"
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="manualLastName">Last Name *</label>
        <input
          id="manualLastName"
          type="text"
          className="cs-liquid-input"
          value={manualLastName}
          onChange={(e) => setManualLastName(e.target.value)}
          placeholder="Enter last name"
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="manualDob">Date of Birth *</label>
        <input
          id="manualDob"
          type="text"
          inputMode="numeric"
          className="cs-liquid-input"
          value={formatDobMmDdYyyy(manualDobDigits)}
          onChange={(e) => setManualDobDigits(extractDobDigits(e.target.value))}
          placeholder="MM/DD/YYYY"
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="manualIdNumber">License / ID Number</label>
        <input
          id="manualIdNumber"
          type="text"
          className="cs-liquid-input"
          value={manualIdNumber}
          onChange={(e) => setManualIdNumber(e.target.value)}
          placeholder="Enter license or ID number"
          disabled={isSubmitting}
        />
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className="submit-btn cs-liquid-button"
          disabled={
            isSubmitting ||
            manualEntrySubmitting ||
            !manualFirstName.trim() ||
            !manualLastName.trim() ||
            !manualDobIso
          }
        >
          {isSubmitting || manualEntrySubmitting ? 'Submitting...' : 'Add Customer'}
        </button>
        <button
          type="button"
          className="cancel-btn cs-liquid-button cs-liquid-button--danger"
          onClick={() => {
            setManualEntry(false);
            setManualFirstName('');
            setManualLastName('');
            setManualDobDigits('');
            setManualIdNumber('');
            selectHomeTab('scan');
          }}
          disabled={isSubmitting || manualEntrySubmitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
