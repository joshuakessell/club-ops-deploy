import { getApiUrl } from '@club-ops/shared';
import { getErrorMessage, isRecord } from '@club-ops/ui';
import type { ActiveCheckinDetails } from '../components/register/modals/AlreadyCheckedInModal';

const API_BASE = getApiUrl('/api');

export type StartLaneResponse = {
  sessionId?: string;
  customerName?: string;
  membershipNumber?: string;
  mode?: 'CHECKIN' | 'RENEWAL';
  blockEndsAt?: string;
  visitId?: string;
  currentTotalHours?: number;
  renewalHours?: 2 | 6;
  activeAssignedResourceType?: 'room' | 'locker';
  activeAssignedResourceNumber?: string;
  customerHasEncryptedLookupMarker?: boolean;
};

export type StartLaneCheckinResult =
  | { kind: 'already-visiting'; activeCheckin: ActiveCheckinDetails }
  | { kind: 'error'; message: string }
  | { kind: 'started'; payload: StartLaneResponse | null };

function parseAlreadyCheckedIn(payload: unknown): ActiveCheckinDetails | null {
  if (!isRecord(payload)) return null;
  if (payload['code'] !== 'ALREADY_CHECKED_IN') return null;
  const ac = payload['activeCheckin'];
  if (isRecord(ac) && typeof ac['visitId'] === 'string') {
    return ac as ActiveCheckinDetails;
  }
  return null;
}

export async function startLaneCheckin(params: {
  lane: string;
  sessionToken: string;
  customerId: string;
  visitId?: string;
  renewalHours?: 2 | 6;
}): Promise<StartLaneCheckinResult> {
  const { lane, sessionToken, customerId, visitId, renewalHours } = params;

  const response = await fetch(`${API_BASE}/v1/checkin/lane/${encodeURIComponent(lane)}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      customerId,
      ...(visitId ? { visitId } : {}),
      ...(renewalHours ? { renewalHours } : {}),
    }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (response.ok) {
    const activeCheckin = parseAlreadyCheckedIn(payload);
    if (activeCheckin) {
      return { kind: 'already-visiting', activeCheckin };
    }
    return { kind: 'started', payload: isRecord(payload) ? (payload as StartLaneResponse) : null };
  }

  if (response.status === 409) {
    const activeCheckin = parseAlreadyCheckedIn(payload);
    if (activeCheckin) {
      return { kind: 'already-visiting', activeCheckin };
    }
  }

  const msg = getErrorMessage(payload) || `Failed to start check-in (HTTP ${response.status})`;
  return { kind: 'error', message: msg };
}
