import { useCallback, useState } from 'react';
import { getErrorMessage } from '@club-ops/ui';
import type { MultipleMatchCandidate } from '../../../components/register/modals/MultipleMatchesModal';
import { API_BASE } from '../shared/api';
import type { ScanResult, StaffSession } from '../shared/types';

type Params = {
  session: StaffSession | null;
  lane: string;
  startLaneSessionByCustomerId: (
    customerId: string,
    opts?: { suppressAlerts?: boolean; customerLabel?: string | null }
  ) => Promise<ScanResult>;
};

export function useScanResolutionState({ session, lane, startLaneSessionByCustomerId }: Params) {
  const [idScanIssue, setIdScanIssue] = useState<'ID_EXPIRED' | 'UNDERAGE' | null>(null);
  const [pendingCreateFromScan, setPendingCreateFromScan] = useState<{
    idScanValue: string;
    idScanHash: string | null;
    extracted: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      dob?: string;
      idExpirationDate?: string;
      idNumber?: string;
      issuer?: string;
      jurisdiction?: string;
      idState?: string;
      addressLine1?: string;
      city?: string;
      state?: string;
      postalCode?: string;
    };
  } | null>(null);
  const [showCreateFromScanPrompt, setShowCreateFromScanPrompt] = useState(false);
  const [createFromScanError, setCreateFromScanError] = useState<string | null>(null);
  const [createFromScanSubmitting, setCreateFromScanSubmitting] = useState(false);

  const [pendingScanResolution, setPendingScanResolution] = useState<null | {
    rawScanText: string;
    extracted?: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      dob?: string;
      idExpirationDate?: string;
      idNumber?: string;
      issuer?: string;
      jurisdiction?: string;
      idState?: string;
    };
    candidates: MultipleMatchCandidate[];
  }>(null);
  const [scanResolutionError, setScanResolutionError] = useState<string | null>(null);
  const [scanResolutionSubmitting, setScanResolutionSubmitting] = useState(false);

  const onBarcodeCaptured = useCallback(
    async (rawScanText: string): Promise<ScanResult> => {
      if (!session?.sessionToken) {
        return { outcome: 'error', message: 'Not authenticated' };
      }

      try {
        setIdScanIssue(null);
        const response = await fetch(`${API_BASE}/v1/checkin/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            laneId: lane,
            rawScanText,
          }),
        });

        const payload: unknown = await response.json().catch(() => null);
        const issueCode = (() => {
          if (!payload || typeof payload !== 'object') return null;
          const error = (payload as { error?: unknown }).error;
          const codeFromError =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: unknown }).code
              : undefined;
          const code =
            typeof codeFromError === 'string'
              ? codeFromError
              : typeof (payload as { code?: unknown }).code === 'string'
                ? (payload as { code?: string }).code
                : undefined;
          if (code === 'ID_EXPIRED' || code === 'UNDERAGE') return code;
          return null;
        })();
        if (issueCode) {
          setIdScanIssue(issueCode);
          setPendingCreateFromScan(null);
          setShowCreateFromScanPrompt(false);
          setPendingScanResolution(null);
          setScanResolutionError(null);
          return { outcome: 'error', message: '' };
        }
        if (!response.ok) {
          const msg = getErrorMessage(payload) || 'Failed to process scan';
          return { outcome: 'error', message: msg };
        }

        const data = payload as {
          result: 'MATCHED' | 'NO_MATCH' | 'MULTIPLE_MATCHES' | 'ERROR';
          scanType?: 'STATE_ID' | 'MEMBERSHIP';
          customer?: { id: string; name: string; membershipNumber: string | null };
          extracted?: {
            firstName?: string;
            lastName?: string;
            fullName?: string;
            dob?: string;
            idExpirationDate?: string;
            idNumber?: string;
            issuer?: string;
            jurisdiction?: string;
          };
          candidates?: Array<{
            id: string;
            name: string;
            dob: string | null;
            membershipNumber: string | null;
            matchScore: number;
          }>;
          normalizedRawScanText?: string;
          idScanHash?: string;
          membershipCandidate?: string;
          error?: { code?: string; message?: string };
        };

        if (data.result === 'ERROR') {
          const code = data.error?.code;
          if (code === 'ID_EXPIRED' || code === 'UNDERAGE') {
            setIdScanIssue(code);
            return { outcome: 'error', message: '' };
          }
          return { outcome: 'error', message: data.error?.message || 'Scan failed' };
        }

        if (data.result === 'MATCHED' && data.customer?.id) {
          setPendingCreateFromScan(null);
          setShowCreateFromScanPrompt(false);
          setCreateFromScanError(null);
          setPendingScanResolution(null);
          setScanResolutionError(null);
          return await startLaneSessionByCustomerId(data.customer.id, { suppressAlerts: true });
        }

        if (data.result === 'MULTIPLE_MATCHES' && data.scanType === 'STATE_ID') {
          const extracted = data.extracted || {};
          setPendingCreateFromScan(null);
          setShowCreateFromScanPrompt(false);
          setCreateFromScanError(null);
          setScanResolutionError(null);
          setPendingScanResolution({
            rawScanText,
            extracted: {
              firstName: extracted.firstName,
              lastName: extracted.lastName,
              fullName: extracted.fullName,
              dob: extracted.dob,
              idExpirationDate: extracted.idExpirationDate,
              idNumber: extracted.idNumber,
              issuer: extracted.issuer,
              jurisdiction: extracted.jurisdiction,
              idState: extracted.jurisdiction || extracted.issuer,
            },
            candidates: (data.candidates || []).slice(0, 10),
          });
          return { outcome: 'matched' };
        }

        if (data.scanType === 'STATE_ID') {
          const extracted = data.extracted || {};
          setPendingCreateFromScan({
            idScanValue: data.normalizedRawScanText || rawScanText,
            idScanHash: data.idScanHash || null,
            extracted: {
              firstName: extracted.firstName,
              lastName: extracted.lastName,
              fullName: extracted.fullName,
              dob: extracted.dob,
              idExpirationDate: extracted.idExpirationDate,
              idNumber: extracted.idNumber,
              issuer: extracted.issuer,
              jurisdiction: extracted.jurisdiction,
              idState: extracted.jurisdiction || extracted.issuer,
            },
          });
          return {
            outcome: 'no_match',
            message: 'No match found. Create new account?',
            canCreate: true,
          };
        }

        setPendingCreateFromScan(null);
        const label = data.membershipCandidate ? ` (${data.membershipCandidate})` : '';
        return {
          outcome: 'no_match',
          message: `No match found${label}. Scan ID or use Manual Entry.`,
          canCreate: false,
        };
      } catch (error) {
        console.error('Scan failed:', error);
        return {
          outcome: 'error',
          message: error instanceof Error ? error.message : 'Scan failed',
        };
      }
    },
    [lane, session?.sessionToken, startLaneSessionByCustomerId]
  );

  const resolvePendingScanSelection = useCallback(
    async (customerId: string) => {
      if (!pendingScanResolution) return;
      if (!session?.sessionToken) {
        setScanResolutionError('Not authenticated');
        return;
      }
      setScanResolutionSubmitting(true);
      setScanResolutionError(null);
      try {
        const response = await fetch(`${API_BASE}/v1/checkin/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            laneId: lane,
            rawScanText: pendingScanResolution.rawScanText,
            selectedCustomerId: customerId,
          }),
        });

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const msg =
            (payload as { error?: { message?: string } } | null)?.error?.message ||
            getErrorMessage(payload) ||
            'Failed to resolve scan';
          setScanResolutionError(msg);
          return;
        }

        const data = payload as {
          result: 'MATCHED' | 'NO_MATCH' | 'MULTIPLE_MATCHES' | 'ERROR';
          customer?: { id?: string };
          error?: { code?: string; message?: string };
        };

        if (data.result === 'ERROR') {
          setScanResolutionError(data.error?.message || 'Failed to resolve scan');
          return;
        }
        if (data.result === 'MATCHED' && data.customer?.id) {
          setPendingScanResolution(null);
          setScanResolutionError(null);
          await startLaneSessionByCustomerId(data.customer.id, { suppressAlerts: true });
          return;
        }

        setScanResolutionError('Could not resolve scan. Please try again.');
      } catch (err) {
        setScanResolutionError(err instanceof Error ? err.message : 'Failed to resolve scan');
      } finally {
        setScanResolutionSubmitting(false);
      }
    },
    [lane, pendingScanResolution, session?.sessionToken, startLaneSessionByCustomerId]
  );

  const handleCreateFromNoMatch = useCallback(async (): Promise<ScanResult> => {
    if (!pendingCreateFromScan) {
      return { outcome: 'error', message: 'Nothing to create (no pending scan)' };
    }
    if (!session?.sessionToken) {
      return { outcome: 'error', message: 'Not authenticated' };
    }

    const { extracted, idScanValue, idScanHash } = pendingCreateFromScan;
    const firstName = extracted.firstName || '';
    const lastName = extracted.lastName || '';
    const dob = extracted.dob || '';
    const idNumber = extracted.idNumber || undefined;
    const idState = extracted.idState || extracted.jurisdiction || extracted.issuer || undefined;
    if (!firstName || !lastName || !dob) {
      return { outcome: 'error', message: 'Missing required fields to create customer' };
    }

    try {
      const response = await fetch(`${API_BASE}/v1/customers/create-from-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          idScanValue,
          idScanHash: idScanHash || undefined,
          firstName,
          lastName,
          dob,
          idExpirationDate: extracted.idExpirationDate || undefined,
          idNumber,
          state: idState,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? (payload as { code?: unknown }).code
            : undefined;
        if (code === 'ID_EXPIRED' || code === 'UNDERAGE') {
          setIdScanIssue(code);
          return { outcome: 'error', message: '' };
        }
        const msg = getErrorMessage(payload) || 'Failed to create customer';
        return { outcome: 'error', message: msg };
      }

      const data = payload as { customer?: { id?: string } };
      const customerId = data.customer?.id;
      if (!customerId) {
        return { outcome: 'error', message: 'Create returned no customer id' };
      }

      setPendingCreateFromScan(null);
      setShowCreateFromScanPrompt(false);
      setCreateFromScanError(null);
      return await startLaneSessionByCustomerId(customerId, { suppressAlerts: true });
    } catch (error) {
      console.error('Failed to create customer from scan:', error);
      return {
        outcome: 'error',
        message: error instanceof Error ? error.message : 'Failed to create customer',
      };
    }
  }, [pendingCreateFromScan, session?.sessionToken, startLaneSessionByCustomerId]);

  return {
    pendingScanResolution,
    scanResolutionError,
    scanResolutionSubmitting,
    setPendingScanResolution,
    setScanResolutionError,
    setScanResolutionSubmitting,
    resolvePendingScanSelection,
    pendingCreateFromScan,
    showCreateFromScanPrompt,
    createFromScanError,
    createFromScanSubmitting,
    idScanIssue,
    setIdScanIssue,
    setPendingCreateFromScan,
    setShowCreateFromScanPrompt,
    setCreateFromScanError,
    setCreateFromScanSubmitting,
    handleCreateFromNoMatch,
    onBarcodeCaptured,
  };
}
