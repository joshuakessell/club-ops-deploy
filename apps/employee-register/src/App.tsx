import { useCallback, useEffect, useState, useRef } from 'react';
import {
  type ActiveVisit,
  type CheckoutRequestSummary,
  type CheckoutChecklist,
  type WebSocketEvent,
  type CheckoutRequestedPayload,
  type CheckoutClaimedPayload,
  type CheckoutUpdatedPayload,
  type SessionUpdatedPayload,
  type AssignmentCreatedPayload,
  type AssignmentFailedPayload,
  type CustomerConfirmedPayload,
  type CustomerDeclinedPayload,
  type SelectionProposedPayload,
  type SelectionLockedPayload,
  type SelectionAcknowledgedPayload,
  type SelectionForcedPayload,
  getCustomerMembershipStatus,
} from '@club-ops/shared';
import { safeJsonParse, useReconnectingWebSocket } from '@club-ops/ui';
import { RegisterSignIn } from './RegisterSignIn';
import { InventorySelector } from './InventorySelector';
import type { IdScanPayload } from '@club-ops/shared';
import { ScanMode, type ScanModeResult } from './ScanMode';
import { debounce } from './utils/debounce';
import { OfferUpgradeModal } from './components/OfferUpgradeModal';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

const API_BASE = '/api';

interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const err = value['error'];
  const msg = value['message'];
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return undefined;
}

function parseStaffSession(value: unknown): StaffSession | null {
  if (!isRecord(value)) return null;
  const staffId = value['staffId'];
  const name = value['name'];
  const role = value['role'];
  const sessionToken = value['sessionToken'];
  if (typeof staffId !== 'string') return null;
  if (typeof name !== 'string') return null;
  if (role !== 'STAFF' && role !== 'ADMIN') return null;
  if (typeof sessionToken !== 'string') return null;
  return { staffId, name, role, sessionToken };
}

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

