import { useEffect, useState, useRef } from 'react';
import { RoomStatus, RoomType, CheckinMode, type ActiveVisit, type CheckoutRequestSummary, type CheckoutChecklist, type WebSocketEvent, type CheckoutRequestedPayload, type CheckoutClaimedPayload, type CheckoutUpdatedPayload, type SessionUpdatedPayload, type AssignmentCreatedPayload, type AssignmentFailedPayload, type CustomerConfirmedPayload, type CustomerDeclinedPayload, type SelectionProposedPayload, type SelectionLockedPayload, type SelectionAcknowledgedPayload } from '@club-ops/shared';
import { RegisterSignIn } from './RegisterSignIn';
import { InventorySelector } from './InventorySelector';
import { IdScanner } from './IdScanner';
import type { IdScanPayload } from '@club-ops/shared';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

const API_BASE = '/api';

function App() {
  const [session, setSession] = useState<StaffSession | null>(() => {
    // Load session from localStorage on mount
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [scanMode, setScanMode] = useState<'id' | 'membership' | null>(null);
  const [scanBuffer, setScanBuffer] = useState('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [showIdScanner, setShowIdScanner] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [membershipNumber, setMembershipNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [agreementSigned, setAgreementSigned] = useState(false);
  const [checkinMode, setCheckinMode] = useState<CheckinMode>(CheckinMode.INITIAL);
  const [selectedVisit, setSelectedVisit] = useState<ActiveVisit | null>(null);
  const [showRenewalSearch, setShowRenewalSearch] = useState(false);
  const [renewalSearchQuery, setRenewalSearchQuery] = useState('');
  const [renewalSearchResults, setRenewalSearchResults] = useState<ActiveVisit[]>([]);
  const [showRenewalDisclaimer, setShowRenewalDisclaimer] = useState(false);
  const [selectedRentalType, setSelectedRentalType] = useState<string | null>(null);
  const [checkoutRequests, setCheckoutRequests] = useState<Map<string, CheckoutRequestSummary>>(new Map());
  const [selectedCheckoutRequest, setSelectedCheckoutRequest] = useState<string | null>(null);
  const [checkoutChecklist, setCheckoutChecklist] = useState<CheckoutChecklist>({});
  const [checkoutItemsConfirmed, setCheckoutItemsConfirmed] = useState(false);
  const [checkoutFeePaid, setCheckoutFeePaid] = useState(false);
  const [customerSelectedType, setCustomerSelectedType] = useState<string | null>(null);
  const [waitlistDesiredTier, setWaitlistDesiredTier] = useState<string | null>(null);
  const [waitlistBackupType, setWaitlistBackupType] = useState<string | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<{ type: 'room' | 'locker'; id: string; number: string; tier: string } | null>(null);
  const [proposedRentalType, setProposedRentalType] = useState<string | null>(null);
  const [proposedBy, setProposedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(null);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [selectionConfirmedBy, setSelectionConfirmedBy] = useState<'CUSTOMER' | 'EMPLOYEE' | null>(null);
  const [selectionAcknowledged, setSelectionAcknowledged] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showCustomerConfirmationPending, setShowCustomerConfirmationPending] = useState(false);
  const [customerConfirmationType, setCustomerConfirmationType] = useState<{ requested: string; selected: string; number: string } | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<{ total: number; lineItems: Array<{ description: string; amount: number }>; messages: string[] } | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'DUE' | 'PAID' | null>(null);
  const [waitlistEntries, setWaitlistEntries] = useState<Array<{
    id: string;
    visitId: string;
    checkinBlockId: string;
    desiredTier: string;
    backupTier: string;
    status: string;
    createdAt: string;
    offeredAt?: string;
    displayIdentifier: string;
    currentRentalType: string;
  }>>([]);
  const [showUpgradesPanel, setShowUpgradesPanel] = useState(false);
  const [selectedWaitlistEntry, setSelectedWaitlistEntry] = useState<string | null>(null);
  const [availableRoomsForUpgrade, setAvailableRoomsForUpgrade] = useState<Array<{
    id: string;
    number: string;
    tier: string;
  }>>([]);
  const [upgradePaymentIntentId, setUpgradePaymentIntentId] = useState<string | null>(null);
  const [upgradeFee, setUpgradeFee] = useState<number | null>(null);
  const [showUpgradeDisclaimer, setShowUpgradeDisclaimer] = useState(false);
  const [showFinalExtensionModal, setShowFinalExtensionModal] = useState(false);
  const [finalExtensionVisitId, setFinalExtensionVisitId] = useState<string | null>(null);
  const [lane] = useState(() => {
    // Get lane from URL query param or localStorage, default to 'lane-1'
    const params = new URLSearchParams(window.location.search);
    return params.get('lane') || localStorage.getItem('lane') || 'lane-1';
  });

  const deviceId = useState(() => {
    // Get device ID from environment variable or localStorage
    const envDeviceId = import.meta.env.VITE_DEVICE_ID;
    if (envDeviceId) {
      return envDeviceId;
    }
    let id = localStorage.getItem('device_id');
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      localStorage.setItem('device_id', id);
    }
    return id;
  })[0];

  const [registerSession, setRegisterSession] = useState<{
    employeeId: string;
    employeeName: string;
    registerNumber: number;
    deviceId: string;
  } | null>(null);

  // Load staff session from localStorage (created after register sign-in)
  useEffect(() => {
    const stored = localStorage.getItem('staff_session');
    if (stored) {
      try {
        const staffSession = JSON.parse(stored);
        setSession(staffSession);
      } catch {
        setSession(null);
      }
    }
  }, []);

  const handleRegisterSignIn = (session: {
    employeeId: string;
    employeeName: string;
    registerNumber: number;
    deviceId: string;
  }) => {
    setRegisterSession(session);
  };

  // Show register sign-in if not signed into a register
  if (!registerSession) {
    return (
      <RegisterSignIn
        deviceId={deviceId}
        onSignedIn={handleRegisterSignIn}
      >
        <div /> {/* Empty children for now */}
      </RegisterSignIn>
    );
  }

  // Show lock screen if no staff session (shouldn't happen, but safety check)
  if (!session) {
    return (
      <RegisterSignIn
        deviceId={deviceId}
        onSignedIn={handleRegisterSignIn}
      >
        <div style={{ padding: '2rem', textAlign: 'center', color: '#fff' }}>
          Loading...
        </div>
      </RegisterSignIn>
    );
  }

  // Handle barcode scanner input (keyboard wedge mode)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Barcode scanners typically send characters quickly and end with Enter
      if (e.key === 'Enter' && scanBuffer.trim()) {
        const scannedValue = scanBuffer.trim();
        handleScan(scannedValue);
        setScanBuffer('');
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Accumulate characters (barcode scanner input)
        setScanBuffer(prev => prev + e.key);
        
        // Clear buffer after 1 second of no input (normal typing)
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
        }
        scanTimeoutRef.current = setTimeout(() => {
          setScanBuffer('');
        }, 1000);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, [scanBuffer]);

  const handleScan = async (scannedValue: string) => {
    if (!scanMode) {
      // Auto-detect: if it looks like a UUID, treat as ID; otherwise membership number
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scannedValue);
      const mode = isUuid ? 'id' : 'membership';
      setScanMode(mode);
      await sendScan(mode, scannedValue);
    } else {
      await sendScan(scanMode, scannedValue);
    }
  };

  const sendScan = async (mode: 'id' | 'membership', value: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      // Use new check-in start endpoint
      if (mode === 'id') {
        // ID scan - start or update session
        await startLaneSession(value, null);
      } else {
        // Membership scan - update existing session with membership number
        await startLaneSession(customerName || 'Customer', value);
      }

      // Reset scan mode after successful scan
      setScanMode(null);
    } catch (error) {
      console.error('Failed to send scan:', error);
      alert('Failed to process scan. Please try again.');
    }
  };

  const handleIdScan = async (payload: IdScanPayload) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    // Require check-in mode to be selected before starting session
    if (!checkinMode) {
      alert('Please select check-in mode (Initial Check-In or Renewal) before scanning ID');
      return;
    }

    // For RENEWAL mode, require visit to be selected
    if (checkinMode === CheckinMode.RENEWAL && !selectedVisit) {
      alert('Please select a visit to renew before scanning ID');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/scan-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to scan ID');
      }

      const data = await response.json();
      console.log('ID scanned, session updated:', data);
      
      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      
      // Close scanner
      setShowIdScanner(false);
    } catch (error) {
      console.error('Failed to scan ID:', error);
      alert(error instanceof Error ? error.message : 'Failed to scan ID');
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

  const startLaneSession = async (idScanValue: string, membershipScanValue?: string | null) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    // Require check-in mode to be selected before starting session
    if (!checkinMode) {
      alert('Please select check-in mode (Initial Check-In or Renewal) before starting session');
      return;
    }

    // For RENEWAL mode, require visit to be selected
    if (checkinMode === CheckinMode.RENEWAL && !selectedVisit) {
      alert('Please select a visit to renew before starting session');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          idScanValue,
          membershipScanValue: membershipScanValue || undefined,
          checkinMode: checkinMode === CheckinMode.RENEWAL ? 'RENEWAL' : 'INITIAL',
          visitId: checkinMode === CheckinMode.RENEWAL && selectedVisit ? selectedVisit.id : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start session');
      }

      const data = await response.json();
      console.log('Session started:', data);
      
      // Update local state
      if (data.customerName) setCustomerName(data.customerName);
      if (data.membershipNumber) setMembershipNumber(data.membershipNumber);
      if (data.sessionId) setCurrentSessionId(data.sessionId);
      
      // Clear manual entry mode if active
      if (manualEntry) {
        setManualEntry(false);
      }
    } catch (error) {
      console.error('Failed to start session:', error);
      alert(error instanceof Error ? error.message : 'Failed to start session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateLaneSession = async (name: string, membership: string | null) => {
    // Use new check-in start endpoint
    await startLaneSession(name, membership);
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

  const fetchAgreementStatus = async (sessionId: string) => {
    if (!session?.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/sessions/active`, {
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const activeSession = data.sessions?.find((s: { id: string }) => s.id === sessionId);
        if (activeSession) {
          setAgreementSigned(activeSession.agreementSigned || false);
        }
      }
    } catch (error) {
      console.error('Failed to fetch agreement status:', error);
    }
  };

  const handleClearSession = async () => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/lanes/${lane}/clear`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to clear session');
      }

      setCustomerName('');
      setMembershipNumber('');
      setCurrentSessionId(null);
      setAgreementSigned(false);
      setManualEntry(false);
      setSelectedVisit(null);
      setCheckinMode(CheckinMode.INITIAL);
      setShowRenewalSearch(false);
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

  const handleSearchActiveVisits = async () => {
    if (!session?.sessionToken || !renewalSearchQuery.trim()) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE}/v1/visits/active?query=${encodeURIComponent(renewalSearchQuery)}`,
        {
          headers: {
            'Authorization': `Bearer ${session.sessionToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to search visits');
      }

      const data = await response.json();
      setRenewalSearchResults(data.visits || []);
    } catch (error) {
      console.error('Failed to search visits:', error);
      alert('Failed to search visits');
    }
  };

  const handleSelectVisit = (visit: ActiveVisit) => {
    setSelectedVisit(visit);
    setCustomerName(visit.customerName);
    setMembershipNumber(visit.membershipNumber || '');
    setShowRenewalSearch(false);
    setRenewalSearchQuery('');
    setRenewalSearchResults([]);
  };

  const handleCreateVisit = async (rentalType: string, roomId?: string, lockerId?: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    if (checkinMode === CheckinMode.RENEWAL && !selectedVisit) {
      alert('Please select a visit to renew');
      return;
    }

    setIsSubmitting(true);
    try {
      if (checkinMode === CheckinMode.RENEWAL && selectedVisit) {
        // Show renewal disclaimer before proceeding
        setSelectedRentalType(rentalType);
        setShowRenewalDisclaimer(true);
        setIsSubmitting(false);
        return;
      }

      // For initial check-in, we need member ID - for now, use lane session approach
      // In production, this would look up member by name/membership
      await updateLaneSession(customerName, membershipNumber || null);
    } catch (error) {
      console.error('Failed to create visit:', error);
      alert('Failed to create visit');
      setIsSubmitting(false);
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to claim checkout');
      }

      const data = await response.json();
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to confirm items');
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to mark fee as paid');
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to complete checkout');
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

  const handleRenewalDisclaimerAcknowledge = async () => {
    if (!session?.sessionToken || !selectedVisit || !selectedRentalType) {
      return;
    }

    setIsSubmitting(true);
    setShowRenewalDisclaimer(false);

    try {
      const response = await fetch(`${API_BASE}/v1/visits/${selectedVisit.id}/renew`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          rentalType: selectedRentalType,
          lane,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to renew visit');
      }

      const data = await response.json();
      setCurrentSessionId(data.sessionId);
      setSelectedRentalType(null);
      alert('Renewal created successfully');
    } catch (error) {
      console.error('Failed to renew visit:', error);
      alert(error instanceof Error ? error.message : 'Failed to renew visit');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Waitlist/Upgrades functions
  const fetchWaitlist = async () => {
    if (!session?.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/waitlist?status=ACTIVE`, {
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setWaitlistEntries(data.entries || []);
      }
    } catch (error) {
      console.error('Failed to fetch waitlist:', error);
    }
  };

  const fetchAvailableRoomsForTier = async (tier: string) => {
    if (!session?.sessionToken) return;

    try {
      const response = await fetch(`${API_BASE}/v1/inventory/summary`, {
        headers: {
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Get available rooms for the desired tier
        // This is simplified - in production, you'd filter by tier
        const availableRooms: Array<{ id: string; number: string; tier: string }> = [];
        // For now, we'll need to fetch room details separately
        // This is a placeholder - actual implementation would query rooms by tier
        setAvailableRoomsForUpgrade(availableRooms);
      }
    } catch (error) {
      console.error('Failed to fetch available rooms:', error);
    }
  };

  const handleOfferUpgrade = async (waitlistId: string, roomId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/waitlist/${waitlistId}/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({ roomId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to offer upgrade');
      }

      await fetchWaitlist();
      alert('Upgrade offered successfully');
    } catch (error) {
      console.error('Failed to offer upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to offer upgrade');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFulfillUpgrade = async (waitlistId: string, roomId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      // Show upgrade disclaimer first
      setShowUpgradeDisclaimer(true);
      setSelectedWaitlistEntry(waitlistId);
      
      // Store room ID for after disclaimer
      const fulfillAfterDisclaimer = async () => {
        try {
          const response = await fetch(`${API_BASE}/v1/upgrades/fulfill`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.sessionToken}`,
            },
            body: JSON.stringify({
              waitlistId,
              roomId,
              acknowledgedDisclaimer: true,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            if (error.code === 'REAUTH_REQUIRED') {
              alert('Re-authentication required. Please log in again.');
              handleLogout();
              return;
            }
            throw new Error(error.error || 'Failed to fulfill upgrade');
          }

          const data = await response.json();
          setUpgradePaymentIntentId(data.paymentIntentId);
          setUpgradeFee(data.upgradeFee);
          setShowUpgradeDisclaimer(false);
          alert(`Upgrade fee: $${data.upgradeFee}. Please mark payment as paid in Square.`);
          await fetchWaitlist();
        } catch (error) {
          console.error('Failed to fulfill upgrade:', error);
          alert(error instanceof Error ? error.message : 'Failed to fulfill upgrade');
        } finally {
          setIsSubmitting(false);
        }
      };

      // For now, auto-acknowledge and proceed
      // In production, wait for staff to acknowledge
      await fulfillAfterDisclaimer();
    } catch (error) {
      console.error('Failed to fulfill upgrade:', error);
      alert(error instanceof Error ? error.message : 'Failed to fulfill upgrade');
      setIsSubmitting(false);
    }
  };

  const handleCompleteUpgrade = async (waitlistId: string, paymentIntentId: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/upgrades/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          waitlistId,
          paymentIntentId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.code === 'REAUTH_REQUIRED') {
          alert('Re-authentication required. Please log in again.');
          handleLogout();
          return;
        }
        throw new Error(error.error || 'Failed to complete upgrade');
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

  const handleFinalExtension = async (visitId: string, rentalType: string, roomId?: string, lockerId?: string) => {
    if (!session?.sessionToken) {
      alert('Not authenticated');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/visits/${visitId}/final-extension`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          rentalType,
          roomId,
          lockerId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.code === 'REAUTH_REQUIRED') {
          alert('Re-authentication required. Please log in again.');
          handleLogout();
          return;
        }
        throw new Error(error.error || 'Failed to create final extension');
      }

      const data = await response.json();
      setShowFinalExtensionModal(false);
      setFinalExtensionVisitId(null);
      alert(`Final extension created. Payment: $20. Please mark payment as paid in Square. Payment Intent ID: ${data.paymentIntentId}`);
    } catch (error) {
      console.error('Failed to create final extension:', error);
      alert(error instanceof Error ? error.message : 'Failed to create final extension');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthStatus) => setHealth(data))
      .catch(console.error);

    // Connect to WebSocket
    const ws = new WebSocket(`ws://${window.location.hostname}:3001/ws?lane=${encodeURIComponent(lane)}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
      
      // Subscribe to events
      ws.send(JSON.stringify({
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
      }));
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketEvent = JSON.parse(event.data);
        console.log('WebSocket message:', message);

        if (message.type === 'CHECKOUT_REQUESTED') {
          const payload = message.payload as CheckoutRequestedPayload;
          setCheckoutRequests(prev => {
            const next = new Map(prev);
            next.set(payload.request.requestId, payload.request);
            return next;
          });
        } else if (message.type === 'CHECKOUT_CLAIMED') {
          const payload = message.payload as CheckoutClaimedPayload;
          setCheckoutRequests(prev => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
        } else if (message.type === 'CHECKOUT_UPDATED') {
          const payload = message.payload as CheckoutUpdatedPayload;
          if (selectedCheckoutRequest === payload.requestId) {
            setCheckoutItemsConfirmed(payload.itemsConfirmed);
            setCheckoutFeePaid(payload.feePaid);
          }
        } else if (message.type === 'CHECKOUT_COMPLETED') {
          const payload = message.payload as { requestId: string };
          setCheckoutRequests(prev => {
            const next = new Map(prev);
            next.delete(payload.requestId);
            return next;
          });
          if (selectedCheckoutRequest === payload.requestId) {
            setSelectedCheckoutRequest(null);
            setCheckoutChecklist({});
            setCheckoutItemsConfirmed(false);
            setCheckoutFeePaid(false);
          }
        } else if (message.type === 'SESSION_UPDATED') {
          const payload = message.payload as SessionUpdatedPayload;
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
        } else if (message.type === 'SELECTION_PROPOSED') {
          const payload = message.payload as SelectionProposedPayload;
          if (payload.sessionId === currentSessionId) {
            setProposedRentalType(payload.rentalType);
            setProposedBy(payload.proposedBy);
          }
        } else if (message.type === 'SELECTION_LOCKED') {
          const payload = message.payload as SelectionLockedPayload;
          if (payload.sessionId === currentSessionId) {
            setSelectionConfirmed(true);
            setSelectionConfirmedBy(payload.confirmedBy);
            setCustomerSelectedType(payload.rentalType);
            // If employee didn't confirm, show acknowledgement prompt
            if (payload.confirmedBy === 'CUSTOMER') {
              setSelectionAcknowledged(false);
            } else {
              setSelectionAcknowledged(true);
            }
          }
        } else if (message.type === 'SELECTION_ACKNOWLEDGED') {
          const payload = message.payload as SelectionAcknowledgedPayload;
          if (payload.sessionId === currentSessionId) {
            setSelectionAcknowledged(true);
          }
        } else if (message.type === 'INVENTORY_UPDATED' || message.type === 'ROOM_STATUS_CHANGED') {
          // Refresh inventory will be handled by InventorySelector component
        } else if (message.type === 'ASSIGNMENT_CREATED') {
          const payload = message.payload as AssignmentCreatedPayload;
          if (payload.sessionId === currentSessionId) {
            // Assignment successful - create payment intent
            handleCreatePaymentIntent();
          }
        } else if (message.type === 'ASSIGNMENT_FAILED') {
          const payload = message.payload as AssignmentFailedPayload;
          if (payload.sessionId === currentSessionId) {
            // Handle race condition - refresh and re-select
            alert('Assignment failed: ' + payload.reason);
            setSelectedInventoryItem(null);
          }
        } else if (message.type === 'CUSTOMER_CONFIRMED') {
          const payload = message.payload as CustomerConfirmedPayload;
          if (payload.sessionId === currentSessionId) {
            setShowCustomerConfirmationPending(false);
            setCustomerConfirmationType(null);
            // Proceed with payment intent creation
            handleCreatePaymentIntent();
          }
        } else if (message.type === 'CUSTOMER_DECLINED') {
          const payload = message.payload as CustomerDeclinedPayload;
          if (payload.sessionId === currentSessionId) {
            setShowCustomerConfirmationPending(false);
            setCustomerConfirmationType(null);
            // Revert to customer's requested type
            if (customerSelectedType) {
              setSelectedInventoryItem(null);
              // This will trigger auto-selection in InventorySelector
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    return () => ws.close();
  }, [selectedCheckoutRequest, lane]);

  const handleInventorySelect = (type: 'room' | 'locker', id: string, number: string, tier: string) => {
    // If selection is locked and not acknowledged, don't allow selection change
    if (selectionConfirmed && !selectionAcknowledged) {
      alert('Please acknowledge the locked selection before changing selection.');
      return;
    }

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

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/propose-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          rentalType,
          proposedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to propose selection');
      }

      setProposedRentalType(rentalType);
      setProposedBy('EMPLOYEE');
    } catch (error) {
      console.error('Failed to propose selection:', error);
      alert(error instanceof Error ? error.message : 'Failed to propose selection. Please try again.');
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          confirmedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to confirm selection');
      }

      setSelectionConfirmed(true);
      setSelectionConfirmedBy('EMPLOYEE');
      setSelectionAcknowledged(true);
      setCustomerSelectedType(proposedRentalType);
    } catch (error) {
      console.error('Failed to confirm selection:', error);
      alert(error instanceof Error ? error.message : 'Failed to confirm selection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcknowledgeSelection = async () => {
    if (!currentSessionId || !session?.sessionToken) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/acknowledge-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          acknowledgedBy: 'EMPLOYEE',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to acknowledge selection');
      }

      setSelectionAcknowledged(true);
    } catch (error) {
      console.error('Failed to acknowledge selection:', error);
      alert(error instanceof Error ? error.message : 'Failed to acknowledge selection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
      alert('Agreement must be signed before assignment. Please wait for customer to sign the agreement.');
      return;
    }

    if (paymentStatus !== 'PAID') {
      alert('Payment must be marked as paid before assignment. Please mark payment as paid in Square first.');
      return;
    }

    setIsSubmitting(true);
    try {

      // Use new check-in assign endpoint
      const response = await fetch(`${API_BASE}/v1/checkin/lane/${lane}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          resourceType: selectedInventoryItem.type,
          resourceId: selectedInventoryItem.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.raceLost || error.error?.includes('already assigned')) {
          // Race condition - refresh inventory and re-select
          alert('Item no longer available. Refreshing inventory...');
          setSelectedInventoryItem(null);
          // InventorySelector will auto-refresh and re-select
        } else {
          throw new Error(error.error || 'Failed to assign');
        }
      } else {
        const data = await response.json();
        console.log('Assignment successful:', data);
        
        // If cross-type assignment, wait for customer confirmation
        if (data.needsConfirmation) {
          setShowCustomerConfirmationPending(true);
          setIsSubmitting(false);
          return;
        }

        // Create payment intent after successful assignment
        await handleCreatePaymentIntent();
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create payment intent');
      }

      const data = await response.json();
      setPaymentIntentId(data.paymentIntentId);
      setPaymentQuote(data.quote);
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
          'Authorization': `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          squareTransactionId: undefined, // Would come from Square POS integration
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to mark payment as paid');
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

  const handleClearSelection = () => {
    setSelectedInventoryItem(null);
  };

  return (
    <RegisterSignIn
      deviceId={deviceId}
      onSignedIn={handleRegisterSignIn}
    >
      <div className="container" style={{ marginTop: '60px', padding: '1.5rem' }}>
      {/* Checkout Request Notifications */}
      {checkoutRequests.size > 0 && !selectedCheckoutRequest && (
        <div style={{
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
        }}>
          {Array.from(checkoutRequests.values()).map((request) => {
            const lateMinutes = request.lateMinutes;
            const feeAmount = request.lateFeeAmount;
            const banApplied = request.banApplied;
            
            return (
              <div
                key={request.requestId}
                onClick={() => handleClaimCheckout(request.requestId)}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}>
                      {request.customerName}
                      {request.membershipNumber && ` (${request.membershipNumber})`}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                      {request.rentalType} • {request.roomNumber || request.lockerNumber || 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      Scheduled: {new Date(request.scheduledCheckoutAt).toLocaleString()} • 
                      Current: {new Date(request.currentTime).toLocaleString()} • 
                      {lateMinutes > 0 ? (
                        <span style={{ color: '#f59e0b' }}>{lateMinutes} min late</span>
                      ) : (
                        <span>On time</span>
                      )}
                    </div>
                    {feeAmount > 0 && (
                      <div style={{ fontSize: '0.875rem', color: '#f59e0b', marginTop: '0.25rem', fontWeight: 600 }}>
                        Late fee: ${feeAmount.toFixed(2)}
                        {banApplied && ' • 30-day ban applied'}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClaimCheckout(request.requestId);
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
      {selectedCheckoutRequest && (() => {
        const request = checkoutRequests.get(selectedCheckoutRequest);
        if (!request) return null;
        
        return (
          <div style={{
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
          }}>
            <div style={{
              background: '#1e293b',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}>
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
                Checkout Verification
              </h2>
              
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong>Customer:</strong> {request.customerName}
                  {request.membershipNumber && ` (${request.membershipNumber})`}
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong>Rental:</strong> {request.rentalType} • {request.roomNumber || request.lockerNumber || 'N/A'}
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong>Scheduled Checkout:</strong> {new Date(request.scheduledCheckoutAt).toLocaleString()}
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

              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#0f172a', borderRadius: '8px' }}>
                <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Customer Checklist:</div>
                <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                  (Items customer marked as returned)
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                <button
                  onClick={() => handleConfirmItems(selectedCheckoutRequest)}
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
                    onClick={() => handleMarkFeePaid(selectedCheckoutRequest)}
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
                  onClick={() => handleCompleteCheckout(selectedCheckoutRequest)}
                  disabled={!checkoutItemsConfirmed || (request.lateFeeAmount > 0 && !checkoutFeePaid) || isSubmitting}
                  style={{
                    padding: '0.75rem',
                    background: (!checkoutItemsConfirmed || (request.lateFeeAmount > 0 && !checkoutFeePaid)) ? '#475569' : '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: (!checkoutItemsConfirmed || (request.lateFeeAmount > 0 && !checkoutFeePaid)) ? 'not-allowed' : 'pointer',
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

      <header className="header">
        <h1>Employee Register</h1>
        <div className="status-badges">
          <span className={`badge ${health?.status === 'ok' ? 'badge-success' : 'badge-error'}`}>
            API: {health?.status ?? '...'}
          </span>
          <span className={`badge ${wsConnected ? 'badge-success' : 'badge-error'}`}>
            WS: {wsConnected ? 'Live' : 'Offline'}
          </span>
          <span className="badge badge-info">Lane: {lane}</span>
          <span className="badge badge-info">{session.name} ({session.role})</span>
          <button
            onClick={handleLogout}
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
      </header>

      <main className="main">
        {/* Waitlist/Upgrades Panel Toggle */}
        <section style={{ marginBottom: '1rem' }}>
          <button
            onClick={() => setShowUpgradesPanel(!showUpgradesPanel)}
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
            {showUpgradesPanel ? '▼' : '▶'} Upgrades / Waitlist ({waitlistEntries.filter(e => e.status === 'ACTIVE' || e.status === 'OFFERED').length})
          </button>
        </section>

        {/* Waitlist/Upgrades Panel */}
        {showUpgradesPanel && (
          <section style={{ marginBottom: '1rem', padding: '1rem', background: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>Waitlist & Upgrades</h2>
            
            {waitlistEntries.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No active waitlist entries</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {['ACTIVE', 'OFFERED'].map(status => {
                  const entries = waitlistEntries.filter(e => e.status === status);
                  if (entries.length === 0) return null;
                  
                  return (
                    <div key={status} style={{ marginBottom: '1rem' }}>
                      <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 600, color: status === 'OFFERED' ? '#f59e0b' : '#94a3b8' }}>
                        {status === 'OFFERED' ? '⚠️ Offered' : '⏳ Active'} ({entries.length})
                      </h3>
                      {entries.map(entry => (
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                            <div>
                              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                {entry.displayIdentifier} → {entry.desiredTier}
                              </div>
                              <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                                Current: {entry.currentRentalType} • Created: {new Date(entry.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                            {status === 'OFFERED' && upgradePaymentIntentId && entry.id === selectedWaitlistEntry && (
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.875rem', color: '#f59e0b', marginBottom: '0.25rem' }}>
                                  Fee: ${upgradeFee?.toFixed(2)}
                                </div>
                                <button
                                  onClick={() => {
                                    if (paymentStatus === 'PAID') {
                                      handleCompleteUpgrade(entry.id, upgradePaymentIntentId);
                                    } else {
                                      alert('Please mark payment as paid in Square first');
                                    }
                                  }}
                                  disabled={paymentStatus !== 'PAID' || isSubmitting}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    background: paymentStatus === 'PAID' ? '#10b981' : '#475569',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '0.875rem',
                                    fontWeight: 600,
                                    cursor: paymentStatus === 'PAID' ? 'pointer' : 'not-allowed',
                                  }}
                                >
                                  {paymentStatus === 'PAID' ? 'Complete Upgrade' : 'Mark Paid First'}
                                </button>
                              </div>
                            )}
                          </div>
                          {status === 'ACTIVE' && (
                            <button
                              onClick={() => {
                                // For now, show alert - in production, would show room selector
                                alert('Select a room to offer. This will open room selector.');
                                // handleOfferUpgrade(entry.id, roomId);
                              }}
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

        {/* Mode Toggle */}
        <section className="mode-toggle-section" style={{ marginBottom: '1rem', padding: '1rem', background: '#f3f4f6', borderRadius: '8px' }}>
          <h2 style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>Check-in Mode</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => {
                setCheckinMode(CheckinMode.INITIAL);
                setSelectedVisit(null);
                setShowRenewalSearch(false);
                // Clear all session state when switching modes
                setCustomerName('');
                setMembershipNumber('');
                setCurrentSessionId(null);
                setAgreementSigned(false);
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
              }}
              style={{
                padding: '0.5rem 1rem',
                background: checkinMode === CheckinMode.INITIAL ? '#3b82f6' : '#e5e7eb',
                color: checkinMode === CheckinMode.INITIAL ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Initial Check-in
            </button>
            <button
              onClick={() => {
                setCheckinMode(CheckinMode.RENEWAL);
                setShowRenewalSearch(true);
                // Clear all session state when switching modes
                setCustomerName('');
                setMembershipNumber('');
                setCurrentSessionId(null);
                setAgreementSigned(false);
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
                setProposedRentalType(null);
                setProposedBy(null);
                setSelectionConfirmed(false);
                setSelectionConfirmedBy(null);
                setSelectionAcknowledged(false);
              }}
              style={{
                padding: '0.5rem 1rem',
                background: checkinMode === CheckinMode.RENEWAL ? '#3b82f6' : '#e5e7eb',
                color: checkinMode === CheckinMode.RENEWAL ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Renewal
            </button>
          </div>
        </section>

        {/* Renewal Visit Search */}
        {checkinMode === CheckinMode.RENEWAL && showRenewalSearch && (
          <section className="renewal-search-section" style={{ marginBottom: '1rem', padding: '1rem', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '0.5rem' }}>Select Visit to Renew</h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={renewalSearchQuery}
                onChange={(e) => setRenewalSearchQuery(e.target.value)}
                placeholder="Search by membership # or customer name"
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchActiveVisits();
                  }
                }}
              />
              <button
                onClick={handleSearchActiveVisits}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Search
              </button>
            </div>
            {renewalSearchResults.length > 0 && (
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {renewalSearchResults.map((visit) => (
                  <div
                    key={visit.id}
                    onClick={() => handleSelectVisit(visit)}
                    style={{
                      padding: '0.75rem',
                      marginBottom: '0.5rem',
                      background: selectedVisit?.id === visit.id ? '#dbeafe' : '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{visit.customerName}</div>
                    {visit.membershipNumber && (
                      <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                        Membership: {visit.membershipNumber}
                      </div>
                    )}
                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                      Checkout: {new Date(visit.currentCheckoutAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedVisit && (
              <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#dbeafe', borderRadius: '6px' }}>
                <strong>Selected:</strong> {selectedVisit.customerName} - Checkout: {new Date(selectedVisit.currentCheckoutAt).toLocaleString()}
              </div>
            )}
          </section>
        )}

        {/* Waitlist Banner */}
        {waitlistDesiredTier && waitlistBackupType && (
          <div style={{
            padding: '1rem',
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: '8px',
            marginBottom: '1rem',
            color: '#92400e',
          }}>
            <div style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.5rem' }}>
              ⚠️ Customer Waitlisted
            </div>
            <div style={{ fontSize: '0.875rem' }}>
              Customer requested <strong>{waitlistDesiredTier}</strong> but it's unavailable.
              Assigning <strong>{waitlistBackupType}</strong> as backup. If {waitlistDesiredTier} becomes available, customer can upgrade.
            </div>
          </div>
        )}

        {/* Selection State Display */}
        {currentSessionId && customerName && (proposedRentalType || selectionConfirmed) && (
          <div style={{ 
            padding: '1rem', 
            marginBottom: '1rem', 
            background: selectionConfirmed ? '#10b981' : '#3b82f6', 
            borderRadius: '8px',
            color: 'white',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              {selectionConfirmed 
                ? `✓ Selection Locked: ${proposedRentalType} (by ${selectionConfirmedBy === 'CUSTOMER' ? 'Customer' : 'You'})`
                : `Proposed: ${proposedRentalType} (by ${proposedBy === 'CUSTOMER' ? 'Customer' : 'You'})`}
            </div>
            {!selectionConfirmed && proposedBy === 'EMPLOYEE' && (
              <button
                onClick={handleConfirmSelection}
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
                onClick={handleConfirmSelection}
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
            {selectionConfirmed && selectionConfirmedBy === 'CUSTOMER' && !selectionAcknowledged && (
              <div>
                <p style={{ marginBottom: '0.5rem' }}>Customer has locked this selection. Please acknowledge to continue.</p>
                <button
                  onClick={handleAcknowledgeSelection}
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
                  {isSubmitting ? 'Acknowledging...' : 'Acknowledge'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Quick Selection Buttons */}
        {currentSessionId && customerName && !selectionConfirmed && (
          <div style={{ 
            display: 'flex', 
            gap: '0.5rem', 
            marginBottom: '1rem',
            flexWrap: 'wrap',
          }}>
            {['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL'].map(rental => (
              <button
                key={rental}
                onClick={() => handleProposeSelection(rental)}
                disabled={isSubmitting || (proposedRentalType === rental)}
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
        {currentSessionId && customerName && (
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
          <div style={{
            position: 'sticky',
            bottom: 0,
            background: '#1e293b',
            borderTop: '2px solid #3b82f6',
            padding: '1rem',
            zIndex: 100,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: paymentQuote ? '1rem' : 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}>
                  Selected: {selectedInventoryItem.type === 'room' ? 'Room' : 'Locker'} {selectedInventoryItem.number}
                </div>
                {customerSelectedType && selectedInventoryItem.tier !== customerSelectedType && (
                  <div style={{ fontSize: '0.875rem', color: '#f59e0b' }}>
                    Waiting for customer confirmation...
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleAssign}
                  disabled={isSubmitting || showCustomerConfirmationPending}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: (isSubmitting || showCustomerConfirmationPending) ? '#475569' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: (isSubmitting || showCustomerConfirmationPending) ? 'not-allowed' : 'pointer',
                  }}
                  title={showCustomerConfirmationPending ? 'Waiting for customer confirmation' : 'Assign resource'}
                >
                  {isSubmitting ? 'Assigning...' : showCustomerConfirmationPending ? 'Waiting for Confirmation' : 'Assign'}
                </button>
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
              </div>
            </div>

            {/* Payment Quote and Mark Paid */}
            {paymentQuote && (
              <div style={{
                padding: '1rem',
                background: '#0f172a',
                borderRadius: '6px',
                border: '1px solid #475569',
              }}>
                <div style={{ marginBottom: '0.75rem', fontWeight: 600, fontSize: '1rem' }}>Payment Quote</div>
                <div style={{ marginBottom: '0.5rem' }}>
                  {paymentQuote.lineItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.875rem' }}>
                      <span>{item.description}</span>
                      <span>${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontWeight: 600, 
                  fontSize: '1.125rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid #475569',
                  marginBottom: '0.75rem',
                }}>
                  <span>Total Due:</span>
                  <span>${paymentQuote.total.toFixed(2)}</span>
                </div>
                {paymentQuote.messages && paymentQuote.messages.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
                    {paymentQuote.messages.map((msg, idx) => (
                      <div key={idx}>{msg}</div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleMarkPaid}
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
              className={`action-btn ${showIdScanner ? 'active' : ''}`}
              onClick={() => {
                setShowIdScanner(true);
                setScanMode(null);
                setManualEntry(false);
              }}
            >
              <span className="btn-icon">🆔</span>
              SCAN ID
            </button>
            <button 
              className={`action-btn ${scanMode === 'membership' ? 'active' : ''}`}
              onClick={() => {
                setScanMode(scanMode === 'membership' ? null : 'membership');
                setManualEntry(false);
              }}
            >
              <span className="btn-icon">🏷️</span>
              {scanMode === 'membership' ? 'Scanning Membership...' : 'Scan Membership'}
            </button>
            <button 
              className={`action-btn ${manualEntry ? 'active' : ''}`}
              onClick={() => {
                setManualEntry(!manualEntry);
                setScanMode(null);
              }}
            >
              <span className="btn-icon">✏️</span>
              Manual Entry
            </button>
            <button 
              className="action-btn"
              onClick={handleClearSession}
              disabled={isSubmitting}
            >
              <span className="btn-icon">🗑️</span>
              Clear Session
            </button>
          </div>
          
          {scanMode && (
            <div className="scan-status">
              <p>
                {scanMode === 'id' ? 'Ready to scan ID' : 'Ready to scan membership card'}
              </p>
              <p className="scan-hint">
                Point barcode scanner and scan, or press Enter
              </p>
            </div>
          )}

          {manualEntry && (
            <form className="manual-entry-form" onSubmit={handleManualSubmit}>
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
              <p><strong>Current Session:</strong></p>
              <p>Name: {customerName || 'Not set'}</p>
              {membershipNumber && <p>Membership: {membershipNumber}</p>}
              {currentSessionId && (
                <p className={agreementSigned ? 'agreement-status signed' : 'agreement-status unsigned'}>
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
              Customer requested waitlist for {waitlistDesiredTier}. Assigning a {waitlistBackupType} in the meantime.
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
              Staff selected a different option: {customerConfirmationType.selected} {customerConfirmationType.number}. 
              Waiting for customer to accept or decline on their device.
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

      {/* Renewal Disclaimer Modal */}
      {showRenewalDisclaimer && (
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
            zIndex: 1000,
          }}
          onClick={() => setShowRenewalDisclaimer(false)}
        >
          <div
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Renewal Notice</h2>
            <div style={{ marginBottom: '1.5rem', lineHeight: '1.6' }}>
              <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>
                  This is a renewal that extends your stay for another 6 hours from your current checkout time.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  You are nearing the 14-hour maximum stay for a single visit.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  At the end of this 6-hour renewal, you may extend one final time for 2 additional hours for a flat $20 fee (same for lockers or any room type).
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  The $20 fee is not charged now; it applies only if you choose the final 2-hour extension later.
                </li>
              </ul>
            </div>
            <button
              onClick={handleRenewalDisclaimerAcknowledge}
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? 'Processing...' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {/* ID Scanner Modal */}
      <IdScanner
        isOpen={showIdScanner}
        onClose={() => setShowIdScanner(false)}
        onScan={handleIdScan}
        onManualEntry={() => {
          setShowIdScanner(false);
          setManualEntry(true);
        }}
      />
    </div>
    </RegisterSignIn>
  );
}

export default App;

