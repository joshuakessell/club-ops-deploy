import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
import { safeJsonParse, useReconnectingWebSocket, isRecord, getErrorMessage, readJson } from '@club-ops/ui';
import { RegisterSignIn } from '../RegisterSignIn';
import type { IdScanPayload } from '@club-ops/shared';
import { ScanMode, type ScanModeResult } from '../ScanMode';
import { debounce } from '../utils/debounce';
import { OfferUpgradeModal } from '../components/OfferUpgradeModal';
import { CheckoutRequestsBanner } from '../components/register/CheckoutRequestsBanner';
import { CheckoutVerificationModal } from '../components/register/CheckoutVerificationModal';
import { RegisterHeader } from '../components/register/RegisterHeader';
import { RegisterTopActionsBar } from '../components/register/RegisterTopActionsBar';
import { useEmployeeRegisterTabletUiTweaks } from '../hooks/useEmployeeRegisterTabletUiTweaks';
import { MeasuredHalfWidthSearchInput } from '../components/register/MeasuredHalfWidthSearchInput';
import { RequiredTenderOutcomeModal } from '../components/register/modals/RequiredTenderOutcomeModal';
import { WaitlistNoticeModal } from '../components/register/modals/WaitlistNoticeModal';
import {
  AlreadyCheckedInModal,
  type ActiveCheckinDetails,
} from '../components/register/modals/AlreadyCheckedInModal';
import { CustomerConfirmationPendingModal } from '../components/register/modals/CustomerConfirmationPendingModal';
import { PastDuePaymentModal } from '../components/register/modals/PastDuePaymentModal';
import { ManagerBypassModal } from '../components/register/modals/ManagerBypassModal';
import { UpgradePaymentModal } from '../components/register/modals/UpgradePaymentModal';
import { AddNoteModal } from '../components/register/modals/AddNoteModal';
import { MembershipIdPromptModal } from '../components/register/modals/MembershipIdPromptModal';
import { ModalFrame } from '../components/register/modals/ModalFrame';
import {
  MultipleMatchesModal,
  type MultipleMatchCandidate,
} from '../components/register/modals/MultipleMatchesModal';
import { PaymentDeclineToast } from '../components/register/toasts/PaymentDeclineToast';
import { RegisterSideDrawers } from '../components/drawers/RegisterSideDrawers';
import { UpgradesDrawerContent } from '../components/upgrades/UpgradesDrawerContent';
import { InventoryDrawer, type InventoryDrawerSection } from '../components/inventory/InventoryDrawer';
import { InventorySummaryBar } from '../components/inventory/InventorySummaryBar';
import { useRegisterTopActionsOverlays } from '../components/register/useRegisterTopActionsOverlays';
import { usePassiveScannerInput } from '../usePassiveScannerInput';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

type SessionDocument = {
  id: string;
  doc_type: string;
  mime_type: string;
  created_at: string;
  has_signature: boolean;
  signature_hash_prefix?: string;
  has_pdf?: boolean;
};

const API_BASE = '/api';

interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
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

