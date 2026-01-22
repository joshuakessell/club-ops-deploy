import crypto from 'node:crypto';

const HEADER_BLOCKLIST = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'csrf-token',
  'proxy-authorization',
]);

const BODY_REDACT_KEYS = [
  'password',
  'passcode',
  'pin',
  'token',
  'secret',
  'apikey',
  'authorization',
  'cardnumber',
  'cvv',
  'cvc',
  'exp',
  'expiry',
  'expiration',
  'accountnumber',
  'routingnumber',
  'ssn',
];

const BODY_DENYLIST = ['/payment', '/square', '/auth', '/login', '/pin'];
const MAX_BODY_BYTES = 32 * 1024;

type SanitizedBody = {
  body: unknown | null;
  meta: Record<string, unknown>;
};

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function shouldRedactKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return BODY_REDACT_KEYS.some((needle) => normalized.includes(needle));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function truncateString(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes <= maxBytes) return { value, truncated: false };
  return { value: value.slice(0, maxBytes), truncated: true };
}

function scrubSecrets(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 12) return '[truncated:max_depth]';
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedactKey(k) ? '[redacted]' : scrubSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function shouldCaptureBodyForRoute(route: string | null | undefined): boolean {
  if (!route) return true;
  const lower = route.toLowerCase();
  return !BODY_DENYLIST.some((part) => lower.includes(part));
}

export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HEADER_BLOCKLIST.has(lower)) {
      out[key] = '[redacted]';
      continue;
    }
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v === 'string') ?? String(value[0] ?? '');
      out[key] = first.slice(0, 512);
      continue;
    }
    if (value == null) continue;
    out[key] = String(value).slice(0, 512);
  }
  return out;
}

export function sanitizeJsonBody(
  body: unknown,
  route: string | null | undefined,
  label: 'request' | 'response'
): SanitizedBody {
  const meta: Record<string, unknown> = {};
  if (!shouldCaptureBodyForRoute(route)) {
    meta[`${label}BodyDenied`] = true;
    return { body: null, meta };
  }

  if (body == null) return { body: null, meta };
  if (typeof body !== 'object') return { body: null, meta };

  const scrubbed = scrubSecrets(body);
  let serialized: string;
  try {
    serialized = JSON.stringify(scrubbed);
  } catch {
    meta[`${label}BodyUnserializable`] = true;
    return { body: null, meta };
  }

  const { value, truncated } = truncateString(serialized, MAX_BODY_BYTES);
  meta[`${label}BodySha256`] = sha256(serialized);
  if (truncated) {
    meta[`${label}BodyTruncated`] = true;
  }

  try {
    return { body: JSON.parse(value), meta };
  } catch {
    return { body: null, meta: { ...meta, [`${label}BodyParseError`]: true } };
  }
}
