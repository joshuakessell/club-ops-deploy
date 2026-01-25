import { getApiUrl } from '@club-ops/shared';
import { getErrorMessage } from '@club-ops/ui';
import { ModalFrame } from '../../components/register/modals/ModalFrame';
import { CustomerConfirmationPendingModal } from '../../components/register/modals/CustomerConfirmationPendingModal';
import { MultipleMatchesModal } from '../../components/register/modals/MultipleMatchesModal';
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
    showCreateFromScanPrompt,
    pendingCreateFromScan,
    createFromScanError,
    createFromScanSubmitting,
    setShowCreateFromScanPrompt,
    setPendingCreateFromScan,
    setCreateFromScanError,
    setCreateFromScanSubmitting,
    handleCreateFromNoMatch,
  } = useEmployeeRegisterState();

  return (
    <>
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
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ color: '#94a3b8' }}>
            An existing customer already matches this First Name, Last Name, and Date of Birth. Do
            you want to continue?
          </div>

          {manualExistingPrompt?.matchCount && manualExistingPrompt.matchCount > 1 ? (
            <div style={{ color: '#f59e0b', fontWeight: 800 }}>
              {manualExistingPrompt.matchCount} matching customers found. Showing best match:
            </div>
          ) : null}

          {manualExistingPrompt ? (
            <div className="cs-liquid-card" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>
                {manualExistingPrompt.bestMatch.name}
              </div>
              <div
                style={{
                  marginTop: '0.25rem',
                  color: '#94a3b8',
                  display: 'flex',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  DOB:{' '}
                  <strong style={{ color: 'white' }}>
                    {manualExistingPrompt.bestMatch.dob || manualExistingPrompt.dobIso}
                  </strong>
                </span>
                {manualExistingPrompt.bestMatch.membershipNumber ? (
                  <span>
                    Membership:{' '}
                    <strong style={{ color: 'white' }}>
                      {manualExistingPrompt.bestMatch.membershipNumber}
                    </strong>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {manualExistingPromptError ? (
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 12,
                color: '#fecaca',
                fontWeight: 800,
              }}
            >
              {manualExistingPromptError}
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
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
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ color: '#94a3b8' }}>
            Create a new customer profile using the scanned First Name, Last Name, and DOB.
          </div>

          {createFromScanError ? (
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 12,
                color: '#fecaca',
                fontWeight: 800,
              }}
            >
              {createFromScanError}
            </div>
          ) : null}

          <div className="cs-liquid-card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: '#94a3b8' }}>
              <span>
                First:{' '}
                <strong style={{ color: 'white' }}>
                  {pendingCreateFromScan?.extracted.firstName || '—'}
                </strong>
              </span>
              <span>
                Last:{' '}
                <strong style={{ color: 'white' }}>
                  {pendingCreateFromScan?.extracted.lastName || '—'}
                </strong>
              </span>
              <span>
                DOB:{' '}
                <strong style={{ color: 'white' }}>
                  {pendingCreateFromScan?.extracted.dob || '—'}
                </strong>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
