const MAX_MESSAGE = 2_000;
const MAX_STACK = 20_000;
const MAX_JSON = 64_000;
const MAX_PAYLOAD_STRING = 4_000;
const MAX_KEY_DEPTH = 20;

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(truncated ${s.length - max})`;
}

function isSecretKey(key: string) {
  const k = key.toLowerCase();
  return (
    k.includes('authorization') ||
    k.includes('cookie') ||
    k.includes('token') ||
    k.includes('secret')
  );
}

function scrubSecrets(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_KEY_DEPTH) return '[truncated: max depth]';
  if (value == null) return value;

  if (typeof value === 'string') return truncate(value, MAX_PAYLOAD_STRING);
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => scrubSecrets(v, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = scrubSecrets(v, seen, depth + 1);
  }
  return out;
}

export function sanitizeTelemetryRow(row: unknown) {
  // Never throw (telemetry is for diagnostics; it must be resilient).
  try {
    const clean: Record<string, unknown> =
      row && typeof row === 'object' ? { ...(row as Record<string, unknown>) } : { raw: row };

    if (typeof clean.message === 'string') clean.message = truncate(clean.message, MAX_MESSAGE);
    if (typeof clean.stack === 'string') clean.stack = truncate(clean.stack, MAX_STACK);

    const payload = clean.payload;
    const scrubbed = scrubSecrets(
      payload && typeof payload === 'object' ? payload : {},
      new WeakSet(),
      0
    );
    clean.payload = scrubbed && typeof scrubbed === 'object' ? scrubbed : {};

    try {
      const serialized = JSON.stringify(clean.payload);
      if (serialized.length > MAX_JSON) {
        clean.payload = { note: 'payload truncated', preview: serialized.slice(0, MAX_JSON) };
      }
    } catch {
      clean.payload = { note: 'payload unserializable' };
    }

    return clean;
  } catch (err) {
    return {
      note: 'sanitizeTelemetryRow_failed',
      error: err instanceof Error ? err.message : String(err),
      payload: {},
    };
  }
}
