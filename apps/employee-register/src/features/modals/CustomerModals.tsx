import { getApiUrl } from '@club-ops/shared';
import { getErrorMessage } from '@club-ops/ui';
import { ModalFrame } from '../../components/register/modals/ModalFrame';
import { CustomerConfirmationPendingModal } from '../../components/register/modals/CustomerConfirmationPendingModal';
import { IdScanBlockedModal } from '../../components/register/modals/IdScanBlockedModal';
import { MultipleMatchesModal } from '../../components/register/modals/MultipleMatchesModal';
import { RenewCheckinModal } from '../../components/register/modals/RenewCheckinModal';
import { useEmployeeRegisterState } from '../../app/state/useEmployeeRegisterState';

const API_BASE = getApiUrl('/api');

export function CustomerModals() {
  const {
    showCustomerConfirmationPending,
    customerConfirmationType,
    setShowCustomerConfirmationPending,
    setCustomerConfirmationType,
    setSelectedInventoryItem,
    pendingScanResolution,
    scanResolutionError,
    scanResolutionSubmitting,
    setPendingScanResolution,
    setScanResolutionError,
    resolvePendingScanSelection,
    manualExistingPrompt,
    manualExistingPromptError,
    manualExistingPromptSubmitting,
    setManualExistingPrompt,
    setManualExistingPromptError,
    setManualExistingPromptSubmitting,
    startLaneSessionByCustomerId,
    setManualEntry,
    setManualFirstName,
    setManualLastName,
    setManualDobDigits,
    setManualIdNumber,
    session,
    isSubmitting,
    renewalSelection,
    renewalSelectionError,
    closeRenewalSelection,
    handleStartRenewal,
    showCreateFromScanPrompt,
    pendingCreateFromScan,
    createFromScanError,
    createFromScanSubmitting,
    idScanIssue,
    setIdScanIssue,
    setShowCreateFromScanPrompt,
    setPendingCreateFromScan,
    setCreateFromScanError,
    setCreateFromScanSubmitting,
    handleCreateFromNoMatch,
  } = useEmployeeRegisterState();

  return (
    <>
      <IdScanBlockedModal
        isOpen={!!idScanIssue}
        issue={idScanIssue ?? null}
        onClose={() => setIdScanIssue(null)}
      />
      <CustomerConfirmationPendingModal
        isOpen={showCustomerConfirmationPending && !!customerConfirmationType}
        data={customerConfirmationType || { requested: '', selected: '', number: '' }}
        onCancel={
          customerConfirmationType
            ? () => {
                setShowCustomerConfirmationPending(false);
                setCustomerConfirmationType(null);
                setSelectedInventoryItem(null);
              }
            : undefined
        }
      />

      <MultipleMatchesModal
        isOpen={!!pendingScanResolution}
        candidates={pendingScanResolution?.candidates || []}
        errorMessage={scanResolutionError}
        isSubmitting={scanResolutionSubmitting}
        onCancel={() => {
          setPendingScanResolution(null);
          setScanResolutionError(null);
        }}
        onSelect={(customerId) => void resolvePendingScanSelection(customerId)}
      />

      <RenewCheckinModal
        isOpen={!!renewalSelection}
        activeCheckin={renewalSelection}
        errorMessage={renewalSelectionError}
        isSubmitting={isSubmitting}
        onClose={closeRenewalSelection}
        onSelectHours={(hours) => void handleStartRenewal(hours)}
      />

      <ModalFrame
        isOpen={!!manualExistingPrompt}
        title="Existing customer found"
        onClose={() => {
          setManualExistingPrompt(null);
          setManualExistingPromptError(null);
          setManualExistingPromptSubmitting(false);
        }}
        maxWidth="640px"
        closeOnOverlayClick={false}
      >
        <div className="u-grid u-gap-12">
          <div className="er-text-muted">
            An existing customer already matches this First Name, Last Name, and Date of Birth. Do
            you want to continue?
          </div>

          {manualExistingPrompt?.matchCount && manualExistingPrompt.matchCount > 1 ? (
            <div className="u-text-warning u-fw-800">
              {manualExistingPrompt.matchCount} matching customers found. Showing best match:
            </div>
          ) : null}

          {manualExistingPrompt ? (
            <div className="cs-liquid-card u-p-16">
              <div className="u-fw-900 er-text-lg">
                {manualExistingPrompt.bestMatch.name}
              </div>
              <div className="u-mt-4 er-text-muted u-flex u-gap-12 u-flex-wrap">
                <span>
                  DOB:{' '}
                  <strong className="u-text-white">
                    {manualExistingPrompt.bestMatch.dob || manualExistingPrompt.dobIso}
                  </strong>
                </span>
                {manualExistingPrompt.bestMatch.membershipNumber ? (
                  <span>
                    Membership:{' '}
                    <strong className="u-text-white">
                      {manualExistingPrompt.bestMatch.membershipNumber}
                    </strong>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {manualExistingPromptError ? (
            <div className="er-modal-error">{manualExistingPromptError}</div>
          ) : null}

          <div className="u-flex u-justify-end u-gap-8 u-flex-wrap">
            <button
              type="button"
              className="cs-liquid-button cs-liquid-button--secondary"
              disabled={manualExistingPromptSubmitting || isSubmitting}
              onClick={() => {
                setManualExistingPrompt(null);
                setManualExistingPromptError(null);
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              className="cs-liquid-button cs-liquid-button--secondary"
              disabled={manualExistingPromptSubmitting || isSubmitting || !manualExistingPrompt}
              onClick={() => {
                if (!manualExistingPrompt) return;
                void (async () => {
                  setManualExistingPromptSubmitting(true);
                  setManualExistingPromptError(null);
                  try {
                    const result = await startLaneSessionByCustomerId(
                      manualExistingPrompt.bestMatch.id,
                      {
                        suppressAlerts: true,
                      }
                    );
                    if (result.outcome === 'matched') {
                      setManualExistingPrompt(null);
                      setManualEntry(false);
                      setManualFirstName('');
                      setManualLastName('');
                      setManualDobDigits('');
                      setManualIdNumber('');
                    }
                  } catch (err) {
                    setManualExistingPromptError(
                      err instanceof Error ? err.message : 'Failed to load existing customer'
                    );
                  } finally {
                    setManualExistingPromptSubmitting(false);
                  }
                })();
              }}
            >
              Existing Customer
            </button>

            <button
              type="button"
              className="cs-liquid-button"
              disabled={
                manualExistingPromptSubmitting ||
                isSubmitting ||
                !manualExistingPrompt ||
                !session?.sessionToken
              }
              onClick={() => {
                if (!manualExistingPrompt || !session?.sessionToken) return;
                void (async () => {
                  setManualExistingPromptSubmitting(true);
                  setManualExistingPromptError(null);
                  try {
                    const { firstName, lastName, dobIso, idNumber } = manualExistingPrompt;
                    const createRes = await fetch(`${API_BASE}/v1/customers/create-manual`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.sessionToken}`,
                      },
                      body: JSON.stringify({
                        firstName,
                        lastName,
                        dob: dobIso,
                        idNumber: idNumber || undefined,
                      }),
                    });
                    const createPayload: unknown = await createRes.json().catch(() => null);
                    if (!createRes.ok) {
                      const msg = getErrorMessage(createPayload) || 'Failed to create customer';
                      setManualExistingPromptError(msg);
                      return;
                    }
                    const created = createPayload as { customer?: { id?: string } };
                    const newId = created.customer?.id;
                    if (!newId) {
                      setManualExistingPromptError('Create returned no customer id');
                      return;
                    }
                    const result = await startLaneSessionByCustomerId(newId, {
                      suppressAlerts: true,
                    });
                    if (result.outcome === 'matched') {
                      setManualExistingPrompt(null);
                      setManualEntry(false);
                      setManualFirstName('');
                      setManualLastName('');
                      setManualDobDigits('');
                      setManualIdNumber('');
                    }
                  } finally {
                    setManualExistingPromptSubmitting(false);
                  }
                })();
              }}
            >
              Add Customer
            </button>
          </div>
        </div>
      </ModalFrame>

      <ModalFrame
        isOpen={showCreateFromScanPrompt && !!pendingCreateFromScan}
        title="No match found"
        onClose={() => {
          setShowCreateFromScanPrompt(false);
          setPendingCreateFromScan(null);
          setCreateFromScanError(null);
          setCreateFromScanSubmitting(false);
        }}
        maxWidth="720px"
        closeOnOverlayClick={false}
      >
        <div className="u-grid u-gap-12">
          <div className="er-text-muted">
            Create a new customer profile using the scanned First Name, Last Name, and DOB.
          </div>

          {createFromScanError ? (
            <div className="er-modal-error">{createFromScanError}</div>
          ) : null}

          <div className="cs-liquid-card u-p-16">
            <div className="u-flex u-gap-12 u-flex-wrap er-text-muted">
              <span>
                First:{' '}
                <strong className="u-text-white">
                  {pendingCreateFromScan?.extracted.firstName || '—'}
                </strong>
              </span>
              <span>
                Last:{' '}
                <strong className="u-text-white">
                  {pendingCreateFromScan?.extracted.lastName || '—'}
                </strong>
              </span>
              <span>
                DOB:{' '}
                <strong className="u-text-white">
                  {pendingCreateFromScan?.extracted.dob || '—'}
                </strong>
              </span>
            </div>
          </div>

          <div className="u-flex u-justify-end u-gap-8">
            <button
              className="cs-liquid-button cs-liquid-button--secondary"
              disabled={createFromScanSubmitting || isSubmitting}
              onClick={() => {
                setShowCreateFromScanPrompt(false);
                setPendingCreateFromScan(null);
                setCreateFromScanError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="cs-liquid-button"
              disabled={createFromScanSubmitting || isSubmitting || !pendingCreateFromScan}
              onClick={() => {
                void (async () => {
                  setCreateFromScanSubmitting(true);
                  setCreateFromScanError(null);
                  try {
                    const r = await handleCreateFromNoMatch();
                    if (r.outcome !== 'matched') {
                      setCreateFromScanError(r.message);
                    }
                  } finally {
                    setCreateFromScanSubmitting(false);
                  }
                })();
              }}
            >
              {createFromScanSubmitting ? 'Creating…' : 'Create Customer'}
            </button>
          </div>
        </div>
      </ModalFrame>
    </>
  );
}
