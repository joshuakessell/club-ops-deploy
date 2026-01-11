export async function readJson<T>(response: Response): Promise<T> {
  // Avoid Response.json() throwing on empty bodies or non-JSON responses.
  // Callers should still validate the returned shape.
  if (response.status === 204) {
    return null as unknown as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text().catch(() => '');
  const trimmed = text.trim();
  const snippet = trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;

  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    if (isJson && trimmed) {
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // fall through to readable error
      }
    }
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`
    );
  }

  // OK response
  if (!isJson) {
    // Gracefully handle empty bodies (common for some endpoints).
    if (!trimmed) return null as unknown as T;
    throw new Error(`Expected JSON but received ${contentType || 'unknown content-type'} — ${snippet}`);
  }

  if (!trimmed) return null as unknown as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`Failed to parse JSON — ${snippet || '(empty body)'}`);
  }
}