/**
 * Generate a UUID. Falls back to a simple random string if crypto.randomUUID() is not available.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to fallback
    }
  }
  // Fallback: generate a UUID-like string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function App() {
  const [session, setSession] = useState<StaffSession | null>(() => {
    // Load session from localStorage on mount
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored) as unknown;
        return parseStaffSession(parsed);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [scanModeOpen, setScanModeOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [membershipNumber, setMembershipNumber] = useState('');
  const [pendingCreateFromScan, setPendingCreateFromScan] = useState<{
    idScanValue: string;
    idScanHash: string | null;
    extracted: {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      dob?: string;
      idNumber?: string;
      issuer?: string;
      jurisdiction?: string;
      addressLine1?: string;
      city?: string;
      state?: string;
      postalCode?: string;
    };
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [agreementSigned, setAgreementSigned] = useState(false);
  // Check-in mode is now auto-detected server-side based on active visits/assignments.
  const [selectedRentalType, setSelectedRentalType] = useState<string | null>(null);
  const [checkoutRequests, setCheckoutRequests] = useState<Map<string, CheckoutRequestSummary>>(
    new Map()
  );
  const [selectedCheckoutRequest, setSelectedCheckoutRequest] = useState<string | null>(null);
  const [, setCheckoutChecklist] = useState<CheckoutChecklist>({});
  const [checkoutItemsConfirmed, setCheckoutItemsConfirmed] = useState(false);
  const [checkoutFeePaid, setCheckoutFeePaid] = useState(false);
  const [customerSelectedType, setCustomerSelectedType] = useState<string | null>(null);
  const [waitlistDesiredTier, setWaitlistDesiredTier] = useState<string | null>(null);
  const [waitlistBackupType, setWaitlistBackupType] = useState<string | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<{
    type: 'room' | 'locker';
    id: string;
    number: string;
    tier: string;
  } | null>(null);
  const [proposedRentalType, setProposedRentalType] = useState<string | null>(null);
  const [proposedBy, setProposedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(null);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [selectionConfirmedBy, setSelectionConfirmedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(
    null
  );
  const [selectionAcknowledged, setSelectionAcknowledged] = useState(true);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showCustomerConfirmationPending, setShowCustomerConfirmationPending] = useState(false);
  const [customerConfirmationType, setCustomerConfirmationType] = useState<{
    requested: string;
    selected: string;
    number: string;
  } | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<{
    total: number;
    lineItems: Array<{ description: string; amount: number }>;
    messages: string[];
  } | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'DUE' | 'PAID' | null>(null);
  const [membershipPurchaseIntent, setMembershipPurchaseIntent] = useState<'PURCHASE' | 'RENEW' | null>(
    null
  );
  const [customerMembershipValidUntil, setCustomerMembershipValidUntil] = useState<string | null>(null);

  // Keep WebSocket handlers stable while still reading the latest values.
  const selectedCheckoutRequestRef = useRef<string | null>(null);
  useEffect(() => {
    selectedCheckoutRequestRef.current = selectedCheckoutRequest;
  }, [selectedCheckoutRequest]);

  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const customerSelectedTypeRef = useRef<string | null>(null);
  useEffect(() => {
    customerSelectedTypeRef.current = customerSelectedType;
  }, [customerSelectedType]);

  const [showMembershipIdPrompt, setShowMembershipIdPrompt] = useState(false);
  const [membershipIdInput, setMembershipIdInput] = useState('');
  const [membershipIdMode, setMembershipIdMode] = useState<'KEEP_EXISTING' | 'ENTER_NEW'>('ENTER_NEW');
  const [membershipIdSubmitting, setMembershipIdSubmitting] = useState(false);
  const [membershipIdError, setMembershipIdError] = useState<string | null>(null);
  const [membershipIdPromptedForSessionId, setMembershipIdPromptedForSessionId] = useState<string | null>(
    null
  );
  const [pastDueBlocked, setPastDueBlocked] = useState(false);
  const [waitlistEntries, setWaitlistEntries] = useState<
    Array<{
      id: string;
      visitId: string;
      checkinBlockId: string;
      desiredTier: string;
      backupTier: string;
      status: string;
      createdAt: string;
      checkinAt?: string;
      checkoutAt?: string;
      offeredAt?: string;
      displayIdentifier: string;
      currentRentalType: string;
      customerName?: string;
    }>
  >([]);
  const [inventoryAvailable, setInventoryAvailable] = useState<null | {
    rooms: Record<string, number>;
    rawRooms: Record<string, number>;
    waitlistDemand: Record<string, number>;
  }>(null);
  const [showUpgradesPanel, setShowUpgradesPanel] = useState(false);
  const [selectedWaitlistEntry, setSelectedWaitlistEntry] = useState<string | null>(null);
  const [upgradePaymentIntentId, setUpgradePaymentIntentId] = useState<string | null>(null);
  const [upgradeFee, setUpgradeFee] = useState<number | null>(null);
  const [waitlistWidgetOpen, setWaitlistWidgetOpen] = useState(false);
  const [showUpgradePulse, setShowUpgradePulse] = useState(false);
  const [offerUpgradeModal, setOfferUpgradeModal] = useState<{
    waitlistId: string;
    desiredTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL';
    customerLabel?: string;
  } | null>(null);

  // Customer info state
  const [customerPrimaryLanguage, setCustomerPrimaryLanguage] = useState<'EN' | 'ES' | undefined>(
    undefined
  );
  const [customerDobMonthDay, setCustomerDobMonthDay] = useState<string | undefined>(undefined);
  const [customerLastVisitAt, setCustomerLastVisitAt] = useState<string | undefined>(undefined);
  const [customerNotes, setCustomerNotes] = useState<string | undefined>(undefined);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // Past due state
  const [showPastDueModal, setShowPastDueModal] = useState(false);
  const [showManagerBypassModal, setShowManagerBypassModal] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [managerList, setManagerList] = useState<Array<{ id: string; name: string }>>([]);
  const [paymentDeclineError, setPaymentDeclineError] = useState<string | null>(null);
  const paymentIntentCreateInFlightRef = useRef(false);
  const fetchWaitlistRef = useRef<(() => Promise<void>) | null>(null);
  const fetchInventoryAvailableRef = useRef<(() => Promise<void>) | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<
    Array<{
      id: string;
      name: string;
      firstName: string;
      lastName: string;
      dobMonthDay?: string;
      membershipNumber?: string;
      disambiguator: string;
    }>
  >([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState<string | null>(null);

  // Assignment completion state
  const [assignedResourceType, setAssignedResourceType] = useState<'room' | 'locker' | null>(null);
  const [assignedResourceNumber, setAssignedResourceNumber] = useState<string | null>(null);
  const [checkoutAt, setCheckoutAt] = useState<string | null>(null);

  const deviceId = useState(() => {
    try {
      // Get device ID from environment variable or generate a stable per-device base ID.
      // In development, you may have multiple tabs open; we add a per-tab instance suffix
      // (stored in sessionStorage) so two tabs on the same machine can sign into
      // different registers without colliding on deviceId.
      const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
      const envDeviceId = env?.['VITE_DEVICE_ID'];
      if (typeof envDeviceId === 'string' && envDeviceId.trim()) {
        return envDeviceId;
      }

      let baseId: string | null = null;
      try {
        baseId = localStorage.getItem('device_id');
      } catch {
        // localStorage might not be available (e.g., private browsing)
      }

      if (!baseId) {
        baseId = `device-${generateUUID()}`;
        try {
          localStorage.setItem('device_id', baseId);
        } catch {
          // If we can't store it, that's okay - we'll regenerate each time
        }
      }

      let instanceId: string | null = null;
      try {
        instanceId = sessionStorage.getItem('device_instance_id');
      } catch {
        // sessionStorage might not be available
      }

      if (!instanceId) {
        instanceId = generateUUID();
        try {
          sessionStorage.setItem('device_instance_id', instanceId);
        } catch {
          // If we can't store it, that's okay
        }
      }

      return `${baseId}:${instanceId}`;
    } catch (error) {
      // Fallback: generate a temporary device ID if anything fails
      console.error('Failed to generate device ID:', error);
      return `device-temp-${generateUUID()}`;
    }
  })[0];

  const [registerSession, setRegisterSession] = useState<{
    employeeId: string;
    employeeName: string;
    registerNumber: number;
    deviceId: string;
  } | null>(null);

  // Derive lane from register number
  const lane = registerSession ? `lane-${registerSession.registerNumber}` : 'lane-1';

  const handleLogout = async () => {
    try {
      if (session?.sessionToken) {
        // IMPORTANT: release the register session (server-side) before logging out staff.
        // This makes the separate "menu sign out" redundant and keeps register availability correct.
        try {
          await fetch(`${API_BASE}/v1/registers/signout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.sessionToken}`,
            },
            body: JSON.stringify({ deviceId }),
          });
        } catch (err) {
          console.warn('Register signout failed (continuing):', err);
        }

        await fetch(`${API_BASE}/v1/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        });
      }
    } catch (err) {
      console.warn('Logout failed (continuing):', err);
    } finally {
      localStorage.removeItem('staff_session');
      setSession(null);
      // Ensure RegisterSignIn re-runs status checks and clears any lingering client state immediately.
      window.location.reload();
    }
  };
  const runCustomerSearch = useCallback(
    debounce(async (query: string) => {
      if (!session?.sessionToken || query.trim().length < 3) {
        setCustomerSuggestions([]);
        setCustomerSearchLoading(false);
        return;
      }

      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setCustomerSearchLoading(true);
      try {
        const response = await fetch(
          `/api/v1/customers/search?q=${encodeURIComponent(query)}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${session.sessionToken}`,
            },
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          throw new Error('Search failed');
        }
        const data = (await response.json()) as { suggestions?: typeof customerSuggestions };
        setCustomerSuggestions(data.suggestions || []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Customer search failed:', error);
          setCustomerSuggestions([]);
        }
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 200),
    [session?.sessionToken]
  );

  useEffect(() => {
    if (customerSearch.trim().length >= 3) {
      setSelectedCustomerId(null);
      setSelectedCustomerLabel(null);
      runCustomerSearch(customerSearch);
    } else {
      setCustomerSuggestions([]);
      setSelectedCustomerId(null);
      setSelectedCustomerLabel(null);
    }
  }, [customerSearch, runCustomerSearch]);

  const handleConfirmCustomerSelection = async () => {
    if (!session?.sessionToken || !selectedCustomerId) return;
    setIsSubmitting(true);
    try {
      // Customer search selection should attach to the *check-in lane session* system
      // (lane_sessions), not legacy sessions, so downstream kiosk endpoints (set-language, etc.)
      // can resolve the active session.
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          customerId: selectedCustomerId,
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(payload) || 'Failed to start session');
      }

      const data = (await response.json()) as {
        sessionId?: string;
        customerName?: string;
        membershipNumber?: string;
      };
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);

      // Clear search UI
      setCustomerSearch('');
      setCustomerSuggestions([]);
    } catch (error) {
      console.error('Failed to confirm customer:', error);
      alert(error instanceof Error ? error.message : 'Failed to confirm customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load staff session from localStorage (created after register sign-in)
  useEffect(() => {
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored) as unknown;
        setSession(parseStaffSession(parsed));
      } catch {
        setSession(null);
      }
    }
  }, []);

  const handleRegisterSignIn = useCallback(
    (session: {
      employeeId: string;
      employeeName: string;
      registerNumber: number;
      deviceId: string;
    }) => {
      setRegisterSession(session);
      // Refresh staff session from localStorage after register sign-in
      const stored = localStorage.getItem('staff_session');
      if (stored) {
        try {
          const parsed: unknown = JSON.parse(stored) as unknown;
          const staffSession = parseStaffSession(parsed);
          if (staffSession) {
            setSession(staffSession);
          }
        } catch {
          setSession(null);
        }
      }
    },
    [setRegisterSession, setSession]
  );

  const handleIdScan = async (
    payload: IdScanPayload,
    opts?: { suppressAlerts?: boolean }
  ): Promise<ScanModeResult> => {
    if (!session?.sessionToken) {
      const msg = 'Not authenticated';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/scan-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        const msg = getErrorMessage(errorPayload) || 'Failed to scan ID';
        if (!opts?.suppressAlerts) alert(msg);
        // Treat 400 as "no match / invalid ID data", keep scan mode open.
        if (response.status === 400) return { outcome: 'no_match', message: msg };
        return { outcome: 'error', message: msg };
      }

      const data = await readJson<{
        customerName?: string;
        membershipNumber?: string;
        sessionId?: string;
      }>(response);
      console.log('ID scanned, session updated:', data);

      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);

      return { outcome: 'matched' };
    } catch (error) {
      console.error('Failed to scan ID:', error);
      const msg = error instanceof Error ? error.message : 'Failed to scan ID';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualIdEntry = async (name: string, idNumber?: string, dob?: string) => {
    const payload: IdScanPayload = {
      fullName: name,
      idNumber: idNumber || undefined,
      dob: dob || undefined,
    };
    await handleIdScan(payload);
  };

  const startLaneSession = async (
    idScanValue: string,
    membershipScanValue?: string | null,
    opts?: { suppressAlerts?: boolean }
  ): Promise<ScanModeResult> => {
    if (!session?.sessionToken) {
      const msg = 'Not authenticated';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          idScanValue,
          membershipScanValue: membershipScanValue || undefined,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        const msg = getErrorMessage(errorPayload) || 'Failed to start session';
        if (!opts?.suppressAlerts) alert(msg);
        return { outcome: 'error', message: msg };
      }

      const data = await readJson<{
        customerName?: string;
        membershipNumber?: string;
        sessionId?: string;
      }>(response);
      console.log('Session started:', data);

      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);

      // Clear manual entry mode if active
      if (manualEntry) {
        setManualEntry(false);
      }
      return { outcome: 'matched' };
    } catch (error) {
      console.error('Failed to start session:', error);
      const msg = error instanceof Error ? error.message : 'Failed to start session';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    } finally {
      setIsSubmitting(false);
    }
  };

  const startLaneSessionByCustomerId = async (
    customerId: string,
    opts?: { suppressAlerts?: boolean }
  ): Promise<ScanModeResult> => {
    if (!session?.sessionToken) {
      const msg = 'Not authenticated';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ customerId }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        const msg = getErrorMessage(errorPayload) || 'Failed to start session';
        if (!opts?.suppressAlerts) alert(msg);
        return { outcome: 'error', message: msg };
      }

      const data = await readJson<{
        sessionId?: string;
        customerName?: string;
        membershipNumber?: string;
      }>(response);

      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);

      if (manualEntry) setManualEntry(false);
      return { outcome: 'matched' };
    } catch (error) {
      console.error('Failed to start session by customerId:', error);
      const msg = error instanceof Error ? error.message : 'Failed to start session';
      if (!opts?.suppressAlerts) alert(msg);
      return { outcome: 'error', message: msg };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }
    // Use scan-id endpoint for manual entry too (with minimal payload)
    await handleManualIdEntry(customerName.trim());
  };

  const onBarcodeCaptured = async (rawScanText: string): Promise<ScanModeResult> => {
    if (!session?.sessionToken) {
      return { outcome: 'error', message: 'Not authenticated' };
    }

    try {
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
      if (!response.ok) {
        const msg = getErrorMessage(payload) || 'Failed to process scan';
        return { outcome: 'error', message: msg };
      }

      const data = payload as {
        result: 'MATCHED' | 'NO_MATCH' | 'ERROR';
        scanType?: 'STATE_ID' | 'MEMBERSHIP';
        customer?: { id: string; name: string; membershipNumber: string | null };
        extracted?: {
          firstName?: string;
          lastName?: string;
          fullName?: string;
          dob?: string;
          idNumber?: string;
          issuer?: string;
          jurisdiction?: string;
        };
        normalizedRawScanText?: string;
        idScanHash?: string;
        membershipCandidate?: string;
        error?: { code?: string; message?: string };
      };

      if (data.result === 'ERROR') {
        return { outcome: 'error', message: data.error?.message || 'Scan failed' };
      }

      if (data.result === 'MATCHED' && data.customer?.id) {
        setPendingCreateFromScan(null);
        // Open customer record (start lane session) using the resolved customerId.
        return await startLaneSessionByCustomerId(data.customer.id, { suppressAlerts: true });
      }

      // NO_MATCH
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
            idNumber: extracted.idNumber,
            issuer: extracted.issuer,
            jurisdiction: extracted.jurisdiction,
          },
        });
        return {
          outcome: 'no_match',
          message: 'No match found. Create new account?',
          canCreate: true,
        };
      }

      // Membership/general barcode no-match: do not create implicitly.
      setPendingCreateFromScan(null);
      const label = data.membershipCandidate ? ` (${data.membershipCandidate})` : '';
      return {
        outcome: 'no_match',
        message: `No match found${label}. Scan ID or use Manual Entry.`,
        canCreate: false,
      };
    } catch (error) {
      console.error('Scan failed:', error);
      return { outcome: 'error', message: error instanceof Error ? error.message : 'Scan failed' };
    }
  };

  const handleCreateFromNoMatch = async (): Promise<ScanModeResult> => {
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
          fullName: extracted.fullName || undefined,
          addressLine1: extracted.addressLine1 || undefined,
          city: extracted.city || undefined,
          state: extracted.state || undefined,
          postalCode: extracted.postalCode || undefined,
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const msg = getErrorMessage(payload) || 'Failed to create customer';
        return { outcome: 'error', message: msg };
      }

      const data = payload as { customer?: { id?: string } };
      const customerId = data.customer?.id;
      if (!customerId) {
        return { outcome: 'error', message: 'Create returned no customer id' };
      }

      setPendingCreateFromScan(null);
      return await startLaneSessionByCustomerId(customerId, { suppressAlerts: true });
    } catch (error) {
      console.error('Failed to create customer from scan:', error);
      return {
        outcome: 'error',
        message: error instanceof Error ? error.message : 'Failed to create customer',
      };
    }
  };

  const handleClearSession = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      // Reset can be treated as idempotent on the client.
      // If there is no active lane session, the server may respond 404.
      if (!response.ok && response.status !== 404) {
        throw new Error('Failed to clear session');
      }

      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setAgreementSigned(false);
      setManualEntry(false);
      setSelectedRentalType(null);
      setCustomerSelectedType(null);
      setWaitlistDesiredTier(null);
      setWaitlistBackupType(null);
      setSelectedInventoryItem(null);
      setPaymentIntentId(null);
      setPaymentQuote(null);
      setPaymentStatus(null);
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
      setShowWaitlistModal(false);
      console.log('Session cleared');
    } catch (error) {
      console.error('Failed to clear session:', error);
      alert('Failed to clear session');
    }
  };

  const handleClaimCheckout = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to claim checkout');
      }

      await response.json().catch(() => null);
      setSelectedCheckoutRequest(requestId);

      // Fetch the checkout request details to get checklist
      // For now, we'll get it from the request summary
      const request = checkoutRequests.get(requestId);
      if (request) {
        // We'll need to fetch the full request details to get the checklist
        // For now, initialize empty checklist
        setCheckoutChecklist({});
        setCheckoutItemsConfirmed(false);
        setCheckoutFeePaid(false);
      }
    } catch (error) {
      console.error('Failed to claim checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to claim checkout');
    }
  };

  const handleConfirmItems = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/confirm-items`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm items');
      }

      setCheckoutItemsConfirmed(true);
    } catch (error) {
      console.error('Failed to confirm items:', error);
      alert(error instanceof Error ? error.message : 'Failed to confirm items');
    }
  };

  const handleMarkFeePaid = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/mark-fee-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to mark fee as paid');
      }

      setCheckoutFeePaid(true);
    } catch (error) {
      console.error('Failed to mark fee as paid:', error);
      alert(error instanceof Error ? error.message : 'Failed to mark fee as paid');
    }
  };

  const handleCompleteCheckout = async (requestId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    if (!checkoutItemsConfirmed) {
      alert('Please confirm items returned first');
      return;
    }

    const request = checkoutRequests.get(requestId);
    if (request && request.lateFeeAmount > 0 && !checkoutFeePaid) {
      alert('Please mark late fee as paid first');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkout/${requestId}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete checkout');
      }

      // Reset checkout state
      setSelectedCheckoutRequest(null);
      setCheckoutChecklist({});
      setCheckoutItemsConfirmed(false);
      setCheckoutFeePaid(false);
    } catch (error) {
      console.error('Failed to complete checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Waitlist/Upgrades functions
  const fetchWaitlist = async () => {
    if (!session?.sessionToken) return;

    try {
      // Fetch both ACTIVE and OFFERED waitlist entries
      const [activeResponse, offeredResponse] = await Promise.all([
        fetch(`${API_BASE}/v1/waitlist?status=ACTIVE`, {
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }),
        fetch(`${API_BASE}/v1/waitlist?status=OFFERED`, {
          headers: {
            Authorization: `Bearer ${session.sessionToken}`,
          },
        }),
      ]);

      const allEntries: typeof waitlistEntries = [];

      if (activeResponse.ok) {
        const activeData = await readJson<{ entries?: typeof waitlistEntries }>(activeResponse);
        allEntries.push(...(activeData.entries || []));
      }

      if (offeredResponse.ok) {
        const offeredData = await readJson<{ entries?: typeof waitlistEntries }>(offeredResponse);
        allEntries.push(...(offeredData.entries || []));
      }

      // Oldest first (createdAt ascending)
      allEntries.sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return at - bt;
      });

      setWaitlistEntries(allEntries);
    } catch (error) {
      console.error('Failed to fetch waitlist:', error);
    }
  };

  const fetchInventoryAvailable = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/inventory/available`);
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      if (
        isRecord(data) &&
        isRecord(data.rooms) &&
        isRecord(data.rawRooms) &&
        isRecord(data.waitlistDemand)
      ) {
        setInventoryAvailable({
          rooms: data.rooms as Record<string, number>,
          rawRooms: data.rawRooms as Record<string, number>,
          waitlistDemand: data.waitlistDemand as Record<string, number>,
        });
      }
    } catch (error) {
      console.error('Failed to fetch inventory available:', error);
    }
  };

  fetchWaitlistRef.current = fetchWaitlist;
  fetchInventoryAvailableRef.current = fetchInventoryAvailable;

  // Fetch waitlist on mount and when session is available
  useEffect(() => {
    if (session?.sessionToken) {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }
  }, [session?.sessionToken]);

  // 30s live refresh for waitlist + availability
  useEffect(() => {
    if (!session?.sessionToken) return;
    const interval = window.setInterval(() => {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [session?.sessionToken]);

  const topWaitlistEntry = waitlistEntries.find(
    (e) => e.status === 'ACTIVE' || e.status === 'OFFERED'
  );
  const waitlistDisplayNumber = topWaitlistEntry?.displayIdentifier || '...';
  const sessionActive = !!currentSessionId;

  const offeredCountByTier = waitlistEntries.reduce<Record<string, number>>((acc, e) => {
    if (e.status === 'OFFERED') {
      acc[e.desiredTier] = (acc[e.desiredTier] || 0) + 1;
    }
    return acc;
  }, {});

  const isEntryOfferEligible = (entry: (typeof waitlistEntries)[number]): boolean => {
    if (sessionActive) return false;
    if (entry.status === 'OFFERED') return true;
    if (entry.status !== 'ACTIVE') return false;
    if (!inventoryAvailable) return false;
    const tier = entry.desiredTier;
    const raw = Number(inventoryAvailable.rawRooms?.[tier] ?? 0);
    const offered = Number(offeredCountByTier[tier] ?? 0);
    return raw - offered > 0;
  };

  const eligibleEntryCount = waitlistEntries.filter(isEntryOfferEligible).length;
  const hasEligibleEntries = eligibleEntryCount > 0;
  const waitlistInteractive = hasEligibleEntries && !sessionActive;
  const prevSessionActiveRef = useRef<boolean>(false);
  const pulseCandidateRef = useRef<boolean>(false);

  const dismissUpgradePulse = () => {
    pulseCandidateRef.current = false;
    setShowUpgradePulse(false);
  };

  const openOfferUpgradeModal = (entry: (typeof waitlistEntries)[number]) => {
    if (sessionActive) return;
    if (entry.desiredTier !== 'STANDARD' && entry.desiredTier !== 'DOUBLE' && entry.desiredTier !== 'SPECIAL') {
      alert('Only STANDARD/DOUBLE/SPECIAL upgrades can be offered.');
      return;
    }
    dismissUpgradePulse();
    setOfferUpgradeModal({
      waitlistId: entry.id,
      desiredTier: entry.desiredTier,
      customerLabel: entry.customerName || entry.displayIdentifier,
    });
  };

  // When a session ends, arm the pulse (we'll show it once we know upgrades are eligible).
  useEffect(() => {
    const prev = prevSessionActiveRef.current;
    if (prev && !sessionActive) {
      pulseCandidateRef.current = true;
    }
    prevSessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  // If a session just ended and eligible upgrades exist, show the pulse.
  useEffect(() => {
    if (pulseCandidateRef.current && !sessionActive && hasEligibleEntries) {
      setShowUpgradePulse(true);
      pulseCandidateRef.current = false;
    }
  }, [hasEligibleEntries, sessionActive]);

  const handleWaitlistEntryAction = (entryId: string, customerName?: string) => {
    if (sessionActive) {
      return;
    }
    dismissUpgradePulse();
    const label = customerName || 'customer';
    const confirm = window.confirm(`Begin upgrading ${label}?`);
    if (!confirm) return;
    setSelectedWaitlistEntry(entryId);
    setShowUpgradesPanel(true);
    setWaitlistWidgetOpen(false);
  };

  const handleCompleteUpgrade = async (waitlistId: string, paymentIntentId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    dismissUpgradePulse();
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/upgrades/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId,
          paymentIntentId,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (isRecord(errorPayload) && errorPayload.code === 'REAUTH_REQUIRED') {
          alert('Re-authentication required. Please log in again.');
          await handleLogout();
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete upgrade');
      }

      setUpgradePaymentIntentId(null);
      setUpgradeFee(null);
      await fetchWaitlist();
      alert('Upgrade completed successfully');
    } catch (error) {
      console.error('Failed to complete upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete upgrade');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: unknown) => {
        if (
          isRecord(data) &&
          typeof data.status === 'string' &&
          typeof data.timestamp === 'string' &&
          typeof data.uptime === 'number'
        ) {
          setHealth({ status: data.status, timestamp: data.timestamp, uptime: data.uptime });
        }
      })
      .catch(console.error);
  }, [lane]);

  const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsScheme}//${window.location.host}/ws?lane=${encodeURIComponent(lane)}`;
  const ws = useReconnectingWebSocket({
    url: wsUrl,
    onOpenSendJson: [
      {
        type: 'subscribe',
        events: [
          'CHECKOUT_REQUESTED',
          'CHECKOUT_CLAIMED',
          'CHECKOUT_UPDATED',
          'CHECKOUT_COMPLETED',
          'SESSION_UPDATED',
          'ROOM_STATUS_CHANGED',
          'INVENTORY_UPDATED',
          'ASSIGNMENT_CREATED',
          'ASSIGNMENT_FAILED',
          'CUSTOMER_CONFIRMED',
          'CUSTOMER_DECLINED',
          'WAITLIST_UPDATED',
          'SELECTION_PROPOSED',
          'SELECTION_LOCKED',
          'SELECTION_ACKNOWLEDGED',
        ],
      },
    ],
    onMessage: (event) => {
      try {
        const parsed: unknown = safeJsonParse(String(event.data));
        if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
        const message = parsed as unknown as WebSocketEvent;
        console.log('WebSocket message:', message);

        if (message.type === 'CHECKOUT_REQUESTED') {
          const payload = message.payload as CheckoutRequestedPayload;
          setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.set(payload.request.requestId, payload.request);
            return next;
          });
        } else if (message.type === 'CHECKOUT_CLAIMED') {
          const payload = message.payload as CheckoutClaimedPayload;
          setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
        } else if (message.type === 'CHECKOUT_UPDATED') {
          const payload = message.payload as CheckoutUpdatedPayload;
          if (selectedCheckoutRequestRef.current === payload.requestId) {
            setCheckoutItemsConfirmed(payload.itemsConfirmed);
            setCheckoutFeePaid(payload.feePaid);
          }
        } else if (message.type === 'CHECKOUT_COMPLETED') {
          const payload = message.payload as { requestId: string };
          setCheckoutRequests((prev) => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
          if (selectedCheckoutRequestRef.current === payload.requestId) {
            setSelectedCheckoutRequest(null);
            setCheckoutChecklist({});
            setCheckoutItemsConfirmed(false);
            setCheckoutFeePaid(false);
          }
        } else if (message.type === 'SESSION_UPDATED') {
          const payload = message.payload as SessionUpdatedPayload;
          // Core identity/session fields (keep register in sync without manual refresh)
          if (payload.sessionId !== undefined) {
            setCurrentSessionId(payload.sessionId || null);
          }
          if (payload.customerName !== undefined) {
            setCustomerName(payload.customerName || '');
          }
          if (payload.membershipNumber !== undefined) {
            setMembershipNumber(payload.membershipNumber || '');
          }
          if (payload.customerMembershipValidUntil !== undefined) {
            setCustomerMembershipValidUntil(payload.customerMembershipValidUntil || null);
          }
          if (payload.membershipPurchaseIntent !== undefined) {
            setMembershipPurchaseIntent(payload.membershipPurchaseIntent || null);
          }

          // Agreement completion sync
          if (payload.agreementSigned !== undefined) {
            setAgreementSigned(Boolean(payload.agreementSigned));
          }

          // Update selection state
          if (payload.proposedRentalType) {
            setProposedRentalType(payload.proposedRentalType);
            setProposedBy(payload.proposedBy || null);
          }
          if (payload.selectionConfirmed !== undefined) {
            setSelectionConfirmed(payload.selectionConfirmed);
            setSelectionConfirmedBy(payload.selectionConfirmedBy || null);
            if (payload.selectionConfirmed) {
              setCustomerSelectedType(payload.proposedRentalType || null);
            }
          }
          // Update customer info
          if (payload.customerPrimaryLanguage !== undefined) {
            setCustomerPrimaryLanguage(payload.customerPrimaryLanguage);
          }
          if (payload.customerDobMonthDay !== undefined) {
            setCustomerDobMonthDay(payload.customerDobMonthDay);
          }
          if (payload.customerLastVisitAt !== undefined) {
            setCustomerLastVisitAt(payload.customerLastVisitAt);
          }
          if (payload.customerNotes !== undefined) {
            setCustomerNotes(payload.customerNotes);
          }
          // Update assignment info
          if (payload.assignedResourceType !== undefined) {
            setAssignedResourceType(payload.assignedResourceType);
          }
          if (payload.assignedResourceNumber !== undefined) {
            setAssignedResourceNumber(payload.assignedResourceNumber);
          }
          if (payload.checkoutAt !== undefined) {
            setCheckoutAt(payload.checkoutAt);
          }
          // Update payment status
          if (payload.paymentIntentId !== undefined) {
            setPaymentIntentId(payload.paymentIntentId || null);
          }
          if (payload.paymentStatus !== undefined) {
            setPaymentStatus(payload.paymentStatus);
          }
          // Keep payment quote view in sync with server-authoritative quote updates (e.g., kiosk membership purchase intent).
          if (payload.paymentTotal !== undefined || payload.paymentLineItems !== undefined) {
            setPaymentQuote((prev) => {
              const total = payload.paymentTotal ?? prev?.total ?? 0;
              const lineItems = payload.paymentLineItems ?? prev?.lineItems ?? [];
              const messages = prev?.messages ?? [];
              return { total, lineItems, messages };
            });
          }
          if (payload.paymentFailureReason) {
            setPaymentDeclineError(payload.paymentFailureReason);
          }
          // Update past-due blocking
          if (payload.pastDueBlocked !== undefined) {
            setPastDueBlocked(payload.pastDueBlocked);
            if (payload.pastDueBlocked && payload.pastDueBalance && payload.pastDueBalance > 0) {
              setShowPastDueModal(true);
            }
          }

          // If server cleared the lane session (COMPLETED with empty customer name), reset local UI.
          if (payload.status === 'COMPLETED' && (!payload.customerName || payload.customerName === '')) {
            setCurrentSessionId(null);
            setCustomerName('');
            setMembershipNumber('');
            setAgreementSigned(false);
            setAssignedResourceType(null);
            setAssignedResourceNumber(null);
            setSelectedInventoryItem(null);
            setPaymentIntentId(null);
            setPaymentQuote(null);
            setPaymentStatus(null);
            setMembershipPurchaseIntent(null);
            setCustomerMembershipValidUntil(null);
            setShowMembershipIdPrompt(false);
            setMembershipIdInput('');
            setMembershipIdError(null);
            setMembershipIdPromptedForSessionId(null);
            setProposedRentalType(null);
            setProposedBy(null);
            setSelectionConfirmed(false);
            setSelectionConfirmedBy(null);
            setSelectionAcknowledged(true);
          }
        } else if (message.type === 'WAITLIST_UPDATED') {
          // Refresh waitlist when updated
          void fetchWaitlistRef.current?.();
          void fetchInventoryAvailableRef.current?.();
        } else if (message.type === 'SELECTION_PROPOSED') {
          const payload = message.payload as SelectionProposedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            setProposedRentalType(payload.rentalType);
            setProposedBy(payload.proposedBy);
          }
        } else if (message.type === 'SELECTION_LOCKED') {
          const payload = message.payload as SelectionLockedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            setSelectionConfirmed(true);
            setSelectionConfirmedBy(payload.confirmedBy);
            setCustomerSelectedType(payload.rentalType);
            setSelectionAcknowledged(true);
          }
        } else if (message.type === 'SELECTION_FORCED') {
          const payload = message.payload as SelectionForcedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            setSelectionConfirmed(true);
            setSelectionConfirmedBy('EMPLOYEE');
            setCustomerSelectedType(payload.rentalType);
            setSelectionAcknowledged(true);
          }
        } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
          setSelectionAcknowledged(true);
        } else if (message.type === 'INVENTORY_UPDATED' || message.type === 'ROOM_STATUS_CHANGED') {
          void fetchInventoryAvailableRef.current?.();
        } else if (message.type === 'ASSIGNMENT_CREATED') {
          const payload = message.payload as AssignmentCreatedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            // Assignment successful - payment should already be handled before agreement + assignment.
            // SessionUpdated will carry assigned resource details.
          }
        } else if (message.type === 'ASSIGNMENT_FAILED') {
          const payload = message.payload as AssignmentFailedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            // Handle race condition - refresh and re-select
            alert('Assignment failed: ' + payload.reason);
            setSelectedInventoryItem(null);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMED') {
          const payload = message.payload as CustomerConfirmedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            setShowCustomerConfirmationPending(false);
            setCustomerConfirmationType(null);
          }
        } else if (message.type === 'CUSTOMER_DECLINED') {
          const payload = message.payload as CustomerDeclinedPayload;
          if (payload.sessionId === currentSessionIdRef.current) {
            setShowCustomerConfirmationPending(false);
            setCustomerConfirmationType(null);
            // Revert to customer's requested type
            if (customerSelectedTypeRef.current) {
              setSelectedInventoryItem(null);
              // This will trigger auto-selection in InventorySelector
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    },
  });

  useEffect(() => {
    setWsConnected(ws.connected);
  }, [ws.connected]);

  const handleInventorySelect = (
    type: 'room' | 'locker',
    id: string,
    number: string,
    tier: string
  ) => {
    // Check if employee selected different type than customer requested
    if (customerSelectedType && tier !== customerSelectedType) {
      // Require customer confirmation
      setCustomerConfirmationType({
        requested: customerSelectedType,
        selected: tier,
        number,
      });
      setShowCustomerConfirmationPending(true);

      // Send confirmation request to customer kiosk via WebSocket
      // This would be handled by the API/WebSocket broadcaster
      // For now, we'll show a modal
    }

    setSelectedInventoryItem({ type, id, number, tier });
  };

  const handleProposeSelection = async (rentalType: string) => {
    if (!currentSessionId || !session?.sessionToken) {
      return;
    }

    // Second tap on same rental forces selection
    if (proposedRentalType === rentalType && !selectionConfirmed) {
      await handleConfirmSelection();
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          rentalType,
          proposedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }

      setProposedRentalType(rentalType);
      setProposedBy('EMPLOYEE');
    } catch (error) {
      console.error('Failed to propose selection:', error);
      alert(
        error instanceof Error ? error.message : 'Failed to propose selection. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSelection = async () => {
    if (!currentSessionId || !session?.sessionToken || !proposedRentalType) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          confirmedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }

      setSelectionConfirmed(true);
      setSelectionConfirmedBy('EMPLOYEE');
      setSelectionAcknowledged(true);
      setCustomerSelectedType(proposedRentalType);
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(
        error instanceof Error ? error.message : 'Failed to confirm selection. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Corrected demo flow: once selection is confirmed/locked, create payment intent (no assignment required).
  useEffect(() => {
    if (!currentSessionId || !session?.sessionToken) return;
    if (!selectionConfirmed) return;
    if (paymentIntentId || paymentStatus === 'DUE' || paymentStatus === 'PAID') return;
    if (paymentIntentCreateInFlightRef.current) return;

    paymentIntentCreateInFlightRef.current = true;
    void handleCreatePaymentIntent().finally(() => {
      paymentIntentCreateInFlightRef.current = false;
    });
  }, [currentSessionId, session?.sessionToken, selectionConfirmed, paymentIntentId, paymentStatus]);

  const handleAssign = async () => {
    if (!selectedInventoryItem || !currentSessionId || !session?.sessionToken) {
      alert('Please select an item to assign');
      return;
    }

    // Guardrails: Prevent assignment if conditions not met
    if (showCustomerConfirmationPending) {
      alert('Please wait for customer confirmation before assigning');
      return;
    }

    if (!agreementSigned) {
      alert(
        'Agreement must be signed before assignment. Please wait for customer to sign the agreement.'
      );
      return;
    }

    if (paymentStatus !== 'PAID') {
      alert(
        'Payment must be marked as paid before assignment. Please mark payment as paid in Square first.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Use new check-in assign endpoint
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          resourceType: selectedInventoryItem.type,
          resourceId: selectedInventoryItem.id,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        const msg = getErrorMessage(errorPayload);
        if (
          isRecord(errorPayload) &&
          (errorPayload.raceLost === true ||
            (typeof msg === 'string' && msg.includes('already assigned')))
        ) {
          // Race condition - refresh inventory and re-select
          alert('Item no longer available. Refreshing inventory...');
          setSelectedInventoryItem(null);
          // InventorySelector will auto-refresh and re-select
        } else {
          throw new Error(msg || 'Failed to assign');
        }
      } else {
        const data = await readJson<{ needsConfirmation?: boolean }>(response);
        console.log('Assignment successful:', data);

        // If cross-type assignment, wait for customer confirmation
        if (data.needsConfirmation === true) {
          setShowCustomerConfirmationPending(true);
          setIsSubmitting(false);
          return;
        }

        // Assignment occurs after payment + agreement in the corrected flow; nothing payment-related here.
      }
    } catch (error) {
      console.error('Failed to assign:', error);
      alert(error instanceof Error ? error.message : 'Failed to assign');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePaymentIntent = async () => {
    if (!currentSessionId || !session?.sessionToken) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/create-payment-intent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to create payment intent');
      }

      const data = await readJson<{
        paymentIntentId?: string;
        quote?: {
          total: number;
          lineItems: Array<{ description: string; amount: number }>;
          messages: string[];
        };
      }>(response);
      if (typeof data.paymentIntentId === 'string') {
        setPaymentIntentId(data.paymentIntentId);
      }
      setPaymentQuote(data.quote ?? null);
      setPaymentStatus('DUE');
    } catch (error) {
      console.error('Failed to create payment intent:', error);
      alert(error instanceof Error ? error.message : 'Failed to create payment intent');
    }
  };

  const handleMarkPaid = async () => {
    if (!paymentIntentId || !session?.sessionToken) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/payments/${paymentIntentId}/mark-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          squareTransactionId: undefined, // Would come from Square POS integration
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to mark payment as paid');
      }

      setPaymentStatus('PAID');
      // Payment marked paid - customer can now sign agreement
    } catch (error) {
      console.error('Failed to mark payment as paid:', error);
      alert(error instanceof Error ? error.message : 'Failed to mark payment as paid');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteMembershipPurchase = async (membershipNumberOverride?: string) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }
    const membershipNumberToSave = (membershipNumberOverride ?? membershipIdInput).trim();
    if (!membershipNumberToSave) {
      setMembershipIdError('Membership number is required');
      return;
    }

    setMembershipIdSubmitting(true);
    setMembershipIdError(null);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/complete-membership-purchase`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            sessionId: currentSessionId,
            membershipNumber: membershipNumberToSave,
          }),
        }
      );

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to save membership number');
      }

      await response.json().catch(() => null);
      // Server will broadcast updated membership + clear pending intent.
      setShowMembershipIdPrompt(false);
      setMembershipIdInput('');
      setMembershipIdPromptedForSessionId(null);
    } catch (error) {
      console.error('Failed to complete membership purchase:', error);
      setMembershipIdError(error instanceof Error ? error.message : 'Failed to save membership number');
    } finally {
      setMembershipIdSubmitting(false);
    }
  };

  // Auto-prompt for membership ID after payment is accepted when a membership purchase intent is present.
  useEffect(() => {
    if (!currentSessionId) return;
    if (paymentStatus !== 'PAID') return;
    if (!membershipPurchaseIntent) return;
    // If membership is already active, no prompt needed.
    if (
      getCustomerMembershipStatus({
        membershipNumber: membershipNumber || null,
        membershipValidUntil: customerMembershipValidUntil,
      }) === 'ACTIVE'
    ) {
      return;
    }
    if (!paymentQuote?.lineItems?.some((li) => li.description === '6 Month Membership')) return;
    if (showMembershipIdPrompt) return;
    if (membershipIdPromptedForSessionId === currentSessionId) return;

    setMembershipIdPromptedForSessionId(currentSessionId);
    // Renewal supports keeping the same membership number (explicit option).
    if (membershipPurchaseIntent === 'RENEW' && membershipNumber) {
      setMembershipIdMode('KEEP_EXISTING');
      setMembershipIdInput(membershipNumber);
    } else {
      setMembershipIdMode('ENTER_NEW');
      setMembershipIdInput(membershipNumber || '');
    }
    setMembershipIdError(null);
    setShowMembershipIdPrompt(true);
  }, [
    currentSessionId,
    paymentStatus,
    membershipPurchaseIntent,
    paymentQuote,
    showMembershipIdPrompt,
    membershipIdPromptedForSessionId,
    membershipNumber,
    customerMembershipValidUntil,
  ]);

  // If server clears the pending intent (membership activated), close the prompt.
  useEffect(() => {
    if (membershipPurchaseIntent) return;
    if (!showMembershipIdPrompt) return;
    setShowMembershipIdPrompt(false);
    setMembershipIdInput('');
    setMembershipIdMode('ENTER_NEW');
    setMembershipIdError(null);
    setMembershipIdPromptedForSessionId(null);
  }, [membershipPurchaseIntent, showMembershipIdPrompt]);

  const handleClearSelection = () => {
    setSelectedInventoryItem(null);
  };

  const handleManualSignatureOverride = async () => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/manual-signature-override`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            sessionId: currentSessionId,
          }),
        }
      );

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(errorPayload) || 'Failed to process manual signature override'
        );
      }

      // Success - WebSocket will update the UI
      await response.json();
    } catch (error) {
      console.error('Failed to process manual signature override:', error);
      alert(error instanceof Error ? error.message : 'Failed to process manual signature override');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Past-due payment handlers
  const handlePastDuePayment = async (
    outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE',
    declineReason?: string
  ) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/past-due/demo-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ outcome, declineReason }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process payment');
      }

      if (outcome === 'CREDIT_DECLINE') {
        setPaymentDeclineError(declineReason || 'Payment declined');
      } else {
        setShowPastDueModal(false);
        setPaymentDeclineError(null);
      }
    } catch (error) {
      console.error('Failed to process past-due payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManagerBypass = async () => {
    if (!session?.sessionToken || !currentSessionId || !managerId || !managerPin) {
      alert('Please select manager and enter PIN');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/past-due/bypass`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ managerId, managerPin }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to bypass past-due');
      }

      setShowManagerBypassModal(false);
      setManagerId('');
      setManagerPin('');
      setPaymentDeclineError(null);
    } catch (error) {
      console.error('Failed to bypass past-due:', error);
      alert(error instanceof Error ? error.message : 'Failed to bypass past-due');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Notes handler
  const handleAddNote = async () => {
    if (!session?.sessionToken || !currentSessionId || !newNoteText.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/add-note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ note: newNoteText.trim() }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to add note');
      }

      setShowAddNoteModal(false);
      setNewNoteText('');
    } catch (error) {
      console.error('Failed to add note:', error);
      alert(error instanceof Error ? error.message : 'Failed to add note');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pay-first demo handlers
  const handleDemoPayment = async (
    outcome: 'CASH_SUCCESS' | 'CREDIT_SUCCESS' | 'CREDIT_DECLINE',
    declineReason?: string
  ) => {
    if (!session?.sessionToken || !currentSessionId) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/demo-take-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          outcome,
          declineReason,
          registerNumber: registerSession?.registerNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process payment');
      }

      if (outcome === 'CREDIT_DECLINE') {
        setPaymentDeclineError(declineReason || 'Payment declined');
      } else {
        setPaymentDeclineError(null);
      }
    } catch (error) {
      console.error('Failed to process payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Complete transaction handler
  const handleCompleteTransaction = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete transaction');
      }

      // Reset all state
      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setAgreementSigned(false);
      setSelectedRentalType(null);
      setCustomerSelectedType(null);
      setSelectedInventoryItem(null);
      setPaymentIntentId(null);
      setPaymentQuote(null);
      setPaymentStatus(null);
      setAssignedResourceType(null);
      setAssignedResourceNumber(null);
      setCheckoutAt(null);
      setCustomerPrimaryLanguage(undefined);
      setCustomerDobMonthDay(undefined);
      setCustomerLastVisitAt(undefined);
      setCustomerNotes(undefined);
      setPaymentDeclineError(null);
    } catch (error) {
      console.error('Failed to complete transaction:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete transaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fetch managers for bypass modal
  useEffect(() => {
    if (showManagerBypassModal && session?.sessionToken) {
      fetch(`${API_BASE}/v1/employees/available`, {
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      })
        .then((res) => res.json())
        .then((data: unknown) => {
          if (!isRecord(data) || !Array.isArray(data.employees)) {
            setManagerList([]);
            return;
          }
          const managers = data.employees
            .filter(
              (e): e is { id: string; name: string; role: string } =>
                isRecord(e) && typeof e.role === 'string'
            )
            .filter((e) => e.role === 'ADMIN')
            .map((e) => ({ id: String(e.id), name: String(e.name) }));
          setManagerList(managers);
        })
        .catch(console.error);
    }
  }, [showManagerBypassModal, session?.sessionToken]);

  return (
    <RegisterSignIn deviceId={deviceId} onSignedIn={handleRegisterSignIn}>
      {!registerSession ? (
        <div />
      ) : !session ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>Loading...</div>
      ) : (
        <div className="container" style={{ marginTop: '60px', padding: '1.5rem' }}>
          {/* Checkout Request Notifications */}
          {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                background: '#1e293b',
                borderBottom: '2px solid #3b82f6',
                zIndex: 1000,
                padding: '1rem',
                maxHeight: '200px',
                overflowY: 'auto',
              }}
            >
              {Array.from(checkoutRequests.values()).map((request) => {
                const lateMinutes = request.lateMinutes;
                const feeAmount = request.lateFeeAmount;
                const banApplied = request.banApplied;

                return (
                  <div
                    key={request.requestId}
                    onClick={() => void handleClaimCheckout(request.requestId)}
                    style={{
                      padding: '1rem',
                      marginBottom: '0.5rem',
                      background: '#0f172a',
                      border: '2px solid #3b82f6',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#1e293b';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#0f172a';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div
                          style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}
                        >
                          {request.customerName}
                          {request.membershipNumber && ` (${request.membershipNumber})`}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                          {request.rentalType} •{' '}
                          {request.roomNumber || request.lockerNumber || 'N/A'}
                        </div>
                        <div
                          style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}
                        >
                          Scheduled: {new Date(request.scheduledCheckoutAt).toLocaleString()} •
                          Current: {new Date(request.currentTime).toLocaleString()} •
                          {lateMinutes > 0 ? (
                            <span style={{ color: '#f59e0b' }}>{lateMinutes} min late</span>
                          ) : (
                            <span>On time</span>
                          )}
                        </div>
                        {feeAmount > 0 && (
                          <div
                            style={{
                              fontSize: '0.875rem',
                              color: '#f59e0b',
                              marginTop: '0.25rem',
                              fontWeight: 600,
                            }}
                          >
                            Late fee: ${feeAmount.toFixed(2)}
                            {banApplied && ' • 30-day ban applied'}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleClaimCheckout(request.requestId);
                        }}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Claim
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Checkout Verification Screen */}
          {selectedCheckoutRequest &&
            (() => {
              const request = checkoutRequests.get(selectedCheckoutRequest);
              if (!request) return null;

              return (
                <div
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.8)',
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2rem',
                  }}
                >
                  <div
                    style={{
                      background: '#1e293b',
                      border: '2px solid #3b82f6',
                      borderRadius: '12px',
                      padding: '2rem',
                      maxWidth: '600px',
                      width: '100%',
                      maxHeight: '90vh',
                      overflowY: 'auto',
                    }}
                  >
                    <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
                      Checkout Verification
                    </h2>

                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong>Customer:</strong> {request.customerName}
                        {request.membershipNumber && ` (${request.membershipNumber})`}
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong>Rental:</strong> {request.rentalType} •{' '}
                        {request.roomNumber || request.lockerNumber || 'N/A'}
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong>Scheduled Checkout:</strong>{' '}
                        {new Date(request.scheduledCheckoutAt).toLocaleString()}
                      </div>
                      {request.lateMinutes > 0 && (
                        <div style={{ marginBottom: '0.5rem', color: '#f59e0b' }}>
                          <strong>Late:</strong> {request.lateMinutes} minutes
                        </div>
                      )}
                      {request.lateFeeAmount > 0 && (
                        <div style={{ marginBottom: '0.5rem', color: '#f59e0b', fontWeight: 600 }}>
                          <strong>Late Fee:</strong> ${request.lateFeeAmount.toFixed(2)}
                          {request.banApplied && ' • 30-day ban applied'}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: '#0f172a',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
                        Customer Checklist:
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                        (Items customer marked as returned)
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                        marginBottom: '1.5rem',
                      }}
                    >
                      <button
                        onClick={() => void handleConfirmItems(selectedCheckoutRequest)}
                        disabled={checkoutItemsConfirmed}
                        style={{
                          padding: '0.75rem',
                          background: checkoutItemsConfirmed ? '#10b981' : '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: checkoutItemsConfirmed ? 'default' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {checkoutItemsConfirmed ? '✓ Items Confirmed' : 'Confirm Items Returned'}
                      </button>

                      {request.lateFeeAmount > 0 && (
                        <button
                          onClick={() => void handleMarkFeePaid(selectedCheckoutRequest)}
                          disabled={checkoutFeePaid}
                          style={{
                            padding: '0.75rem',
                            background: checkoutFeePaid ? '#10b981' : '#f59e0b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: checkoutFeePaid ? 'default' : 'pointer',
                            fontWeight: 600,
                          }}
                        >
                          {checkoutFeePaid ? '✓ Fee Marked Paid' : 'Mark Late Fee Paid'}
                        </button>
                      )}

                      <button
                        onClick={() => void handleCompleteCheckout(selectedCheckoutRequest)}
                        disabled={
                          !checkoutItemsConfirmed ||
                          (request.lateFeeAmount > 0 && !checkoutFeePaid) ||
                          isSubmitting
                        }
                        style={{
                          padding: '0.75rem',
                          background:
                            !checkoutItemsConfirmed ||
                            (request.lateFeeAmount > 0 && !checkoutFeePaid)
                              ? '#475569'
                              : '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor:
                            !checkoutItemsConfirmed ||
                            (request.lateFeeAmount > 0 && !checkoutFeePaid)
                              ? 'not-allowed'
                              : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {isSubmitting ? 'Processing...' : 'Complete Checkout'}
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedCheckoutRequest(null);
                        setCheckoutChecklist({});
                        setCheckoutItemsConfirmed(false);
                        setCheckoutFeePaid(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'transparent',
                        color: '#94a3b8',
                        border: '1px solid #475569',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}

          <header
            className="header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>Employee Register</h1>
              <div
                className="status-badges"
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <span
                  className={`badge ${health?.status === 'ok' ? 'badge-success' : 'badge-error'}`}
                >
                  API: {health?.status ?? '...'}
                </span>
                <span className={`badge ${wsConnected ? 'badge-success' : 'badge-error'}`}>
                  WS: {wsConnected ? 'Live' : 'Offline'}
                </span>
                <span className="badge badge-info">Lane: {lane}</span>
                <span className="badge badge-info">
                  {session.name} ({session.role})
                </span>
              </div>
              <button
                onClick={() => void handleLogout()}
                style={{
                  padding: '0.375rem 0.75rem',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid var(--error)',
                  borderRadius: '9999px',
                  color: 'var(--error)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                className={showUpgradePulse && hasEligibleEntries ? 'gold-pulse' : undefined}
                onClick={() => {
                  const nextOpen = !waitlistWidgetOpen;
                  if (nextOpen) dismissUpgradePulse();
                  setWaitlistWidgetOpen(nextOpen);
                }}
                disabled={!waitlistInteractive}
                aria-label="Waitlist widget"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.75rem',
                  background: waitlistInteractive ? '#fef3c7' : '#1f2937',
                  border: `1px solid ${waitlistInteractive ? '#f59e0b' : '#334155'}`,
                  borderRadius: '9999px',
                  color: waitlistInteractive ? '#92400e' : '#94a3b8',
                  fontWeight: 700,
                  cursor: waitlistInteractive ? 'pointer' : 'not-allowed',
                  minWidth: '110px',
                  justifyContent: 'center',
                }}
              >
                <span role="img" aria-label="waitlist clock">
                  ⏰
                </span>
                <span>{waitlistDisplayNumber}</span>
              </button>
            </div>
          </header>

          {waitlistWidgetOpen && (
            <div style={{ position: 'relative', marginTop: '0.5rem' }}>
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  zIndex: 1500,
                  background: '#0b1220',
                  border: '1px solid #1f2937',
                  borderRadius: '8px',
                  width: '320px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                }}
              >
                <div
                  style={{
                    padding: '0.75rem',
                    borderBottom: '1px solid #1f2937',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#f59e0b' }}>Waitlist</div>
                  <button
                    onClick={() => setWaitlistWidgetOpen(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    Close
                  </button>
                </div>
                <div
                  style={{
                    maxHeight: '260px',
                    overflowY: 'auto',
                    opacity: sessionActive ? 0.65 : 1,
                    pointerEvents: sessionActive ? 'none' : 'auto',
                  }}
                >
                  {waitlistEntries.length === 0 && (
                    <div style={{ padding: '0.75rem', color: '#94a3b8' }}>No waitlist entries</div>
                  )}
                  {waitlistEntries.slice(0, 6).map((entry) => {
                    const eligible = isEntryOfferEligible(entry);
                    return (
                    <div
                      key={entry.id}
                      style={{
                        padding: '0.75rem',
                        borderBottom: '1px solid #1f2937',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {entry.customerName || entry.displayIdentifier}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                          {entry.displayIdentifier} → {entry.desiredTier}
                        </div>
                      </div>
                      <button
                        aria-label={`Begin upgrade for ${entry.customerName || entry.displayIdentifier}`}
                        onClick={() => handleWaitlistEntryAction(entry.id, entry.customerName)}
                        style={{
                          background: eligible ? '#f59e0b' : '#475569',
                          color: '#1f2937',
                          border: 'none',
                          borderRadius: '9999px',
                          padding: '0.4rem 0.55rem',
                          fontWeight: 700,
                          cursor: eligible ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!eligible}
                      >
                        🔑
                      </button>
                    </div>
                    );
                  })}
                  {waitlistEntries.length > 6 && (
                    <div
                      onClick={() => {
                        dismissUpgradePulse();
                        setShowUpgradesPanel(true);
                        setWaitlistWidgetOpen(false);
                      }}
                      style={{
                        padding: '0.75rem',
                        borderTop: '1px solid #1f2937',
                        color: '#f59e0b',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      More..
                    </div>
                  )}
                </div>
                {sessionActive && (
                  <div
                    style={{
                      padding: '0.65rem 0.75rem',
                      color: '#f59e0b',
                      fontSize: '0.85rem',
                      borderTop: '1px solid #1f2937',
                    }}
                  >
                    Active session present — actions disabled
                  </div>
                )}
              </div>
            </div>
          )}

          <main className="main">
            {/* Customer Info Panel */}
            {currentSessionId && customerName && (
              <section
                style={{
                  marginBottom: '1rem',
                  padding: '1rem',
                  background: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>
                  Customer Information
                </h2>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <div
                      style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}
                    >
                      Name
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{customerName}</div>
                  </div>
                  {customerPrimaryLanguage && (
                    <div>
                      <div
                        style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}
                      >
                        Primary Language
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                        {customerPrimaryLanguage}
                      </div>
                    </div>
                  )}
                  {customerDobMonthDay && (
                    <div>
                      <div
                        style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}
                      >
                        Date of Birth
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '1rem' }}>{customerDobMonthDay}</div>
                    </div>
                  )}
                  {customerLastVisitAt && (
                    <div>
                      <div
                        style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}
                      >
                        Last Visit
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                        {new Date(customerLastVisitAt).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                  {paymentQuote && paymentQuote.total > 0 && (
                    <div>
                      <div
                        style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}
                      >
                        Past Due Balance
                      </div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '1rem',
                          color: paymentQuote.total > 0 ? '#f59e0b' : 'inherit',
                        }}
                      >
                        ${paymentQuote.total.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
                {customerNotes && (
                  <div
                    style={{
                      marginTop: '1rem',
                      paddingTop: '1rem',
                      borderTop: '1px solid #475569',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                      Notes
                    </div>
                    <div
                      style={{
                        padding: '0.75rem',
                        background: '#0f172a',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        whiteSpace: 'pre-wrap',
                        maxHeight: '150px',
                        overflowY: 'auto',
                      }}
                    >
                      {customerNotes}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setShowAddNoteModal(true)}
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add Note
                  </button>
                </div>
              </section>
            )}

            {/* Waitlist/Upgrades Panel Toggle */}
            <section style={{ marginBottom: '1rem' }}>
              <button
                className={showUpgradePulse && hasEligibleEntries ? 'gold-pulse' : undefined}
                onClick={() => {
                  const nextOpen = !showUpgradesPanel;
                  if (nextOpen) dismissUpgradePulse();
                  setShowUpgradesPanel(nextOpen);
                }}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: showUpgradesPanel ? '#3b82f6' : '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showUpgradesPanel ? '▼' : '▶'} Upgrades / Waitlist (
                {
                  waitlistEntries.filter((e) => e.status === 'ACTIVE' || e.status === 'OFFERED')
                    .length
                }
                )
              </button>
            </section>

            {/* Waitlist/Upgrades Panel */}
            {showUpgradesPanel && (
              <section
                style={{
                  marginBottom: '1rem',
                  padding: '1rem',
                  background: '#1e293b',
                  border: '1px solid #475569',
                  borderRadius: '8px',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>
                  Waitlist & Upgrades
                </h2>
                {sessionActive && (
                  <div style={{ marginBottom: '0.75rem', color: '#f59e0b', fontSize: '0.875rem' }}>
                    Active session present — waitlist actions are disabled
                  </div>
                )}

                {waitlistEntries.length === 0 ? (
                  <p style={{ color: '#94a3b8' }}>No active waitlist entries</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {['ACTIVE', 'OFFERED'].map((status) => {
                      const entries = waitlistEntries.filter((e) => e.status === status);
                      if (entries.length === 0) return null;

                      return (
                        <div key={status} style={{ marginBottom: '1rem' }}>
                          <h3
                            style={{
                              marginBottom: '0.5rem',
                              fontSize: '1rem',
                              fontWeight: 600,
                              color: status === 'OFFERED' ? '#f59e0b' : '#94a3b8',
                            }}
                          >
                            {status === 'OFFERED' ? '⚠️ Offered' : '⏳ Active'} ({entries.length})
                          </h3>
                          {entries.map((entry) => (
                            <div
                              key={entry.id}
                              style={{
                                padding: '1rem',
                                background: '#0f172a',
                                border: '1px solid #475569',
                                borderRadius: '6px',
                                marginBottom: '0.5rem',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'start',
                                  marginBottom: '0.5rem',
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                    {entry.displayIdentifier} → {entry.desiredTier}
                                  </div>
                                  <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                                    Current: {entry.currentRentalType} • Check-in:{' '}
                                    {entry.checkinAt ? new Date(entry.checkinAt).toLocaleTimeString() : '—'} •
                                    Checkout:{' '}
                                    {entry.checkoutAt ? new Date(entry.checkoutAt).toLocaleTimeString() : '—'}
                                  </div>
                                </div>
                                {status === 'OFFERED' &&
                                  upgradePaymentIntentId &&
                                  entry.id === selectedWaitlistEntry && (
                                    <div style={{ textAlign: 'right' }}>
                                      <div
                                        style={{
                                          fontSize: '0.875rem',
                                          color: '#f59e0b',
                                          marginBottom: '0.25rem',
                                        }}
                                      >
                                        Fee: ${upgradeFee?.toFixed(2)}
                                      </div>
                                      <button
                                        onClick={() => {
                                          dismissUpgradePulse();
                                          if (paymentStatus === 'PAID') {
                                            void handleCompleteUpgrade(
                                              entry.id,
                                              upgradePaymentIntentId
                                            );
                                          } else {
                                            alert('Please mark payment as paid in Square first');
                                          }
                                        }}
                                        disabled={
                                          !isEntryOfferEligible(entry) ||
                                          paymentStatus !== 'PAID' ||
                                          isSubmitting
                                        }
                                        style={{
                                          padding: '0.5rem 1rem',
                                          background:
                                            paymentStatus === 'PAID' && isEntryOfferEligible(entry)
                                              ? '#10b981'
                                              : '#475569',
                                          color: 'white',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '0.875rem',
                                          fontWeight: 600,
                                          cursor:
                                            paymentStatus === 'PAID' && isEntryOfferEligible(entry)
                                              ? 'pointer'
                                              : 'not-allowed',
                                        }}
                                      >
                                        {paymentStatus === 'PAID'
                                          ? 'Complete Upgrade'
                                          : 'Mark Paid First'}
                                      </button>
                                    </div>
                                  )}
                              </div>
                              {status === 'ACTIVE' && (
                                <button
                                  onClick={() => {
                                    dismissUpgradePulse();
                                    openOfferUpgradeModal(entry);
                                  }}
                                  disabled={!isEntryOfferEligible(entry)}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    background: isEntryOfferEligible(entry) ? '#3b82f6' : '#475569',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '0.875rem',
                                    fontWeight: 600,
                                    cursor: isEntryOfferEligible(entry) ? 'pointer' : 'not-allowed',
                                  }}
                                >
                                  Offer Upgrade
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Waitlist Banner */}
            {waitlistDesiredTier && waitlistBackupType && (
              <div
                style={{
                  padding: '1rem',
                  background: '#fef3c7',
                  border: '2px solid #f59e0b',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  color: '#92400e',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.5rem' }}>
                  ⚠️ Customer Waitlisted
                </div>
                <div style={{ fontSize: '0.875rem' }}>
                  Customer requested <strong>{waitlistDesiredTier}</strong> but it's unavailable.
                  Assigning <strong>{waitlistBackupType}</strong> as backup. If{' '}
                  {waitlistDesiredTier} becomes available, customer can upgrade.
                </div>
              </div>
            )}

            {/* Selection State Display */}
            {currentSessionId && customerName && (proposedRentalType || selectionConfirmed) && (
              <div
                style={{
                  padding: '1rem',
                  marginBottom: '1rem',
                  background: selectionConfirmed ? '#10b981' : '#3b82f6',
                  borderRadius: '8px',
                  color: 'white',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  {selectionConfirmed
                    ? `✓ Selection Locked: ${proposedRentalType} (by ${selectionConfirmedBy === 'CUSTOMER' ? 'Customer' : 'You'})`
                    : `Proposed: ${proposedRentalType} (by ${proposedBy === 'CUSTOMER' ? 'Customer' : 'You'})`}
                </div>
                {!selectionConfirmed && proposedBy === 'EMPLOYEE' && (
                  <button
                    onClick={() => void handleConfirmSelection()}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'white',
                      color: '#3b82f6',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSubmitting ? 'Confirming...' : 'Confirm Selection'}
                  </button>
                )}
                {!selectionConfirmed && proposedBy === 'CUSTOMER' && (
                  <button
                    onClick={() => void handleConfirmSelection()}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.5rem 1rem',
                      background: 'white',
                      color: '#3b82f6',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSubmitting ? 'Confirming...' : 'Confirm Customer Selection'}
                  </button>
                )}
              </div>
            )}

            {/* Quick Selection Buttons */}
            {currentSessionId && customerName && !selectionConfirmed && !pastDueBlocked && (
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                {['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'].map((rental) => (
                  <button
                    key={rental}
                    onClick={() => void handleProposeSelection(rental)}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.5rem 1rem',
                      background: proposedRentalType === rental ? '#3b82f6' : '#475569',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Propose {rental}
                  </button>
                ))}
              </div>
            )}

            {/* Inventory Selector */}
            {currentSessionId && customerName && !pastDueBlocked && (
              <InventorySelector
                customerSelectedType={customerSelectedType}
                waitlistDesiredTier={waitlistDesiredTier}
                waitlistBackupType={waitlistBackupType}
                onSelect={handleInventorySelect}
                selectedItem={selectedInventoryItem}
                sessionId={currentSessionId}
                lane={lane}
                sessionToken={session.sessionToken}
              />
            )}

            {/* Assignment Bar */}
            {selectedInventoryItem && (
              <div
                style={{
                  position: 'sticky',
                  bottom: 0,
                  background: '#1e293b',
                  borderTop: '2px solid #3b82f6',
                  padding: '1rem',
                  zIndex: 100,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    marginBottom: paymentQuote ? '1rem' : 0,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}>
                      Selected: {selectedInventoryItem.type === 'room' ? 'Room' : 'Locker'}{' '}
                      {selectedInventoryItem.number}
                    </div>
                    {customerSelectedType &&
                      selectedInventoryItem.tier !== customerSelectedType && (
                        <div style={{ fontSize: '0.875rem', color: '#f59e0b' }}>
                          Waiting for customer confirmation...
                        </div>
                      )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => void handleAssign()}
                      disabled={
                        isSubmitting ||
                        showCustomerConfirmationPending ||
                        !agreementSigned ||
                        paymentStatus !== 'PAID'
                      }
                      style={{
                        padding: '0.75rem 1.5rem',
                        background:
                          isSubmitting ||
                          showCustomerConfirmationPending ||
                          !agreementSigned ||
                          paymentStatus !== 'PAID'
                            ? '#475569'
                            : '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '1rem',
                        fontWeight: 600,
                        cursor:
                          isSubmitting ||
                          showCustomerConfirmationPending ||
                          !agreementSigned ||
                          paymentStatus !== 'PAID'
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                      title={
                        showCustomerConfirmationPending
                          ? 'Waiting for customer confirmation'
                          : paymentStatus !== 'PAID'
                            ? 'Payment must be successful before assignment'
                            : !agreementSigned
                              ? 'Waiting for customer to sign agreement'
                              : 'Assign resource'
                      }
                    >
                      {isSubmitting
                        ? 'Assigning...'
                        : showCustomerConfirmationPending
                          ? 'Waiting for Confirmation'
                          : paymentStatus !== 'PAID'
                            ? 'Awaiting Payment'
                            : !agreementSigned
                              ? 'Awaiting Signature'
                              : 'Assign'}
                    </button>
                    {!agreementSigned && paymentStatus === 'PAID' ? (
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              'Override customer signature? This will complete the agreement signing process without a customer signature.'
                            )
                          ) {
                            void handleManualSignatureOverride();
                          }
                        }}
                        disabled={isSubmitting}
                        style={{
                          padding: '0.75rem 1.5rem',
                          background: '#ef4444',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '1rem',
                          fontWeight: 600,
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Manual Signature
                      </button>
                    ) : (
                      <button
                        onClick={handleClearSelection}
                        disabled={isSubmitting}
                        style={{
                          padding: '0.75rem 1.5rem',
                          background: 'transparent',
                          color: '#94a3b8',
                          border: '1px solid #475569',
                          borderRadius: '6px',
                          fontSize: '1rem',
                          fontWeight: 600,
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Payment Quote and Mark Paid */}
                {paymentQuote && (
                  <div
                    style={{
                      padding: '1rem',
                      background: '#0f172a',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                    }}
                  >
                    <div style={{ marginBottom: '0.75rem', fontWeight: 600, fontSize: '1rem' }}>
                      Payment Quote
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      {paymentQuote.lineItems.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '0.25rem',
                            fontSize: '0.875rem',
                          }}
                        >
                          <span>{item.description}</span>
                          <span>${item.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 600,
                        fontSize: '1.125rem',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid #475569',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <span>Total Due:</span>
                      <span>${paymentQuote.total.toFixed(2)}</span>
                    </div>
                    {paymentQuote.messages && paymentQuote.messages.length > 0 && (
                      <div
                        style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem' }}
                      >
                        {paymentQuote.messages.map((msg, idx) => (
                          <div key={idx}>{msg}</div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => void handleMarkPaid()}
                      disabled={isSubmitting || paymentStatus === 'PAID'}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: paymentStatus === 'PAID' ? '#10b981' : '#f59e0b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '1rem',
                        fontWeight: 600,
                        cursor: paymentStatus === 'PAID' ? 'default' : 'pointer',
                      }}
                    >
                      {paymentStatus === 'PAID' ? '✓ Paid in Square' : 'Mark Paid in Square'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <section className="actions-panel">
              <h2>Lane Session</h2>
              <div className="action-buttons">
                <button
                  className={`action-btn ${scanModeOpen ? 'active' : ''}`}
                  onClick={() => {
                    setManualEntry(false);
                    setScanModeOpen(true);
                  }}
                >
                  <span className="btn-icon">📡</span>
                  Scan
                </button>
                <button
                  className={`action-btn ${manualEntry ? 'active' : ''}`}
                  onClick={() => {
                    setManualEntry(!manualEntry);
                  }}
                >
                  <span className="btn-icon">✏️</span>
                  Manual Entry
                </button>
                <button
                  className="action-btn"
                  onClick={() => void handleClearSession()}
                  disabled={isSubmitting}
                >
                  <span className="btn-icon">🗑️</span>
                  Clear Session
                </button>
              </div>

              {manualEntry && (
                <form className="manual-entry-form" onSubmit={(e) => void handleManualSubmit(e)}>
                  <div className="form-group">
                    <label htmlFor="customerName">Customer Name *</label>
                    <input
                      id="customerName"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Enter customer name"
                      disabled={isSubmitting}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="membershipNumber">Membership Number (optional)</label>
                    <input
                      id="membershipNumber"
                      type="text"
                      value={membershipNumber}
                      onChange={(e) => setMembershipNumber(e.target.value)}
                      placeholder="Enter membership number"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="submit-btn"
                      disabled={isSubmitting || !customerName.trim()}
                    >
                      {isSubmitting ? 'Submitting...' : 'Update Session'}
                    </button>
                    <button
                      type="button"
                      className="cancel-btn"
                      onClick={() => {
                        setManualEntry(false);
                        setCustomerName('');
                        setMembershipNumber('');
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {(customerName || membershipNumber) && !manualEntry && (
                <div className="current-session">
                  <p>
                    <strong>Current Session:</strong>
                  </p>
                  <p>Name: {customerName || 'Not set'}</p>
                  {membershipNumber && <p>Membership: {membershipNumber}</p>}
                  {currentSessionId && (
                    <p
                      className={
                        agreementSigned ? 'agreement-status signed' : 'agreement-status unsigned'
                      }
                    >
                      {agreementSigned ? 'Agreement signed ✓' : 'Agreement pending'}
                    </p>
                  )}
                </div>
              )}

              {/* Customer lookup (typeahead) */}
              <div
                className="typeahead-section"
                style={{
                  marginTop: '1rem',
                  background: '#0f172a',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid #1e293b',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <label htmlFor="customer-search" style={{ fontWeight: 600 }}>
                    Search Customer
                  </label>
                  <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                    (type at least 3 letters)
                  </span>
                </div>
                <input
                  id="customer-search"
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Start typing name..."
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #1f2937',
                    background: '#0b1220',
                    color: '#e2e8f0',
                  }}
                  disabled={isSubmitting}
                />
                {customerSearchLoading && (
                  <div style={{ marginTop: '0.25rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                    Searching...
                  </div>
                )}
                {customerSuggestions.length > 0 && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      background: '#0b1220',
                      border: '1px solid #1f2937',
                      borderRadius: '6px',
                      maxHeight: '180px',
                      overflowY: 'auto',
                    }}
                  >
                    {customerSuggestions.map((s) => {
                      const label = `${s.lastName}, ${s.firstName}`;
                      const active = selectedCustomerId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => {
                            setSelectedCustomerId(s.id);
                            setSelectedCustomerLabel(label);
                          }}
                          style={{
                            padding: '0.5rem 0.75rem',
                            cursor: 'pointer',
                            background: active ? '#1e293b' : 'transparent',
                            borderBottom: '1px solid #1f2937',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{label}</div>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              color: '#94a3b8',
                              display: 'flex',
                              gap: '0.75rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            {s.dobMonthDay && <span>DOB: {s.dobMonthDay}</span>}
                            {s.membershipNumber && <span>Membership: {s.membershipNumber}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => void handleConfirmCustomerSelection()}
                  disabled={!selectedCustomerId || isSubmitting}
                  style={{
                    marginTop: '0.75rem',
                    width: '100%',
                    padding: '0.65rem',
                    background: selectedCustomerId ? '#3b82f6' : '#1f2937',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: !selectedCustomerId || isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: !selectedCustomerId || isSubmitting ? 0.7 : 1,
                  }}
                >
                  {selectedCustomerLabel ? `Confirm ${selectedCustomerLabel}` : 'Confirm'}
                </button>
              </div>
            </section>
          </main>

          <footer className="footer">
            <p>Employee-facing tablet • Runs alongside Square POS</p>
          </footer>

          {/* Waitlist Modal */}
          {showWaitlistModal && waitlistDesiredTier && waitlistBackupType && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
              onClick={() => setShowWaitlistModal(false)}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '500px',
                  width: '90%',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
                  Waitlist Notice
                </h2>
                <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
                  Customer requested waitlist for {waitlistDesiredTier}. Assigning a{' '}
                  {waitlistBackupType} in the meantime.
                </p>
                <button
                  onClick={() => setShowWaitlistModal(false)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          )}

          {offerUpgradeModal && session?.sessionToken && (
            <OfferUpgradeModal
              isOpen={true}
              onClose={() => setOfferUpgradeModal(null)}
              sessionToken={session.sessionToken}
              waitlistId={offerUpgradeModal.waitlistId}
              desiredTier={offerUpgradeModal.desiredTier}
              customerLabel={offerUpgradeModal.customerLabel}
              disabled={sessionActive}
              onOffered={() => {
                void fetchWaitlistRef.current?.();
                void fetchInventoryAvailableRef.current?.();
              }}
            />
          )}

          {/* Customer Confirmation Pending Modal */}
          {showCustomerConfirmationPending && customerConfirmationType && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '500px',
                  width: '90%',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
                  Waiting for Customer Confirmation
                </h2>
                <p style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
                  Staff selected a different option: {customerConfirmationType.selected}{' '}
                  {customerConfirmationType.number}. Waiting for customer to accept or decline on
                  their device.
                </p>
                <button
                  onClick={() => {
                    setShowCustomerConfirmationPending(false);
                    setCustomerConfirmationType(null);
                    // Revert selection
                    setSelectedInventoryItem(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#475569',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Full-screen Scan Mode (keyboard-wedge scanner; no iPad camera) */}
          <ScanMode
            isOpen={scanModeOpen}
            onCancel={() => {
              setScanModeOpen(false);
              setPendingCreateFromScan(null);
            }}
            onBarcodeCaptured={onBarcodeCaptured}
            onCreateFromNoMatch={handleCreateFromNoMatch}
          />

          {/* Past-Due Payment Modal */}
          {showPastDueModal && paymentQuote && paymentQuote.total > 0 && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '500px',
                  width: '90%',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
                  Past Due Balance: ${paymentQuote.total.toFixed(2)}
                </h2>
                <p style={{ marginBottom: '1.5rem', color: '#94a3b8' }}>
                  Customer has a past due balance. Please process payment or bypass.
                </p>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <button
                    onClick={() => void handlePastDuePayment('CREDIT_SUCCESS')}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.75rem',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Credit Success
                  </button>
                  <button
                    onClick={() => void handlePastDuePayment('CASH_SUCCESS')}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.75rem',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cash Success
                  </button>
                  <button
                    onClick={() => void handlePastDuePayment('CREDIT_DECLINE', 'Card declined')}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.75rem',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Credit Decline
                  </button>
                  <button
                    onClick={() => {
                      setShowPastDueModal(false);
                      setShowManagerBypassModal(true);
                    }}
                    disabled={isSubmitting}
                    style={{
                      padding: '0.75rem',
                      background: 'transparent',
                      color: '#94a3b8',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Manager Bypass
                  </button>
                </div>
                <button
                  onClick={() => setShowPastDueModal(false)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'transparent',
                    color: '#94a3b8',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Membership ID Prompt (after membership purchase/renewal payment is accepted) */}
          {showMembershipIdPrompt && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2500,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '520px',
                  width: '92%',
                  border: '1px solid #334155',
                }}
              >
                <h2 style={{ marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: 700 }}>
                  Enter Membership ID
                </h2>
                <p style={{ marginBottom: '1rem', color: '#94a3b8' }}>
                  Payment was accepted for a 6 month membership. Scan or type the membership number from
                  the physical card, then press Enter.
                </p>

                {membershipPurchaseIntent === 'RENEW' && membershipNumber ? (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <button
                        onClick={() => {
                          setMembershipIdMode('KEEP_EXISTING');
                          setMembershipIdInput(membershipNumber);
                          setMembershipIdError(null);
                        }}
                        disabled={membershipIdSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.6rem',
                          background: membershipIdMode === 'KEEP_EXISTING' ? '#3b82f6' : 'transparent',
                          color: membershipIdMode === 'KEEP_EXISTING' ? 'white' : '#cbd5e1',
                          border: '1px solid #475569',
                          borderRadius: '6px',
                          fontWeight: 700,
                          cursor: membershipIdSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Keep Same ID
                      </button>
                      <button
                        onClick={() => {
                          setMembershipIdMode('ENTER_NEW');
                          setMembershipIdInput('');
                          setMembershipIdError(null);
                        }}
                        disabled={membershipIdSubmitting}
                        style={{
                          flex: 1,
                          padding: '0.6rem',
                          background: membershipIdMode === 'ENTER_NEW' ? '#3b82f6' : 'transparent',
                          color: membershipIdMode === 'ENTER_NEW' ? 'white' : '#cbd5e1',
                          border: '1px solid #475569',
                          borderRadius: '6px',
                          fontWeight: 700,
                          cursor: membershipIdSubmitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Enter New ID
                      </button>
                    </div>

                    {membershipIdMode === 'KEEP_EXISTING' && (
                      <div
                        style={{
                          padding: '0.75rem',
                          background: '#0f172a',
                          border: '1px solid #475569',
                          borderRadius: '6px',
                          color: 'white',
                          fontSize: '1.25rem',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {membershipNumber}
                      </div>
                    )}
                  </div>
                ) : null}

                {(membershipPurchaseIntent !== 'RENEW' ||
                  !membershipNumber ||
                  membershipIdMode === 'ENTER_NEW') && (
                  <input
                    type="text"
                    value={membershipIdInput}
                    autoFocus
                    onChange={(e) => setMembershipIdInput(e.target.value)}
                    onKeyDown={(e) => {
                      // Allow scanner wedge input (keyboard) and Enter-to-submit; prevent bubbling to global handlers.
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCompleteMembershipPurchase();
                      }
                    }}
                    placeholder="Membership ID"
                    disabled={membershipIdSubmitting}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '1.25rem',
                      letterSpacing: '0.04em',
                      marginBottom: '0.75rem',
                    }}
                  />
                )}

                {membershipIdError && (
                  <div style={{ color: '#fecaca', marginBottom: '0.75rem' }}>{membershipIdError}</div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() =>
                      void handleCompleteMembershipPurchase(
                        membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                          ? membershipNumber
                          : undefined
                      )
                    }
                    disabled={
                      membershipIdSubmitting ||
                      (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                        ? !membershipNumber
                        : !membershipIdInput.trim())
                    }
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background:
                        (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                          ? membershipNumber
                          : membershipIdInput.trim())
                          ? '#3b82f6'
                          : '#475569',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 700,
                      cursor:
                        membershipIdSubmitting ||
                        (membershipIdMode === 'KEEP_EXISTING' && membershipPurchaseIntent === 'RENEW'
                          ? !membershipNumber
                          : !membershipIdInput.trim())
                          ? 'not-allowed'
                          : 'pointer',
                    }}
                  >
                    {membershipIdSubmitting ? 'Saving…' : 'Save Membership'}
                  </button>
                  <button
                    onClick={() => {
                      setShowMembershipIdPrompt(false);
                      setMembershipIdError(null);
                    }}
                    disabled={membershipIdSubmitting}
                    style={{
                      padding: '0.75rem 1rem',
                      background: 'transparent',
                      color: '#94a3b8',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: membershipIdSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Manager Bypass Modal */}
          {showManagerBypassModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '500px',
                  width: '90%',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
                  Manager Bypass
                </h2>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    Select Manager
                  </label>
                  <select
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '1rem',
                    }}
                  >
                    <option value="">Select a manager...</option>
                    {managerList.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    PIN
                  </label>
                  <input
                    type="password"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit PIN"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#0f172a',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '1rem',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => void handleManagerBypass()}
                    disabled={isSubmitting || !managerId || managerPin.trim().length !== 6}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background:
                        managerId && managerPin.trim().length === 6 ? '#3b82f6' : '#475569',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor:
                        managerId && managerPin.trim().length === 6 && !isSubmitting
                          ? 'pointer'
                          : 'not-allowed',
                    }}
                  >
                    {isSubmitting ? 'Processing...' : 'Bypass'}
                  </button>
                  <button
                    onClick={() => {
                      setShowManagerBypassModal(false);
                      setManagerId('');
                      setManagerPin('');
                    }}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: 'transparent',
                      color: '#94a3b8',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Note Modal */}
          {showAddNoteModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
              }}
            >
              <div
                style={{
                  background: '#1e293b',
                  padding: '2rem',
                  borderRadius: '12px',
                  maxWidth: '500px',
                  width: '90%',
                }}
              >
                <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 600 }}>
                  Add Note
                </h2>
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="Enter note..."
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#0f172a',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '1rem',
                    marginBottom: '1rem',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => void handleAddNote()}
                    disabled={isSubmitting || !newNoteText.trim()}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: newNoteText.trim() ? '#3b82f6' : '#475569',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: newNoteText.trim() && !isSubmitting ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Note'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddNoteModal(false);
                      setNewNoteText('');
                    }}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: 'transparent',
                      color: '#94a3b8',
                      border: '1px solid #475569',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Payment Decline Error (dismissible) */}
          {paymentDeclineError && (
            <div
              style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
                background: '#ef4444',
                color: 'white',
                padding: '1rem',
                borderRadius: '8px',
                zIndex: 2000,
                maxWidth: '400px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'start',
                  marginBottom: '0.5rem',
                }}
              >
                <div style={{ fontWeight: 600 }}>Payment Declined</div>
                <button
                  onClick={() => setPaymentDeclineError(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'white',
                    fontSize: '1.25rem',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: '1rem',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ fontSize: '0.875rem' }}>{paymentDeclineError}</div>
            </div>
          )}

          {/* Agreement + Assignment Display */}
          {currentSessionId && customerName && (agreementSigned || assignedResourceType) && (
            <div
              style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                background: '#1e293b',
                borderTop: '2px solid #3b82f6',
                padding: '1.5rem',
                zIndex: 100,
              }}
            >
              {!agreementSigned && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '1rem',
                    background: '#0f172a',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>
                    Agreement Pending
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                    Waiting for customer to sign the agreement on their device.
                  </div>
                </div>
              )}
              {assignedResourceType && assignedResourceNumber && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '1rem',
                    background: '#0f172a',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>
                    Assigned: {assignedResourceType === 'room' ? 'Room' : 'Locker'}{' '}
                    {assignedResourceNumber}
                  </div>
                  {checkoutAt && (
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                      Checkout: {new Date(checkoutAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              {agreementSigned && assignedResourceType && (
                <button
                  onClick={() => void handleCompleteTransaction()}
                  disabled={isSubmitting}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Processing...' : 'Complete Transaction'}
                </button>
              )}
            </div>
          )}

          {/* Pay-First Demo Buttons (after selection confirmed) */}
          {currentSessionId &&
            customerName &&
            selectionConfirmed &&
            paymentQuote &&
            paymentStatus === 'DUE' &&
            !pastDueBlocked && (
              <div
                style={{
                  position: 'fixed',
                  bottom: assignedResourceType ? '200px' : '0',
                  left: 0,
                  right: 0,
                  background: '#1e293b',
                  borderTop: '2px solid #3b82f6',
                  padding: '1.5rem',
                  zIndex: 100,
                }}
              >
                <div style={{ marginBottom: '1rem', fontWeight: 600, fontSize: '1.125rem' }}>
                  Total: ${paymentQuote.total.toFixed(2)}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => void handleDemoPayment('CREDIT_SUCCESS')}
                    disabled={isSubmitting}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Credit Success
                  </button>
                  <button
                    onClick={() => void handleDemoPayment('CASH_SUCCESS')}
                    disabled={isSubmitting}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cash Success
                  </button>
                  <button
                    onClick={() => void handleDemoPayment('CREDIT_DECLINE', 'Card declined')}
                    disabled={isSubmitting}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '1rem',
                      fontWeight: 600,
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Credit Decline
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </RegisterSignIn>
  );
}

export default App;
