import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  safeParseWebSocketEvent,
  type CustomerConfirmationRequiredPayload,
} from '@club-ops/shared';
import { useLaneSession } from '@club-ops/shared';
import { safeJsonParse, isRecord, getErrorMessage, readJson } from '@club-ops/ui';
import { t, type Language } from '../i18n';
import { getMembershipStatus, type SessionState } from '../utils/membership';
import { IdleScreen } from '../screens/IdleScreen';
import { LanguageScreen } from '../screens/LanguageScreen';
import { SelectionScreen } from '../screens/SelectionScreen';
import { PaymentScreen } from '../screens/PaymentScreen';
import { AgreementScreen, type Agreement } from '../screens/AgreementScreen';
import { CompleteScreen } from '../screens/CompleteScreen';
import { UpgradeDisclaimerModal } from '../components/modals/UpgradeDisclaimerModal';
import { CustomerConfirmationModal } from '../components/modals/CustomerConfirmationModal';
import { WaitlistModal } from '../components/modals/WaitlistModal';
import { RenewalDisclaimerModal } from '../components/modals/RenewalDisclaimerModal';
import { MembershipModal } from '../components/modals/MembershipModal';
import { getApiUrl } from '@/lib/apiBase';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

type AppView = 'idle' | 'language' | 'selection' | 'payment' | 'agreement' | 'complete';

