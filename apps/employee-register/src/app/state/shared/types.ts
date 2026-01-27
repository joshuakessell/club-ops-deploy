export type HomeTab =
  | 'account'
  | 'scan'
  | 'search'
  | 'inventory'
  | 'upgrades'
  | 'checkout'
  | 'roomCleaning'
  | 'firstTime'
  | 'retail';

export type ScanResult =
  | { outcome: 'matched' }
  | { outcome: 'no_match'; message: string; canCreate?: boolean }
  | { outcome: 'error'; message: string };

export interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
}

export interface StaffSession {
  staffId: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  sessionToken: string;
}
