"use client";

import { getAccessToken } from "./supabase-auth";

type CacheEntry = { value: unknown; savedAt: number };
type ApiGetOptions = { ttlMs?: number; force?: boolean; timeoutMs?: number };

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 80;

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

function sessionSubject(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return token.slice(-24);
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(window.atob(padded)) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub ? parsed.sub : token.slice(-24);
  } catch {
    return token.slice(-24);
  }
}

function cacheKey(subject: string, url: string) {
  return `${subject}::${url}`;
}

async function fetchJson<T>(url: string, token: string, key: string, timeoutMs: number) {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw new ApiClientError("استغرق تحميل البيانات وقتًا أطول من المتوقع.", 408);
      throw reason;
    } finally {
      window.clearTimeout(timeout);
    }
    const responseText = await response.text();
    let payload: (T & { error?: string }) | null = null;
    if (responseText) {
      try { payload = JSON.parse(responseText) as T & { error?: string }; }
      catch { throw new ApiClientError(`الخادم أعاد استجابة غير صالحة (${response.status}).`, response.status); }
    }
    if (!response.ok || !payload) {
      throw new ApiClientError(payload?.error || `تعذر تحميل البيانات (${response.status}).`, response.status);
    }
    responseCache.set(key, { value: payload, savedAt: Date.now() });
    while (responseCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = responseCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      responseCache.delete(oldestKey);
    }
    return payload;
  })();

  inFlight.set(key, request);
  try { return await request; }
  finally { if (inFlight.get(key) === request) inFlight.delete(key); }
}

/**
 * Authenticated, in-memory GET cache shared by every client route.
 * It also deduplicates React Strict Mode and simultaneous page requests.
 */
export async function apiGet<T>(url: string, options: ApiGetOptions = {}) {
  const token = await getAccessToken();
  if (!token) throw new ApiClientError("Authentication required.", 401);
  const key = cacheKey(sessionSubject(token), url);
  const cached = responseCache.get(key);
  const ttlMs = Math.max(0, options.ttlMs ?? 60_000);
  if (!options.force && cached && Date.now() - cached.savedAt <= ttlMs) return cached.value as T;
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 30_000, 120_000));
  return fetchJson<T>(url, token, key, timeoutMs);
}

export function prefetchApi(url: string, ttlMs = 60_000) {
  return apiGet(url, { ttlMs }).catch(() => undefined);
}

export function invalidateApiCache(urlPart?: string) {
  if (!urlPart) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) if (key.includes(urlPart)) responseCache.delete(key);
}
