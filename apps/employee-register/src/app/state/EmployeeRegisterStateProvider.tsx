import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AssignmentFailedPayload,
  type CheckoutChecklist,
  type CheckoutRequestSummary,
  getApiUrl,
  getCustomerMembershipStatus,
} from '@club-ops/shared';
import { getErrorMessage, isRecord, readJson } from '@club-ops/ui';
import { debounce } from '../../utils/debounce';
import { parseDobDigitsToIso } from '../../utils/dob';
import { useEmployeeRegisterTabletUiTweaks } from '../../hooks/useEmployeeRegisterTabletUiTweaks';
import { usePassiveScannerInput } from '../../usePassiveScannerInput';
import { useRegisterLaneSessionState } from '../useRegisterLaneSessionState';
import { useRegisterWebSocketEvents } from '../useRegisterWebSocketEvents';
import type { InventoryDrawerSection } from '../../components/inventory/InventoryDrawer';
import type { MultipleMatchCandidate } from '../../components/register/modals/MultipleMatchesModal';
import type { BottomToast } from '../../components/register/toasts/BottomToastStack';
import { deriveAssignedLabel } from '../../shared/derive/assignedLabel';
import { deriveCheckinStage } from '../../shared/derive/checkinStage';
import { derivePastDueLineItems } from '../../shared/derive/pastDueLineItems';
import { deriveWaitlistEligibility } from '../../shared/derive/waitlistEligibility';
import { RETAIL_CATALOG, type RetailCart } from '../../components/retail/retailCatalog';

type ScanResult =
  | { outcome: 'matched' }
  | { outcome: 'no_match'; message: string; canCreate?: boolean }
  | { outcome: 'error'; message: string };

export const EmployeeRegisterStateContext = createContext<any>(null);

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

