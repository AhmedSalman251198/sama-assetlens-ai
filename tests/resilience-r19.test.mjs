import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectSpreadsheet } from "../app/lib/excel-client.ts";
import { findImportCell, reconcileImportCounts } from "../app/lib/import-mapping.ts";
import { supabaseRestAll } from "../app/lib/server/supabase.ts";
import { askAssetLens, buildDigitalTwin, dependencyImpact, simulateCapitalPlan } from "../app/lib/asset-intelligence.ts";

const source = async path => readFile(new URL(path, import.meta.url), "utf8");

test("import reconciliation never reports an incomplete 2,000+ row workbook as a success", () => {
  assert.equal(reconcileImportCounts(2407, 2370, 25, 12), true);
  assert.throws(() => reconcileImportCounts(2407, 115, 0, 0), /Import is incomplete/);
  assert.throws(() => reconcileImportCounts(2407, 2407, 1, 0), /Import is incomplete/);
});

test("2,407 semicolon-separated assets after a preamble are imported without losing row 116 or row 2,407", async () => {
  const csv = ["Asset inventory exported by a third party", "Asset No;Asset Type;Serial Number;Office", ...Array.from({ length: 2407 }, (_, index) => `AST-${index + 1};Light;S-${index + 1};Room ${index + 1}`)].join("\n");
  const result = await inspectSpreadsheet(new File([csv], "assets.csv", { type: "text/csv" }));
  assert.equal(result.sheets[0].headerRow, 2);
  assert.equal(result.rows.length, 2407);
  assert.equal(result.rows[115]["Asset No"], "AST-116");
  assert.equal(result.rows.at(-1)["Serial Number"], "S-2407");
  assert.equal(result.rows.at(-1).__row, "2409");
});

test("the import limit rejects overflow explicitly rather than silently truncating", async () => {
  const csv = "Asset No,Asset Type\nA1,AC\nA2,AC\nA3,AC\nA4,AC";
  await assert.rejects(inspectSpreadsheet(new File([csv], "overflow.csv"), 3), /more than 3 data rows/);
});

test("quoted delimiters and escaped quotation marks survive CSV ingestion", async () => {
  const result = await inspectSpreadsheet(new File([['Asset No;Asset Type;Description', 'A1;AC;"Pump; with ""valve"""'].join("\n")], "quoted.csv"));
  assert.equal(result.rows[0].Description, 'Pump; with "valve"');
});

test("a workbook may use English headers on one sheet and Arabic on another", () => {
  const mapped = "Asset Type";
  assert.equal(findImportCell({ "Asset Type": "Chiller" }, [mapped, "نوع الأصل"], mapped), "Chiller");
  assert.equal(findImportCell({ "Asset Type": "", "نوع الأصل": "مكيف" }, [mapped, "نوع الأصل"], mapped), "مكيف");
  assert.equal(findImportCell({ "نوع الأصل": "مكيف" }, [mapped, "نوع الأصل"], mapped), "مكيف");
});

test("PostgREST pagination reads beyond a 1,000-row server cap and detects a safety limit", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const records = Array.from({ length: 2407 }, (_, index) => ({ id: index }));
  const ranges = [];
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  globalThis.fetch = async (_url, init) => {
    const [from, to] = init.headers.Range.split("-").map(Number);
    ranges.push([from, to]);
    return Response.json(records.slice(from, Math.min(to + 1, from + 1000)));
  };
  try {
    const rows = await supabaseRestAll("assets?select=id&order=id", "token", { pageSize: 1000 });
    assert.equal(rows.length, 2407);
    assert.equal(rows.at(-1).id, 2406);
    assert.deepEqual(ranges.slice(0, 4).map(([from]) => from), [0, 1000, 2000, 2407]);
    await assert.rejects(supabaseRestAll("assets?select=id&order=id", "token", { maxRows: 1000 }), /exceeds the safe export limit/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});

test("public QR endpoint and both SQL migrations expose core fields only", async () => {
  const [route, initial, upgrade] = await Promise.all([
    source("../app/api/public/assets/[id]/route.ts"),
    source("../supabase/migrations/015_asset_intelligence_suite.sql"),
    source("../supabase/migrations/016_harden_qr_and_hierarchy.sql"),
  ]);
  for (const content of [route, initial, upgrade]) {
    assert.doesNotMatch(content, /estimated_price|replacement_cost|enrichment_data|surveyor_email/);
  }
  assert.match(initial, /asset.status = 'completed'/);
  assert.match(upgrade, /asset.status = 'completed'/);
  assert.match(upgrade, /drop function if exists public\.asset_qr_public_snapshot/);
  assert.match(upgrade, /'manufacturer','brand','make','model','modelnumber'/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /SAFE_QR_FIELDS\.has\(key\)/);
  assert.match(route, /fields: safeQrFields\(asset\.fields\)/);
});

test("capture, transfer and server independently enforce parent option and office scope", async () => {
  const [capture, transfer, server, migration] = await Promise.all([
    source("../app/capture/page.tsx"), source("../app/transfers/page.tsx"),
    source("../app/api/assets/route.ts"), source("../supabase/migrations/016_harden_qr_and_hierarchy.sql"),
  ]);
  for (const ui of [capture, transfer]) {
    assert.match(ui, /option\.officeId === officeId/);
    assert.match(ui, /option\.parentOptionId === locationSelections\[level\.parentLevelId\]/);
    assert.match(ui, /level\.key !== "office"/);
  }
  assert.match(server, /option\.parent_option_id !== preceding\.valueId/);
  assert.match(server, /option\.office_id !== officeId/);
  assert.match(server, /supabaseRestAll<LocationOptionRow>/);
  assert.match(migration, /location_option_parent_guard/);
  assert.match(migration, /The location value must belong to a building in the same project/);
  assert.match(migration, /Both dependency assets must belong to the selected project/);
  assert.match(migration, /can_manage_asset_intelligence\(project_id, 'create'\)/);
  assert.match(migration, /can_manage_asset_intelligence\(project_id, 'edit'\)/);
  assert.match(migration, /can_manage_asset_intelligence\(project_id, 'delete'\)/);
});

test("intelligence graph handles cycles and the capital plan respects a budget without invented savings", () => {
  const assets = [
    { id: "ac", assetNo: "AC-01", projectId: "p", assetType: "AC", location: "R1", building: "B1", conditionRating: 1, criticalityRating: 5, operationalStatus: "active", replacementCost: 80, remainingLifeYears: 0, fields: [] },
    { id: "fan", assetNo: "F-01", projectId: "p", assetType: "Fan", location: "R2", building: "B1", conditionRating: 4, criticalityRating: 2, operationalStatus: "maintenance", replacementCost: 35, remainingLifeYears: 5, fields: [] },
  ];
  assert.deepEqual(dependencyImpact("ac", [
    { upstreamAssetId: "ac", downstreamAssetId: "fan", dependencyType: "feeds", impact: "high" },
    { upstreamAssetId: "fan", downstreamAssetId: "ac", dependencyType: "feeds", impact: "medium" },
  ]).map(item => item.assetId), ["fan"]);
  const plan = simulateCapitalPlan(assets, 80, 2);
  assert.equal(plan.years[0].assets[0].assetNo, "AC-01");
  assert.ok(plan.years.every(year => year.spend <= 80));
  assert.equal(plan.deferred.length, 0);
  assert.equal(askAssetLens("critical assets", assets).matches[0].assetNo, "AC-01");
  assert.equal(buildDigitalTwin(assets)[0].assetCount, 2);
});
