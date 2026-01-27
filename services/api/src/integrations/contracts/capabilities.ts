export type ProviderId = 'mock' | 'square';

export type ProviderCapabilities = {
  customers: {
    search: boolean;
    lookupByExternalId: boolean;
    upsertMirror: boolean;
  };
  payments: {
    card: boolean;
    cash: boolean;
    listPayments: boolean;
    listRefunds: boolean;
    refund: boolean;
  };
  orders: {
    create: boolean;
    addLineItem: boolean;
    finalizePaid: boolean;
    lookupByExternalId: boolean;
  };
  labor: {
    shifts: boolean;
    timeclock: boolean;
    breaks: boolean;
  };
};

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  mock: {
    customers: {
      search: true,
      lookupByExternalId: true,
      upsertMirror: true,
    },
    payments: {
      card: true,
      cash: true,
      listPayments: true,
      listRefunds: true,
      refund: true,
    },
    orders: {
      create: true,
      addLineItem: true,
      finalizePaid: true,
      lookupByExternalId: true,
    },
    labor: {
      shifts: true,
      timeclock: true,
      breaks: true,
    },
  },
  square: {
    customers: {
      search: true,
      lookupByExternalId: true,
      upsertMirror: true,
    },
    payments: {
      card: true,
      cash: true,
      listPayments: true,
      listRefunds: true,
      refund: true,
    },
    orders: {
      create: true,
      addLineItem: true,
      finalizePaid: true,
      lookupByExternalId: true,
    },
    labor: {
      shifts: true,
      timeclock: true,
      breaks: true,
    },
  },
};
