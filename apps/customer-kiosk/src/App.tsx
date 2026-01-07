import { useEffect, useState, useRef, useMemo } from 'react';
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
import blackLogo from './assets/logo_vector_transparent_hi_black.svg';
import { t, type Language } from './i18n';
import { ScreenShell } from './components/ScreenShell';

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

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

interface SessionState {
  sessionId: string | null;
  customerName: string | null;
  membershipNumber: string | null;
  allowedRentals: string[];
  visitId?: string;
  mode?: 'INITIAL' | 'RENEWAL';
  blockEndsAt?: string; // ISO timestamp of when current block ends
  customerPrimaryLanguage?: Language | null;
  pastDueBlocked?: boolean;
  pastDueBalance?: number;
  paymentStatus?: 'DUE' | 'PAID';
  paymentTotal?: number;
  paymentLineItems?: Array<{ description: string; amount: number }>;
  paymentFailureReason?: string;
  agreementSigned?: boolean;
  assignedResourceType?: 'room' | 'locker';
  assignedResourceNumber?: string;
  checkoutAt?: string;
}

interface Agreement {
  id: string;
  version: string;
  title: string;
  bodyText: string;
}

type AppView = 'idle' | 'language' | 'selection' | 'payment' | 'agreement' | 'complete';

// Map rental types to display names
function getRentalDisplayName(rental: string, lang: Language | null | undefined): string {
  switch (rental) {
    case 'LOCKER':
      return t(lang, 'locker');
    case 'STANDARD':
      return t(lang, 'regularRoom');
    case 'DOUBLE':
      return t(lang, 'doubleRoom');
    case 'SPECIAL':
      return t(lang, 'specialRoom');
    case 'GYM_LOCKER':
      return t(lang, 'gymLocker');
    default:
      return rental;
  }
}

