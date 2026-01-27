/**
 * Routes barrel file.
 * All route modules are exported here for registration in the main server.
 */
export { healthRoutes } from './health';
export { authRoutes } from './auth';
export { webauthnRoutes } from './webauthn';
export { customerRoutes } from './customers';
export { inventoryRoutes } from './inventory';
export { roomsRoutes } from './rooms';
export { keysRoutes } from './keys';
export { cleaningRoutes } from './cleaning';
export { adminRoutes } from './admin';
export { adminTelemetryRoutes } from './admin-telemetry';
export { agreementsRoutes } from './agreements';
export { upgradeRoutes } from './upgrades';
export { waitlistRoutes } from './waitlist';
export { metricsRoutes } from './metrics';
export { visitRoutes } from './visits';
export { checkoutRoutes } from './checkout';
export { checkinRoutes } from './checkin';
export { registerRoutes } from './registers';
export { shiftsRoutes } from './shifts';
export { timeclockRoutes } from './timeclock';
export { documentsRoutes } from './documents';
export { sessionDocumentsRoutes } from './session-documents';
export { scheduleRoutes } from './schedule';
export { timeoffRoutes } from './timeoff';
export { cashDrawerRoutes } from './cash-drawers';
export { breakRoutes } from './breaks';
export { orderRoutes } from './orders';
