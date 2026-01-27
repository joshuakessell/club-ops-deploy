import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CustomerConfirmationRequiredPayload,
  SessionUpdatedPayload,
} from '@club-ops/shared';
import { getMembershipStatus, type SessionState } from '../../utils/membership';

export type AppView =
  | 'idle'
  | 'language'
  | 'selection'
  | 'payment'
  | 'agreement'
  | 'agreement-bypass'
  | 'complete';

type ProposedBy = 'CUSTOMER' | 'EMPLOYEE' | null;

type SelectionConfirmedBy = 'CUSTOMER' | 'EMPLOYEE' | null;

type UpgradeAction = 'waitlist' | null;

type MembershipChoice = 'ONE_TIME' | 'SIX_MONTH' | null;

type MembershipModalIntent = 'PURCHASE' | 'RENEW' | null;

type CheckinMode = 'CHECKIN' | 'RENEWAL' | null;

export function useKioskSessionState() {
  const [session, setSession] = useState<SessionState>({
    sessionId: null,
    customerName: null,
    membershipNumber: null,
    allowedRentals: [],
  });
  const [view, setView] = useState<AppView>('idle');
  const [selectedRental, setSelectedRental] = useState<string | null>(null);
  const [showUpgradeDisclaimer, setShowUpgradeDisclaimer] = useState(false);
  const [upgradeAction, setUpgradeAction] = useState<UpgradeAction>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkinMode, setCheckinMode] = useState<CheckinMode>(null);
  const [showRenewalDisclaimer, setShowRenewalDisclaimer] = useState(false);
  const [showCustomerConfirmation, setShowCustomerConfirmation] = useState(false);
  const [customerConfirmationData, setCustomerConfirmationData] =
    useState<CustomerConfirmationRequiredPayload | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [waitlistDesiredType, setWaitlistDesiredType] = useState<string | null>(null);
  const [waitlistBackupType, setWaitlistBackupType] = useState<string | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [waitlistETA, setWaitlistETA] = useState<string | null>(null);
  const [waitlistUpgradeFee, setWaitlistUpgradeFee] = useState<number | null>(null);
  const [proposedRentalType, setProposedRentalType] = useState<string | null>(null);
  const [proposedBy, setProposedBy] = useState<ProposedBy>(null);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [selectionConfirmedBy, setSelectionConfirmedBy] = useState<SelectionConfirmedBy>(null);
  const [, setSelectionAcknowledged] = useState(true);
  const [upgradeDisclaimerAcknowledged, setUpgradeDisclaimerAcknowledged] = useState(false);
  const welcomeOverlayTimeoutRef = useRef<number | null>(null);
  const lastWelcomeSessionIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [membershipModalIntent, setMembershipModalIntent] =
    useState<MembershipModalIntent>(null);
  const [membershipChoice, setMembershipChoice] = useState<MembershipChoice>(null);
  const [highlightedLanguage, setHighlightedLanguage] = useState<'EN' | 'ES' | null>(null);
  const [highlightedMembershipChoice, setHighlightedMembershipChoice] =
    useState<MembershipChoice>(null);
  const [highlightedWaitlistBackup, setHighlightedWaitlistBackup] = useState<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session.sessionId;
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    setMembershipChoice(null);
  }, [session.sessionId]);

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

  useEffect(() => {
    const status = getMembershipStatus(session, Date.now());
    const isMember = status === 'ACTIVE' || status === 'PENDING';
    if (isMember) return;
    if (session.membershipPurchaseIntent && membershipChoice !== 'SIX_MONTH') {
      setMembershipChoice('SIX_MONTH');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.sessionId,
    session.membershipPurchaseIntent,
    session.membershipValidUntil,
    session.membershipNumber,
  ]);

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
      agreementBypassPending: undefined,
      agreementSignedMethod: undefined,
      idScanIssue: undefined,
    });
    setSelectedRental(null);
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
    setHighlightedLanguage(null);
    setHighlightedMembershipChoice(null);
    setHighlightedWaitlistBackup(null);
  }, []);

  const applySessionUpdatedPayload = useCallback(
    (payload: SessionUpdatedPayload) => {
      const prevSession = sessionRef.current;
      const hasKey = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
      const assignedResourceType = hasKey('assignedResourceType')
        ? payload.assignedResourceType
        : prevSession?.assignedResourceType;
      const assignedResourceNumber = hasKey('assignedResourceNumber')
        ? payload.assignedResourceNumber
        : prevSession?.assignedResourceNumber;
      const checkoutAt = hasKey('checkoutAt') ? payload.checkoutAt : prevSession?.checkoutAt;

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
        agreementBypassPending: payload.agreementBypassPending,
        agreementSignedMethod: payload.agreementSignedMethod,
        assignedResourceType,
        assignedResourceNumber,
        checkoutAt,
        idScanIssue: payload.idScanIssue ?? undefined,
      }));

      if (payload.mode) {
        setCheckinMode(payload.mode);
      }

      if (payload.kioskAcknowledgedAt) {
        setView('idle');
        return;
      }

      if (payload.idScanIssue) {
        setView('idle');
        return;
      }

      if (assignedResourceType && assignedResourceNumber) {
        setView('complete');
        return;
      }

      if (payload.status === 'COMPLETED') {
        resetToIdle();
        return;
      }

      if (payload.sessionId && payload.status !== 'COMPLETED' && !payload.customerPrimaryLanguage) {
        setView('language');
        return;
      }

      if (payload.pastDueBlocked) {
        setView('selection');
        return;
      }

      if (
        payload.paymentStatus === 'PAID' &&
        payload.agreementBypassPending &&
        !payload.agreementSigned
      ) {
        setView('agreement-bypass');
        return;
      }

      if (
        payload.paymentStatus === 'PAID' &&
        !payload.agreementSigned &&
        (payload.mode === 'CHECKIN' || payload.mode === 'RENEWAL')
      ) {
        setView('agreement');
        return;
      }

      if (payload.selectionConfirmed && payload.paymentStatus === 'DUE') {
        setView('payment');
        return;
      }

      if (payload.sessionId && payload.status !== 'COMPLETED') {
        setView('selection');
      }

      if (payload.proposedRentalType) {
        setProposedRentalType(payload.proposedRentalType);
        setProposedBy(payload.proposedBy || null);
      }
      if (payload.waitlistDesiredType !== undefined) {
        setWaitlistDesiredType(payload.waitlistDesiredType || null);
      }
      if (payload.backupRentalType !== undefined) {
        setWaitlistBackupType(payload.backupRentalType || null);
      }
      if (payload.selectionConfirmed !== undefined) {
        setSelectionConfirmed(Boolean(payload.selectionConfirmed));
        setSelectionConfirmedBy(payload.selectionConfirmedBy || null);
      }
    },
    [resetToIdle]
  );

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

  useEffect(() => {
    if (view === 'agreement' && checkinMode !== 'CHECKIN' && checkinMode !== 'RENEWAL') {
      setView('complete');
    }
  }, [view, checkinMode]);

  const dismissWelcomeOverlay = useCallback(() => {
    setShowWelcomeOverlay(false);
  }, []);

  return {
    session,
    setSession,
    view,
    setView,
    selectedRental,
    setSelectedRental,
    showUpgradeDisclaimer,
    setShowUpgradeDisclaimer,
    upgradeAction,
    setUpgradeAction,
    isSubmitting,
    setIsSubmitting,
    checkinMode,
    setCheckinMode,
    showRenewalDisclaimer,
    setShowRenewalDisclaimer,
    showCustomerConfirmation,
    setShowCustomerConfirmation,
    customerConfirmationData,
    setCustomerConfirmationData,
    showWaitlistModal,
    setShowWaitlistModal,
    waitlistDesiredType,
    setWaitlistDesiredType,
    waitlistBackupType,
    setWaitlistBackupType,
    waitlistPosition,
    setWaitlistPosition,
    waitlistETA,
    setWaitlistETA,
    waitlistUpgradeFee,
    setWaitlistUpgradeFee,
    proposedRentalType,
    setProposedRentalType,
    proposedBy,
    setProposedBy,
    selectionConfirmed,
    setSelectionConfirmed,
    selectionConfirmedBy,
    setSelectionConfirmedBy,
    setSelectionAcknowledged,
    upgradeDisclaimerAcknowledged,
    setUpgradeDisclaimerAcknowledged,
    showWelcomeOverlay,
    dismissWelcomeOverlay,
    showMembershipModal,
    setShowMembershipModal,
    membershipModalIntent,
    setMembershipModalIntent,
    membershipChoice,
    setMembershipChoice,
    highlightedLanguage,
    setHighlightedLanguage,
    highlightedMembershipChoice,
    setHighlightedMembershipChoice,
    highlightedWaitlistBackup,
    setHighlightedWaitlistBackup,
    resetToIdle,
    applySessionUpdatedPayload,
    sessionIdRef,
    sessionRef,
  };
}