function App() {
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
        <h1>Portrait mode required</h1>
        <p>Please rotate the device to portrait to continue.</p>
      </div>
    </div>
  ) : null;

  const API_BASE = '/api';

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

    // Connect to WebSocket with lane parameter
    const ws = new WebSocket(
      `ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`
    );

    ws.onopen = () => {
      console.log('WebSocket connected to lane:', lane);
      setWsConnected(true);

      // Subscribe to relevant events
      ws.send(
        JSON.stringify({
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
        })
      );
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data)) as unknown;
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
          if (
            payload.status === 'COMPLETED' &&
            (!payload.customerName || payload.customerName === '')
          ) {
            // Reset to idle
            setView('idle');
            setSession({
              sessionId: null,
              customerName: null,
              membershipNumber: null,
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
    };

    return () => ws.close();
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
        aria-label="Welcome"
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
          alert('Failed to load agreement. Please try again.');
        });
    }
  }, [view, agreement]);

  const handleRentalSelection = async (rental: string) => {
    if (!session.sessionId) {
      alert('No active session. Please wait for staff to start a session.');
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
      alert(
        error instanceof Error ? error.message : 'Failed to process selection. Please try again.'
      );
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
      alert(error instanceof Error ? error.message : 'Failed to process. Please try again.');
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
      alert('This rental type is not available. Please select an available option.');
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
      alert(error instanceof Error ? error.message : 'Failed to sign agreement. Please try again.');
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
      alert(error instanceof Error ? error.message : 'Failed to set language. Please try again.');
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
      alert('Failed to confirm selection. Please try again.');
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

  // Idle state: logo only, centered
  if (view === 'idle') {
    return (
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        <div className="idle-content"></div>
      </ScreenShell>
    );
  }

  // Language selection screen
  if (view === 'language') {
    return (
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        <WelcomeOverlay />
        <div className="active-content">
          <main className="main-content">
            <div className="language-selection-screen">
              <h1 className="language-title">{t(null, 'selectLanguage')}</h1>
              <div className="language-options">
                <button
                  className="language-option"
                  onClick={() => void handleLanguageSelection('EN')}
                  disabled={isSubmitting}
                >
                  {t(null, 'english')}
                </button>
                <button
                  className="language-option"
                  onClick={() => void handleLanguageSelection('ES')}
                  disabled={isSubmitting}
                >
                  {t(null, 'spanish')}
                </button>
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    );
  }

  // Payment pending screen
  if (view === 'payment') {
    return (
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
        {orientationOverlay}
        <WelcomeOverlay />
        <div className="active-content">
          <main className="main-content">
            <div className="payment-pending-screen">
              <h1>{t(session.customerPrimaryLanguage, 'paymentPending')}</h1>
              {session.paymentLineItems && session.paymentLineItems.length > 0 && (
                <div className="payment-breakdown">
                  <p className="breakdown-title">
                    {t(session.customerPrimaryLanguage, 'charges') ?? 'Charges'}
                  </p>
                  <div className="breakdown-items">
                    {session.paymentLineItems.map((li, idx) => (
                      <div key={`${li.description}-${idx}`} className="breakdown-row">
                        <span className="breakdown-desc">{li.description}</span>
                        <span className="breakdown-amt">${li.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {session.paymentTotal !== undefined && (
                <div className="payment-total">
                  <p className="total-label">{t(session.customerPrimaryLanguage, 'totalDue')}</p>
                  <p className="total-amount">${session.paymentTotal.toFixed(2)}</p>
                </div>
              )}
              {/* Never show decline reason to the customer; generic guidance only */}
              {session.paymentFailureReason && (
                <div className="payment-decline-generic">
                  {t(session.customerPrimaryLanguage, 'paymentIssueSeeAttendant')}
                </div>
              )}
              <p className="payment-instruction">
                {t(session.customerPrimaryLanguage, 'paymentPending')}
              </p>
            </div>
          </main>
        </div>
      </ScreenShell>
    );
  }

  // Agreement signing view (only for INITIAL/RENEWAL)
  if (view === 'agreement') {
    // Only show agreement for INITIAL/RENEWAL
    if (checkinMode !== 'INITIAL' && checkinMode !== 'RENEWAL') {
      // For upgrades, skip agreement and go to complete (will be handled by useEffect above)
      return null;
    }

    return (
      <ScreenShell backgroundVariant="none" showLogoWatermark={false}>
        {orientationOverlay}
        <WelcomeOverlay />
        <div className="agreement-screen-container">
          {/* Logo header - black on white */}
          <div className="agreement-logo-header">
            <img src={blackLogo} alt="Club Dallas" className="agreement-logo-img" />
          </div>

          {/* White paper panel */}
          <div className="agreement-paper-panel">
            <h1 className="agreement-title">
              {agreement?.title || t(session.customerPrimaryLanguage, 'agreementTitle')}
            </h1>

            <div ref={agreementScrollRef} className="agreement-scroll-area">
              {agreement?.bodyText ? (
                <div
                  className="agreement-body"
                  dangerouslySetInnerHTML={{ __html: agreement.bodyText }}
                />
              ) : (
                <p className="agreement-placeholder">
                  {t(session.customerPrimaryLanguage, 'agreementPlaceholder')}
                </p>
              )}
            </div>

            <div className="agreement-actions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  disabled={!hasScrolledAgreement}
                />
                <span>{t(session.customerPrimaryLanguage, 'iAgree')}</span>
              </label>
              {!hasScrolledAgreement && (
                <p className="scroll-warning">
                  {t(session.customerPrimaryLanguage, 'scrollRequired')}
                </p>
              )}

              <div className="signature-section">
                <p className="signature-label">
                  {t(session.customerPrimaryLanguage, 'signatureRequired')}
                </p>
                <canvas
                  ref={signatureCanvasRef}
                  className="signature-canvas"
                  width={600}
                  height={200}
                  onMouseDown={handleSignatureStart}
                  onMouseMove={handleSignatureMove}
                  onMouseUp={handleSignatureEnd}
                  onMouseLeave={handleSignatureEnd}
                  onTouchStart={handleSignatureStart}
                  onTouchMove={handleSignatureMove}
                  onTouchEnd={handleSignatureEnd}
                />
                <button
                  type="button"
                  className="clear-signature-btn"
                  onClick={handleClearSignature}
                >
                  {t(session.customerPrimaryLanguage, 'clear')}
                </button>
              </div>

              <div className="agreement-submit-container">
                <button
                  className="btn-liquid-glass submit-agreement-btn"
                  onClick={() => void handleSubmitAgreement()}
                  disabled={!agreed || !signatureData || !hasScrolledAgreement || isSubmitting}
                >
                  {isSubmitting
                    ? t(session.customerPrimaryLanguage, 'submitting')
                    : t(session.customerPrimaryLanguage, 'submit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </ScreenShell>
    );
  }

  // Complete view
  if (view === 'complete') {
    const lang = session.customerPrimaryLanguage;

    return (
      <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true}>
        {orientationOverlay}
        <WelcomeOverlay />
        <div className="active-content">
          <main className="main-content">
            <div className="complete-screen">
              <h1>{t(lang, 'thankYou')}</h1>
              {session.assignedResourceType && session.assignedResourceNumber ? (
                <>
                  <div className="assignment-info">
                    <p className="assignment-resource">
                      {t(lang, session.assignedResourceType)}: {session.assignedResourceNumber}
                    </p>
                    {session.checkoutAt && (
                      <p className="checkout-time">
                        {t(lang, 'checkoutAt')}: {new Date(session.checkoutAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p>{t(lang, 'assignmentComplete')}</p>
              )}

              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                <button
                  className="btn-liquid-glass modal-ok-btn"
                  onClick={() =>
                    void (async () => {
                      setIsSubmitting(true);
                      try {
                        // Kiosk acknowledgement: clears lane session UI state so this kiosk resets for the next customer.
                        await fetch(`${API_BASE}/v1/checkin/lane/${lane}/kiosk-ack`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                        });
                      } catch (error) {
                        console.error('Failed to kiosk-ack completion:', error);
                        // Continue to local reset even if server call fails; WS will reconcile when possible.
                      } finally {
                        // Local reset (immediate UX), server broadcast will also clear deterministically.
                        setView('idle');
                        setSession({
                          sessionId: null,
                          customerName: null,
                          membershipNumber: null,
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
                        setIsSubmitting(false);
                      }
                    })()
                  }
                  disabled={isSubmitting}
                >
                  OK
                </button>
              </div>
            </div>
          </main>
        </div>
      </ScreenShell>
    );
  }

  // Selection view (default active session state)
  return (
    <ScreenShell backgroundVariant="steamroom1" showLogoWatermark={true} watermarkLayer="under">
      {orientationOverlay}
      <WelcomeOverlay />
      <div className="active-content">
        <main className="main-content">
          <div className="customer-info">
            <h1 className="customer-name">Welcome, {session.customerName}</h1>
          </div>

          {/* Membership Level - locked buttons */}
          <div className="membership-level-section">
            <p className="section-label">Membership Level:</p>
            <div className="membership-buttons">
              <button
                className="btn-liquid-glass btn-liquid-glass--selected btn-liquid-glass--disabled"
                disabled
              >
                {session.membershipNumber ? 'Member' : 'Non-Member'}
              </button>
              <button className="btn-liquid-glass btn-liquid-glass--disabled" disabled>
                {session.membershipNumber ? 'Non-Member' : 'Member'}
              </button>
            </div>
          </div>

          {/* Past-due block message */}
          {session.pastDueBlocked && (
            <div className="past-due-block-message">
              <p>{t(session.customerPrimaryLanguage, 'pastDueBlocked')}</p>
            </div>
          )}

          {/* Selection State Display */}
          {proposedRentalType && (
            <div
              style={{
                padding: '1rem',
                marginBottom: '1rem',
                background: selectionConfirmed
                  ? '#10b981'
                  : proposedBy === 'EMPLOYEE'
                    ? '#2563eb'
                    : '#334155',
                borderRadius: '8px',
                color: 'white',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                {selectionConfirmed
                  ? `✓ ${t(session.customerPrimaryLanguage, 'selected')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (${selectionConfirmedBy === 'CUSTOMER' ? 'You' : 'Staff'})`
                  : proposedBy === 'EMPLOYEE'
                    ? `${t(session.customerPrimaryLanguage, 'proposed')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (Staff suggestion — tap the highlighted option to accept)`
                    : `${t(session.customerPrimaryLanguage, 'proposed')}: ${getRentalDisplayName(proposedRentalType, session.customerPrimaryLanguage)} (Your selection — waiting for staff to confirm)`}
              </div>
            </div>
          )}

          {/* Choose your experience */}
          <div className="experience-section">
            <p className="section-label">Choose your experience:</p>
            <div className="experience-options">
              {session.allowedRentals.length > 0 ? (
                session.allowedRentals.map((rental) => {
                  const availableCount =
                    inventory?.rooms[rental] ||
                    (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
                    0;
                  const showWarning = availableCount > 0 && availableCount <= 5;
                  const isUnavailable = availableCount === 0;
                  const isDisabled = session.pastDueBlocked;
                  const isSelected = proposedRentalType === rental && selectionConfirmed;
                  const isStaffProposed =
                    proposedBy === 'EMPLOYEE' &&
                    proposedRentalType === rental &&
                    !selectionConfirmed;
                  const isPulsing = isStaffProposed;
                  const isForced =
                    selectedRental === rental &&
                    selectionConfirmed &&
                    selectionConfirmedBy === 'EMPLOYEE';
                  const lang = session.customerPrimaryLanguage;

                  // Map rental types to display names
                  let displayName = getRentalDisplayName(rental, lang);
                  if (rental === 'STANDARD') displayName = 'Private Dressing Room';
                  else if (rental === 'DOUBLE') displayName = 'Deluxe Dressing Room';
                  else if (rental === 'SPECIAL') displayName = 'Special Dressing Room';
                  else if (rental === 'LOCKER') displayName = 'Locker';

                  return (
                    <button
                      key={rental}
                      className={`btn-liquid-glass ${isSelected ? 'btn-liquid-glass--selected' : ''} ${isStaffProposed ? 'btn-liquid-glass--staff-proposed' : ''} ${isDisabled ? 'btn-liquid-glass--disabled' : ''} ${isPulsing ? 'pulse-bright' : ''}`}
                      data-forced={isForced}
                      onClick={() => {
                        if (!isDisabled) {
                          void handleRentalSelection(rental);
                        }
                      }}
                      disabled={isDisabled}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <span>{displayName}</span>
                        {showWarning && !isUnavailable && (
                          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                            Only {availableCount} available
                          </span>
                        )}
                        {isUnavailable && (
                          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>Unavailable</span>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="btn-liquid-glass btn-liquid-glass--disabled">
                  {t(session.customerPrimaryLanguage, 'noOptionsAvailable')}
                </div>
              )}
            </div>
          </div>

          {/* Waitlist button (shown when higher tier available) */}
          {session.allowedRentals.includes('STANDARD') && (
            <button className="btn-liquid-glass waitlist-btn" onClick={handleJoinWaitlist}>
              Join Waitlist for Upgrade
            </button>
          )}
        </main>

        {/* Upgrade Disclaimer Modal */}
        {showUpgradeDisclaimer && (
          <div className="modal-overlay" onClick={() => setShowUpgradeDisclaimer(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Upgrade Disclaimer</h2>
              <div className="disclaimer-text">
                <p>
                  <strong>Upgrade Disclaimer</strong>
                </p>
                <ul
                  style={{
                    listStyle: 'disc',
                    paddingLeft: '1.5rem',
                    textAlign: 'left',
                    marginTop: '1rem',
                  }}
                >
                  <li style={{ marginBottom: '0.5rem' }}>
                    Upgrade fees apply only to remaining time in your current stay.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Upgrades do not extend your stay. Your checkout time remains the same.
                  </li>
                  <li style={{ marginBottom: '0.5rem', fontWeight: 600, color: '#ef4444' }}>
                    No refunds under any circumstances.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    Upgrade fees are charged only when an upgrade becomes available and you choose
                    to accept it.
                  </li>
                </ul>
              </div>
              <button
                className="btn-liquid-glass modal-ok-btn"
                onClick={() => void handleDisclaimerAcknowledge()}
                disabled={isSubmitting}
              >
                OK
              </button>
            </div>
          </div>
        )}

        {/* Customer Confirmation Modal */}
        {showCustomerConfirmation && customerConfirmationData && (
          <div className="modal-overlay" onClick={() => {}}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Staff Selected Different Option</h2>
              <div className="disclaimer-text">
                <p>
                  You requested:{' '}
                  <strong>
                    {getRentalDisplayName(
                      customerConfirmationData.requestedType,
                      session.customerPrimaryLanguage
                    )}
                  </strong>
                </p>
                <p>
                  Staff selected:{' '}
                  <strong>
                    {getRentalDisplayName(
                      customerConfirmationData.selectedType,
                      session.customerPrimaryLanguage
                    )}{' '}
                    {customerConfirmationData.selectedNumber}
                  </strong>
                </p>
                <p>Do you accept this selection?</p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button
                  className="btn-liquid-glass modal-ok-btn"
                  onClick={() => void handleCustomerConfirmSelection(true)}
                  disabled={isSubmitting}
                >
                  Accept
                </button>
                <button
                  className="btn-liquid-glass modal-ok-btn"
                  style={{ backgroundColor: '#ef4444' }}
                  onClick={() => void handleCustomerConfirmSelection(false)}
                  disabled={isSubmitting}
                >
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Waitlist Modal */}
        {showWaitlistModal && waitlistDesiredType && (
          <div className="modal-overlay" onClick={() => setShowWaitlistModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>None Available - Join Waiting List?</h2>
              <div className="disclaimer-text">
                <p>
                  <strong>
                    {getRentalDisplayName(waitlistDesiredType, session.customerPrimaryLanguage)}
                  </strong>{' '}
                  is currently unavailable.
                </p>
                {waitlistPosition !== null && (
                  <div
                    style={{
                      marginTop: '1rem',
                      padding: '0.75rem',
                      background: '#1e293b',
                      borderRadius: '6px',
                    }}
                  >
                    <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Waitlist Information:</p>
                    <p>
                      Position: <strong>#{waitlistPosition}</strong>
                    </p>
                    {waitlistETA ? (
                      <p>
                        Estimated Ready: <strong>{new Date(waitlistETA).toLocaleString()}</strong>
                      </p>
                    ) : (
                      <p>
                        Estimated Ready: <strong>Unknown</strong>
                      </p>
                    )}
                    {waitlistUpgradeFee !== null && waitlistUpgradeFee > 0 && (
                      <p style={{ color: '#f59e0b', marginTop: '0.5rem' }}>
                        Upgrade Fee: <strong>${waitlistUpgradeFee.toFixed(2)}</strong>
                      </p>
                    )}
                  </div>
                )}
                <p style={{ marginTop: '1rem' }}>
                  To join the waitlist, please select a backup rental that is available now.
                </p>
                <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                  You will be charged for the backup rental. If an upgrade becomes available, you
                  may accept it (upgrade fees apply).
                </p>
              </div>
              <div style={{ marginTop: '1.5rem' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Select backup rental:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {session.allowedRentals
                    .filter((rental) => rental !== waitlistDesiredType)
                    .map((rental) => {
                      const availableCount =
                        inventory?.rooms[rental] ||
                        (rental === 'LOCKER' || rental === 'GYM_LOCKER' ? inventory?.lockers : 0) ||
                        0;
                      const isAvailable = availableCount > 0;

                      return (
                        <button
                          key={rental}
                          className="btn-liquid-glass modal-ok-btn"
                          onClick={() => handleWaitlistBackupSelection(rental)}
                          disabled={!isAvailable || isSubmitting}
                          style={{
                            opacity: isAvailable ? 1 : 0.5,
                            cursor: isAvailable && !isSubmitting ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {getRentalDisplayName(rental, session.customerPrimaryLanguage)}
                          {!isAvailable && ' (Unavailable)'}
                        </button>
                      );
                    })}
                </div>
              </div>
              <button
                className="btn-liquid-glass modal-ok-btn"
                onClick={() => setShowWaitlistModal(false)}
                disabled={isSubmitting}
                style={{ marginTop: '1rem', backgroundColor: '#64748b' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Renewal Disclaimer Modal */}
        {showRenewalDisclaimer && (
          <div className="modal-overlay" onClick={() => setShowRenewalDisclaimer(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Renewal Notice</h2>
              <div className="disclaimer-text">
                <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem', textAlign: 'left' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    This renewal extends your stay for 6 hours from your current checkout time.
                    {session.blockEndsAt && (
                      <span>
                        {' '}
                        (Current checkout: {new Date(session.blockEndsAt).toLocaleString()})
                      </span>
                    )}
                  </li>
                  <li style={{ marginBottom: '0.5rem', color: '#f59e0b', fontWeight: 600 }}>
                    ⚠️ You are approaching the 14-hour maximum stay for a single visit.
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    At the end of this 6-hour renewal, you may extend one final time for 2
                    additional hours for a flat $20 fee (same for lockers or any room type).
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    The $20 fee is not charged now; it applies only if you choose the final 2-hour
                    extension later.
                  </li>
                </ul>
              </div>
              <button
                className="btn-liquid-glass modal-ok-btn"
                onClick={() => {
                  setShowRenewalDisclaimer(false);
                  // Proceed to agreement screen
                  setView('agreement');
                }}
                disabled={isSubmitting}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}

export default App;
