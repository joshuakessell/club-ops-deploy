import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SessionUpdatedPayload,
  WebSocketEvent,
  CustomerConfirmationRequiredPayload,
  AssignmentCreatedPayload,
  InventoryUpdatedPayload,
  SelectionProposedPayload,
  SelectionLockedPayload,
  SelectionForcedPayload,
} from '@club-ops/shared';
import { safeJsonParse, useReconnectingWebSocket, isRecord, getErrorMessage } from '@club-ops/ui';
import { t, type Language } from '../i18n';
import { type SessionState } from '../utils/membership';
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

  const API_BASE = '/api';

  const onWsMessage = useCallback((event: MessageEvent) => {
    try {
      const parsed: unknown = safeJsonParse(String(event.data));
      if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
      const message = parsed as unknown as WebSocketEvent;
      console.log('WebSocket message:', message);

      if (message.type === 'SESSION_UPDATED') {
        const payload = message.payload as SessionUpdatedPayload;

        // Update session state with all fields
        setSession((prev) => ({
          ...prev,
          sessionId: payload.sessionId || null,
          customerName: payload.customerName,
          membershipNumber: payload.membershipNumber || null,
          membershipValidUntil: payload.customerMembershipValidUntil || null,
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
          // Reset to idle
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
          return;
        }

        // If we have assignment, show complete view (highest priority after reset)
        if (payload.assignedResourceType && payload.assignedResourceNumber) {
          setView('complete');
          return;
        }

        // If kiosk acknowledged, stay idle (lane still locked until employee-register completes/reset).
        if (payload.kioskAcknowledgedAt && payload.customerName && payload.status !== 'COMPLETED') {
          setView('idle');
          return;
        }

        // Language selection (first visit, before past-due check)
        if (payload.customerName && !payload.customerPrimaryLanguage && !payload.pastDueBlocked) {
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
        if (payload.customerName) {
          setView('selection');
        }

        // Update selection state
        if (payload.proposedRentalType) {
          setProposedRentalType(payload.proposedRentalType);
          setProposedBy(payload.proposedBy || null);
        }
        if (payload.selectionConfirmed !== undefined) {
          setSelectionConfirmed(payload.selectionConfirmed);
          setSelectionConfirmedBy(payload.selectionConfirmedBy || null);
        }
      } else if (message.type === 'SELECTION_PROPOSED') {
        const payload = message.payload as SelectionProposedPayload;
        if (payload.sessionId === sessionIdRef.current) {
          setProposedRentalType(payload.rentalType);
          setProposedBy(payload.proposedBy);
        }
      } else if (message.type === 'SELECTION_LOCKED' || message.type === 'SELECTION_FORCED') {
        const payload = message.payload as SelectionLockedPayload | SelectionForcedPayload;
        if (payload.sessionId === sessionIdRef.current) {
          setSelectionConfirmed(true);
          setSelectionConfirmedBy('EMPLOYEE');
          setSelectedRental(payload.rentalType);
          setSelectionAcknowledged(true);
          setView('payment');
        }
      } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
        setSelectionAcknowledged(true);
      } else if (message.type === 'CUSTOMER_CONFIRMATION_REQUIRED') {
        const payload = message.payload as CustomerConfirmationRequiredPayload;
        setCustomerConfirmationData(payload);
        setShowCustomerConfirmation(true);
      } else if (message.type === 'ASSIGNMENT_CREATED') {
        const payload = message.payload as AssignmentCreatedPayload;
        // Assignment successful - could show confirmation message
        console.log('Assignment created:', payload);
      } else if (message.type === 'INVENTORY_UPDATED') {
        const payload = message.payload as InventoryUpdatedPayload;
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
  }, []);

  const wsUrl = `ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`;
  const ws = useReconnectingWebSocket({
    url: wsUrl,
    onMessage: onWsMessage,
    onOpenSendJson: [
      {
        type: 'subscribe',
        events: [
          'SESSION_UPDATED',
          'SELECTION_PROPOSED',
          'SELECTION_LOCKED',
          'SELECTION_ACKNOWLEDGED',
          'CUSTOMER_CONFIRMATION_REQUIRED',
          'ASSIGNMENT_CREATED',
          'INVENTORY_UPDATED',
          'WAITLIST_CREATED',
        ],
      },
    ],
  });

  useEffect(() => {
    setWsConnected(ws.connected);
  }, [ws.connected]);

  useEffect(() => {
    // Check API health
    fetch(`${API_BASE}/health`)
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

    // Fetch initial inventory
    fetch(`${API_BASE}/v1/inventory/available`)
      .then((res) => res.json())
      .then((data: unknown) => {
        if (isRecord(data) && isRecord(data.rooms) && typeof data.lockers === 'number') {
          setInventory({ rooms: data.rooms as Record<string, number>, lockers: data.lockers });
        }
      })
      .catch(console.error);

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
    if (view === 'agreement' && !agreement) {
      fetch(`${API_BASE}/v1/agreements/active`)
        .then((res) => res.json())
        .then((data: Agreement) => {
          setAgreement({
            id: data.id,
            version: data.version,
            title: data.title,
            bodyText: data.bodyText,
          });
        })
        .catch((error) => {
          console.error('Failed to load agreement:', error);
          alert(t(lang, 'error.loadAgreement'));
        });
    }
  }, [view, agreement, session.customerPrimaryLanguage]);

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
        },
        body: JSON.stringify({
          rentalType: rental,
          proposedBy: 'CUSTOMER',
        }),
      });

      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
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

  const handleJoinWaitlist = () => {
    setUpgradeAction('waitlist');
    setShowUpgradeDisclaimer(true);
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

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

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
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

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
        headers: { 'Content-Type': 'application/json' },
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

  const handleMembershipContinue = async () => {
    if (!membershipModalIntent || !session.sessionId) return;
    const lang = session.customerPrimaryLanguage;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/v1/checkin/lane/${lane}/membership-purchase-intent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: membershipModalIntent, sessionId: session.sessionId }),
        }
      );
      if (!response.ok) {
        const errorPayload: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(errorPayload) || 'Failed to request membership purchase');
      }
      // Immediate UX; server WS broadcast will also reconcile.
      setSession((prev) => ({ ...prev, membershipPurchaseIntent: membershipModalIntent }));
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
          onComplete={async () => {
            setIsSubmitting(true);
            try {
              // Kiosk acknowledgement: UI-only. Must NOT end/clear the lane session.
              await fetch(`${API_BASE}/v1/checkin/lane/${lane}/kiosk-ack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
          }}
        />
      );

    case 'selection':
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
            onOpenMembershipModal={openMembershipModal}
            onJoinWaitlist={handleJoinWaitlist}
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
      );

    default:
      return null;
  }
}

