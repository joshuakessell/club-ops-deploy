export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const getApiUrl = (path: string) => {
  // Local dev: keep Vite proxy behavior working (/api -> backend).
  if (!API_BASE_URL) return path;

  // Hosted: point directly at the API service, which does NOT include a leading /api prefix.
  const base = API_BASE_URL.replace(/\/+$/, '');
  let normalizedPath = path;

  if (normalizedPath === '/api') normalizedPath = '';
  else if (normalizedPath.startsWith('/api/')) normalizedPath = normalizedPath.slice('/api'.length);

  if (normalizedPath && !normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`;
  return normalizedPath ? `${base}${normalizedPath}` : base;
};

export const getWebSocketUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  const wsBase = API_BASE_URL.startsWith('https')
    ? API_BASE_URL.replace('https', 'wss')
    : API_BASE_URL.replace('http', 'ws');
  return `${wsBase}${path.startsWith('/') ? path : `/${path}`}`;
};

