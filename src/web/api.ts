export interface ApiFailure { readonly code: string; readonly message: string; }
const tokenKey = "fieldops.session";
export const session = { get: () => localStorage.getItem(tokenKey), set: (value: string) => localStorage.setItem(tokenKey, value), clear: () => localStorage.removeItem(tokenKey) };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = session.get();
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  } catch {
    throw new Error("The local API is not running. Start it with pnpm dev:api after configuring DATABASE_URL and AUTH_SECRET.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: { data?: T; error?: ApiFailure } | undefined;
  try { body = text.length > 0 ? JSON.parse(text) as { data?: T; error?: ApiFailure } : undefined; } catch { /* Safe fallback below. */ }
  if (!response.ok) throw new Error(body?.error?.message ?? `API request failed (${response.status}). Check that the API server and database configuration are available.`);
  if (!body?.data) throw new Error("The API returned an empty response. Check the API server logs.");
  return body.data as T;
}
