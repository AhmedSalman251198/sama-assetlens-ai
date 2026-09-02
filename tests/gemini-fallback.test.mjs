import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithGemini } from "../app/lib/server/analyze-images.ts";

test("Gemini analysis skips a retired configured model and succeeds on an available modern model", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    if (url.includes("/models?pageSize=1000")) {
      return Response.json({
        models: [
          { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-live", supportedGenerationMethods: ["generateContent"] },
        ],
      });
    }
    if (url.includes("gemini-3.7-flash:generateContent")) {
      return Response.json({ error: { message: "This model is no longer available to new users." } }, { status: 404 });
    }
    if (url.includes("gemini-3.6-flash:generateContent")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: "{\"assetType\":\"Pump\"}" }] } }] });
    }
    throw new Error(`Unexpected Gemini request: ${url}`);
  };

  try {
    const output = await analyzeWithGemini("unit-test-key", "models/gemini-2.5-flash", [{ mimeType: "image/jpeg", data: "AA==" }]);
    assert.equal(output, '{"assetType":"Pump"}');
    assert.equal(calls.some(call => call.url.includes("gemini-2.5-flash")), false);
    assert.equal(calls.some(call => call.url.includes("gemini-3.7-flash:generateContent")), true);
    assert.equal(calls.some(call => call.url.includes("gemini-3.6-flash:generateContent")), true);
    assert.equal(calls.every(call => !call.url.includes("unit-test-key")), true);
    assert.equal(calls.every(call => call.headers.get("x-goog-api-key") === "unit-test-key"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini analysis discovers a future compatible model only after known fallbacks fail", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/models?pageSize=1000")) {
      return Response.json({ models: [{ name: "models/gemini-4.0-flash", supportedGenerationMethods: ["generateContent"] }] });
    }
    if (url.includes("gemini-4.0-flash:generateContent")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: "future-model-ok" }] } }] });
    }
    if (url.includes(":generateContent")) {
      return Response.json({ error: { message: "Model is not available." } }, { status: 404 });
    }
    throw new Error(`Unexpected Gemini request: ${url}; ${JSON.stringify(init)}`);
  };

  try {
    const output = await analyzeWithGemini("unit-test-key", "gemini-2.5-flash", [{ mimeType: "image/jpeg", data: "AA==" }]);
    assert.equal(output, "future-model-ok");
    assert.equal(calls.filter(url => url.includes("/models?pageSize=1000")).length, 1);
    assert.equal(calls.at(-1)?.includes("gemini-4.0-flash:generateContent"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