export function EmployeeRegisterStateProvider({ children }: { children: ReactNode }) {
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
    | 'firstTime'
    | 'retail';
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
      setBottomToasts((prev) =>
        [{ id, message: toast.message, tone: toast.tone }, ...prev].slice(0, 4)
      );
      if (bottomToastTimersRef.current[id]) window.clearTimeout(bottomToastTimersRef.current[id]);
      bottomToastTimersRef.current[id] = window.setTimeout(() => dismissBottomToast(id), ttlMs);
    },
    [dismissBottomToast]
  );

  const [inventoryRefreshNonce, setInventoryRefreshNonce] = useState(0);
  const [checkoutPrefill, setCheckoutPrefill] = useState<null | {
    occupancyId?: string;
    number?: string;
  }>(null);
  const [checkoutEntryMode, setCheckoutEntryMode] = useState<'default' | 'direct-confirm'>(
    'default'
  );
  const checkoutReturnToTabRef = useRef<HomeTab | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualDobDigits, setManualDobDigits] = useState('');
  const manualDobIso = useMemo(() => parseDobDigitsToIso(manualDobDigits), [manualDobDigits]);
  const [manualIdNumber, setManualIdNumber] = useState('');
  const [manualEntrySubmitting, setManualEntrySubmitting] = useState(false);
  const [showAddOnSaleModal, setShowAddOnSaleModal] = useState(false);
  const [addOnCart, setAddOnCart] = useState<RetailCart>({});

  const resetAddOnCart = useCallback(() => setAddOnCart({}), []);

  const addAddOnItem = useCallback((itemId: string) => {
    setAddOnCart((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
  }, []);

  const removeAddOnItem = useCallback((itemId: string) => {
    setAddOnCart((prev) => {
      const next = { ...prev };
      const current = next[itemId] ?? 0;
      if (current <= 1) {
        delete next[itemId];
      } else {
        next[itemId] = current - 1;
      }
      return next;
    });
  }, []);

  const openAddOnSaleModal = useCallback(() => {
    setShowAddOnSaleModal(true);
  }, []);
  const closeAddOnSaleModal = useCallback(() => {
    setShowAddOnSaleModal(false);
    resetAddOnCart();
  }, [resetAddOnCart]);
  const [manualExistingPrompt, setManualExistingPrompt] = useState<null | {
    firstName: string;
    lastName: string;
    dobIso: string;
    idNumber?: string | null;
    matchCount: number;
    bestMatch: { id: string; name: string; membershipNumber?: string | null; dob?: string | null };
  }>(null);
  const [manualExistingPromptError, setManualExistingPromptError] = useState<string | null>(null);
  const [manualExistingPromptSubmitting, setManualExistingPromptSubmitting] = useState(false);
  const [inventoryForcedSection, setInventoryForcedSection] =
    useState<InventoryDrawerSection>(null);

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
    agreementBypassPending,
    agreementSignedMethod,
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
    (value: 'EN' | 'ES' | undefined) =>
      laneSessionActions.patch({ customerPrimaryLanguage: value }),
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

  const checkinStage = useMemo(
    () =>
      deriveCheckinStage({
        currentSessionId,
        customerName,
        assignedResourceType,
        assignedResourceNumber,
        agreementSigned,
        selectionConfirmed,
        customerPrimaryLanguage,
        membershipNumber: membershipNumber || null,
        customerMembershipValidUntil: customerMembershipValidUntil || null,
        membershipPurchaseIntent,
        membershipChoice,
      }),
    [
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
      selectionConfirmed,
    ]
  );
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
  const [membershipIdMode, setMembershipIdMode] = useState<'KEEP_EXISTING' | 'ENTER_NEW'>(
    'ENTER_NEW'
  );
  const [membershipIdSubmitting, setMembershipIdSubmitting] = useState(false);
  const [membershipIdError, setMembershipIdError] = useState<string | null>(null);
  const [membershipIdPromptedForSessionId, setMembershipIdPromptedForSessionId] = useState<
    string | null
  >(null);
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

  const handleLogout = async (options?: { signOutAll?: boolean }) => {
    const inProgress = Boolean(
      currentSessionId && customerName && customerName.trim().length > 0 && !checkoutAt
    );

    if (inProgress) {
      const confirmed = window.confirm(
        'A check-in is still in progress on this lane. Signing out will end the customer kiosk session. Continue?'
      );
      if (!confirmed) return;
      if (!session?.sessionToken) {
        alert('Not authenticated');
        return;
      }
      const resetResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.sessionToken}`,
        },
      });
      if (!resetResponse.ok) {
        const errorPayload: unknown = await resetResponse.json().catch(() => null);
        alert(getErrorMessage(errorPayload) || 'Failed to reset lane session');
        return;
      }
    }

    try {
      if (session?.sessionToken) {
        // IMPORTANT: release the register session (server-side) before logging out staff.
        // This makes the separate "menu sign out" redundant and keeps register availability correct.
        try {
          const endpoint = options?.signOutAll
            ? `${API_BASE}/v1/registers/signout-all`
            : `${API_BASE}/v1/registers/signout`;
          const body = options?.signOutAll ? {} : { deviceId };
          await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.sessionToken}`,
            },
            body: JSON.stringify(body),
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
    const confirmed = window.confirm(
      'Close Out: this will sign you out of all registers. Continue?'
    );
    if (!confirmed) return;
    await handleLogout({ signOutAll: true });
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
    const dobIso = manualDobIso;
    const idNumber = manualIdNumber.trim();
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
        bestMatch?: {
          id?: string;
          name?: string;
          membershipNumber?: string | null;
          dob?: string | null;
        } | null;
      };
      const best = data.bestMatch;
      const matchCount = typeof data.matchCount === 'number' ? data.matchCount : 0;
      if (best && typeof best.id === 'string' && typeof best.name === 'string') {
        // Show confirmation prompt instead of creating a duplicate immediately.
        setManualExistingPrompt({
          firstName,
          lastName,
          dobIso,
          idNumber: idNumber || null,
          matchCount,
          bestMatch: {
            id: best.id,
            name: best.name,
            membershipNumber: best.membershipNumber,
            dob: best.dob,
          },
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

      const result = await startLaneSessionByCustomerId(newId, { suppressAlerts: true });
      if (result.outcome === 'matched') {
        setManualEntry(false);
        setManualFirstName('');
        setManualLastName('');
        setManualDobDigits('');
        setManualIdNumber('');
      }
    } finally {
      setManualEntrySubmitting(false);
    }
  };

  const onBarcodeCaptured = useCallback(
    async (rawScanText: string): Promise<ScanResult> => {
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
        return {
          outcome: 'error',
          message: error instanceof Error ? error.message : 'Scan failed',
        };
      }
    },
    [lane, session?.sessionToken, startLaneSessionByCustomerId]
  );

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
        const cleanedScanText = rawScanText.trim();
        if (
          cleanedScanText === 'TZTAN' ||
          (cleanedScanText.length > 0 &&
            cleanedScanText.length <= 8 &&
            /^[A-Za-z]+$/.test(cleanedScanText))
        ) {
          passiveScanProcessingRef.current = false;
          setPassiveScanProcessing(false);
          hideScanOverlay();
          return;
        }
        setScanToastMessage(null);
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

  const computeScanIdleTimeout = useCallback((buffer: string) => {
    const trimmed = buffer.trim();
    if (!trimmed) return 250;
    const looksAamva =
      trimmed.startsWith('@') ||
      trimmed.includes('ANSI ') ||
      trimmed.includes('AAMVA') ||
      trimmed.includes('DL');
    if (!looksAamva) return 250;
    const hasCoreFields =
      trimmed.includes('DCS') &&
      trimmed.includes('DAC') &&
      (trimmed.includes('DBB') || trimmed.includes('DBD')) &&
      trimmed.includes('DAQ');
    return hasCoreFields ? 250 : 1200;
  }, []);

  usePassiveScannerInput({
    enabled: passiveScanEnabled,
    idleTimeoutMs: 250,
    enterGraceMs: 80,
    captureWhenEditable: false,
    enterTerminates: false,
    tabTerminates: false,
    getIdleTimeoutMs: computeScanIdleTimeout,
    onCaptureEnd: () => {
      // Only hide if a capture ended without processing (e.g. too-short scan).
      if (!passiveScanProcessingRef.current) hideScanOverlay();
    },
    onCancel: () => {
      passiveScanProcessingRef.current = false;
      setPassiveScanProcessing(false);
      hideScanOverlay();
    },
    onCapture: (raw) => {
      passiveScanProcessingRef.current = true;
      setPassiveScanProcessing(true);
      showScanOverlay();
      handlePassiveCapture(raw);
    },
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
      setInventoryHasLate(false);
      setInventoryRefreshNonce((prev) => prev + 1);
    } catch (error) {
      console.error('Failed to complete checkout:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Waitlist/Upgrades functions
  const fetchWaitlist = async () => {
    if (!session?.sessionToken || !registerSession) return;

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

      if (activeResponse.status === 401 || offeredResponse.status === 401) {
        localStorage.removeItem('staff_session');
        setSession(null);
        setRegisterSession(null);
        return;
      }

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
  const refreshWaitlistAndInventory = useCallback(() => {
    void fetchWaitlistRef.current?.();
    void fetchInventoryAvailableRef.current?.();
  }, []);

  // Fetch waitlist on mount and when session is available
  useEffect(() => {
    if (session?.sessionToken && registerSession) {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }
  }, [registerSession, session?.sessionToken]);

  // 60s polling fallback for waitlist + availability (WebSocket is primary)
  useEffect(() => {
    if (!session?.sessionToken || !registerSession) return;
    const interval = window.setInterval(() => {
      void fetchWaitlistRef.current?.();
      void fetchInventoryAvailableRef.current?.();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [registerSession, session?.sessionToken]);

  const sessionActive = !!currentSessionId;
  const assignedLabel = useMemo(
    () =>
      deriveAssignedLabel({
        assignedResourceType,
        proposedRentalType,
        customerSelectedType,
      }),
    [assignedResourceType, customerSelectedType, proposedRentalType]
  );

  const { isEntryOfferEligible, hasEligibleEntries } = useMemo(
    () =>
      deriveWaitlistEligibility(
        waitlistEntries,
        inventoryAvailable ? { rawRooms: inventoryAvailable.rawRooms } : null
      ),
    [inventoryAvailable, waitlistEntries]
  );
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
    if (
      entry.desiredTier !== 'STANDARD' &&
      entry.desiredTier !== 'DOUBLE' &&
      entry.desiredTier !== 'SPECIAL'
    ) {
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
      const markPaidResponse = await fetch(
        `${API_BASE}/v1/payments/${upgradePaymentIntentId}/mark-paid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({
            squareTransactionId: method === 'CASH' ? 'demo-cash-success' : 'demo-credit-success',
          }),
        }
      );

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
    // Poll API health so the badge recovers after transient startup failures.
    let cancelled = false;
    let intervalId: number | null = null;

    const checkHealth = async () => {
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
        if (!cancelled) {
          setHealth({
            status: 'down',
            timestamp: new Date().toISOString(),
            uptime: 0,
          });
        }
        console.error('Health check failed:', err);
      }
    };

    void checkHealth();
    intervalId = window.setInterval(() => {
      void checkHealth();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
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
      applySelectionForced: ({ rentalType }) =>
        laneSessionActions.applySelectionForced({ rentalType }),
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
      setShowAddOnSaleModal(false);
      resetAddOnCart();
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

  // ---------------------------------------------------------------------------
  // Polling fallback (mirrors customer-kiosk): keeps UI in sync if WS is flaky.
  // ---------------------------------------------------------------------------
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;

  const pollOnce = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (typeof kioskToken === 'string' && kioskToken) {
        headers['x-kiosk-token'] = kioskToken;
      }
      const res = await fetch(
        `${API_BASE}/v1/checkin/lane/${encodeURIComponent(lane)}/session-snapshot`,
        { headers }
      );
      if (!res.ok) return;
      const data = await readJson<unknown>(res);
      if (!isRecord(data)) return;
      const sessionPayload = data['session'];
      if (sessionPayload == null) {
        laneSessionActions.resetCleared();
        return;
      }
      if (isRecord(sessionPayload)) {
        laneSessionActions.applySessionUpdated(sessionPayload as any);
      }
    } catch {
      // Best-effort; polling is a fallback.
    }
  }, [kioskToken, lane, laneSessionActions]);

  const pollingDelayTimerRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (pollingDelayTimerRef.current !== null) {
      window.clearTimeout(pollingDelayTimerRef.current);
      pollingDelayTimerRef.current = null;
    }
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (wsConnected) return;

    pollingDelayTimerRef.current = window.setTimeout(() => {
      if (wsConnected) return;
      void pollOnce();
      pollingIntervalRef.current = window.setInterval(() => {
        void pollOnce();
      }, 2000);
    }, 1200);

    return () => {
      if (pollingDelayTimerRef.current !== null) {
        window.clearTimeout(pollingDelayTimerRef.current);
        pollingDelayTimerRef.current = null;
      }
      if (pollingIntervalRef.current !== null) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [pollOnce, wsConnected]);

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
    step: 'LANGUAGE' | 'MEMBERSHIP' | 'WAITLIST_BACKUP';
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
      await pollOnce();
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
      await pollOnce();
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
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.sessionToken}`,
          },
          body: JSON.stringify({ intent, sessionId: currentSessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(errorPayload) || 'Failed to set membership purchase intent'
        );
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to set membership purchase intent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProposeSelection = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const availableCount =
        inventoryAvailable?.rooms?.[rentalType] ??
        (rentalType === 'LOCKER' ? inventoryAvailable?.lockers : undefined);
      const waitlistDesiredType = availableCount === 0 ? rentalType : undefined;

      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ rentalType, proposedBy: 'EMPLOYEE', waitlistDesiredType }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to propose selection');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerSelectRental = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId) return;
    setIsSubmitting(true);
    try {
      const availableCount =
        inventoryAvailable?.rooms?.[rentalType] ??
        (rentalType === 'LOCKER' ? inventoryAvailable?.lockers : undefined);
      if (availableCount === 0) {
        await fetch(`${API_BASE}/v1/checkin/lane/${lane}/waitlist-desired`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(typeof kioskToken === 'string' && kioskToken
              ? { 'x-kiosk-token': kioskToken }
              : {}),
          },
          body: JSON.stringify({ waitlistDesiredType: rentalType }),
        });
        await pollOnce();
        return;
      }

      // Public endpoint; customer selections should proceed directly to payment.
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ rentalType, proposedBy: 'CUSTOMER' }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select rental');
      }
      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ confirmedBy: 'CUSTOMER' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select rental');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectWaitlistBackupAsCustomer = async (
    rentalType: 'LOCKER' | 'STANDARD' | 'DOUBLE' | 'SPECIAL'
  ) => {
    if (!currentSessionId || !waitlistDesiredTier) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({
          rentalType,
          proposedBy: 'CUSTOMER',
          waitlistDesiredType: waitlistDesiredTier,
          backupRentalType: rentalType,
        }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to select waitlist backup');
      }
      const confirmResponse = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/confirm-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof kioskToken === 'string' && kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
        },
        body: JSON.stringify({ confirmedBy: 'CUSTOMER' }),
      });
      if (!confirmResponse.ok) {
        const errorPayload: unknown = await confirmResponse.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm selection');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to select waitlist backup');
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
      await pollOnce();
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(
        error instanceof Error ? error.message : 'Failed to confirm selection. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartAgreementBypass = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/agreement-bypass`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to bypass agreement');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to bypass agreement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPhysicalAgreement = async () => {
    if (!currentSessionId || !session?.sessionToken) return;
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
          body: JSON.stringify({ sessionId: currentSessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to confirm physical agreement');
      }
      await pollOnce();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to confirm physical agreement');
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
  }, [
    currentSessionId,
    lane,
    session?.sessionToken,
    setPaymentIntentId,
    setPaymentQuote,
    setPaymentStatus,
  ]);

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

  const handleAddOnSaleToCheckin = useCallback(async () => {
    if (!currentSessionId || !session?.sessionToken) {
      alert('Not authenticated');
      return;
    }
    if (!paymentIntentId) {
      alert('No active payment intent for this session.');
      return;
    }

    const items = Object.entries(addOnCart)
      .map(([id, quantity]) => {
        const catalogItem = RETAIL_CATALOG.find((item) => item.id === id);
        if (!catalogItem || quantity <= 0) return null;
        return {
          label: catalogItem.label,
          quantity,
          unitPrice: catalogItem.price,
        };
      })
      .filter(
        (item): item is { label: string; quantity: number; unitPrice: number } => Boolean(item)
      );

    if (items.length === 0) {
      alert('Add at least one item to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/add-ons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: currentSessionId, items }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to add add-on items');
      }

      const payload = await readJson<{
        quote?: {
          total: number;
          lineItems: Array<{ description: string; amount: number }>;
          messages: string[];
        };
      }>(response);

      if (payload.quote) {
        setPaymentQuote(payload.quote);
      }

      setShowAddOnSaleModal(false);
      resetAddOnCart();
      setSuccessToastMessage('Add-on items added to check-in.');
    } catch (error) {
      console.error('Failed to add add-on items:', error);
      alert(error instanceof Error ? error.message : 'Failed to add add-on items');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    addOnCart,
    currentSessionId,
    lane,
    paymentIntentId,
    resetAddOnCart,
    session?.sessionToken,
    setPaymentQuote,
    setSuccessToastMessage,
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
      setMembershipIdError(
        error instanceof Error ? error.message : 'Failed to save membership number'
      );
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

  const pastDueLineItems = useMemo(
    () => derivePastDueLineItems(customerNotes, pastDueBalance),
    [customerNotes, pastDueBalance]
  );

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
      resetAddOnCart();
      setShowAddOnSaleModal(false);
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

  const value = {
    deviceId,
    handleRegisterSignIn,
    lane,
    health,
    wsConnected,
    handleLogout,
    handleCloseOut,
    registerSession,
    session,
    scanOverlayMounted,
    scanOverlayActive,
    scanToastMessage,
    setScanToastMessage,
    checkoutRequests,
    selectedCheckoutRequest,
    checkoutItemsConfirmed,
    checkoutFeePaid,
    handleClaimCheckout,
    openCustomerAccount,
    handleConfirmItems,
    handleMarkFeePaid,
    handleCompleteCheckout,
    setSelectedCheckoutRequest,
    setCheckoutChecklist,
    setCheckoutItemsConfirmed,
    setCheckoutFeePaid,
    homeTab,
    selectHomeTab,
    inventoryHasLate,
    setInventoryHasLate,
    hasEligibleEntries,
    isEntryOfferEligible,
    dismissUpgradePulse,
    startCheckoutFromHome,
    startCheckoutFromInventory,
    startCheckoutFromCustomerAccount,
    exitCheckout,
    accountCustomerId,
    accountCustomerLabel,
    laneSession,
    laneSessionActions,
    currentSessionId,
    customerName,
    membershipNumber,
    customerMembershipValidUntil,
    membershipPurchaseIntent,
    membershipChoice,
    allowedRentals,
    proposedRentalType,
    proposedBy,
    selectionConfirmed,
    customerPrimaryLanguage,
    customerDobMonthDay,
    customerLastVisitAt,
    checkinStage,
    customerNotes,
    customerSelectedType,
    waitlistDesiredTier,
    waitlistBackupType,
    inventoryAvailable,
    assignedResourceType,
    assignedResourceNumber,
    checkoutAt,
    agreementSigned,
    agreementBypassPending,
    agreementSignedMethod,
    paymentIntentId,
    paymentQuote,
    paymentStatus,
    paymentDeclineError,
    pastDueBlocked,
    pastDueBalance,
    isSubmitting,
    highlightKioskOption,
    handleConfirmLanguage,
    handleConfirmMembershipOneTime,
    handleConfirmMembershipSixMonth,
    handleProposeSelection,
    handleCustomerSelectRental,
    handleSelectWaitlistBackupAsCustomer,
    handleConfirmSelection,
    handleClearSession,
    handleInventorySelect,
    startLaneSessionByCustomerId,
    handleManualSubmit,
    setManualEntry,
    manualFirstName,
    setManualFirstName,
    manualLastName,
    setManualLastName,
    manualDobDigits,
    setManualDobDigits,
    manualDobIso,
    manualIdNumber,
    setManualIdNumber,
    manualEntrySubmitting,
    manualExistingPrompt,
    manualExistingPromptError,
    manualExistingPromptSubmitting,
    setManualExistingPrompt,
    setManualExistingPromptError,
    setManualExistingPromptSubmitting,
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
    inventoryForcedSection,
    setInventoryForcedSection,
    selectedInventoryItem,
    setSelectedInventoryItem,
    inventoryRefreshNonce,
    setInventoryRefreshNonce,
    waitlistEntries,
    showWaitlistModal,
    setShowWaitlistModal,
    offerUpgradeModal,
    setOfferUpgradeModal,
    openOfferUpgradeModal,
    resetUpgradeState,
    setSelectedWaitlistEntry,
    handleStartUpgradePayment,
    refreshWaitlistAndInventory,
    checkoutEntryMode,
    checkoutPrefill,
    checkoutReturnToTabRef,
    showCustomerConfirmationPending,
    customerConfirmationType,
    setShowCustomerConfirmationPending,
    setCustomerConfirmationType,
    pendingScanResolution,
    scanResolutionError,
    scanResolutionSubmitting,
    setPendingScanResolution,
    setScanResolutionError,
    resolvePendingScanSelection,
    showCreateFromScanPrompt,
    pendingCreateFromScan,
    createFromScanError,
    createFromScanSubmitting,
    setShowCreateFromScanPrompt,
    setPendingCreateFromScan,
    setCreateFromScanError,
    setCreateFromScanSubmitting,
    handleCreateFromNoMatch,
    showPastDueModal,
    setShowPastDueModal,
    handlePastDuePayment,
    pastDueLineItems,
    showManagerBypassModal,
    setShowManagerBypassModal,
    managerList,
    managerId,
    managerPin,
    setManagerId,
    setManagerPin,
    handleManagerBypass,
    showMembershipIdPrompt,
    membershipIdMode,
    membershipIdInput,
    membershipIdError,
    membershipIdSubmitting,
    setShowMembershipIdPrompt,
    setMembershipIdMode,
    setMembershipIdInput,
    setMembershipIdError,
    handleCompleteMembershipPurchase,
    showAddOnSaleModal,
    setShowAddOnSaleModal,
    openAddOnSaleModal,
    closeAddOnSaleModal,
    addOnCart,
    addAddOnItem,
    removeAddOnItem,
    handleAddOnSaleToCheckin,
    upgradeContext,
    showUpgradePaymentModal,
    setShowUpgradePaymentModal,
    upgradeOriginalCharges,
    upgradeOriginalTotal,
    upgradeFee,
    upgradePaymentStatus,
    upgradePaymentIntentId,
    handleUpgradePaymentFlow,
    handleUpgradePaymentDecline,
    showAddNoteModal,
    setShowAddNoteModal,
    newNoteText,
    setNewNoteText,
    handleAddNote,
    successToastMessage,
    setSuccessToastMessage,
    bottomToasts,
    dismissBottomToast,
    setPaymentDeclineError,
    assignedLabel,
    currentSessionIdRef,
    documentsModalOpen,
    setDocumentsModalOpen,
    documentsLoading,
    documentsError,
    documentsForSession,
    setDocumentsError,
    fetchDocumentsBySession,
    downloadAgreementPdf,
    handleStartAgreementBypass,
    handleConfirmPhysicalAgreement,
    handleCompleteTransaction,
    handleDemoPayment,
  };

  return (
    <EmployeeRegisterStateContext.Provider value={value}>
      {children}
    </EmployeeRegisterStateContext.Provider>
  );
}
