import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeTab } from '../shared/types';

type CheckoutPrefill = {
  occupancyId?: string;
  number?: string;
};

type UseHomeNavigationStateParams = {
  setManualEntry: (value: boolean) => void;
  currentSessionId: string | null;
  laneSessionCustomerId: string | null;
};

export function useHomeNavigationState({
  setManualEntry,
  currentSessionId,
  laneSessionCustomerId,
}: UseHomeNavigationStateParams) {
  const [homeTab, setHomeTab] = useState<HomeTab>('scan');
  const [accountCustomerId, setAccountCustomerId] = useState<string | null>(null);
  const [accountCustomerLabel, setAccountCustomerLabel] = useState<string | null>(null);
  const [checkoutPrefill, setCheckoutPrefill] = useState<CheckoutPrefill | null>(null);
  const [checkoutEntryMode, setCheckoutEntryMode] = useState<'default' | 'direct-confirm'>(
    'default'
  );
  const checkoutReturnToTabRef = useRef<HomeTab | null>(null);

  const selectHomeTab = useCallback(
    (next: HomeTab) => {
      setHomeTab(next);
      setManualEntry(next === 'firstTime');
      if (next !== 'checkout') {
        setCheckoutPrefill(null);
        setCheckoutEntryMode('default');
        checkoutReturnToTabRef.current = null;
      }
    },
    [setManualEntry]
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
      const returnTo: HomeTab = currentSessionId ? 'account' : 'scan';
      checkoutReturnToTabRef.current = returnTo;
      const number = prefill?.number ?? null;
      setCheckoutEntryMode(number ? 'direct-confirm' : 'default');
      setCheckoutPrefill(number ? { number } : null);
      selectHomeTab('checkout');
    },
    [currentSessionId, selectHomeTab]
  );

  const exitCheckout = useCallback(() => {
    const returnTo = checkoutReturnToTabRef.current;
    checkoutReturnToTabRef.current = null;
    setCheckoutPrefill(null);
    setCheckoutEntryMode('default');
    if (returnTo) {
      if (returnTo === 'scan') {
        setAccountCustomerId(null);
        setAccountCustomerLabel(null);
      }
      selectHomeTab(returnTo);
      return;
    }
    selectHomeTab('scan');
  }, [selectHomeTab]);

  const openCustomerAccount = useCallback(
    (customerId: string, label?: string | null) => {
      setAccountCustomerId(customerId);
      setAccountCustomerLabel(label ?? null);
      selectHomeTab('account');
    },
    [selectHomeTab]
  );

  const prevSessionIdForTabRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSessionIdForTabRef.current;
    prevSessionIdForTabRef.current = currentSessionId;
    if (!prev && currentSessionId) {
      if (laneSessionCustomerId && !accountCustomerId) {
        setAccountCustomerId(laneSessionCustomerId);
      }
      selectHomeTab('account');
    }
  }, [accountCustomerId, currentSessionId, laneSessionCustomerId, selectHomeTab]);

  useEffect(() => {
    if (homeTab !== 'account' && !currentSessionId && accountCustomerId) {
      setAccountCustomerId(null);
      setAccountCustomerLabel(null);
    }
  }, [accountCustomerId, currentSessionId, homeTab]);

  const canOpenAccountTab = Boolean(currentSessionId || accountCustomerId);

  return {
    homeTab,
    selectHomeTab,
    accountCustomerId,
    accountCustomerLabel,
    setAccountCustomerId,
    setAccountCustomerLabel,
    canOpenAccountTab,
    checkoutPrefill,
    setCheckoutPrefill,
    checkoutEntryMode,
    setCheckoutEntryMode,
    checkoutReturnToTabRef,
    startCheckoutFromHome,
    startCheckoutFromInventory,
    startCheckoutFromCustomerAccount,
    exitCheckout,
    openCustomerAccount,
  };
}
