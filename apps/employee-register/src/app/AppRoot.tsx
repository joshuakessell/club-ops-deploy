import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  type CheckoutRequestSummary,
  type CheckoutChecklist,
  type AssignmentFailedPayload,
  getCustomerMembershipStatus,
} from '@club-ops/shared';
import { isRecord, getErrorMessage, readJson } from '@club-ops/ui';
import { RegisterSignIn } from '../RegisterSignIn';
type ScanResult =
  | { outcome: 'matched' }
  | { outcome: 'no_match'; message: string; canCreate?: boolean }
  | { outcome: 'error'; message: string };
import { debounce } from '../utils/debounce';
import { extractDobDigits, formatDobMmDdYyyy, parseDobDigitsToIso } from '../utils/dob';
import { OfferUpgradeModal } from '../components/OfferUpgradeModal';
import { CheckoutRequestsBanner } from '../components/register/CheckoutRequestsBanner';
import { CheckoutVerificationModal } from '../components/register/CheckoutVerificationModal';
import { useEmployeeRegisterTabletUiTweaks } from '../hooks/useEmployeeRegisterTabletUiTweaks';
import { RequiredTenderOutcomeModal } from '../components/register/modals/RequiredTenderOutcomeModal';
import { WaitlistNoticeModal } from '../components/register/modals/WaitlistNoticeModal';
import { CustomerConfirmationPendingModal } from '../components/register/modals/CustomerConfirmationPendingModal';
import { PastDuePaymentModal } from '../components/register/modals/PastDuePaymentModal';
import { ManagerBypassModal } from '../components/register/modals/ManagerBypassModal';
import { UpgradePaymentModal } from '../components/register/modals/UpgradePaymentModal';
import { AddNoteModal } from '../components/register/modals/AddNoteModal';
import { MembershipIdPromptModal } from '../components/register/modals/MembershipIdPromptModal';
import { ModalFrame } from '../components/register/modals/ModalFrame';
import { TransactionCompleteModal } from '../components/register/modals/TransactionCompleteModal';
import {
  MultipleMatchesModal,
  type MultipleMatchCandidate,
} from '../components/register/modals/MultipleMatchesModal';
import { PaymentDeclineToast } from '../components/register/toasts/PaymentDeclineToast';
import { SuccessToast } from '../components/register/toasts/SuccessToast';
import {
  BottomToastStack,
  type BottomToast,
} from '../components/register/toasts/BottomToastStack';
import { ManualCheckoutPanel } from '../components/register/panels/ManualCheckoutPanel';
import { RoomCleaningPanel } from '../components/register/panels/RoomCleaningPanel';
import { CustomerProfileCard, type CheckinStage } from '../components/register/CustomerProfileCard';
import { EmployeeAssistPanel } from '../components/register/EmployeeAssistPanel';
import { CustomerAccountPanel } from '../components/register/panels/CustomerAccountPanel';
import { UpgradesDrawerContent } from '../components/upgrades/UpgradesDrawerContent';
import { InventoryDrawer, type InventoryDrawerSection } from '../components/inventory/InventoryDrawer';
import { usePassiveScannerInput } from '../usePassiveScannerInput';
import { useRegisterLaneSessionState } from './useRegisterLaneSessionState';
import { useRegisterWebSocketEvents } from './useRegisterWebSocketEvents';
import { getApiUrl } from '@/lib/apiBase';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

type PaymentQuote = ReturnType<typeof useRegisterLaneSessionState>['state']['paymentQuote'];

type SessionDocument = {
  id: string;
  doc_type: string;
  mime_type: string;
  created_at: string;
  has_signature: boolean;
  signature_hash_prefix?: string;
  has_pdf?: boolean;
};

