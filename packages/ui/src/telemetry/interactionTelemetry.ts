let routeProvider: (() => string) | null = null;

export function setCurrentRouteProvider(fn: () => string): void {
  routeProvider = fn;
}

export function getCurrentRoute(): string {
  try {
    if (routeProvider) {
      const value = routeProvider();
      if (value && value.trim()) return value;
    }
  } catch {
    // fall back to window location
  }

  try {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname || '/';
      const search = window.location.search || '';
      return `${path}${search}` || 'unknown';
    }
  } catch {
    // ignore
  }

  return 'unknown';
}
