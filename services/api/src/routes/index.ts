/**
 * Routes barrel file.
 * All route modules are exported here for registration in the main server.
 */
export { healthRoutes } from './health';
export { authRoutes } from './auth';
export { webauthnRoutes } from './webauthn';
export { customerRoutes } from './customers';
export { sessionRoutes } from './sessions';
export { laneRoutes } from './lanes';
export { inventoryRoutes } from './inventory';
export { roomsRoutes } from './rooms';
export { keysRoutes } from './keys';
export { cleaningRoutes } from './cleaning';
export { adminRoutes } from './admin';
export { agreementRoutes } from './agreements';
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