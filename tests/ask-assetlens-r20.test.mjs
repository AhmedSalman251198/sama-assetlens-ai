import assert from "node:assert/strict";
import test from "node:test";
import { answerAssetLens } from "../app/lib/server/ask-assetlens.ts";
import { applyAskQueryPlan, askAssetLens, askAssetMetrics, validateAskQueryPlan } from "../app/lib/asset-intelligence.ts";

const assets = [
  { id: "11111111-1111-4111-8111-111111111111", assetNo: "AC-01", projectId: "p", assetType: "AC", location: "B1 / GF", building: "B1", conditionRating: 1, criticalityRating: 5, operationalStatus: "active", replacementCost: 8000, remainingLifeYears: 1, fields: [{ key: "model", value: "X10" }] },
  { id: "22222222-2222-4222-8222-222222222222", assetNo: "L-01", projectId: "p", assetType: "Light", location: "B1 / GF", building: "B1", conditionRating: 4, criticalityRating: 1, operationalStatus: "active", replacementCost: null, remainingLifeYears: null, fields: [] },
  { id: "33333333-3333-4333-8333-333333333333", assetNo: "AC-02", projectId: "p", assetType: "AC", location: "B2 / GF", building: "B2", conditionRating: 2, criticalityRating: 5, operationalStatus: "maintenance", replacementCost: 6000, remainingLifeYears: 2, fields: [] },
];

test("planned filters are scoped to real values and only count matching records", () => {
  const plan = validateAskQueryPlan({ building: "b1", criticalityMin: 5, conditionMax: 2 }, assets);
  assert.deepEqual(applyAskQueryPlan(assets, plan).map(asset => asset.assetNo), ["AC-01"]);
  assert.equal(askAssetMetrics(applyAskQueryPlan(assets, plan)).combinedRiskScore, 25);
  assert.throws(() => validateAskQueryPlan({ building: "another project" }, assets), /Unknown building/);
  assert.throws(() => validateAskQueryPlan({ conditionMin: 5, conditionMax: 1 }, assets), /Contradictory/);
  assert.deepEqual(applyAskQueryPlan(assets, { conditionMax: 2 }).map(asset => asset.assetNo), ["AC-01", "AC-02"]);
});

test("AI answer uses computed full-result counts and discards citations outside authorized evidence", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "test-key");
    calls += 1;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(calls === 1
      ? { building: "B1", criticalityMin: 5, conditionMax: 2 }
      : { answer: "يوجد أصل واحد حرج في B1 وحالته ضعيفة.", citations: [assets[0].id, assets[2].id], caveat: "" }) }] } }] });
  };
  try {
    const result = await answerAssetLens("كم أصلًا حرجًا حالته ضعيفة في B1؟", assets, "ar");
    assert.equal(calls, 2);
    assert.equal(result.mode, "ai");
    assert.equal(result.totalMatches, 1);
    assert.equal(result.totalRisk, 25);
    assert.deepEqual(result.citations, [assets[0].id]);
    assert.equal(result.matches[0].assetNo, "AC-01");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("missing or unavailable AI is honestly labeled register search; unknown terms do not match every asset", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.GEMINI_API_KEY;
  try {
    const fallback = await answerAssetLens("critical assets", assets, "en");
    assert.equal(fallback.mode, "register_search");
    assert.equal(fallback.totalMatches, 2);
    assert.match(fallback.limitation, /not an AI analysis/);
    assert.equal(askAssetLens("unrecognized-nonexistent-type", assets).totalMatches, 0);
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => Response.json({ error: { message: "provider temporarily offline" } }, { status: 503 });
    const degraded = await answerAssetLens("critical assets", assets, "en");
    assert.equal(degraded.mode, "register_search");
    assert.match(degraded.limitation, /not an AI answer/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("OpenAI is an available server-side assistant provider without client-side secrets", async () => {
  const previous = { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, provider: process.env.AI_PROVIDER };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  delete process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = "secret-server-key";
  process.env.AI_PROVIDER = "openai";
  globalThis.fetch = async (url, options) => {
    assert.match(url, /api\.openai\.com\/v1\/responses/);
    assert.equal(options.headers.Authorization, "Bearer secret-server-key");
    assert.equal(JSON.parse(options.body).store, false);
    calls += 1;
    const output = calls === 1
      ? { building: "B1", assetType: null, conditionMin: null, conditionMax: 2, criticalityMin: 5, criticalityMax: null, operationalStatus: null }
      : { answer: "One critical asset is in poor condition in B1.", citations: [assets[0].id], caveat: "" };
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  try {
    const result = await answerAssetLens("How many critical assets are poor in B1?", assets, "en");
    assert.equal(calls, 2);
    assert.equal(result.mode, "ai");
    assert.equal(result.totalMatches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [field, value] of [["GEMINI_API_KEY", previous.gemini], ["OPENAI_API_KEY", previous.openai], ["AI_PROVIDER", previous.provider]]) {
      if (value === undefined) delete process.env[field]; else process.env[field] = value;
    }
  }
});

test("total asset counts bypass lexical search and do not require an AI provider", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "should-not-be-used";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("AI must not be called for a deterministic total"); };
  try {
    const english = await answerAssetLens("how many total asset in my project?", assets, "en");
    const arabic = await answerAssetLens("كم عدد الأصول في مشروعي؟", assets, "ar");
    assert.equal(calls, 0);
    assert.equal(english.mode, "calculation");
    assert.equal(english.totalMatches, 3);
    assert.match(english.summary, /3 assets/);
    assert.equal(arabic.mode, "calculation");
    assert.equal(arabic.totalMatches, 3);
    assert.match(arabic.summary, /3/);
    assert.equal((await answerAssetLens("how many critical assets?", assets, "en")).mode, "register_search");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});