const API_BASE = getApiUrl('/api');

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
  const [passiveScanProcessing, setPassiveScanProcessing] = useState(false);
  const passiveScanProcessingRef = useRef(false);
  const [scanOverlayMounted, setScanOverlayMounted] = useState(false);
  const [scanOverlayActive, setScanOverlayActive] = useState(false);
  const scanOverlayHideTimerRef = useRef<number | null>(null);
  const scanOverlayShownAtRef = useRef<number | null>(null);
  const SCAN_OVERLAY_MIN_VISIBLE_MS = 300;

  type HomeTab =
    | 'account'
    | 'scan'
    | 'search'
    | 'inventory'
    | 'upgrades'
    | 'checkout'
    | 'roomCleaning'
    | 'firstTime';
  const [homeTab, setHomeTab] = useState<HomeTab>('scan');
  const [accountCustomerId, setAccountCustomerId] = useState<string | null>(null);
  const [accountCustomerLabel, setAccountCustomerLabel] = useState<string | null>(null);
  const [successToastMessage, setSuccessToastMessage] = useState<string | null>(null);
  const successToastTimerRef = useRef<number | null>(null);

  const [bottomToasts, setBottomToasts] = useState<BottomToast[]>([]);
  const bottomToastTimersRef = useRef<Record<string, number>>({});

  const dismissBottomToast = useCallback((id: string) => {
    const timer = bottomToastTimersRef.current[id];
    if (timer) window.clearTimeout(timer);
    delete bottomToastTimersRef.current[id];
    setBottomToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushBottomToast = useCallback(
    (toast: Omit<BottomToast, 'id'> & { id?: string }, ttlMs = 12_000) => {
      const id = toast.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setBottomToasts((prev) => [{ id, message: toast.message, tone: toast.tone }, ...prev].slice(0, 4));
      if (bottomToastTimersRef.current[id]) window.clearTimeout(bottomToastTimersRef.current[id]);
      bottomToastTimersRef.current[id] = window.setTimeout(() => dismissBottomToast(id), ttlMs);
    },
    [dismissBottomToast]
  );

  const [inventoryRefreshNonce, setInventoryRefreshNonce] = useState(0);
  const [checkoutPrefill, setCheckoutPrefill] = useState<null | { occupancyId?: string; number?: string }>(null);
  const [checkoutEntryMode, setCheckoutEntryMode] = useState<'default' | 'direct-confirm'>('default');
  const checkoutReturnToTabRef = useRef<HomeTab | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualDobDigits, setManualDobDigits] = useState('');
  const [manualEntrySubmitting, setManualEntrySubmitting] = useState(false);
  const [manualExistingPrompt, setManualExistingPrompt] = useState<null | {
    firstName: string;
    lastName: string;
    dobIso: string;
    matchCount: number;
    bestMatch: { id: string; name: string; membershipNumber?: string | null; dob?: string | null };
  }>(null);
  const [manualExistingPromptError, setManualExistingPromptError] = useState<string | null>(null);
  const [manualExistingPromptSubmitting, setManualExistingPromptSubmitting] = useState(false);
  const [inventoryForcedSection, setInventoryForcedSection] = useState<InventoryDrawerSection>(null);

  useEffect(() => {
    if (!successToastMessage) return;
    if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    successToastTimerRef.current = window.setTimeout(() => setSuccessToastMessage(null), 3000);
    return () => {
      if (successToastTimerRef.current) window.clearTimeout(successToastTimerRef.current);
    };
  }, [successToastMessage]);

  useEffect(() => {
    return () => {
      for (const id of Object.keys(bottomToastTimersRef.current)) {
        const timer = bottomToastTimersRef.current[id];
        if (timer) window.clearTimeout(timer);
      }
      bottomToastTimersRef.current = {};
    };
  }, []);

  const selectHomeTab = useCallback(
    (next: HomeTab) => {
      setHomeTab(next);
      // First Time Customer tab drives manual entry mode.
      setManualEntry(next === 'firstTime');
      if (next !== 'checkout') {
        setCheckoutPrefill(null);
        setCheckoutEntryMode('default');
        checkoutReturnToTabRef.current = null;
      }
    },
    [setHomeTab]
  );

  const startCheckoutFromHome = useCallback(() => {
    checkoutReturnToTabRef.current = null;
    setCheckoutPrefill(null);
    setCheckoutEntryMode('default');
    selectHomeTab('checkout');
  }, [selectHomeTab]);

  const startCheckoutFromInventory = useCallback(
    (prefill: { occupancyId?: string; number: string }) => {
      checkoutReturnToTabRef.current = 'inventory';
      setCheckoutEntryMode('direct-confirm');
      setCheckoutPrefill(prefill);
      selectHomeTab('checkout');
    },
    [selectHomeTab]
  );

  const startCheckoutFromCustomerAccount = useCallback(
    (prefill?: { number?: string | null }) => {
      checkoutReturnToTabRef.current = 'account';
      const number = prefill?.number ?? null;
      setCheckoutEntryMode(number ? 'direct-confirm' : 'default');
      setCheckoutPrefill(number ? { number } : null);
      selectHomeTab('checkout');
    },
    [selectHomeTab]
  );

  const exitCheckout = useCallback(() => {
    const returnTo = checkoutReturnToTabRef.current;
    checkoutReturnToTabRef.current = null;
    setCheckoutPrefill(null);
    setCheckoutEntryMode('default');
    if (returnTo) {
      selectHomeTab(returnTo);
      return;
    }
    selectHomeTab('scan');
  }, [selectHomeTab]);

  // ---------------------------------------------------------------------------
  // Lane-session view model (reducer) + WS-driven updates
  // ---------------------------------------------------------------------------
  const { state: laneSession, actions: laneSessionActions } = useRegisterLaneSessionState();
  const {
    customerName,
    membershipNumber,
    currentSessionId,
    agreementSigned,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    paymentIntentId,
    paymentQuote,
    paymentStatus,
    membershipPurchaseIntent,
    membershipChoice,
    customerMembershipValidUntil,
    allowedRentals,
    pastDueBlocked,
    pastDueBalance,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerLastVisitAt,
    customerNotes,
    assignedResourceType,
    assignedResourceNumber,
    checkoutAt,
    paymentDeclineError,
  } = laneSession;

  // Keep naming stable throughout the existing component by providing setter wrappers.
  const setCustomerName = useCallback(
    (value: string) => laneSessionActions.patch({ customerName: value }),
    [laneSessionActions]
  );
  const setMembershipNumber = useCallback(
    (value: string) => laneSessionActions.patch({ membershipNumber: value }),
    [laneSessionActions]
  );
  const setCurrentSessionId = useCallback(
    (value: string | null) => laneSessionActions.patch({ currentSessionId: value }),
    [laneSessionActions]
  );
  const setCurrentSessionCustomerId = useCallback(
    (value: string | null) => laneSessionActions.patch({ customerId: value }),
    [laneSessionActions]
  );
  const setAgreementSigned = useCallback(
    (value: boolean) => laneSessionActions.patch({ agreementSigned: value }),
    [laneSessionActions]
  );
  const setCustomerSelectedType = useCallback(
    (value: string | null) => laneSessionActions.patch({ customerSelectedType: value }),
    [laneSessionActions]
  );
  const setWaitlistDesiredTier = useCallback(
    (value: string | null) => laneSessionActions.patch({ waitlistDesiredTier: value }),
    [laneSessionActions]
  );
  const setWaitlistBackupType = useCallback(
    (value: string | null) => laneSessionActions.patch({ waitlistBackupType: value }),
    [laneSessionActions]
  );
  const setSelectionConfirmed = useCallback(
    (value: boolean) => laneSessionActions.patch({ selectionConfirmed: value }),
    [laneSessionActions]
  );
  const setPaymentIntentId = useCallback(
    (value: string | null) => laneSessionActions.patch({ paymentIntentId: value }),
    [laneSessionActions]
  );
  const setPaymentQuote = useCallback(
    (value: PaymentQuote | ((prev: PaymentQuote) => PaymentQuote)) => {
      if (typeof value === 'function') {
        laneSessionActions.patch({ paymentQuote: value(paymentQuote) });
        return;
      }
      laneSessionActions.patch({ paymentQuote: value });
    },
    [laneSessionActions, paymentQuote]
  );
  const setPaymentStatus = useCallback(
    (value: 'DUE' | 'PAID' | null) => laneSessionActions.patch({ paymentStatus: value }),
    [laneSessionActions]
  );
  const setCustomerPrimaryLanguage = useCallback(
    (value: 'EN' | 'ES' | undefined) => laneSessionActions.patch({ customerPrimaryLanguage: value }),
    [laneSessionActions]
  );
  const setCustomerDobMonthDay = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerDobMonthDay: value }),
    [laneSessionActions]
  );
  const setCustomerLastVisitAt = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerLastVisitAt: value }),
    [laneSessionActions]
  );
  const setCustomerNotes = useCallback(
    (value: string | undefined) => laneSessionActions.patch({ customerNotes: value }),
    [laneSessionActions]
  );
  const setAssignedResourceType = useCallback(
    (value: 'room' | 'locker' | null) => laneSessionActions.patch({ assignedResourceType: value }),
    [laneSessionActions]
  );
  const setAssignedResourceNumber = useCallback(
    (value: string | null) => laneSessionActions.patch({ assignedResourceNumber: value }),
    [laneSessionActions]
  );
  const setCheckoutAt = useCallback(
    (value: string | null) => laneSessionActions.patch({ checkoutAt: value }),
    [laneSessionActions]
  );
  const setPaymentDeclineError = useCallback(
    (value: string | null) => laneSessionActions.setPaymentDeclineError(value),
    [laneSessionActions]
  );

  const checkinStage: CheckinStage | null = useMemo(() => {
    if (!currentSessionId || !customerName) return null;

    // 6 - Assigned
    if (assignedResourceType && assignedResourceNumber) {
      return { number: 6, label: 'Locker/Room Assigned' };
    }

    // 5 - Signing agreement (after rental confirmation, before assignment)
    if (agreementSigned) {
      // In practice assignment follows immediately; treat as stage 6 when agreement is already signed.
      return { number: 6, label: 'Locker/Room Assigned' };
    }
    if (selectionConfirmed) {
      return { number: 5, label: 'Signing Member Agreement' };
    }

    // 4 - Employee confirms customer selection
    if (proposedBy === 'CUSTOMER' && proposedRentalType) {
      return { number: 4, label: 'Employee Rental Confirmation' };
    }

    // 1 - Language selection
    if (!customerPrimaryLanguage) {
      return { number: 1, label: 'Language Selection' };
    }

    // 2 - Membership options (only when needed)
    const membershipStatus = getCustomerMembershipStatus(
      { membershipNumber: membershipNumber || null, membershipValidUntil: customerMembershipValidUntil || null },
      new Date()
    );
    const isMember = membershipPurchaseIntent ? true : membershipStatus === 'ACTIVE';
    if (!isMember && !membershipChoice) {
      return { number: 2, label: 'Membership Options' };
    }

    // 3 - Rental options
    return { number: 3, label: 'Rental Options' };
  }, [
    agreementSigned,
    assignedResourceNumber,
    assignedResourceType,
    customerMembershipValidUntil,
    customerName,
    customerPrimaryLanguage,
    currentSessionId,
    membershipChoice,
    membershipNumber,
    membershipPurchaseIntent,
    proposedBy,
    proposedRentalType,
    selectionConfirmed,
  ]);
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
  // Check-in mode is now auto-detected server-side based on active visits/assignments.
  const [, setSelectedRentalType] = useState<string | null>(null);
  const [checkoutRequests, setCheckoutRequests] = useState<Map<string, CheckoutRequestSummary>>(
    new Map()
  );
  const [selectedCheckoutRequest, setSelectedCheckoutRequest] = useState<string | null>(null);
  const [, setCheckoutChecklist] = useState<CheckoutChecklist>({});
  const [checkoutItemsConfirmed, setCheckoutItemsConfirmed] = useState(false);
  const [checkoutFeePaid, setCheckoutFeePaid] = useState(false);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<{
    type: 'room' | 'locker';
    id: string;
    number: string;
    tier: string;
  } | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const openCustomerAccount = useCallback(
    (customerId: string, label?: string | null) => {
      setAccountCustomerId(customerId);
      setAccountCustomerLabel(label ?? null);
      selectHomeTab('account');
    },
    [selectHomeTab]
  );
  const [showCustomerConfirmationPending, setShowCustomerConfirmationPending] = useState(false);
  const [customerConfirmationType, setCustomerConfirmationType] = useState<{
    requested: string;
    selected: string;
    number: string;
  } | null>(null);
  // payment + membership state lives in laneSession reducer

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

  // When a session becomes active via any entry path (scan/search/first-time),
  // bring the operator to the Customer Account panel automatically.
  const prevSessionIdForTabRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSessionIdForTabRef.current;
    prevSessionIdForTabRef.current = currentSessionId;
    if (!prev && currentSessionId) {
      if (laneSession.customerId && !accountCustomerId) {
        setAccountCustomerId(laneSession.customerId);
      }
      selectHomeTab('account');
    }
  }, [accountCustomerId, currentSessionId, laneSession.customerId, selectHomeTab]);

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
  // past-due state lives in laneSession reducer
  const [waitlistEntries, setWaitlistEntries] = useState<
    Array<{
      id: string;
      visitId: string;
      checkinBlockId: string;
      customerId?: string;
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
  const [, setSelectedWaitlistEntry] = useState<string | null>(null);
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
  const [, setShowUpgradePulse] = useState(false);
  const [offerUpgradeModal, setOfferUpgradeModal] = useState<{
    waitlistId: string;
    desiredTier: 'STANDARD' | 'DOUBLE' | 'SPECIAL';
    customerLabel?: string;
    heldRoom?: { id: string; number: string } | null;
  } | null>(null);
  const [inventoryHasLate, setInventoryHasLate] = useState(false);

  // Customer info state lives in laneSession reducer
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // Past due state
  const [showPastDueModal, setShowPastDueModal] = useState(false);
  const [showManagerBypassModal, setShowManagerBypassModal] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [managerList, setManagerList] = useState<Array<{ id: string; name: string }>>([]);
  // payment decline state lives in laneSession reducer
  const paymentIntentCreateInFlightRef = useRef(false);

  // Keep past-due modal behavior consistent with prior WS handler: auto-open when server blocks.
  useEffect(() => {
    if (pastDueBlocked && pastDueBalance > 0) {
      setShowPastDueModal(true);
    }
  }, [pastDueBlocked, pastDueBalance]);
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

  // Assignment completion state lives in laneSession reducer

  const deviceId = useState(() => {
    try {
      // Get device ID from environment variable or generate a stable per-device base ID.
      // In development, you may have multiple tabs open; we add a per-tab instance suffix
      // (stored in sessionStorage) so two tabs on the same machine can sign into
      // different registers without colliding on deviceId.
      const rawEnv = import.meta.env as unknown as Record<string, unknown>;
      const envDeviceId = typeof rawEnv.VITE_DEVICE_ID === 'string' ? rawEnv.VITE_DEVICE_ID : null;
      if (envDeviceId && envDeviceId.trim()) return envDeviceId.trim();

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
  const runCustomerSearch = useMemo(
    () =>
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
          getApiUrl(`/api/v1/customers/search?q=${encodeURIComponent(query)}&limit=10`),
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
      runCustomerSearch(customerSearch);
    } else {
      setCustomerSuggestions([]);
    }
  }, [customerSearch, runCustomerSearch]);

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

  const startLaneSessionByCustomerId = useCallback(
    (
    customerId: string,
    opts?: { suppressAlerts?: boolean; customerLabel?: string | null }
  ): Promise<ScanResult> => {
    if (!session?.sessionToken) {
      const msg = 'Not authenticated';
      if (!opts?.suppressAlerts) alert(msg);
      return Promise.resolve({ outcome: 'error', message: msg });
    }

    setIsSubmitting(true);
    try {
      openCustomerAccount(customerId, opts?.customerLabel ?? null);
      if (manualEntry) setManualEntry(false);
      return Promise.resolve({ outcome: 'matched' });
    } catch (error) {
      console.error('Failed to open customer account:', error);
      const msg = error instanceof Error ? error.message : 'Failed to open customer account';
      if (!opts?.suppressAlerts) alert(msg);
      return Promise.resolve({ outcome: 'error', message: msg });
    } finally {
      setIsSubmitting(false);
    }
  },
    [manualEntry, openCustomerAccount, session?.sessionToken]
  );

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const firstName = manualFirstName.trim();
    const lastName = manualLastName.trim();
    const dobIso = parseDobDigitsToIso(manualDobDigits);
    if (!firstName || !lastName || !dobIso) {
      alert('Please enter First Name, Last Name, and a valid Date of Birth (MM/DD/YYYY).');
      return;
    }
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setManualEntrySubmitting(true);
    setManualExistingPromptError(null);
    try {
      // First: check for existing customer match (name + dob).
      const matchRes = await fetch(`${API_BASE}/v1/customers/match-identity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ firstName, lastName, dob: dobIso }),
      });

      const matchPayload: unknown = await matchRes.json().catch(() => null);
      if (!matchRes.ok) {
        const msg = getErrorMessage(matchPayload) || 'Failed to check for existing customer';
        setManualExistingPromptError(msg);
        return;
      }

      const data = matchPayload as {
        matchCount?: number;
        bestMatch?: { id?: string; name?: string; membershipNumber?: string | null; dob?: string | null } | null;
      };
      const best = data.bestMatch;
      const matchCount = typeof data.matchCount === 'number' ? data.matchCount : 0;
      if (best && typeof best.id === 'string' && typeof best.name === 'string') {
        // Show confirmation prompt instead of creating a duplicate immediately.
        setManualExistingPrompt({
          firstName,
          lastName,
          dobIso,
          matchCount,
          bestMatch: { id: best.id, name: best.name, membershipNumber: best.membershipNumber, dob: best.dob },
        });
        return;
      }

      // No match: create new customer then load it.
      const createRes = await fetch(`${API_BASE}/v1/customers/create-manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ firstName, lastName, dob: dobIso }),
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

      const result = await startLaneSessionByCustomerId(newId, { suppressAlerts: true });
      if (result.outcome === 'matched') {
        setManualEntry(false);
        setManualFirstName('');
        setManualLastName('');
        setManualDobDigits('');
      }
    } finally {
      setManualEntrySubmitting(false);
    }
  };

  const onBarcodeCaptured = useCallback(async (rawScanText: string): Promise<ScanResult> => {
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
        // Let the employee select the correct customer.
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
  }, [lane, session?.sessionToken, startLaneSessionByCustomerId]);

  const blockingModalOpen =
    !!pendingScanResolution ||
    showCreateFromScanPrompt ||
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
    homeTab === 'scan' &&
    !!session?.sessionToken &&
    !passiveScanProcessing &&
    !isSubmitting &&
    !manualEntry &&
    !blockingModalOpen;

  const showScanOverlay = useCallback(() => {
    if (scanOverlayHideTimerRef.current) {
      window.clearTimeout(scanOverlayHideTimerRef.current);
      scanOverlayHideTimerRef.current = null;
    }
    scanOverlayShownAtRef.current = performance.now();
    setScanOverlayMounted(true);
    // Ensure CSS transition runs by toggling active on next frame.
    window.requestAnimationFrame(() => setScanOverlayActive(true));
  }, []);

  const hideScanOverlay = useCallback(() => {
    const shownAt = scanOverlayShownAtRef.current;
    const elapsed = shownAt ? performance.now() - shownAt : Number.POSITIVE_INFINITY;
    const remaining = Math.max(0, SCAN_OVERLAY_MIN_VISIBLE_MS - elapsed);

    if (scanOverlayHideTimerRef.current) {
      window.clearTimeout(scanOverlayHideTimerRef.current);
      scanOverlayHideTimerRef.current = null;
    }

    scanOverlayHideTimerRef.current = window.setTimeout(() => {
      setScanOverlayActive(false);
      // After fade-out, fully unmount.
      window.setTimeout(() => {
        setScanOverlayMounted(false);
        scanOverlayHideTimerRef.current = null;
        scanOverlayShownAtRef.current = null;
      }, 220);
    }, remaining);
  }, []);

  const handlePassiveCapture = useCallback(
    (rawScanText: string) => {
      void (async () => {
        setScanToastMessage(null);
        passiveScanProcessingRef.current = true;
        setPassiveScanProcessing(true);
        const result = await onBarcodeCaptured(rawScanText);
        passiveScanProcessingRef.current = false;
        setPassiveScanProcessing(false);
        hideScanOverlay();
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
    [hideScanOverlay, onBarcodeCaptured]
  );

  usePassiveScannerInput({
    enabled: passiveScanEnabled,
    onCaptureStart: () => showScanOverlay(),
    onCaptureEnd: () => {
      // If the capture ended but no processing started (e.g. too-short scan), undim.
      if (!passiveScanProcessingRef.current) hideScanOverlay();
    },
    onCancel: () => {
      passiveScanProcessingRef.current = false;
      setPassiveScanProcessing(false);
      hideScanOverlay();
    },
    onCapture: (raw) => handlePassiveCapture(raw),
  });

  // Cleanup overlay timer on unmount.
  useEffect(() => {
    return () => {
      if (scanOverlayHideTimerRef.current) {
        window.clearTimeout(scanOverlayHideTimerRef.current);
        scanOverlayHideTimerRef.current = null;
      }
    };
  }, []);

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

  const handleCreateFromNoMatch = async (): Promise<ScanResult> => {
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
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
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
      heldRoom:
        entry.status === 'OFFERED' && entry.roomId && entry.offeredRoomNumber
          ? { id: entry.roomId, number: entry.offeredRoomNumber }
          : null,
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
      selectHomeTab('upgrades');
      setShowUpgradePaymentModal(true);
    } catch (error) {
      console.error('Failed to start upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to start upgrade');
    } finally {
      setIsSubmitting(false);
    }
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

  const ws = useRegisterWebSocketEvents({
    lane,
    currentSessionIdRef,
    selectedCheckoutRequestRef,
    customerSelectedTypeRef,
    laneSessionActions: {
      applySessionUpdated: laneSessionActions.applySessionUpdated,
      applySelectionProposed: ({ rentalType, proposedBy }) =>
        laneSessionActions.applySelectionProposed({ rentalType, proposedBy }),
      applySelectionLocked: ({ rentalType, confirmedBy }) =>
        laneSessionActions.applySelectionLocked({ rentalType, confirmedBy }),
      applySelectionForced: ({ rentalType }) => laneSessionActions.applySelectionForced({ rentalType }),
      selectionAcknowledged: laneSessionActions.selectionAcknowledged,
    },
    setCheckoutRequests,
    setCheckoutItemsConfirmed,
    setCheckoutFeePaid,
    setSelectedCheckoutRequest,
    setCheckoutChecklist,
    onWaitlistUpdated: () => {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    },
    onInventoryUpdated: () => {
      void fetchInventoryAvailableRef.current?.();
    },
    onLaneSessionCleared: () => {
      setSelectedInventoryItem(null);
      setShowMembershipIdPrompt(false);
      setMembershipIdInput('');
      setMembershipIdError(null);
      setMembershipIdPromptedForSessionId(null);
      setShowWaitlistModal(false);
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
      selectHomeTab('scan');
      // Any additional per-session UI state resets remain here (outside reducer).
    },
    pushBottomToast,
    onAssignmentFailed: (payload: AssignmentFailedPayload) => {
      alert('Assignment failed: ' + payload.reason);
      setSelectedInventoryItem(null);
    },
    onCustomerConfirmed: () => {
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
    },
    onCustomerDeclined: () => {
      setShowCustomerConfirmationPending(false);
      setCustomerConfirmationType(null);
      if (customerSelectedTypeRef.current) {
        setSelectedInventoryItem(null);
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

  const highlightKioskOption = async (params: {
    step: 'LANGUAGE' | 'MEMBERSHIP';
    option: string | null;
  }) => {
    if (!currentSessionId || !session?.sessionToken) return;
    try {
      await fetch(`${API_BASE}/v1/checkin/lane/${lane}/highlight-option`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ ...params, sessionId: currentSessionId }),
      });
    } catch {
      // Best-effort (UI-only).
    }
  };

  const handleConfirmLanguage = async (lang: 'EN' | 'ES') => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/set-language`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ language: lang, sessionId: currentSessionId, customerName }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set language');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set language');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMembershipOneTime = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      // Clear any 6-month intent (if present)
      await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ intent: 'NONE', sessionId: currentSessionId }),
      });

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-choice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ choice: 'ONE_TIME', sessionId: currentSessionId }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set membership choice');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set membership choice');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmMembershipSixMonth = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    const base = getCustomerMembershipStatus({
      membershipNumber: membershipNumber || null,
      membershipValidUntil: customerMembershipValidUntil,
    });
    const intent: 'PURCHASE' | 'RENEW' = base === 'EXPIRED' ? 'RENEW' : 'PURCHASE';
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ intent, sessionId: currentSessionId }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set membership purchase intent');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set membership purchase intent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProposeSelection = async (rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ rentalType, proposedBy: 'EMPLOYEE' }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to propose selection');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerSelectRental = async (rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL') => {
    if (!currentSessionId) return;
    setIsSubmitting(true);
    try {
      // Public endpoint; we intentionally set proposedBy=CUSTOMER so the kiosk enters its
      // "pending approval" step and employee-register shows the OK button.
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalType, proposedBy: 'CUSTOMER' }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select rental');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select rental');
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
      laneSessionActions.patch({ selectionConfirmedBy: 'EMPLOYEE', selectionAcknowledged: true });
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

  const handleCreatePaymentIntent = useCallback(async () => {
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
  }, [currentSessionId, lane, session?.sessionToken, setPaymentIntentId, setPaymentQuote, setPaymentStatus]);

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
  }, [
    currentSessionId,
    session?.sessionToken,
    selectionConfirmed,
    paymentIntentId,
    paymentStatus,
    handleCreatePaymentIntent,
  ]);

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
      setCurrentSessionCustomerId(null);
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
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
    <RegisterSignIn
      deviceId={deviceId}
      onSignedIn={handleRegisterSignIn}
      topTitle="Employee Register"
      lane={lane}
      apiStatus={health?.status ?? null}
      wsConnected={wsConnected}
      onSignOut={() => void handleLogout()}
      onCloseOut={() => void handleCloseOut()}
    >
      {!registerSession ? (
        <div />
      ) : !session ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>Loading...</div>
      ) : (
        <div className="container">
          {scanOverlayMounted && (
            <div
              className={[
                'er-scan-processing-overlay',
                scanOverlayActive ? 'er-scan-processing-overlay--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            >
              <div className="er-scan-processing-card cs-liquid-card">
                <span className="er-spinner" aria-hidden="true" />
                <span className="er-scan-processing-text">Processing scan…</span>
              </div>
            </div>
          )}

          {/* Checkout Request Notifications */}
          {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
            <CheckoutRequestsBanner
              requests={Array.from(checkoutRequests.values())}
              onClaim={(id) => void handleClaimCheckout(id)}
              onOpenCustomerAccount={(customerId, label) => openCustomerAccount(customerId, label)}
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
                  onOpenCustomerAccount={(customerId, label) => openCustomerAccount(customerId, label)}
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

          <main className="main">
            {/* Customer Account embeds the check-in UI (lane session driven). */}

            <section className="actions-panel">
              <div className="er-home-layout">
                <nav className="er-home-tabs" aria-label="Home actions">
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
                    disabled={!accountCustomerId && !(currentSessionId && customerName)}
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'account' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('account')}
                    style={{ opacity: !accountCustomerId && !(currentSessionId && customerName) ? 0.6 : 1 }}
                    title={!accountCustomerId && !(currentSessionId && customerName) ? 'Select a customer first' : undefined}
                  >
                    Customer Account
                  </button>
                  <button
                    type="button"
                    className={[
                      'er-home-tab-btn',
                      'cs-liquid-button',
                      homeTab === 'inventory'
                        ? 'cs-liquid-button--selected'
                        : inventoryHasLate
                          ? 'cs-liquid-button--danger'
                          : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('inventory')}
                  >
                    Inventory
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
                      homeTab === 'checkout' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
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
                      homeTab === 'roomCleaning' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
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
                      homeTab === 'firstTime' ? 'cs-liquid-button--selected' : 'cs-liquid-button--secondary',
                    ].join(' ')}
                    onClick={() => selectHomeTab('firstTime')}
                  >
                    First Time Customer
                  </button>
                </nav>

                <div className="er-home-content">
                  {homeTab === 'scan' && (
                    <div className="er-home-panel er-home-panel--center cs-liquid-card er-main-panel-card">
                      <div style={{ fontSize: '4rem', lineHeight: 1 }} aria-hidden="true">
                        📷
                      </div>
                      <div style={{ marginTop: '0.75rem', fontWeight: 950, fontSize: '1.6rem' }}>Scan Now</div>
                      <div className="er-text-sm" style={{ marginTop: '0.5rem', color: '#94a3b8', fontWeight: 700 }}>
                        Scan a membership ID or driver license.
                      </div>
                      {currentSessionId && customerName ? (
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                          <div className="er-text-sm" style={{ color: '#94a3b8', fontWeight: 800 }}>
                            Active lane session: <span style={{ color: '#e2e8f0' }}>{customerName}</span>
                          </div>
                          <button
                            type="button"
                            className="cs-liquid-button"
                            onClick={() => selectHomeTab('account')}
                            style={{ width: '100%', padding: '0.75rem', fontWeight: 900 }}
                          >
                            Open Customer Account
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {homeTab === 'account' && (
                    accountCustomerId ? (
                      <CustomerAccountPanel
                        lane={lane}
                        sessionToken={session?.sessionToken}
                        customerId={accountCustomerId}
                        customerLabel={accountCustomerLabel}
                        onStartCheckout={startCheckoutFromCustomerAccount}
                        onClearSession={() => void handleClearSession().then(() => selectHomeTab('scan'))}
                        currentSessionId={currentSessionId}
                        currentSessionCustomerId={laneSession.customerId}
                        customerName={customerName}
                        membershipNumber={membershipNumber}
                        customerMembershipValidUntil={customerMembershipValidUntil}
                        membershipPurchaseIntent={membershipPurchaseIntent}
                        membershipChoice={membershipChoice}
                        allowedRentals={allowedRentals}
                        proposedRentalType={proposedRentalType}
                        proposedBy={proposedBy}
                        selectionConfirmed={selectionConfirmed}
                        customerPrimaryLanguage={customerPrimaryLanguage}
                        customerDobMonthDay={customerDobMonthDay}
                        customerLastVisitAt={customerLastVisitAt}
                        hasEncryptedLookupMarker={Boolean(laneSession.customerHasEncryptedLookupMarker)}
                        waitlistDesiredTier={waitlistDesiredTier}
                        waitlistBackupType={waitlistBackupType}
                        inventoryAvailable={
                          inventoryAvailable ? { rooms: inventoryAvailable.rooms, lockers: inventoryAvailable.lockers } : null
                        }
                        isSubmitting={isSubmitting}
                        checkinStage={checkinStage}
                        onStartedSession={(data) => {
                          setCurrentSessionCustomerId(accountCustomerId);
                          if (data.customerName) setCustomerName(data.customerName);
                          if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
                          if (data.sessionId) setCurrentSessionId(data.sessionId);
                          if (data.customerHasEncryptedLookupMarker !== undefined) {
                            laneSessionActions.patch({
                              customerHasEncryptedLookupMarker: Boolean(data.customerHasEncryptedLookupMarker),
                            });
                          }
                          if (data.mode === 'RENEWAL' && typeof data.blockEndsAt === 'string') {
                            if (data.activeAssignedResourceType) setAssignedResourceType(data.activeAssignedResourceType);
                            if (data.activeAssignedResourceNumber) setAssignedResourceNumber(data.activeAssignedResourceNumber);
                            setCheckoutAt(data.blockEndsAt);
                          }
                        }}
                        onHighlightLanguage={(lang) => void highlightKioskOption({ step: 'LANGUAGE', option: lang })}
                        onConfirmLanguage={(lang) => void handleConfirmLanguage(lang)}
                        onHighlightMembership={(choice) => void highlightKioskOption({ step: 'MEMBERSHIP', option: choice })}
                        onConfirmMembershipOneTime={() => void handleConfirmMembershipOneTime()}
                        onConfirmMembershipSixMonth={() => void handleConfirmMembershipSixMonth()}
                        onHighlightRental={(rental) => void handleProposeSelection(rental)}
                        onSelectRentalAsCustomer={(rental) => void handleCustomerSelectRental(rental)}
                        onApproveRental={() => void handleConfirmSelection()}
                      />
                    ) : currentSessionId && customerName ? (
                      <div
                        className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card"
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
                          <div style={{ fontWeight: 950, fontSize: '1.05rem' }}>Customer Account</div>
                          <CustomerProfileCard
                            name={customerName}
                            preferredLanguage={customerPrimaryLanguage || null}
                            dobMonthDay={customerDobMonthDay || null}
                            membershipNumber={membershipNumber || null}
                            membershipValidUntil={customerMembershipValidUntil || null}
                            lastVisitAt={customerLastVisitAt || null}
                            hasEncryptedLookupMarker={Boolean(laneSession.customerHasEncryptedLookupMarker)}
                            checkinStage={checkinStage}
                            waitlistDesiredTier={waitlistDesiredTier}
                            waitlistBackupType={waitlistBackupType}
                            footer={
                              checkinStage ? (
                                <button
                                  type="button"
                                  className="cs-liquid-button cs-liquid-button--danger"
                                  onClick={() => void handleClearSession().then(() => selectHomeTab('scan'))}
                                  style={{ width: '100%', maxWidth: 320, padding: '0.7rem', fontWeight: 900 }}
                                >
                                  Clear Session
                                </button>
                              ) : null
                            }
                          />
                          <EmployeeAssistPanel
                            sessionId={currentSessionId}
                            customerName={customerName}
                            customerPrimaryLanguage={customerPrimaryLanguage}
                            membershipNumber={membershipNumber || null}
                            customerMembershipValidUntil={customerMembershipValidUntil}
                            membershipPurchaseIntent={membershipPurchaseIntent}
                            membershipChoice={membershipChoice}
                            allowedRentals={allowedRentals}
                            proposedRentalType={proposedRentalType}
                            proposedBy={proposedBy}
                            selectionConfirmed={selectionConfirmed}
                            waitlistDesiredTier={waitlistDesiredTier}
                            waitlistBackupType={waitlistBackupType}
                            inventoryAvailable={
                              inventoryAvailable ? { rooms: inventoryAvailable.rooms, lockers: inventoryAvailable.lockers } : null
                            }
                            isSubmitting={isSubmitting}
                            onHighlightLanguage={(lang) => void highlightKioskOption({ step: 'LANGUAGE', option: lang })}
                            onConfirmLanguage={(lang) => void handleConfirmLanguage(lang)}
                            onHighlightMembership={(choice) => void highlightKioskOption({ step: 'MEMBERSHIP', option: choice })}
                            onConfirmMembershipOneTime={() => void handleConfirmMembershipOneTime()}
                            onConfirmMembershipSixMonth={() => void handleConfirmMembershipSixMonth()}
                            onHighlightRental={(rental) => void handleProposeSelection(rental)}
                            onSelectRentalAsCustomer={(rental) => void handleCustomerSelectRental(rental)}
                            onApproveRental={() => void handleConfirmSelection()}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="er-home-panel er-home-panel--center cs-liquid-card er-main-panel-card">
                        <div style={{ fontWeight: 950, fontSize: '1.35rem' }}>Customer Account</div>
                        <div className="er-text-sm" style={{ marginTop: '0.5rem', color: '#94a3b8', fontWeight: 700 }}>
                          Select a customer (scan, search, or first-time) to view their account.
                        </div>
                      </div>
                    )
                  )}

                  {homeTab === 'search' && (
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
                        <label htmlFor="customer-search" style={{ fontWeight: 600 }}>
                          Search Customer
                        </label>
                        <span className="er-search-help">(type at least 3 letters)</span>
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
                          {customerSuggestions.map((s) => {
                            const label = `${s.lastName}, ${s.firstName}`;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                className="cs-liquid-button cs-liquid-button--secondary"
                                onClick={() => {
                                  // Direct navigation: selecting a customer name anywhere should open Customer Account.
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
                  )}

                  {homeTab === 'inventory' && session?.sessionToken && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card">
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
                          onAlertSummaryChange={({ hasLate }) => setInventoryHasLate(hasLate)}
                          onRequestCheckout={startCheckoutFromInventory}
                          onOpenCustomerAccount={openCustomerAccount}
                          externalRefreshNonce={inventoryRefreshNonce}
                        />
                      </div>
                    </div>
                  )}

                  {homeTab === 'upgrades' && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll cs-liquid-card er-main-panel-card">
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
                          selectHomeTab('upgrades');
                        }}
                        onStartPayment={(entry) => {
                          resetUpgradeState();
                          setSelectedWaitlistEntry(entry.id);
                          void handleStartUpgradePayment(entry);
                        }}
                        onCancelOffer={(entryId) => {
                          alert(`Cancel offer not implemented yet (waitlistId=${entryId}).`);
                        }}
                        onOpenCustomerAccount={openCustomerAccount}
                        isSubmitting={isSubmitting}
                      />
                    </div>
                  )}

                  {homeTab === 'checkout' && session?.sessionToken && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
                      <ManualCheckoutPanel
                        sessionToken={session.sessionToken}
                        entryMode={checkoutEntryMode}
                        prefill={checkoutPrefill ?? undefined}
                        onExit={exitCheckout}
                        onSuccess={(message) => {
                          setSuccessToastMessage(message);
                          if (checkoutReturnToTabRef.current) {
                            setInventoryRefreshNonce((prev) => prev + 1);
                            exitCheckout();
                          }
                        }}
                      />
                    </div>
                  )}

                  {homeTab === 'roomCleaning' && session?.sessionToken && session?.staffId && (
                    <div className="er-home-panel er-home-panel--top er-home-panel--no-scroll">
                      <RoomCleaningPanel
                        sessionToken={session.sessionToken}
                        staffId={session.staffId}
                        onSuccess={(message) => setSuccessToastMessage(message)}
                      />
                    </div>
                  )}

                  {homeTab === 'firstTime' && (
                    <form
                      className="er-home-panel er-home-panel--top manual-entry-form cs-liquid-card er-main-panel-card"
                      onSubmit={(e) => void handleManualSubmit(e)}
                    >
                      <div style={{ fontWeight: 900, marginBottom: '0.75rem' }}>First Time Customer</div>
                      <div className="er-text-sm" style={{ color: '#94a3b8', marginBottom: '0.75rem', fontWeight: 700 }}>
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
                      <div className="form-actions">
                        <button
                          type="submit"
                          className="submit-btn cs-liquid-button"
                          disabled={
                            isSubmitting ||
                            manualEntrySubmitting ||
                            !manualFirstName.trim() ||
                            !manualLastName.trim() ||
                            !parseDobDigitsToIso(manualDobDigits)
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
                            selectHomeTab('scan');
                          }}
                          disabled={isSubmitting || manualEntrySubmitting}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                </div>
              </div>
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

          {offerUpgradeModal && session?.sessionToken && (
            <OfferUpgradeModal
              isOpen={true}
              onClose={() => setOfferUpgradeModal(null)}
              sessionToken={session.sessionToken}
              waitlistId={offerUpgradeModal.waitlistId}
              desiredTier={offerUpgradeModal.desiredTier}
              customerLabel={offerUpgradeModal.customerLabel}
              heldRoom={offerUpgradeModal.heldRoom ?? null}
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
                An existing customer already matches this First Name, Last Name, and Date of Birth. Do you want to continue?
              </div>

              {manualExistingPrompt?.matchCount && manualExistingPrompt.matchCount > 1 ? (
                <div style={{ color: '#f59e0b', fontWeight: 800 }}>
                  {manualExistingPrompt.matchCount} matching customers found. Showing best match:
                </div>
              ) : null}

              {manualExistingPrompt ? (
                <div className="cs-liquid-card" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{manualExistingPrompt.bestMatch.name}</div>
                  <div style={{ marginTop: '0.25rem', color: '#94a3b8', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span>
                      DOB:{' '}
                      <strong style={{ color: 'white' }}>
                        {manualExistingPrompt.bestMatch.dob || manualExistingPrompt.dobIso}
                      </strong>
                    </span>
                    {manualExistingPrompt.bestMatch.membershipNumber ? (
                      <span>
                        Membership:{' '}
                        <strong style={{ color: 'white' }}>{manualExistingPrompt.bestMatch.membershipNumber}</strong>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
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
                        const result = await startLaneSessionByCustomerId(manualExistingPrompt.bestMatch.id, {
                          suppressAlerts: true,
                        });
                        if (result.outcome === 'matched') {
                          setManualExistingPrompt(null);
                          setManualEntry(false);
                          setManualFirstName('');
                          setManualLastName('');
                          setManualDobDigits('');
                        }
                      } catch (err) {
                        setManualExistingPromptError(err instanceof Error ? err.message : 'Failed to load existing customer');
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
                  disabled={manualExistingPromptSubmitting || isSubmitting || !manualExistingPrompt || !session?.sessionToken}
                  onClick={() => {
                    if (!manualExistingPrompt || !session?.sessionToken) return;
                    void (async () => {
                      setManualExistingPromptSubmitting(true);
                      setManualExistingPromptError(null);
                      try {
                        const { firstName, lastName, dobIso } = manualExistingPrompt;
                        const createRes = await fetch(`${API_BASE}/v1/customers/create-manual`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${session.sessionToken}`,
                          },
                          body: JSON.stringify({ firstName, lastName, dob: dobIso }),
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
                        const result = await startLaneSessionByCustomerId(newId, { suppressAlerts: true });
                        if (result.outcome === 'matched') {
                          setManualExistingPrompt(null);
                          setManualEntry(false);
                          setManualFirstName('');
                          setManualLastName('');
                          setManualDobDigits('');
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

          <SuccessToast message={successToastMessage} onDismiss={() => setSuccessToastMessage(null)} />
          <PaymentDeclineToast message={paymentDeclineError} onDismiss={() => setPaymentDeclineError(null)} />
          <BottomToastStack toasts={bottomToasts} onDismiss={dismissBottomToast} />
          {scanToastMessage && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                zIndex: 2000,
              }}
              role="status"
              aria-label="Scan message"
              onClick={() => setScanToastMessage(null)}
            >
              <div
                className="cs-liquid-card"
                style={{
                  width: 'min(520px, 92vw)',
                  background: '#0f172a',
                  color: 'white',
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
                }}
                onClick={(e) => e.stopPropagation()}
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
                <div style={{ marginTop: '0.5rem', color: '#cbd5e1', fontWeight: 700 }}>
                  {scanToastMessage}
                </div>
              </div>
            </div>
          )}
          {/* Agreement + Assignment Display */}
          <TransactionCompleteModal
            isOpen={Boolean(currentSessionId && customerName && assignedResourceType && assignedResourceNumber)}
            agreementPending={!agreementSigned && selectionConfirmed && paymentStatus === 'PAID'}
            assignedLabel={assignedResourceType === 'room' ? 'Room' : 'Locker'}
            assignedNumber={assignedResourceNumber || '—'}
            checkoutAt={checkoutAt}
            verifyDisabled={!session?.sessionToken || !currentSessionIdRef.current}
            showComplete={Boolean(agreementSigned && assignedResourceType)}
            completeLabel={isSubmitting ? 'Processing...' : 'Complete Transaction'}
            completeDisabled={isSubmitting}
            onVerifyAgreementArtifacts={() => {
              const sid = currentSessionIdRef.current;
              if (!sid) return;
              setDocumentsModalOpen(true);
              void fetchDocumentsBySession(sid);
            }}
            onCompleteTransaction={() => void handleCompleteTransaction()}
          />

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

