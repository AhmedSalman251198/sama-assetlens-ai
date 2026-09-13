import assert from "node:assert/strict";
import test from "node:test";
import { getAccessToken, signIn } from "../app/lib/supabase-auth.ts";

test("a failed refresh from the previous account never signs out a newly authenticated admin", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalOnline = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  const items = new Map();
  let rejectRefresh;
  const pendingRefresh = new Promise((_, reject) => { rejectRefresh = reject; });
  globalThis.window = { localStorage: { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }, dispatchEvent() {} };
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
  globalThis.fetch = async (url, options) => {
    if (url === "/api/supabase-config") return Response.json({ url: "https://supabase.test", publishableKey: "public" });
    if (url.includes("grant_type=refresh_token")) return pendingRefresh;
    const email = JSON.parse(options.body).email;
    if (email === "user@example.test") return Response.json({ access_token: "old-token", refresh_token: "old-refresh", expires_at: 1, user: { id: "user" } });
    if (email === "admin@example.test") return Response.json({ access_token: "admin-token", refresh_token: "admin-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "admin" } });
    throw new Error("Unexpected sign-in request");
  };
  try {
    await signIn("user@example.test", "password");
    const refresh = getAccessToken();
    await new Promise(resolve => setImmediate(resolve));
    await signIn("admin@example.test", "password");
    rejectRefresh(new Error("Old session expired"));
    assert.equal(await refresh, null);
    assert.equal(await getAccessToken(), "admin-token");
    assert.equal(JSON.parse(items.get("assetlens_supabase_session_v1")).user.id, "admin");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (originalOnline) Object.defineProperty(globalThis.navigator, "onLine", originalOnline);
    else delete globalThis.navigator.onLine;
  }
});
