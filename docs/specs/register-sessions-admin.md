# Register Sessions Admin Specification

## Overview

This specification defines the admin monitoring and control features for employee register sessions. The system supports a maximum of two active register sessions (Register 1 and Register 2), with admin oversight, forced sign-out capabilities, device allowlist enforcement, and real-time WebSocket updates.

## Register Session Lifecycle

### Normal Flow

1. **Sign-In**: Employee selects themselves, enters PIN, and is assigned to a register (1 or 2)
2. **Active Session**: Employee remains signed in until explicit sign-out or session expiry
3. **Heartbeat**: Client sends heartbeat every 90 seconds to keep session alive
4. **Sign-Out**: Employee explicitly signs out, or session expires after 90 seconds without heartbeat

### Session States

- **Active**: `signed_out_at IS NULL` - Employee is currently signed into a register
- **Signed Out**: `signed_out_at IS NOT NULL` - Session ended normally
- **Abandoned**: No heartbeat for > 90 seconds - Automatically signed out by cleanup job

## Admin Responsibilities

### Register Monitoring

Admins can view the status of both Register 1 and Register 2:
- Current active/inactive status
- Employee name and role (if active)
- Device ID
- Last heartbeat timestamp and age
- Session creation time

### Force Sign-Out

Admins can force sign-out any active register session:
- Sets `signed_out_at = NOW()` on the session
- Logs audit entry with action `REGISTER_FORCE_SIGN_OUT`
- Broadcasts `REGISTER_SESSION_UPDATED` event with reason `FORCED_SIGN_OUT`
- Client receives event and immediately returns to splash screen

## Device Allowlist

### Rules

- Maximum of 2 enabled devices at any time
- Only enabled devices can:
  - Verify PIN
  - Assign to registers
  - Send heartbeats
  - Confirm register assignments
- Disabled or unknown devices receive clear error codes

### Admin Management

- View all devices (enabled and disabled)
- Add new devices (rejected if 2 already enabled)
- Enable/disable devices
- Disabling an active device automatically forces sign-out of its register session

## Heartbeat and TTL Behavior

- **Heartbeat Interval**: 90 seconds (client sends every 90s)
- **TTL**: 90 seconds (session expires if no heartbeat for 90s)
- **Cleanup Job**: Runs every 30 seconds, signs out abandoned sessions
- **Expired Sessions**: Broadcast `REGISTER_SESSION_UPDATED` with reason `TTL_EXPIRED`

## WebSocket Event: REGISTER_SESSION_UPDATED

### Event Type

`REGISTER_SESSION_UPDATED`

### Payload Shape

```typescript
{
  registerNumber: 1 | 2,
  active: boolean,
  sessionId: string | null,
  employee: {
    id: string,
    displayName: string,
    role: string
  } | null,
  deviceId: string | null,
  createdAt: string | null,
  lastHeartbeatAt: string | null,
  reason: "CONFIRMED" | "SIGNED_OUT" | "FORCED_SIGN_OUT" | "TTL_EXPIRED"
}
```

### Emission Points

1. **CONFIRMED**: After `/v1/registers/confirm` successfully creates session
2. **SIGNED_OUT**: After `/v1/registers/signout` successfully ends session
3. **FORCED_SIGN_OUT**: After admin force sign-out endpoint completes
4. **TTL_EXPIRED**: After cleanup job signs out abandoned session

### Broadcast Scope

- Global broadcast (all connected clients receive event)
- Office dashboard subscribes to update UI
- Employee register subscribes to detect forced sign-out

## Error and Invalidation Behavior

### Client-Side Handling

When employee-register receives:
- 404 from `/v1/registers/heartbeat`: Session not found, return to splash
- `DEVICE_DISABLED` error code: Device disabled, return to splash
- `REGISTER_SESSION_UPDATED` with `active: false` and matching `deviceId`: Forced sign-out, return to splash

### Server-Side Enforcement

Runtime endpoints reject requests from disabled/unknown devices:
- `/v1/auth/verify-pin`
- `/v1/registers/assign`
- `/v1/registers/confirm`
- `/v1/registers/heartbeat`

Error response format:
```json
{
  "error": "Device not allowed",
  "code": "DEVICE_DISABLED",
  "message": "This device is not enabled for register use"
}
```

## API Endpoints

### Admin Endpoints (requireAuth + requireAdmin)

#### GET /v1/admin/register-sessions

Returns array with exactly two entries (Register 1 and Register 2).

Response:
```json
[
  {
    "registerNumber": 1,
    "active": true,
    "sessionId": "uuid",
    "employee": {
      "id": "uuid",
      "displayName": "John Doe",
      "role": "STAFF"
    },
    "deviceId": "device-123",
    "createdAt": "2024-01-01T12:00:00Z",
    "lastHeartbeatAt": "2024-01-01T12:01:30Z",
    "secondsSinceHeartbeat": 45
  },
  {
    "registerNumber": 2,
    "active": false,
    "sessionId": null,
    "employee": null,
    "deviceId": null,
    "createdAt": null,
    "lastHeartbeatAt": null,
    "secondsSinceHeartbeat": null
  }
]
```

#### POST /v1/admin/register-sessions/:registerNumber/force-signout

Forces sign-out of active session for specified register.

- Validates `registerNumber ∈ {1, 2}`
- If no active session: returns `{ ok: true, message: "already signed out" }`
- If active session exists:
  - Sets `signed_out_at = NOW()`
  - Logs audit entry with action `REGISTER_FORCE_SIGN_OUT`
  - Broadcasts `REGISTER_SESSION_UPDATED` with reason `FORCED_SIGN_OUT`
  - Returns updated register summary

#### GET /v1/admin/devices

Returns all devices.

Response:
```json
[
  {
    "deviceId": "device-123",
    "displayName": "Register Tablet 1",
    "enabled": true
  }
]
```

#### POST /v1/admin/devices

Adds a new device.

Request:
```json
{
  "deviceId": "device-123",
  "displayName": "Register Tablet 1"
}
```

- Rejects if 2 enabled devices already exist
- New device is enabled by default

#### PATCH /v1/admin/devices/:deviceId

Enables or disables a device.

Request:
```json
{
  "enabled": false
}
```

- If disabling an active device:
  - Force sign out its register session
  - Broadcast `REGISTER_SESSION_UPDATED` with reason `FORCED_SIGN_OUT`

## Database Schema

### devices Table

```sql
CREATE TABLE devices (
  device_id VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Audit Log Entry

When force sign-out occurs:
- `action`: `REGISTER_FORCE_SIGN_OUT`
- `entity_type`: `register_session`
- `entity_id`: session.id
- `staff_id`: admin staff_id

## Security Considerations

- All admin endpoints require `requireAuth` + `requireAdmin`
- Device allowlist prevents unauthorized devices from accessing register functionality
- Force sign-out is audited for accountability
- WebSocket events are broadcast globally but clients filter by deviceId/registerNumber

## Client Implementation Notes

### Office Dashboard

- Subscribes to `REGISTER_SESSION_UPDATED` events
- Displays two register cards with real-time status
- "Force Sign Out" button only enabled when register is active
- Updates UI immediately on WebSocket events

### Employee Register

- Subscribes to `REGISTER_SESSION_UPDATED` events
- If event matches current `deviceId` and `active: false`, immediately:
  - Clear `registerSession` state
  - Clear `staff_session` from localStorage
  - Return to splash screen (RegisterSignIn component)
- Heartbeat loop checks for 404/DEVICE_DISABLED errors and handles same way