export function AppRoot() {
  // Tablet usability tweaks (Employee Register ONLY): measure baseline typography before applying CSS bumps.
  useEmployeeRegisterTabletUiTweaks();
  const tryOpenAlreadyCheckedInModal = (payload: unknown, customerLabel?: string | null): boolean => {
    if (!isRecord(payload)) return false;
    if (payload['code'] !== 'ALREADY_CHECKED_IN') return false;
    const ac = payload['activeCheckin'];
    if (!isRecord(ac)) return false;

    const visitId = ac['visitId'];
    if (typeof visitId !== 'string') return false;

    const rentalTypeRaw = ac['rentalType'];
    const rentalType = typeof rentalTypeRaw === 'string' ? rentalTypeRaw : null;

    const assignedResourceTypeRaw = ac['assignedResourceType'];
    const assignedResourceType =
      assignedResourceTypeRaw === 'room' || assignedResourceTypeRaw === 'locker'
        ? assignedResourceTypeRaw
        : null;

    const assignedResourceNumberRaw = ac['assignedResourceNumber'];
    const assignedResourceNumber =
      typeof assignedResourceNumberRaw === 'string' ? assignedResourceNumberRaw : null;

    const checkinAtRaw = ac['checkinAt'];
    const checkinAt = typeof checkinAtRaw === 'string' ? checkinAtRaw : null;

    const checkoutAtRaw = ac['checkoutAt'];
    const checkoutAt = typeof checkoutAtRaw === 'string' ? checkoutAtRaw : null;

    const overdueRaw = ac['overdue'];
    const overdue = typeof overdueRaw === 'boolean' ? overdueRaw : null;

    const wlRaw = ac['waitlist'];
    let waitlist: ActiveCheckinDetails['waitlist'] = null;
    if (isRecord(wlRaw)) {
      const id = wlRaw['id'];
      const desiredTier = wlRaw['desiredTier'];
      const backupTier = wlRaw['backupTier'];
      const status = wlRaw['status'];
      if (
        typeof id === 'string' &&
        typeof desiredTier === 'string' &&
        typeof backupTier === 'string' &&
        typeof status === 'string'
      ) {
        waitlist = { id, desiredTier, backupTier, status };
      }
    }

    setAlreadyCheckedIn({
      customerLabel: customerLabel || null,
      activeCheckin: {
        visitId,
        rentalType,
        assignedResourceType,
        assignedResourceNumber,
        checkinAt,
        checkoutAt,
        overdue,
        waitlist,
      },
    });
    return true;
  };

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
  const [isUpgradesDrawerOpen, setIsUpgradesDrawerOpen] = useState(false);
  const [isInventoryDrawerOpen, setIsInventoryDrawerOpen] = useState(false);
  const [inventoryForcedSection, setInventoryForcedSection] = useState<InventoryDrawerSection>(null);
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
      idNumber?: string;
      issuer?: string;
      jurisdiction?: string;
    };
    candidates: MultipleMatchCandidate[];
  }>(null);
  const [scanResolutionError, setScanResolutionError] = useState<string | null>(null);
  const [scanResolutionSubmitting, setScanResolutionSubmitting] = useState(false);
  const [scanToastMessage, setScanToastMessage] = useState<string | null>(null);
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
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState<null | {
    customerLabel: string | null;
    activeCheckin: ActiveCheckinDetails;
  }>(null);
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

  // Agreement/PDF verification (staff-only)
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsForSession, setDocumentsForSession] = useState<SessionDocument[] | null>(null);

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
  const [pastDueBalance, setPastDueBalance] = useState<number>(0);
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
      roomId?: string | null;
      offeredRoomNumber?: string | null;
      displayIdentifier: string;
      currentRentalType: string;
      customerName?: string;
    }>
  >([]);
  const [inventoryAvailable, setInventoryAvailable] = useState<null | {
    rooms: Record<string, number>;
    rawRooms: Record<string, number>;
    waitlistDemand: Record<string, number>;
    lockers: number;
  }>(null);
  const [selectedWaitlistEntry, setSelectedWaitlistEntry] = useState<string | null>(null);
  const [upgradePaymentIntentId, setUpgradePaymentIntentId] = useState<string | null>(null);
  const [upgradeFee, setUpgradeFee] = useState<number | null>(null);
  const [upgradePaymentStatus, setUpgradePaymentStatus] = useState<'DUE' | 'PAID' | null>(null);
  const [upgradeOriginalCharges, setUpgradeOriginalCharges] = useState<
    Array<{ description: string; amount: number }>
  >([]);
  const [upgradeOriginalTotal, setUpgradeOriginalTotal] = useState<number | null>(null);
  const [showUpgradePaymentModal, setShowUpgradePaymentModal] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<{
    waitlistId: string;
    customerLabel: string;
    offeredRoomNumber?: string | null;
    newRoomNumber?: string | null;
  } | null>(null);
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

  const handleCloseOut = async () => {
    const confirmed = window.confirm('Close Out: this will sign you out of the register. Continue?');
    if (!confirmed) return;
    await handleLogout();
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
      setAlreadyCheckedIn(null);
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

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (
          response.status === 409 &&
          tryOpenAlreadyCheckedInModal(payload, selectedCustomerLabel || selectedCustomerId)
        ) {
          return;
        }
        throw new Error(getErrorMessage(payload) || 'Failed to start session');
      }

      const data = payload as {
        sessionId?: string;
        customerName?: string;
        membershipNumber?: string;
        mode?: 'INITIAL' | 'RENEWAL';
        blockEndsAt?: string;
        activeAssignedResourceType?: 'room' | 'locker';
        activeAssignedResourceNumber?: string;
      };
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
        if (data.activeAssignedResourceType) setAssignedResourceType(data.activeAssignedResourceType);
        if (data.activeAssignedResourceNumber) setAssignedResourceNumber(data.activeAssignedResourceNumber);
        setCheckoutAt(data.blockEndsAt);
      }

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
      setAlreadyCheckedIn(null);
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
        if (response.status === 409 && tryOpenAlreadyCheckedInModal(errorPayload, customerName || null)) {
          return { outcome: 'matched' };
        }
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
        mode?: 'INITIAL' | 'RENEWAL';
        blockEndsAt?: string;
        activeAssignedResourceType?: 'room' | 'locker';
        activeAssignedResourceNumber?: string;
      }>(response);
      console.log('ID scanned, session updated:', data);

      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
        if (data.activeAssignedResourceType) setAssignedResourceType(data.activeAssignedResourceType);
        if (data.activeAssignedResourceNumber) setAssignedResourceNumber(data.activeAssignedResourceNumber);
        setCheckoutAt(data.blockEndsAt);
      }

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
      setAlreadyCheckedIn(null);
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
        if (response.status === 409 && tryOpenAlreadyCheckedInModal(errorPayload, idScanValue)) {
          return { outcome: 'matched' };
        }
        const msg = getErrorMessage(errorPayload) || 'Failed to start session';
        if (!opts?.suppressAlerts) alert(msg);
        return { outcome: 'error', message: msg };
      }

      const data = await readJson<{
        customerName?: string;
        membershipNumber?: string;
        sessionId?: string;
        mode?: 'INITIAL' | 'RENEWAL';
        blockEndsAt?: string;
        activeAssignedResourceType?: 'room' | 'locker';
        activeAssignedResourceNumber?: string;
      }>(response);
      console.log('Session started:', data);

      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
        if (data.activeAssignedResourceType) setAssignedResourceType(data.activeAssignedResourceType);
        if (data.activeAssignedResourceNumber) setAssignedResourceNumber(data.activeAssignedResourceNumber);
        setCheckoutAt(data.blockEndsAt);
      }

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
      setAlreadyCheckedIn(null);
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
        if (response.status === 409 && tryOpenAlreadyCheckedInModal(errorPayload, null)) {
          return { outcome: 'matched' };
        }
        const msg = getErrorMessage(errorPayload) || 'Failed to start session';
        if (!opts?.suppressAlerts) alert(msg);
        return { outcome: 'error', message: msg };
      }

      const data = await readJson<{
        sessionId?: string;
        customerName?: string;
        membershipNumber?: string;
        mode?: 'INITIAL' | 'RENEWAL';
        blockEndsAt?: string;
        activeAssignedResourceType?: 'room' | 'locker';
        activeAssignedResourceNumber?: string;
      }>(response);

      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
        if (data.activeAssignedResourceType) setAssignedResourceType(data.activeAssignedResourceType);
        if (data.activeAssignedResourceNumber) setAssignedResourceNumber(data.activeAssignedResourceNumber);
        setCheckoutAt(data.blockEndsAt);
      }

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
        result: 'MATCHED' | 'NO_MATCH' | 'MULTIPLE_MATCHES' | 'ERROR';
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
        return { outcome: 'error', message: data.error?.message || 'Scan failed' };
      }

      if (data.result === 'MATCHED' && data.customer?.id) {
        setPendingCreateFromScan(null);
        setShowCreateFromScanPrompt(false);
        setCreateFromScanError(null);
        setPendingScanResolution(null);
        setScanResolutionError(null);
        // Open customer record (start lane session) using the resolved customerId.
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
            idNumber: extracted.idNumber,
            issuer: extracted.issuer,
            jurisdiction: extracted.jurisdiction,
          },
          candidates: (data.candidates || []).slice(0, 10),
        });
        // Close ScanMode overlay (if open) so the employee can select the correct customer.
        return { outcome: 'matched' };
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

  const blockingModalOpen =
    !!pendingScanResolution ||
    showCreateFromScanPrompt ||
    !!alreadyCheckedIn ||
    showPastDueModal ||
    showManagerBypassModal ||
    showMembershipIdPrompt ||
    showUpgradePaymentModal ||
    showAddNoteModal ||
    documentsModalOpen ||
    !!offerUpgradeModal ||
    (showWaitlistModal && !!waitlistDesiredTier && !!waitlistBackupType) ||
    (showCustomerConfirmationPending && !!customerConfirmationType) ||
    !!selectedCheckoutRequest;

  const passiveScanEnabled =
    !!session?.sessionToken && !scanModeOpen && !isSubmitting && !manualEntry && !blockingModalOpen;

  const handlePassiveCapture = useCallback(
    (rawScanText: string) => {
      void (async () => {
        setScanToastMessage(null);
        const result = await onBarcodeCaptured(rawScanText);
        if (result.outcome === 'no_match') {
          if (result.canCreate) {
            setCreateFromScanError(null);
            setShowCreateFromScanPrompt(true);
          } else {
            setScanToastMessage(result.message);
          }
          return;
        }
        if (result.outcome === 'error') {
          setScanToastMessage(result.message);
        }
      })();
    },
    [onBarcodeCaptured]
  );

  usePassiveScannerInput({
    enabled: passiveScanEnabled,
    onCapture: ({ raw }) => handlePassiveCapture(raw),
  });

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

      // De-dupe by id defensively (a record should not appear in both ACTIVE and OFFERED, but
      // during transitions or partial server failures it could). Prefer OFFERED over ACTIVE.
      const statusPriority = (status: string): number =>
        status === 'OFFERED' ? 2 : status === 'ACTIVE' ? 1 : 0;

      const byId = new Map<string, (typeof waitlistEntries)[number]>();
      for (const entry of allEntries) {
        const existing = byId.get(entry.id);
        if (!existing) {
          byId.set(entry.id, entry);
          continue;
        }
        if (statusPriority(entry.status) >= statusPriority(existing.status)) {
          byId.set(entry.id, entry);
        }
      }

      const deduped = Array.from(byId.values());

      // Oldest first (createdAt ascending)
      deduped.sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return at - bt;
      });

      setWaitlistEntries(deduped);
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
        const lockersRaw = data['lockers'];
        const lockers =
          typeof lockersRaw === 'number'
            ? lockersRaw
            : typeof lockersRaw === 'string'
              ? Number(lockersRaw)
              : 0;
        setInventoryAvailable({
          rooms: data.rooms as Record<string, number>,
          rawRooms: data.rawRooms as Record<string, number>,
          waitlistDemand: data.waitlistDemand as Record<string, number>,
          lockers: Number.isFinite(lockers) ? lockers : 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch inventory available:', error);
    }
  };

  const fetchDocumentsBySession = useCallback(
    async (laneSessionId: string) => {
      if (!session?.sessionToken) return;
      setDocumentsLoading(true);
      setDocumentsError(null);
      try {
        const res = await fetch(`${API_BASE}/v1/documents/by-session/${laneSessionId}`, {
          headers: { Authorization: `Bearer ${session.sessionToken}` },
        });
        if (!res.ok) {
          const errPayload: unknown = await res.json().catch(() => null);
          throw new Error(getErrorMessage(errPayload) || 'Failed to load documents');
        }
        const data = (await res.json()) as { documents?: SessionDocument[] };
        setDocumentsForSession(Array.isArray(data.documents) ? data.documents : []);
      } catch (e) {
        setDocumentsForSession(null);
        setDocumentsError(e instanceof Error ? e.message : 'Failed to load documents');
      } finally {
        setDocumentsLoading(false);
      }
    },
    [session?.sessionToken]
  );

  const downloadAgreementPdf = useCallback(
    async (documentId: string) => {
      if (!session?.sessionToken) return;
      const res = await fetch(`${API_BASE}/v1/documents/${documentId}/download`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      if (!res.ok) {
        const errPayload: unknown = await res.json().catch(() => null);
        throw new Error(getErrorMessage(errPayload) || 'Failed to download PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [session?.sessionToken]
  );

  fetchWaitlistRef.current = fetchWaitlist;
  fetchInventoryAvailableRef.current = fetchInventoryAvailable;

  // Fetch waitlist on mount and when session is available
  useEffect(() => {
    if (session?.sessionToken) {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }
  }, [session?.sessionToken]);

  // 60s polling fallback for waitlist + availability (WebSocket is primary)
  useEffect(() => {
    if (!session?.sessionToken) return;
    const interval = window.setInterval(() => {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [session?.sessionToken]);

  const sessionActive = !!currentSessionId;

  const offeredCountByTier = waitlistEntries.reduce<Record<string, number>>((acc, e) => {
    if (e.status === 'OFFERED') {
      acc[e.desiredTier] = (acc[e.desiredTier] || 0) + 1;
    }
    return acc;
  }, {});

  const isEntryOfferEligible = (entry: (typeof waitlistEntries)[number]): boolean => {
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
  const prevSessionActiveRef = useRef<boolean>(false);
  const pulseCandidateRef = useRef<boolean>(false);

  const dismissUpgradePulse = () => {
    pulseCandidateRef.current = false;
    setShowUpgradePulse(false);
  };

  const resetUpgradeState = () => {
    setUpgradePaymentIntentId(null);
    setUpgradeFee(null);
    setUpgradePaymentStatus(null);
    setUpgradeOriginalCharges([]);
    setUpgradeOriginalTotal(null);
    setShowUpgradePaymentModal(false);
    setUpgradeContext(null);
  };

  const openOfferUpgradeModal = (entry: (typeof waitlistEntries)[number]) => {
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

  const handleStartUpgradePayment = async (entry: (typeof waitlistEntries)[number]) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }
    if (!entry.roomId) {
      alert('No reserved room found for this offer. Refresh and retry.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/upgrades/fulfill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId: entry.id,
          roomId: entry.roomId,
          acknowledgedDisclaimer: true,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to start upgrade');
      }

      const payload = await readJson<{
        paymentIntentId?: string;
        upgradeFee?: number;
        originalCharges?: Array<{ description: string; amount: number }>;
        originalTotal?: number | null;
        newRoomNumber?: string | null;
      }>(response);

      setSelectedWaitlistEntry(entry.id);
      const intentId = payload.paymentIntentId ?? null;
      setUpgradePaymentIntentId(intentId);
      setUpgradeFee(
        typeof payload.upgradeFee === 'number' && Number.isFinite(payload.upgradeFee)
          ? payload.upgradeFee
          : null
      );
      setUpgradePaymentStatus(intentId ? 'DUE' : null);
      setUpgradeOriginalCharges(payload.originalCharges || []);
      setUpgradeOriginalTotal(
        typeof payload.originalTotal === 'number' && Number.isFinite(payload.originalTotal)
          ? payload.originalTotal
          : null
      );
      setUpgradeContext({
        waitlistId: entry.id,
        customerLabel: entry.customerName || entry.displayIdentifier,
        offeredRoomNumber: entry.offeredRoomNumber,
        newRoomNumber: payload.newRoomNumber ?? entry.offeredRoomNumber ?? null,
      });
      dismissUpgradePulse();
      setIsUpgradesDrawerOpen(true);
      setShowUpgradePaymentModal(true);
    } catch (error) {
      console.error('Failed to start upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to start upgrade');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openUpgradePaymentQuote = (entry: (typeof waitlistEntries)[number]) => {
    setSelectedWaitlistEntry(entry.id);
    setUpgradeContext((prev) => ({
      waitlistId: entry.id,
      customerLabel: entry.customerName || entry.displayIdentifier,
      offeredRoomNumber: entry.offeredRoomNumber,
      newRoomNumber: prev?.newRoomNumber ?? entry.offeredRoomNumber ?? null,
    }));
    setShowUpgradePaymentModal(true);
  };

  const handleUpgradePaymentDecline = (reason?: string) => {
    setPaymentDeclineError(reason || 'Payment declined');
    setUpgradePaymentStatus('DUE');
  };

  const handleUpgradePaymentFlow = async (method: 'CREDIT' | 'CASH') => {
    if (!upgradePaymentIntentId || !session?.sessionToken || !upgradeContext) {
      alert('No upgrade payment intent available.');
      return;
    }

    setIsSubmitting(true);
    try {
      const markPaidResponse = await fetch(`${API_BASE}/v1/payments/${upgradePaymentIntentId}/mark-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          squareTransactionId: method === 'CASH' ? 'demo-cash-success' : 'demo-credit-success',
        }),
      });

      if (!markPaidResponse.ok) {
        const errorPayload: unknown = await markPaidResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to mark upgrade payment as paid');
      }

      setUpgradePaymentStatus('PAID');

      const completeResponse = await fetch(`${API_BASE}/v1/upgrades/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId: upgradeContext.waitlistId,
          paymentIntentId: upgradePaymentIntentId,
        }),
      });

      if (!completeResponse.ok) {
        const errorPayload: unknown = await completeResponse.json().catch(() => null);
        if (isRecord(errorPayload) && errorPayload.code === 'REAUTH_REQUIRED') {
          alert('Re-authentication required. Please log in again.');
          await handleLogout();
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to complete upgrade');
      }

      resetUpgradeState();
      setSelectedWaitlistEntry(null);
      setShowUpgradePaymentModal(false);
      await fetchWaitlistRef.current?.();
      await fetchInventoryAvailableRef.current?.();
      dismissUpgradePulse();
    } catch (error) {
      console.error('Failed to process upgrade payment:', error);
      alert(error instanceof Error ? error.message : 'Failed to process upgrade payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    // Check API health (avoid JSON parse crashes on empty/non-JSON responses)
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await readJson<unknown>(res);
        if (
          !cancelled &&
          isRecord(data) &&
          typeof data.status === 'string' &&
          typeof data.timestamp === 'string' &&
          typeof data.uptime === 'number'
        ) {
          setHealth({ status: data.status, timestamp: data.timestamp, uptime: data.uptime });
        }
      } catch (err) {
        console.error('Health check failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
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
          // Waitlist intent (customer requested unavailable tier + backup choice)
          if (payload.waitlistDesiredType !== undefined) {
            setWaitlistDesiredTier(payload.waitlistDesiredType || null);
          }
          if (payload.backupRentalType !== undefined) {
            setWaitlistBackupType(payload.backupRentalType || null);
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
            if (payload.pastDueBalance !== undefined) {
              setPastDueBalance(payload.pastDueBalance || 0);
            }
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
            setWaitlistDesiredTier(null);
            setWaitlistBackupType(null);
            setShowWaitlistModal(false);
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

  const pastDueLineItems = useMemo(() => {
    const items: Array<{ description: string; amount: number }> = [];
    const notes = customerNotes || '';
    for (const line of notes.split('\n')) {
      const m = line.match(
        /^\[SYSTEM_LATE_FEE_PENDING\]\s+Late fee\s+\(\$(\d+(?:\.\d{2})?)\):\s+customer was\s+(.+)\s+late on last visit on\s+(\d{4}-\d{2}-\d{2})\./
      );
      if (!m) continue;
      const amount = Number.parseFloat(m[1]!);
      const dur = m[2]!.trim();
      const date = m[3]!;
      if (!Number.isFinite(amount)) continue;
      items.push({
        description: `Late fee (last visit ${date}, ${dur} late)`,
        amount,
      });
    }

    if (items.length === 0 && pastDueBalance > 0) {
      items.push({ description: 'Past due balance', amount: pastDueBalance });
    }

    return items;
  }, [customerNotes, pastDueBalance]);

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

  const topActions = useRegisterTopActionsOverlays({
    sessionToken: session?.sessionToken ?? null,
    staffId: session?.staffId ?? null,
  });

  return (
    <RegisterSignIn deviceId={deviceId} onSignedIn={handleRegisterSignIn}>
      {!registerSession ? (
        <div />
      ) : !session ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>Loading...</div>
      ) : (
        <div className="container" style={{ marginTop: '60px', padding: '1.5rem' }}>
          <RegisterSideDrawers
            upgradesOpen={isUpgradesDrawerOpen}
            onUpgradesOpenChange={(next) => {
              if (next) dismissUpgradePulse();
              setIsUpgradesDrawerOpen(next);
            }}
            inventoryOpen={isInventoryDrawerOpen}
            onInventoryOpenChange={setIsInventoryDrawerOpen}
            upgradesAttention={showUpgradePulse && hasEligibleEntries}
            upgradesContent={
              <UpgradesDrawerContent
                waitlistEntries={waitlistEntries}
                hasEligibleEntries={hasEligibleEntries}
                isEntryOfferEligible={(entryId, status, desiredTier) => {
                  const entry = waitlistEntries.find((e) => e.id === entryId);
                  if (!entry) return false;
                  if (entry.status !== status) return false;
                  if (entry.desiredTier !== desiredTier) return false;
                  return isEntryOfferEligible(entry);
                }}
                onOffer={(entryId) => {
                  const entry = waitlistEntries.find((e) => e.id === entryId);
                  if (!entry) return;
                  openOfferUpgradeModal(entry);
                  setIsUpgradesDrawerOpen(true);
                }}
                onStartPayment={(entry) => {
                  resetUpgradeState();
                  setSelectedWaitlistEntry(entry.id);
                  void handleStartUpgradePayment(entry);
                }}
                onOpenPaymentQuote={(entry) => openUpgradePaymentQuote(entry)}
                onCancelOffer={(entryId) => {
                  // Cancellation endpoint not yet implemented in this demo UI.
                  alert(`Cancel offer not implemented yet (waitlistId=${entryId}).`);
                }}
                isSubmitting={isSubmitting}
              />
            }
            inventoryContent={
              <InventoryDrawer
                lane={lane}
                sessionToken={session.sessionToken}
                forcedExpandedSection={inventoryForcedSection}
                onExpandedSectionChange={setInventoryForcedSection}
                customerSelectedType={customerSelectedType}
                waitlistDesiredTier={waitlistDesiredTier}
                waitlistBackupType={waitlistBackupType}
                onSelect={handleInventorySelect}
                onClearSelection={() => setSelectedInventoryItem(null)}
                selectedItem={selectedInventoryItem}
                sessionId={currentSessionId}
                disableSelection={false}
              />
            }
          />

          {/* Checkout Request Notifications */}
          {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
            <CheckoutRequestsBanner
              requests={Array.from(checkoutRequests.values())}
              onClaim={(id) => void handleClaimCheckout(id)}
            />
          )}

          {/* Checkout Verification Screen */}
          {selectedCheckoutRequest &&
            (() => {
              const request = checkoutRequests.get(selectedCheckoutRequest);
              if (!request) return null;
              return (
                <CheckoutVerificationModal
                  request={request}
                  isSubmitting={isSubmitting}
                  checkoutItemsConfirmed={checkoutItemsConfirmed}
                  checkoutFeePaid={checkoutFeePaid}
                  onConfirmItems={() => void handleConfirmItems(selectedCheckoutRequest)}
                  onMarkFeePaid={() => void handleMarkFeePaid(selectedCheckoutRequest)}
                  onComplete={() => void handleCompleteCheckout(selectedCheckoutRequest)}
                  onCancel={() => {
                    setSelectedCheckoutRequest(null);
                    setCheckoutChecklist({});
                    setCheckoutItemsConfirmed(false);
                    setCheckoutFeePaid(false);
                  }}
                />
              );
            })()}

          <RegisterHeader
            health={health}
            wsConnected={wsConnected}
            lane={lane}
            staffName={session.name}
            staffRole={session.role}
            onSignOut={() => void handleLogout()}
            onCloseOut={() => void handleCloseOut()}
          />

          <RegisterTopActionsBar
            onCheckout={topActions.openCheckout}
            onRoomCleaning={topActions.openRoomCleaning}
          />

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
                  {pastDueBalance > 0 && (
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
                          color: pastDueBalance > 0 ? '#f59e0b' : 'inherit',
                        }}
                      >
                        ${pastDueBalance.toFixed(2)}
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
                    className="cs-liquid-button cs-liquid-button--secondary"
                    style={{
                      padding: '0.5rem 1rem',
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
                    className="cs-liquid-button"
                    disabled={isSubmitting}
                    style={{
                      padding: '0.5rem 1rem',
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
                    className="cs-liquid-button"
                    disabled={isSubmitting}
                    style={{
                      padding: '0.5rem 1rem',
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
                    className={[
                      'cs-liquid-button',
                      'cs-liquid-button--secondary',
                      proposedRentalType === rental ? 'cs-liquid-button--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      padding: '0.5rem 1rem',
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
              <InventorySummaryBar
                counts={inventoryAvailable}
                onOpenInventorySection={(section) => {
                  setInventoryForcedSection(section);
                  setIsInventoryDrawerOpen(true);
                }}
              />
            )}

            {/* Assignment Bar */}
            {selectedInventoryItem && (
              <div
                className="cs-liquid-card"
                style={{
                  position: 'sticky',
                  bottom: 0,
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
                      className="cs-liquid-button"
                      disabled={
                        isSubmitting ||
                        showCustomerConfirmationPending ||
                        !agreementSigned ||
                        paymentStatus !== 'PAID'
                      }
                      style={{
                        padding: '0.75rem 1.5rem',
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
                        className="cs-liquid-button cs-liquid-button--danger"
                        disabled={isSubmitting}
                        style={{
                          padding: '0.75rem 1.5rem',
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
                        className="cs-liquid-button cs-liquid-button--secondary"
                        disabled={isSubmitting}
                        style={{
                          padding: '0.75rem 1.5rem',
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
                    className="cs-liquid-card"
                    style={{
                      padding: '1rem',
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
                      className={[
                        'cs-liquid-button',
                        paymentStatus === 'PAID' ? 'cs-liquid-button--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        fontSize: '1rem',
                        fontWeight: 600,
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

              {/* Customer lookup (typeahead) */}
              <div
                className="typeahead-section cs-liquid-card"
                style={{
                  marginTop: 0,
                  marginBottom: '1rem',
                  padding: '1rem',
                }}
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
                  <label htmlFor="customer-search" style={{ fontWeight: 600 }}>
                    Search Customer
                  </label>
                  <span className="er-search-help" style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                    (type at least 3 letters)
                  </span>
                </div>
                <MeasuredHalfWidthSearchInput
                  id="customer-search"
                  value={customerSearch}
                  onChange={(next) => setCustomerSearch(next)}
                  placeholder="Start typing name..."
                  disabled={isSubmitting}
                />
                {customerSearchLoading && (
                  <div style={{ marginTop: '0.25rem', color: '#94a3b8', fontSize: '0.875rem' }}>
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
                  className="cs-liquid-button"
                  style={{
                    marginTop: '0.75rem',
                    width: '100%',
                    padding: '0.65rem',
                    fontWeight: 600,
                    opacity: !selectedCustomerId || isSubmitting ? 0.7 : 1,
                  }}
                >
                  {selectedCustomerLabel ? `Confirm ${selectedCustomerLabel}` : 'Confirm'}
                </button>
              </div>

              <div className="action-buttons">
                <button
                  className={`action-btn cs-liquid-button ${scanModeOpen ? 'cs-liquid-button--selected active' : ''}`}
                  onClick={() => {
                    setManualEntry(false);
                    setScanModeOpen(true);
                  }}
                >
                  <span className="btn-icon">📡</span>
                  Scan
                </button>
                <button
                  className={`action-btn cs-liquid-button cs-liquid-button--secondary ${manualEntry ? 'cs-liquid-button--selected active' : ''}`}
                  onClick={() => {
                    setManualEntry(!manualEntry);
                  }}
                >
                  <span className="btn-icon">✏️</span>
                  First Time Customer
                </button>
                <button
                  className="action-btn cs-liquid-button cs-liquid-button--danger"
                  onClick={() => void handleClearSession()}
                  disabled={isSubmitting}
                >
                  <span className="btn-icon">🗑️</span>
                  Clear Session
                </button>
              </div>

              {manualEntry && (
                <form
                  className="manual-entry-form cs-liquid-card"
                  onSubmit={(e) => void handleManualSubmit(e)}
                >
                  <div className="form-group">
                    <label htmlFor="customerName">Customer Name *</label>
                    <input
                      id="customerName"
                      type="text"
                      className="cs-liquid-input"
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
                      className="cs-liquid-input"
                      value={membershipNumber}
                      onChange={(e) => setMembershipNumber(e.target.value)}
                      placeholder="Enter membership number"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="submit-btn cs-liquid-button"
                      disabled={isSubmitting || !customerName.trim()}
                    >
                      {isSubmitting ? 'Submitting...' : 'Update Session'}
                    </button>
                    <button
                      type="button"
                      className="cancel-btn cs-liquid-button cs-liquid-button--danger"
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
            </section>
          </main>

          <footer className="footer">
            <p>Employee-facing tablet • Runs alongside Square POS</p>
          </footer>

          <WaitlistNoticeModal
            isOpen={showWaitlistModal && !!waitlistDesiredTier && !!waitlistBackupType}
            desiredTier={waitlistDesiredTier || ''}
            backupType={waitlistBackupType || ''}
            onClose={() => setShowWaitlistModal(false)}
          />

          <AlreadyCheckedInModal
            isOpen={!!alreadyCheckedIn}
            customerLabel={alreadyCheckedIn?.customerLabel || null}
            activeCheckin={alreadyCheckedIn?.activeCheckin || null}
            onClose={() => setAlreadyCheckedIn(null)}
          />

          {offerUpgradeModal && session?.sessionToken && (
            <OfferUpgradeModal
              isOpen={true}
              onClose={() => setOfferUpgradeModal(null)}
              sessionToken={session.sessionToken}
              waitlistId={offerUpgradeModal.waitlistId}
              desiredTier={offerUpgradeModal.desiredTier}
              customerLabel={offerUpgradeModal.customerLabel}
              onOffered={() => {
                void fetchWaitlistRef.current?.();
                void fetchInventoryAvailableRef.current?.();
              }}
            />
          )}

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
                    First: <strong style={{ color: 'white' }}>{pendingCreateFromScan?.extracted.firstName || '—'}</strong>
                  </span>
                  <span>
                    Last: <strong style={{ color: 'white' }}>{pendingCreateFromScan?.extracted.lastName || '—'}</strong>
                  </span>
                  <span>
                    DOB: <strong style={{ color: 'white' }}>{pendingCreateFromScan?.extracted.dob || '—'}</strong>
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

          {pastDueBalance > 0 && (
            <PastDuePaymentModal
              isOpen={showPastDueModal}
              quote={{
                total: pastDueBalance,
                lineItems: pastDueLineItems,
                messages: [],
              }}
              onPayInSquare={(outcome, reason) => void handlePastDuePayment(outcome, reason)}
              onManagerBypass={() => {
                setShowPastDueModal(false);
                setShowManagerBypassModal(true);
              }}
              onClose={() => setShowPastDueModal(false)}
              isSubmitting={isSubmitting}
            />
          )}

          <MembershipIdPromptModal
            isOpen={showMembershipIdPrompt}
            membershipIdMode={membershipIdMode}
            membershipIdInput={membershipIdInput}
            membershipNumber={membershipNumber}
            membershipPurchaseIntent={membershipPurchaseIntent}
            error={membershipIdError}
            isSubmitting={membershipIdSubmitting}
            onModeChange={(mode) => {
              setMembershipIdMode(mode);
              if (mode === 'KEEP_EXISTING' && membershipNumber) {
                setMembershipIdInput(membershipNumber);
              } else {
                setMembershipIdInput('');
              }
              setMembershipIdError(null);
            }}
            onInputChange={setMembershipIdInput}
            onConfirm={(membershipId) => void handleCompleteMembershipPurchase(membershipId)}
            onNotNow={() => {
              setShowMembershipIdPrompt(false);
              setMembershipIdError(null);
            }}
          />

          <ManagerBypassModal
            isOpen={showManagerBypassModal}
            managers={managerList}
            managerId={managerId}
            managerPin={managerPin}
            onChangeManagerId={setManagerId}
            onChangeManagerPin={setManagerPin}
            onBypass={() => void handleManagerBypass()}
            onCancel={() => {
              setShowManagerBypassModal(false);
              setManagerId('');
              setManagerPin('');
            }}
            isSubmitting={isSubmitting}
          />

          {upgradeContext && (
            <UpgradePaymentModal
              isOpen={showUpgradePaymentModal}
              onClose={() => setShowUpgradePaymentModal(false)}
              customerLabel={upgradeContext.customerLabel}
              newRoomNumber={upgradeContext.newRoomNumber}
              offeredRoomNumber={upgradeContext.offeredRoomNumber}
              originalCharges={upgradeOriginalCharges}
              originalTotal={upgradeOriginalTotal}
              upgradeFee={upgradeFee}
              paymentStatus={upgradePaymentStatus}
              isSubmitting={isSubmitting}
              canComplete={!!upgradePaymentIntentId}
              onPayCreditSuccess={() => void handleUpgradePaymentFlow('CREDIT')}
              onPayCashSuccess={() => void handleUpgradePaymentFlow('CASH')}
              onDecline={() => handleUpgradePaymentDecline('Credit declined')}
              onComplete={() => {
                if (upgradePaymentIntentId) {
                  void handleUpgradePaymentFlow('CREDIT');
                }
              }}
            />
          )}

          <AddNoteModal
            isOpen={showAddNoteModal}
            noteText={newNoteText}
            onChangeNoteText={setNewNoteText}
            onSubmit={() => void handleAddNote()}
            onCancel={() => {
              setShowAddNoteModal(false);
              setNewNoteText('');
            }}
            isSubmitting={isSubmitting}
          />

          <PaymentDeclineToast message={paymentDeclineError} onDismiss={() => setPaymentDeclineError(null)} />
          {scanToastMessage && (
            <div
              style={{
                position: 'fixed',
                top: '1rem',
                left: '1rem',
                background: '#0f172a',
                color: 'white',
                padding: '1rem',
                borderRadius: '12px',
                zIndex: 1500,
                maxWidth: '480px',
                border: '1px solid rgba(148, 163, 184, 0.18)',
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
              }}
              role="status"
              aria-label="Scan message"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div style={{ fontWeight: 900 }}>Scan</div>
                <button
                  onClick={() => setScanToastMessage(null)}
                  className="cs-liquid-button cs-liquid-button--secondary"
                  style={{ padding: '0.2rem 0.55rem' }}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop: '0.5rem', color: '#cbd5e1' }}>{scanToastMessage}</div>
            </div>
          )}
          {topActions.overlays}

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
              {!agreementSigned && selectionConfirmed && paymentStatus === 'PAID' && (
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
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      onClick={() => {
                        const sid = currentSessionIdRef.current;
                        if (!sid) return;
                        setDocumentsModalOpen(true);
                        void fetchDocumentsBySession(sid);
                      }}
                      className="cs-liquid-button cs-liquid-button--secondary"
                      style={{ width: '100%', padding: '0.6rem', fontWeight: 700 }}
                      disabled={!session?.sessionToken || !currentSessionIdRef.current}
                    >
                      Verify agreement PDF + signature saved
                    </button>
                  </div>
                </div>
              )}
              {agreementSigned && assignedResourceType && (
                <button
                  onClick={() => void handleCompleteTransaction()}
                  disabled={isSubmitting}
                  className="cs-liquid-button"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
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
              <RequiredTenderOutcomeModal
                isOpen={true}
                totalLabel={`Total: $${paymentQuote.total.toFixed(2)}`}
                isSubmitting={isSubmitting}
                onConfirm={(choice) => {
                  if (choice === 'CREDIT_SUCCESS') void handleDemoPayment('CREDIT_SUCCESS');
                  if (choice === 'CASH_SUCCESS') void handleDemoPayment('CASH_SUCCESS');
                  if (choice === 'CREDIT_DECLINE') void handleDemoPayment('CREDIT_DECLINE', 'Card declined');
                }}
              />
            )}
        </div>
      )}
      <ModalFrame
        isOpen={documentsModalOpen}
        title="Agreement artifacts"
        onClose={() => setDocumentsModalOpen(false)}
        maxWidth="720px"
        maxHeight="70vh"
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Session: <span style={{ fontFamily: 'monospace' }}>{currentSessionIdRef.current || '—'}</span>
          </div>

          {documentsError && (
            <div
              style={{
                padding: '0.75rem',
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 12,
                color: '#fecaca',
                fontWeight: 700,
              }}
            >
              {documentsError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="cs-liquid-button cs-liquid-button--secondary"
              disabled={documentsLoading || !currentSessionIdRef.current}
              onClick={() => {
                const sid = currentSessionIdRef.current;
                if (!sid) return;
                void fetchDocumentsBySession(sid);
              }}
            >
              {documentsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {documentsForSession === null ? (
            <div style={{ color: '#94a3b8' }}>No data loaded yet.</div>
          ) : documentsForSession.length === 0 ? (
            <div style={{ color: '#94a3b8' }}>No documents found for this session.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {documentsForSession.map((doc) => (
                <div
                  key={doc.id}
                  className="er-surface"
                  style={{ padding: '0.75rem', borderRadius: 12, display: 'grid', gap: '0.35rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 900 }}>
                      {doc.doc_type}{' '}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#94a3b8' }}>
                        {doc.id}
                      </span>
                    </div>
                    <div style={{ color: '#94a3b8' }}>{new Date(doc.created_at).toLocaleString()}</div>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    PDF stored: {doc.has_pdf ? 'yes' : 'no'} • Signature stored: {doc.has_signature ? 'yes' : 'no'}
                    {doc.signature_hash_prefix ? ` • sig hash: ${doc.signature_hash_prefix}…` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className="cs-liquid-button"
                      disabled={!doc.has_pdf}
                      onClick={() => {
                        void downloadAgreementPdf(doc.id).catch((e) => {
                          setDocumentsError(e instanceof Error ? e.message : 'Failed to download PDF');
                        });
                      }}
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ModalFrame>
    </RegisterSignIn>
  );
}

