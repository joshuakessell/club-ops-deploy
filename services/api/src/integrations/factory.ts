import type { ProviderId } from './contracts/capabilities';
import type {
  CustomersProvider,
  LaborProvider,
  OrdersProvider,
  PaymentsProvider,
} from './contracts/providers';
import { createMockProviders } from './mock';

export type IntegrationProviders = {
  providerId: ProviderId;
  customers: CustomersProvider;
  payments: PaymentsProvider;
  orders: OrdersProvider;
  labor: LaborProvider;
};

export function getProviderIdFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderId {
  const raw = env.INTEGRATIONS_PROVIDER?.toLowerCase();
  if (!raw) return 'mock';
  if (raw === 'mock' || raw === 'square') return raw;
  throw new Error(`Unsupported INTEGRATIONS_PROVIDER: ${env.INTEGRATIONS_PROVIDER}`);
}

export function createIntegrationProviders(providerId = getProviderIdFromEnv()): IntegrationProviders {
  if (providerId === 'mock') {
    const providers = createMockProviders();
    return { providerId, ...providers };
  }

  throw new Error('Square provider not implemented yet');
}
