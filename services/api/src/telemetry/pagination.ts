export type TelemetryCursor = {
  createdAt: Date;
  id: string;
};

type EncodedTelemetryCursor = {
  createdAt: string;
  id: string;
};

function isValidIsoTimestamp(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  if (!value.includes('T')) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime());
}

export function encodeCursor(cursor: TelemetryCursor): string {
  const payload: EncodedTelemetryCursor = {
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodeCursor(input: string): TelemetryCursor | null {
  if (!input || typeof input !== 'string') return null;
  let decoded: EncodedTelemetryCursor | null = null;
  try {
    const raw = Buffer.from(input, 'base64').toString('utf8');
    decoded = JSON.parse(raw) as EncodedTelemetryCursor;
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== 'object') return null;
  if (!decoded.id || typeof decoded.id !== 'string') return null;
  if (!isValidIsoTimestamp(decoded.createdAt)) return null;

  const createdAt = new Date(decoded.createdAt);
  if (!Number.isFinite(createdAt.getTime())) return null;

  return { createdAt, id: decoded.id };
}
