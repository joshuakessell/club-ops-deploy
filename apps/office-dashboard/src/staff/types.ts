export interface StaffMember {
  id: string;
  name: string;
  role: 'STAFF' | 'ADMIN';
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
}

export interface PasskeyCredential {
  id: string;
  deviceId: string;
  credentialId: string;
  signCount: number;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}
