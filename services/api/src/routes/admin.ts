import type { FastifyInstance } from 'fastify';
import { registerAdminCustomerRoutes } from './admin/customers';
import { registerAdminDeviceRoutes } from './admin/devices';
import { registerAdminKpiRoutes } from './admin/kpi';
import { registerAdminMetricsRoutes } from './admin/metrics';
import { registerAdminRegisterSessionRoutes } from './admin/register-sessions';
import { registerAdminReportRoutes } from './admin/reports';
import { registerAdminRoomRoutes } from './admin/rooms';
import { registerAdminStaffRoutes } from './admin/staff';

/**
 * Admin-only routes for operations management and metrics.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  registerAdminMetricsRoutes(fastify);

  registerAdminRoomRoutes(fastify);

  registerAdminKpiRoutes(fastify);

  registerAdminStaffRoutes(fastify);

  registerAdminRegisterSessionRoutes(fastify);

  registerAdminDeviceRoutes(fastify);

  registerAdminCustomerRoutes(fastify);

  registerAdminReportRoutes(fastify);
}