export function AppRoot() {
  const [, setHealth] = useState<HealthStatus | null>(null);
  const [, setWsConnected] = useState(false);
  const [isPortrait, setIsPortrait] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerHeight >= window.innerWidth;
  });
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    customerName: null,
    membershipNumber: null,
    allowedRentals: [],
  });
  const [view, setView] = useState<AppView>('idle');
  const [selectedRental, setSelectedRental] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showUpgradeDisclaimer, setShowUpgradeDisclaimer] = useState(false);
  const [upgradeAction, setUpgradeAction] = useState<'waitlist' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkinMode, setCheckinMode] = useState<'INITIAL' | 'RENEWAL' | null>(null);
  const [showRenewalDisclaimer, setShowRenewalDisclaimer] = useState(false);
  const [showCustomerConfirmation, setShowCustomerConfirmation] = useState(false);
  const [customerConfirmationData, setCustomerConfirmationData] =
    useState<CustomerConfirmationRequiredPayload | null>(null);
  const [inventory, setInventory] = useState<{
    rooms: Record<string, number>;
    lockers: number;
  } | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [waitlistDesiredType, setWaitlistDesiredType] = useState<string | null>(null);
  const [waitlistBackupType, setWaitlistBackupType] = useState<string | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [waitlistETA, setWaitlistETA] = useState<string | null>(null);
  const [waitlistUpgradeFee, setWaitlistUpgradeFee] = useState<number | null>(null);
  const [proposedRentalType, setProposedRentalType] = useState<string | null>(null);
  const [proposedBy, setProposedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(null);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [selectionConfirmedBy, setSelectionConfirmedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(
    null
  );
  // Selection acknowledgement is tracked for gating/coordination (currently no direct UI).
  const [, setSelectionAcknowledged] = useState(true);
  const [, setUpgradeDisclaimerAcknowledged] = useState(false);
  const [hasScrolledAgreement, setHasScrolledAgreement] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const agreementScrollRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const idleTimeoutRef = useRef<number | null>(null);
  const welcomeOverlayTimeoutRef = useRef<number | null>(null);
  const lastWelcomeSessionIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [membershipModalIntent, setMembershipModalIntent] = useState<'PURCHASE' | 'RENEW' | null>(
    null
  );
  const [membershipChoice, setMembershipChoice] = useState<'ONE_TIME' | 'SIX_MONTH' | null>(null);
  const [highlightedLanguage, setHighlightedLanguage] = useState<'EN' | 'ES' | null>(null);
  const [highlightedMembershipChoice, setHighlightedMembershipChoice] = useState<
    'ONE_TIME' | 'SIX_MONTH' | null
  >(null);

  // Inject pulse animation for proposal highlight
  useEffect(() => {
    const styleId = 'pulse-bright-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        @keyframes pulse-bright {
          0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.35); }
          50% { box-shadow: 0 0 0 12px rgba(255,255,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .pulse-bright {
          animation: pulse-bright 1s ease-in-out infinite;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    sessionIdRef.current = session.sessionId;
  }, [session.sessionId]);

  // Explicit membership choice step (non-members only): reset when session changes.
  useEffect(() => {
    setMembershipChoice(null);
  }, [session.sessionId]);

  // If the server has a membershipChoice persisted, reflect it locally so the kiosk flow
  // can be coordinated with employee-register (e.g. staff-selected ONE_TIME).
  useEffect(() => {
    if (session.membershipChoice === 'ONE_TIME' && membershipChoice !== 'ONE_TIME') {
      setMembershipChoice('ONE_TIME');
      return;
    }
    if (session.membershipChoice === 'SIX_MONTH' && membershipChoice !== 'SIX_MONTH') {
      setMembershipChoice('SIX_MONTH');
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId, session.membershipChoice]);

  // If the server indicates a 6-month membership intent is already selected, reflect it in the explicit choice step.
  // (We intentionally do NOT auto-select ONE_TIME when intent is null.)
  useEffect(() => {
    const status = getMembershipStatus(session, Date.now());
    const isMember = status === 'ACTIVE' || status === 'PENDING';
    if (isMember) return;
    if (session.membershipPurchaseIntent && membershipChoice !== 'SIX_MONTH') {
      setMembershipChoice('SIX_MONTH');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId, session.membershipPurchaseIntent, session.membershipValidUntil, session.membershipNumber]);

  // Get lane from URL pathname pattern, query param, or sessionStorage fallback
  // Priority: /register-1 => lane-1, /register-2 => lane-2, etc.
  // Secondary: ?lane=lane-2 query param
  // Fallback: sessionStorage (NOT localStorage - localStorage is shared across tabs)
  // Default: lane-1
  // Memoize to prevent unnecessary re-renders
  const lane = useMemo(() => {
    // Check pathname patterns: /register-1, /register-2, etc.
    const pathMatch = window.location.pathname.match(/\/register-(\d+)/);
    if (pathMatch) {
      return `lane-${pathMatch[1]}`;
    }

    // Check query param
    const params = new URLSearchParams(window.location.search);
    const queryLane = params.get('lane');
    if (queryLane) {
      return queryLane;
    }

    // Check sessionStorage fallback (per-tab, not shared)
    try {
      const stored = sessionStorage.getItem('lane');
      if (stored) {
        return stored;
      }
    } catch {
      // sessionStorage might not be available
    }

    // Default
    return 'lane-1';
  }, []); // Empty deps - lane should only be computed once on mount

  // Store in sessionStorage for persistence within this tab
  useEffect(() => {
    try {
      sessionStorage.setItem('lane', lane);
    } catch {
      // Ignore if sessionStorage unavailable
    }
  }, [lane]);

  useEffect(() => {
    const handleOrientation = () => {
      setIsPortrait(window.innerHeight >= window.innerWidth);
    };
    handleOrientation();
    window.addEventListener('resize', handleOrientation);
    window.addEventListener('orientationchange', handleOrientation);
    return () => {
      window.removeEventListener('resize', handleOrientation);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  const orientationOverlay = !isPortrait ? (
    <div className="orientation-blocker">
      <div>
        <h1>{t(session.customerPrimaryLanguage, 'orientation.title')}</h1>
        <p>{t(session.customerPrimaryLanguage, 'orientation.body')}</p>
      </div>
    </div>
  ) : null;

  const API_BASE = getApiUrl('/api');
  const rawEnv = import.meta.env as unknown as Record<string, unknown>;
  const kioskToken =
    typeof rawEnv.VITE_KIOSK_TOKEN === 'string' && rawEnv.VITE_KIOSK_TOKEN.trim()
      ? rawEnv.VITE_KIOSK_TOKEN.trim()
      : null;
  const kioskAuthHeaders = (extra?: Record<string, string>) => {
    return {
      ...(extra ?? {}),
      ...(kioskToken ? { 'x-kiosk-token': kioskToken } : {}),
    };
  };

  const resetToIdle = useCallback(() => {
    setView('idle');
    setSession({
      sessionId: null,
      customerName: null,
      membershipNumber: null,
      membershipValidUntil: null,
      membershipPurchaseIntent: null,
      allowedRentals: [],
      blockEndsAt: undefined,
    });
    setSelectedRental(null);
    setAgreed(false);
    setSignatureData(null);
    setShowUpgradeDisclaimer(false);
    setUpgradeAction(null);
    setShowRenewalDisclaimer(false);
    setCheckinMode(null);
    setShowWaitlistModal(false);
    setWaitlistDesiredType(null);
    setWaitlistBackupType(null);
    setProposedRentalType(null);
    setProposedBy(null);
    setSelectionConfirmed(false);
    setSelectionConfirmedBy(null);
    setSelectionAcknowledged(false);
    setUpgradeDisclaimerAcknowledged(false);
    setHasScrolledAgreement(false);
    setHighlightedLanguage(null);
    setHighlightedMembershipChoice(null);
  }, []);

  const applySessionUpdatedPayload = useCallback(
    (payload: Record<string, any>) => {
      // Update session state with all fields
      setSession((prev) => ({
        ...prev,
        sessionId: payload.sessionId || null,
        customerName: payload.customerName,
        membershipNumber: payload.membershipNumber || null,
        membershipValidUntil: payload.customerMembershipValidUntil || null,
        membershipChoice: payload.membershipChoice ?? null,
        membershipPurchaseIntent: payload.membershipPurchaseIntent || null,
        kioskAcknowledgedAt: payload.kioskAcknowledgedAt || null,
        allowedRentals: payload.allowedRentals,
        visitId: payload.visitId,
        mode: payload.mode,
        blockEndsAt: payload.blockEndsAt,
        customerPrimaryLanguage: payload.customerPrimaryLanguage,
        pastDueBlocked: payload.pastDueBlocked,
        pastDueBalance: payload.pastDueBalance,
        paymentStatus: payload.paymentStatus,
        paymentTotal: payload.paymentTotal,
        paymentLineItems: payload.paymentLineItems,
        paymentFailureReason: payload.paymentFailureReason,
        agreementSigned: payload.agreementSigned,
        assignedResourceType: payload.assignedResourceType,
        assignedResourceNumber: payload.assignedResourceNumber,
        checkoutAt: payload.checkoutAt,
      }));

      // Set check-in mode from payload
      if (payload.mode) {
        setCheckinMode(payload.mode);
      }

      // Handle view transitions based on session state
      // First check: Reset to idle if session is completed and cleared
      if (payload.status === 'COMPLETED' && (!payload.customerName || payload.customerName === '')) {
        resetToIdle();
        return;
      }

      // If we have assignment, show complete view (highest priority after reset)
      if (payload.assignedResourceType && payload.assignedResourceNumber) {
        setView('complete');
        return;
      }

      // If kiosk acknowledged, stay idle (lane still locked until employee-register completes/reset).
      if (payload.kioskAcknowledgedAt && payload.status !== 'COMPLETED') {
        setView('idle');
        return;
      }

      // Language selection (first visit). This should happen before any other customer-facing step.
      if (payload.sessionId && payload.status !== 'COMPLETED' && !payload.customerPrimaryLanguage) {
        setView('language');
        return;
      }

      // Past-due block screen (shows selection but disabled)
      if (payload.pastDueBlocked) {
        setView('selection');
        return;
      }

      // Agreement screen (after payment is PAID, before assignment)
      if (
        payload.paymentStatus === 'PAID' &&
        !payload.agreementSigned &&
        (payload.mode === 'INITIAL' || payload.mode === 'RENEWAL')
      ) {
        setView('agreement');
        return;
      }

      // Payment pending screen (after selection confirmed, before payment)
      if (payload.selectionConfirmed && payload.paymentStatus === 'DUE') {
        setView('payment');
        return;
      }

      // Selection view (default active session state)
      if (payload.sessionId && payload.status !== 'COMPLETED') {
        setView('selection');
      }

      // Update selection state
      if (payload.proposedRentalType) {
        setProposedRentalType(payload.proposedRentalType);
        setProposedBy(payload.proposedBy || null);
      }
      if (payload.selectionConfirmed !== undefined) {
        setSelectionConfirmed(Boolean(payload.selectionConfirmed));
        setSelectionConfirmedBy(payload.selectionConfirmedBy || null);
      }
    },
    [resetToIdle]
  );

  const onWsMessage = useCallback((event: MessageEvent) => {
    try {
      const parsed: unknown = safeJsonParse(String(event.data));
      const message = safeParseWebSocketEvent(parsed);
      if (!message) return;
      console.log('WebSocket message:', message);

      if (message.type === 'SESSION_UPDATED') {
        const payload = message.payload;
        if (payload && typeof payload === 'object') {
          applySessionUpdatedPayload(payload as Record<string, any>);
        }
      } else if (message.type === 'SELECTION_PROPOSED') {
        const payload = message.payload;
        if (payload.sessionId === sessionIdRef.current) {
          setProposedRentalType(payload.rentalType);
          setProposedBy(payload.proposedBy);
        }
      } else if (message.type === 'SELECTION_LOCKED' || message.type === 'SELECTION_FORCED') {
        const payload = message.payload;
        if (payload.sessionId === sessionIdRef.current) {
          setSelectionConfirmed(true);
          setSelectionConfirmedBy('EMPLOYEE');
          setSelectedRental(payload.rentalType);
          setSelectionAcknowledged(true);
          setView('payment');
        }
      } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
        setSelectionAcknowledged(true);
      } else if (message.type === 'CHECKIN_OPTION_HIGHLIGHTED') {
        const payload = message.payload;
        if (payload.sessionId !== sessionIdRef.current) return;
        if (payload.step === 'LANGUAGE') {
          const opt = payload.option === 'EN' || payload.option === 'ES' ? payload.option : null;
          setHighlightedLanguage(opt);
        } else if (payload.step === 'MEMBERSHIP') {
          const opt =
            payload.option === 'ONE_TIME' || payload.option === 'SIX_MONTH' ? payload.option : null;
          setHighlightedMembershipChoice(opt);
        }
      } else if (message.type === 'CUSTOMER_CONFIRMATION_REQUIRED') {
        const payload = message.payload;
        setCustomerConfirmationData(payload);
        setShowCustomerConfirmation(true);
      } else if (message.type === 'ASSIGNMENT_CREATED') {
        const payload = message.payload;
        // Assignment successful - could show confirmation message
        console.log('Assignment created:', payload);
      } else if (message.type === 'INVENTORY_UPDATED') {
        const payload = message.payload;
        // Update inventory counts for availability warnings
        if (payload.inventory) {
          const rooms: Record<string, number> = {};
          if (payload.inventory.byType) {
            Object.entries(payload.inventory.byType).forEach(([type, summary]) => {
              rooms[type] = summary.clean;
            });
          }
          setInventory({
            rooms,
            lockers: payload.inventory.lockers?.clean || 0,
          });
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [applySessionUpdatedPayload]);

  const { connected: wsConnected, lastMessage } = useLaneSession({
    laneId: lane,
    role: 'customer',
    kioskToken: kioskToken ?? '',
    enabled: true,
  });

  useEffect(() => {
    if (!lastMessage) return;
    onWsMessage(lastMessage);
  }, [lastMessage, onWsMessage]);

  useEffect(() => {
    setWsConnected(wsConnected);
  }, [wsConnected]);

  // Polling fallback: if WS is down, fetch session snapshots until it recovers.
  const pollingStartedRef = useRef(false);
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
    pollingStartedRef.current = false;

    if (wsConnected) return;

    // Give the WS a moment to connect before we start polling.
    pollingDelayTimerRef.current = window.setTimeout(() => {
      if (wsConnected) return;
      if (!pollingStartedRef.current) {
        pollingStartedRef.current = true;
        console.info('[customer-kiosk] WS disconnected; entering polling fallback');
      }

      const pollOnce = async () => {
        try {
          const res = await fetch(
            `${API_BASE}/v1/checkin/lane/${encodeURIComponent(lane)}/session-snapshot`,
            { headers: kioskAuthHeaders() }
          );
          if (!res.ok) return;
          const data = await readJson<unknown>(res);
          if (!isRecord(data)) return;
          const sessionPayload = data['session'];
          if (sessionPayload == null) {
            resetToIdle();
            return;
          }
          if (isRecord(sessionPayload)) {
            applySessionUpdatedPayload(sessionPayload as Record<string, any>);
          }
        } catch {
          // Best-effort; keep polling.
        }
      };

      void pollOnce();
      pollingIntervalRef.current = window.setInterval(() => {
        void pollOnce();
      }, 1500);
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
      pollingStartedRef.current = false;
    };
  }, [API_BASE, applySessionUpdatedPayload, lane, resetToIdle, wsConnected]);

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

    // Fetch initial inventory
    fetch(`${API_BASE}/v1/inventory/available`)
      .then((res) => res.json())
      .then((data: unknown) => {
        if (isRecord(data) && isRecord(data.rooms) && typeof data.lockers === 'number') {
          setInventory({ rooms: data.rooms as Record<string, number>, lockers: data.lockers });
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [lane]);

  // Show a brief welcome overlay when a new session becomes active
  useEffect(() => {
    const sessionId = session.sessionId;
    if (!sessionId) return;
    if (lastWelcomeSessionIdRef.current === sessionId) return;
    if (view === 'idle') return;

    lastWelcomeSessionIdRef.current = sessionId;
    setShowWelcomeOverlay(true);

    if (welcomeOverlayTimeoutRef.current !== null) {
      window.clearTimeout(welcomeOverlayTimeoutRef.current);
      welcomeOverlayTimeoutRef.current = null;
    }
    welcomeOverlayTimeoutRef.current = window.setTimeout(() => {
      setShowWelcomeOverlay(false);
      welcomeOverlayTimeoutRef.current = null;
    }, 2000);
  }, [session.sessionId, view]);

  useEffect(() => {
    return () => {
      if (welcomeOverlayTimeoutRef.current !== null) {
        window.clearTimeout(welcomeOverlayTimeoutRef.current);
        welcomeOverlayTimeoutRef.current = null;
      }
    };
  }, []);

  // Ensure agreement view redirects for non-INITIAL/RENEWAL modes
  useEffect(() => {
    if (view === 'agreement' && checkinMode !== 'INITIAL' && checkinMode !== 'RENEWAL') {
      setView('complete');
    }
  }, [view, checkinMode]);

  const WelcomeOverlay = () => {
    if (!showWelcomeOverlay) return null;
    const lang = session.customerPrimaryLanguage;
    return (
      <div
        className="welcome-overlay"
        onClick={() => setShowWelcomeOverlay(false)}
        role="dialog"
        aria-label={t(lang, 'a11y.welcomeDialog')}
      >
        <div className="welcome-overlay-content">
          <div className="welcome-overlay-message">
            {t(lang, 'welcome')}
            {session.customerName ? `, ${session.customerName}` : ''}
          </div>
        </div>
      </div>
    );
  };

  // Load active agreement when agreement view is shown
  useEffect(() => {
    const lang = session.customerPrimaryLanguage;
    if (view === 'agreement') {
      fetch(`${API_BASE}/v1/agreements/active`)
        .then((res) => res.json())
        .then((data: Agreement) => {
          setAgreement({
            id: data.id,
            version: data.version,
            title: lang === 'ES' ? t(lang, 'agreementTitle') : data.title,
            bodyText: lang === 'ES' ? t(lang, 'agreement.legalBodyHtml') : data.bodyText,
          });
        })
        .catch((error) => {
          console.error('Failed to load agreement:', error);
          alert(t(lang, 'error.loadAgreement'));
        });
    }
  }, [view, session.customerPrimaryLanguage]);

  const handleRentalSelection = async (rental: string) => {
    if (!session.sessionId) {
      alert(t(session.customerPrimaryLanguage, 'error.noActiveSession'));
      return;
    }

    const availableCount =
      inventory?.rooms[rental] ||
      (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
      0;

    // If unavailable, show waitlist modal
    if (availableCount === 0) {
      setWaitlistDesiredType(rental);
      // Fetch waitlist info (position, ETA, upgrade fee)
      try {
        const response = await fetch(
          `${API_BASE}/v1/checkin/lane/${lane}/waitlist-info?desiredTier=${rental}&currentTier=${selectedRental || 'LOCKER'}`
        );
        if (response.ok) {
          const data: unknown = await response.json();
          if (isRecord(data)) {
            setWaitlistPosition(typeof data.position === 'number' ? data.position : null);
            setWaitlistETA(
              typeof data.estimatedReadyAt === 'string' ? data.estimatedReadyAt : null
            );
            setWaitlistUpgradeFee(typeof data.upgradeFee === 'number' ? data.upgradeFee : null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch waitlist info:', error);
      }
      setShowWaitlistModal(true);
      return;
    }

    setIsSubmitting(true);

    try {
      // Propose selection (customer proposes)
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          rentalType: rental,
          proposedBy: 'CUSTOMER',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          setView('language');
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to propose selection');
      }

      await response.json().catch(() => null);
      setProposedRentalType(rental);
      setProposedBy('CUSTOMER');
      setIsSubmitting(false);
    } catch (error) {
      console.error('Failed to propose selection:', error);
      // Customer-facing UI: keep it generic (server errors may not be localized).
      alert(t(session.customerPrimaryLanguage, 'error.processSelection'));
      setIsSubmitting(false);
    }
  };

  const handleDisclaimerAcknowledge = async () => {
    if (!session.sessionId || !upgradeAction) return;

    // Upgrade disclaimer is informational only - no signature required
    // Store acknowledgement and propose backup selection
    try {
      const backupType = waitlistBackupType || selectedRental || 'LOCKER';

      // Propose the backup rental type with waitlist info
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          rentalType: backupType,
          proposedBy: 'CUSTOMER',
          waitlistDesiredType: waitlistDesiredType || undefined,
          backupRentalType: backupType,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          setView('language');
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to process waitlist selection');
      }

      setUpgradeDisclaimerAcknowledged(true);
      setShowUpgradeDisclaimer(false);
      setUpgradeAction(null);
      setProposedRentalType(backupType);
      setProposedBy('CUSTOMER');

      // After acknowledging upgrade disclaimer, customer should confirm the backup selection
      // Then proceed to agreement if INITIAL/RENEWAL
    } catch (error) {
      console.error('Failed to acknowledge upgrade disclaimer:', error);
      alert(t(session.customerPrimaryLanguage, 'error.process'));
    }
  };

  const handleWaitlistBackupSelection = (rental: string) => {
    if (!session.sessionId || !waitlistDesiredType) {
      return;
    }

    const availableCount =
      inventory?.rooms[rental] ||
      (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
      0;
    if (availableCount === 0) {
      alert(t(session.customerPrimaryLanguage, 'error.rentalNotAvailable'));
      return;
    }

    setWaitlistBackupType(rental);
    setShowWaitlistModal(false);

    // Show upgrade disclaimer modal
    setUpgradeAction('waitlist');
    setShowUpgradeDisclaimer(true);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current !== null) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    };
  }, []);

  // Initialize signature canvas
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (canvas && view === 'agreement') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Fill white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Set black ink for signature
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [view]);

  const handleSignatureStart = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    isDrawingRef.current = true;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    // Translate pointer coordinates (CSS pixels) into canvas coordinates (canvas pixels).
    // The canvas is rendered responsively in CSS, so rect.width/height often differs from canvas.width/height.
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null || clientY == null) return;
    if ('touches' in e) e.preventDefault();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handleSignatureMove = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX == null || clientY == null) return;
    if ('touches' in e) e.preventDefault();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const handleSignatureEnd = () => {
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const handleClearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear and fill white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Reset stroke style to black
        ctx.strokeStyle = '#000000';
      }
      setSignatureData(null);
    }
  };

  const handleSubmitAgreement = async () => {
    if (!agreed || !signatureData || !session.sessionId || !hasScrolledAgreement) {
      const lang = session.customerPrimaryLanguage;
      alert(t(lang, 'signatureRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/sign-agreement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          signaturePayload: signatureData, // Full data URL or base64
          sessionId: session.sessionId || undefined,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to sign agreement');
      }

      // Wait for SESSION_UPDATED event with assignment to show complete view
      // The view will be updated via WebSocket when assignment is created
    } catch (error) {
      console.error('Failed to sign agreement:', error);
      alert(t(session.customerPrimaryLanguage, 'error.signAgreement'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle language selection
  const handleLanguageSelection = async (language: Language) => {
    if (!session.sessionId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/set-language`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...kioskAuthHeaders(),
        },
        body: JSON.stringify({
          language,
          sessionId: session.sessionId,
          customerName: session.customerName || undefined,
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to set language');
      }

      // Language will be updated via SESSION_UPDATED WebSocket event
    } catch (error) {
      console.error('Failed to set language:', error);
      alert(t(session.customerPrimaryLanguage, 'error.setLanguage'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerConfirmSelection = async (confirmed: boolean) => {
    if (!customerConfirmationData?.sessionId) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/customer-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
        body: JSON.stringify({
          sessionId: customerConfirmationData.sessionId,
          confirmed,
        }),
      });
      if (response.ok) {
        setShowCustomerConfirmation(false);
        setCustomerConfirmationData(null);
      }
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(t(session.customerPrimaryLanguage, 'error.confirmSelection'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMembershipModal = (intent: 'PURCHASE' | 'RENEW') => {
    setMembershipModalIntent(intent);
    setShowMembershipModal(true);
  };

  const handleSelectOneTimeMembership = async () => {
    setMembershipChoice('ONE_TIME');
    // Ensure one-time explicitly clears any previously selected 6-month intent.
    if (session.membershipPurchaseIntent) {
      await handleClearMembershipPurchaseIntent();
    }
    // Persist the explicit choice so employee-register can mirror the kiosk step reliably.
    if (session.sessionId) {
      try {
        const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/membership-choice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ choice: 'ONE_TIME', sessionId: session.sessionId }),
        });
        if (!response.ok && response.status === 409) {
          const errorPayload: unknown = await response.json().catch(() => null);
          if (isRecord(errorPayload) && errorPayload.code === 'LANGUAGE_REQUIRED') {
            setView('language');
            alert(t('EN', 'selectLanguage'));
          }
        }
        // SESSION_UPDATED will reconcile; we don't need to block UX on this.
      } catch {
        // Best-effort (UI still works locally).
      }
    }
  };

  const handleClearMembershipPurchaseIntent = async () => {
    if (!session.sessionId) return;
    const lang = session.customerPrimaryLanguage;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ intent: 'NONE', sessionId: session.sessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          setView('language');
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to clear membership intent');
      }
      // Immediate UX; server WS broadcast will also reconcile.
      setSession((prev) => ({ ...prev, membershipPurchaseIntent: null }));
    } catch (error) {
      console.error('Failed to clear membership purchase intent:', error);
      alert(error instanceof Error ? error.message : t(lang, 'error.process'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMembershipContinue = async () => {
    if (!membershipModalIntent || !session.sessionId) return;
    const lang = session.customerPrimaryLanguage;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
          body: JSON.stringify({ intent: membershipModalIntent, sessionId: session.sessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        if (
          response.status === 409 &&
          isRecord(errorPayload) &&
          errorPayload.code === 'LANGUAGE_REQUIRED'
        ) {
          setView('language');
          alert(t('EN', 'selectLanguage'));
          return;
        }
        throw new Error(getErrorMessage(errorPayload) || 'Failed to request membership purchase');
      }
      // Immediate UX; server WS broadcast will also reconcile.
      setSession((prev) => ({ ...prev, membershipPurchaseIntent: membershipModalIntent }));
      setMembershipChoice('SIX_MONTH');
      setShowMembershipModal(false);
      setMembershipModalIntent(null);
    } catch (error) {
      console.error('Failed to set membership purchase intent:', error);
      alert(
        error instanceof Error
          ? error.message
          : t(lang, 'error.process')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if agreement has been scrolled
  useEffect(() => {
    const scrollArea = agreementScrollRef.current;
    if (scrollArea && view === 'agreement') {
      const handleScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = scrollArea;
        if (scrollTop + clientHeight >= scrollHeight - 10) {
          setHasScrolledAgreement(true);
        }
      };
      scrollArea.addEventListener('scroll', handleScroll);
      return () => scrollArea.removeEventListener('scroll', handleScroll);
    }
  }, [view]);

  const welcomeOverlayNode = <WelcomeOverlay />;

  // Render based on view
  switch (view) {
    case 'idle':
      return (
        <IdleScreen
          sessionId={session.sessionId}
          kioskAcknowledgedAt={session.kioskAcknowledgedAt}
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          orientationOverlay={orientationOverlay}
        />
      );

    case 'language':
      return (
        <LanguageScreen
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          onSelectLanguage={(lang) => void handleLanguageSelection(lang)}
          isSubmitting={isSubmitting}
          highlightedLanguage={highlightedLanguage}
          orientationOverlay={orientationOverlay}
          welcomeOverlay={welcomeOverlayNode}
        />
      );

    case 'payment':
      return (
        <PaymentScreen
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          paymentLineItems={session.paymentLineItems}
          paymentTotal={session.paymentTotal}
          paymentFailureReason={session.paymentFailureReason}
          orientationOverlay={orientationOverlay}
          welcomeOverlay={welcomeOverlayNode}
        />
      );

    case 'agreement':
      // Only show agreement for INITIAL/RENEWAL
      if (checkinMode !== 'INITIAL' && checkinMode !== 'RENEWAL') {
        // For upgrades, skip agreement and go to complete (will be handled by useEffect above)
        return null;
      }
      return (
        <AgreementScreen
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          agreement={agreement}
          agreed={agreed}
          signatureData={signatureData}
          hasScrolledAgreement={hasScrolledAgreement}
          isSubmitting={isSubmitting}
          orientationOverlay={orientationOverlay}
          welcomeOverlay={welcomeOverlayNode}
          agreementScrollRef={agreementScrollRef}
          signatureCanvasRef={signatureCanvasRef}
          onAgreeChange={setAgreed}
          onSignatureStart={handleSignatureStart}
          onSignatureMove={handleSignatureMove}
          onSignatureEnd={handleSignatureEnd}
          onClearSignature={handleClearSignature}
          onSubmit={() => void handleSubmitAgreement()}
        />
      );

    case 'complete':
      return (
        <CompleteScreen
          customerPrimaryLanguage={session.customerPrimaryLanguage}
          assignedResourceType={session.assignedResourceType}
          assignedResourceNumber={session.assignedResourceNumber}
          checkoutAt={session.checkoutAt}
          isSubmitting={isSubmitting}
          orientationOverlay={orientationOverlay}
          welcomeOverlay={welcomeOverlayNode}
          onComplete={() => {
            void (async () => {
              setIsSubmitting(true);
              try {
                // Kiosk acknowledgement: UI-only. Must NOT end/clear the lane session.
                await fetch(`${API_BASE}/v1/checkin/lane/${lane}/kiosk-ack`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...kioskAuthHeaders() },
                  body: JSON.stringify({}),
                });
              } catch (error) {
                console.error('Failed to kiosk-ack completion:', error);
                // Continue to local UI reset even if server call fails; WS will reconcile when possible.
              } finally {
                // Local reset (immediate UX): hide customer flow and return kiosk to idle,
                // but keep session data so the kiosk remains "locked" until employee-register completes.
                setView('idle');
                setSession((prev) => ({
                  ...prev,
                  kioskAcknowledgedAt: new Date().toISOString(),
                }));
                setSelectedRental(null);
                setAgreed(false);
                setSignatureData(null);
                setShowUpgradeDisclaimer(false);
                setUpgradeAction(null);
                setShowRenewalDisclaimer(false);
                setCheckinMode(null);
                setShowWaitlistModal(false);
                setWaitlistDesiredType(null);
                setWaitlistBackupType(null);
                setProposedRentalType(null);
                setProposedBy(null);
                setSelectionConfirmed(false);
                setSelectionConfirmedBy(null);
                setSelectionAcknowledged(false);
                setUpgradeDisclaimerAcknowledged(false);
                setHasScrolledAgreement(false);
                setIsSubmitting(false);
              }
            })();
          }}
        />
      );

    case 'selection':
      {
        const membershipStatus = getMembershipStatus(session, Date.now());
        const isMember = membershipStatus === 'ACTIVE' || membershipStatus === 'PENDING';
        const isExpired = membershipStatus === 'EXPIRED';
      return (
        <>
          <SelectionScreen
            session={session}
            inventory={inventory}
            proposedRentalType={proposedRentalType}
            proposedBy={proposedBy}
            selectionConfirmed={selectionConfirmed}
            selectionConfirmedBy={selectionConfirmedBy}
            selectedRental={selectedRental}
            isSubmitting={isSubmitting}
            orientationOverlay={orientationOverlay}
            welcomeOverlay={welcomeOverlayNode}
            onSelectRental={(rental) => void handleRentalSelection(rental)}
            membershipChoice={isMember ? null : membershipChoice}
            onSelectOneTimeMembership={() => void handleSelectOneTimeMembership()}
            onSelectSixMonthMembership={() =>
              openMembershipModal(isExpired ? 'RENEW' : 'PURCHASE')
            }
              highlightedMembershipChoice={highlightedMembershipChoice}
          />
          <UpgradeDisclaimerModal
            isOpen={showUpgradeDisclaimer}
            customerPrimaryLanguage={session.customerPrimaryLanguage}
            onClose={() => setShowUpgradeDisclaimer(false)}
            onAcknowledge={() => void handleDisclaimerAcknowledge()}
            isSubmitting={isSubmitting}
          />
          {customerConfirmationData && (
            <CustomerConfirmationModal
              isOpen={showCustomerConfirmation}
              customerPrimaryLanguage={session.customerPrimaryLanguage}
              data={customerConfirmationData}
              onAccept={() => void handleCustomerConfirmSelection(true)}
              onDecline={() => void handleCustomerConfirmSelection(false)}
              isSubmitting={isSubmitting}
            />
          )}
          {waitlistDesiredType && (
            <WaitlistModal
              isOpen={showWaitlistModal}
              customerPrimaryLanguage={session.customerPrimaryLanguage}
              desiredType={waitlistDesiredType}
              allowedRentals={session.allowedRentals}
              inventory={inventory}
              position={waitlistPosition}
              eta={waitlistETA}
              upgradeFee={waitlistUpgradeFee}
              isSubmitting={isSubmitting}
              onBackupSelection={handleWaitlistBackupSelection}
              onClose={() => setShowWaitlistModal(false)}
            />
          )}
          <RenewalDisclaimerModal
            isOpen={showRenewalDisclaimer}
            customerPrimaryLanguage={session.customerPrimaryLanguage}
            blockEndsAt={session.blockEndsAt}
            onClose={() => setShowRenewalDisclaimer(false)}
            onProceed={() => {
              setShowRenewalDisclaimer(false);
              setView('agreement');
            }}
            isSubmitting={isSubmitting}
          />
          {membershipModalIntent && (
            <MembershipModal
              isOpen={showMembershipModal}
              customerPrimaryLanguage={session.customerPrimaryLanguage}
              intent={membershipModalIntent}
              onContinue={() => void handleMembershipContinue()}
              onClose={() => {
                setShowMembershipModal(false);
                setMembershipModalIntent(null);
              }}
              isSubmitting={isSubmitting}
            />
          )}
        </>
      );}

    default:
      return null;
  }
}

