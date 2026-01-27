import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiUrl } from '@club-ops/shared';
import { debounce } from '../../../utils/debounce';
import type { StaffSession } from '../shared/types';

type CustomerSuggestion = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  dobMonthDay?: string;
  membershipNumber?: string;
  disambiguator: string;
};

export function useCustomerSearchState(session: StaffSession | null) {
  const searchAbortRef = useRef<AbortController | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);

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
          const data = (await response.json()) as { suggestions?: CustomerSuggestion[] };
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

  return {
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
  };
}
