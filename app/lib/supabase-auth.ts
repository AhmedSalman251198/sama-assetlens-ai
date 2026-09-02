type SupabaseConfig = { url: string; publishableKey: string };
type AuthSession = { access_token: string; refresh_token: string; expires_at: number; user?: { id: string; email?: string } };

const SESSION_KEY = "assetlens_supabase_session_v1";
let configPromise: Promise<SupabaseConfig> | null = null;
let refreshPromise: Promise<string | null> | null = null;

async function config() {
  if (!configPromise) {
    configPromise = fetch("/api/supabase-config", { cache: "no-store" }).then(async response => {
      const payload = await response.json() as SupabaseConfig & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Supabase configuration is unavailable.");
      return payload;
    });
  }
  return configPromise;
}

function readSession(): AuthSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null") as AuthSession | null;
    return parsed?.access_token && parsed.refresh_token ? parsed : null;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(payload: AuthSession & { expires_in?: number }) {
  const session = { ...payload, expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + (payload.expires_in || 3600) };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function authRequest(path: string, body: Record<string, unknown>) {
  const { url, publishableKey } = await config();
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as AuthSession & { error?: string; error_description?: string; msg?: string; expires_in?: number };
  if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.error || "Authentication failed.");
  return payload;
}

export async function signIn(email: string, password: string) {
  return saveSession(await authRequest("token?grant_type=password", { email: email.trim().toLowerCase(), password }));
}

export async function signUp(email: string, password: string, name: string) {
  const redirectTo = encodeURIComponent(`${window.location.origin}/login`);
  const payload = await authRequest(`signup?redirect_to=${redirectTo}`, { email: email.trim().toLowerCase(), password, data: { name: name.trim() } });
  if (payload.access_token) saveSession(payload);
  return payload;
}

export async function getAccessToken() {
  const session = readSession();
  if (!session) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return session.access_token;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session.access_token;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshed = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
        return saveSession(refreshed).access_token;
      } catch {
        window.localStorage.removeItem(SESSION_KEY);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export function signOut() {
  window.localStorage.removeItem(SESSION_KEY);
  window.sessionStorage.removeItem("assetlens_gemini_key");
  return new Promise<void>((resolve) => {
    let finished = false;
    const done = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
    window.setTimeout(done, 500);
    try {
      const request = window.indexedDB.deleteDatabase("assetlens_offline_v1");
      request.onsuccess = request.onerror = request.onblocked = done;
    } catch {
      done();
    }
  });
}
