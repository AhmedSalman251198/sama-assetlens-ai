type SupabaseConfig = { url: string; publishableKey: string };
type AuthSession = { access_token: string; refresh_token: string; expires_at: number; user?: { id: string; email?: string } };

const SESSION_KEY = "assetlens_supabase_session_v1";
export const AUTH_SESSION_EVENT = "assetlens:auth-session-change";
let configPromise: Promise<SupabaseConfig> | null = null;
let refreshPromise: Promise<string | null> | null = null;
let sessionGeneration = 0;

export function isStrongPassword(password: string) {
  return password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

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
  // A login submission always replaces the previous account. Clear it before
  // authenticating so a failed attempt can never fall back to the old user.
  sessionGeneration += 1;
  const generation = sessionGeneration;
  refreshPromise = null;
  window.localStorage.removeItem(SESSION_KEY);
  const session = await authRequest("token?grant_type=password", { email: email.trim().toLowerCase(), password });
  if (generation !== sessionGeneration) throw new Error("The sign-in session changed. Please try again.");
  const saved = saveSession(session);
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EVENT, { detail: { type: "signed-in", userId: saved.user?.id || "" } }));
  return saved;
}

export async function changePassword(password: string) {
  const clean = password.trim();
  if (!isStrongPassword(clean)) throw new Error("Password must be at least 10 characters and include uppercase, lowercase, number and symbol.");
  const token = await getAccessToken();
  if (!token) throw new Error("انتهت جلسة الدخول. سجل الدخول مرة أخرى.");
  const { url, publishableKey } = await config();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: clean }),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; error_description?: string; msg?: string };
  if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.error || "تعذر تغيير كلمة المرور.");
}

export async function getAccessToken() {
  const session = readSession();
  if (!session) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return session.access_token;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session.access_token;
  if (!refreshPromise) {
    let currentRefresh: Promise<string | null> | null = null;
    currentRefresh = (async () => {
      const generation = sessionGeneration;
      try {
        const refreshed = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
        if (generation !== sessionGeneration) return null;
        return saveSession(refreshed).access_token;
      } catch {
        // An old refresh may fail after another account has signed in. Never
        // remove the newer account's session in that case.
        if (generation === sessionGeneration) window.localStorage.removeItem(SESSION_KEY);
        return null;
      } finally {
        if (refreshPromise === currentRefresh) refreshPromise = null;
      }
    })();
    refreshPromise = currentRefresh;
  }
  return refreshPromise;
}

export function signOut() {
  const previousSession = readSession();
  sessionGeneration += 1;
  refreshPromise = null;
  window.localStorage.removeItem(SESSION_KEY);
  window.sessionStorage.removeItem("assetlens_gemini_key");
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EVENT, { detail: { type: "signed-out" } }));
  // Revoke the previous refresh token on Supabase as a best-effort security
  // measure. Local state is already gone, so network failure cannot block exit.
  if (previousSession?.access_token) {
    void config().then(({ url, publishableKey }) => fetch(`${url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${previousSession.access_token}` },
    })).catch(() => undefined);
  }
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
