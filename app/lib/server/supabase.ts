import { randomBytes } from "node:crypto";

const SUPABASE_CONFIG_ERROR = "إعدادات Supabase غير مكتملة. أضف SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY داخل .env.local أو متغيرات النشر.";
const SUPABASE_ADMIN_CONFIG_ERROR = "إدارة الحسابات تحتاج SUPABASE_SECRET_KEY (الموصى به) أو SUPABASE_SERVICE_ROLE_KEY داخل متغيرات الخادم فقط، ثم إعادة نشر الموقع.";
const API_TIMEOUT_MS = 15_000;

function timedSignal(signal: AbortSignal | null | undefined, timeoutMs = API_TIMEOUT_MS) {
  return signal || AbortSignal.timeout(timeoutMs);
}

export function supabaseSettings() {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  const url = (runtimeEnv.SUPABASE_URL || runtimeEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (runtimeEnv.SUPABASE_PUBLISHABLE_KEY || runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || runtimeEnv.SUPABASE_ANON_KEY || runtimeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) throw new Error(SUPABASE_CONFIG_ERROR);
  return { url: url.replace(/\/$/, ""), key };
}

function supabaseAdminSettings() {
  const { url } = supabaseSettings();
  const runtimeEnv = process.env as Record<string, string | undefined>;
  // Supabase recommends the newer sb_secret_ key. Keep accepting the legacy
  // service_role JWT so existing deployments continue to work during migration.
  const serviceKey = (runtimeEnv.SUPABASE_SECRET_KEY || runtimeEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) throw new Error(SUPABASE_ADMIN_CONFIG_ERROR);
  return { url, serviceKey };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  let payload: T | { message?: string; details?: string; error_description?: string } | undefined;
  if (responseText) {
    try { payload = JSON.parse(responseText) as T | { message?: string; details?: string; error_description?: string }; }
    catch { throw new Error(`Supabase returned an invalid response (${response.status}).`); }
  }
  if (!response.ok) {
    const error = payload as { message?: string; details?: string; error_description?: string } | undefined;
    throw new Error(error?.message || error?.details || error?.error_description || `Supabase request failed (${response.status}).`);
  }
  return payload as T;
}

export function requestToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export async function verifyAuthUser(token: string) {
  if (!token) return null;
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: timedSignal(undefined, 10_000),
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email || "" } : null;
}

export async function supabaseRest<T>(path: string, token: string, init: RequestInit = {}) {
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    signal: timedSignal(init.signal),
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  return parseResponse<T>(response);
}

export async function supabaseRestWithCount<T>(path: string, token: string, init: RequestInit = {}) {
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    signal: timedSignal(init.signal),
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
      Range: "0-0",
      ...(init.headers || {}),
    },
  });
  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  return { data: await parseResponse<T>(response), count: match ? Number(match[1]) : 0 };
}

export function generateInitialPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(15);
  const body = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  return `Al!${body}9`;
}

export async function createSupabasePasswordUser(email: string, name: string, password: string) {
  const { url, serviceKey } = supabaseAdminSettings();
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase(), password, email_confirm: true, user_metadata: { name } }),
    signal: timedSignal(undefined),
  });
  const payload = await parseResponse<{ id?: string; user?: { id?: string } }>(response);
  const id = payload.id || payload.user?.id || "";
  if (!id) throw new Error("Supabase created the account without returning its identifier.");
  return id;
}

export async function updateSupabaseUserPassword(userId: string, password: string) {
  const { url, serviceKey } = supabaseAdminSettings();
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: timedSignal(undefined),
  });
  await parseResponse<Record<string, unknown>>(response);
}

function encodedStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function uploadAssetImage(path: string, token: string, file: File) {
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/storage/v1/object/asset-images/${encodedStoragePath(path)}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": file.type, "x-upsert": "false" },
    body: file,
    signal: timedSignal(undefined, 30_000),
  });
  await parseResponse<Record<string, unknown>>(response);
}

export async function downloadAssetImage(path: string, token: string) {
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/storage/v1/object/authenticated/asset-images/${encodedStoragePath(path)}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    signal: timedSignal(undefined),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Stored image download failed (${response.status}).`);
  }
  return response.arrayBuffer();
}

export async function deleteAssetImages(paths: string[], token: string) {
  if (paths.length === 0) return;
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/storage/v1/object/asset-images`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    signal: timedSignal(undefined, 20_000),
  });
  await parseResponse<Record<string, unknown>>(response);
}
