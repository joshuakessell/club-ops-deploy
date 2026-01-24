const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;

export const API_BASE_URL = typeof env?.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : '';

const isDev = env?.DEV === true || env?.DEV === 'true';
let didWarnApiBaseUrlSuffix = false;

function warnIfApiBaseUrlEndsWithApi(raw: string) {
  if (!isDev) return;
  if (didWarnApiBaseUrlSuffix) return;
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return;
  if (!/\/api\/?$/.test(trimmed)) return;

  didWarnApiBaseUrlSuffix = true;
  console.warn(
    `[apiBase] VITE_API_BASE_URL should be "https://host" not "https://host/api" (remove the trailing "/api"). Got: ${trimmed}`,
  );
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    // remove trailing slashes
    u.pathname = u.pathname.replace(/\/+$/, '');
    // if pathname ends exactly in "/api", drop it
    if (u.pathname === '/api') u.pathname = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    // fallback string normalization if URL parsing fails
    let base = trimmed.replace(/\/+$/, '');
    if (base.endsWith('/api')) base = base.slice(0, -4);
    return base;
  }
}

warnIfApiBaseUrlEndsWithApi(API_BASE_URL);

export const getApiUrl = (path: string) => {
  // Local dev: keep Vite proxy behavior working (/api -> backend).
  if (!API_BASE_URL) return path;

  // Hosted: point directly at the API service, which does NOT include a leading /api prefix.
  const base = normalizeApiBaseUrl(API_BASE_URL);
  let normalizedPath = path;

  if (normalizedPath === '/api') normalizedPath = '';
  else if (normalizedPath.startsWith('/api/')) normalizedPath = normalizedPath.slice('/api'.length);

  if (normalizedPath && !normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`;
  return normalizedPath ? `${base}${normalizedPath}` : base;
};

export const getWebSocketUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  const base = normalizeApiBaseUrl(API_BASE_URL);
  const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
  return `${wsBase}${path.startsWith('/') ? path : `/${path}`}`;
};
