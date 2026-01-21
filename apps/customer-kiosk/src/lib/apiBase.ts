export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const getApiUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
};

export const getWebSocketUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  const wsBase = API_BASE_URL.startsWith('https')
    ? API_BASE_URL.replace('https', 'wss')
    : API_BASE_URL.replace('http', 'ws');
  return `${wsBase}${path.startsWith('/') ? path : `/${path}`}`;
};

