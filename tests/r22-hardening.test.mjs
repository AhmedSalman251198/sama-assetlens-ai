import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the combined R22 SQL is transactional, repeatable, and checks its base schema", async () => {
  const sql = await source("../supabase/ASSETLENS_R22_SUPABASE.sql");
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /to_regclass\('public\.assets'\)/);
  assert.match(sql, /Apply migrations 001 through 016 first/);
  assert.match(sql, /drop constraint if exists/);
  assert.match(sql, /on conflict \(app_user_id, module_key\) do nothing/);
  assert.doesNotMatch(sql, /drop\s+table|truncate\s+table|delete\s+from\s+public\.assets/i);
});

test("unknown operational states are preserved before database normalization", async () => {
  const migration = await source("../supabase/migrations/017_assistant_access_and_incomplete_imports.sql");
  const combined = await source("../supabase/ASSETLENS_R22_SUPABASE.sql");
  for (const sql of [migration, combined]) {
    assert.match(sql, /operational_status_source_raw = coalesce\(operational_status_source_raw, operational_status\)/);
    assert.match(sql, /operational_status = 'unknown'/);
    assert.match(sql, /'unknown','active','maintenance','out_of_service','transferred','disposed'|'unknown', 'active', 'maintenance', 'out_of_service'/);
  }
});

test("preliminary asset links cannot pretend to have verified engineering meaning", async () => {
  const migration = await source("../supabase/migrations/018_unverified_asset_relationships.sql");
  const combined = await source("../supabase/ASSETLENS_R22_SUPABASE.sql");
  for (const sql of [migration, combined]) {
    assert.match(sql, /'unverified'/);
    assert.match(sql, /'unassessed'/);
    assert.match(sql, /awaiting engineering classification/);
    assert.match(sql, /no engineering interruption severity has been assigned/);
  }
});

test("bulk deletion validates the whole bounded batch before deleting anything", async () => {
  const route = await source("../app/api/assets/route.ts");
  const validationIndex = route.indexOf("assets.length !== ids.length");
  const permissionIndex = route.indexOf("const denied = assets.find");
  const deleteIndex = route.indexOf('supabaseRest(`assets?id=${encodeURIComponent(idFilter)}`');
  assert.match(route, /ids\.length > 50/);
  assert.match(route, /One or more asset ids are invalid/);
  assert.match(route, /nothing was deleted/);
  assert.ok(validationIndex > -1 && permissionIndex > validationIndex && deleteIndex > permissionIndex);
});

test("bulk delete requires an explicit count confirmation in the interface", async () => {
  const reports = await source("../app/reports/page.tsx");
  assert.match(reports, /bulkDeleteConfirm !== String\(selected\.size\)/);
  assert.match(reports, /inputMode="numeric"/);
  assert.match(reports, /العملية غير قابلة للتراجع/);
  assert.match(reports, /selected\.size > 50/);
});

test("every structured finance and lifecycle import field is available for manual mapping", async () => {
  const reports = await source("../app/reports/page.tsx");
  for (const key of [
    "operationalStatus",
    "estimatedPrice",
    "replacementCost",
    "priceCurrency",
    "usefulLifeYears",
    "remainingLifeYears",
    "installationDate",
  ]) {
    const occurrences = reports.match(new RegExp(`"${key}"`, "g"))?.length ?? 0;
    assert.ok(occurrences >= 2, `${key} must exist in both the type/aliases and mapping UI`);
  }
});

test("the closed assistant has no invisible click surface", async () => {
  const component = await source("../app/components/assetlens-assistant.tsx");
  const css = await source("../app/assistant.css");
  assert.match(component, /inert=\{!open\}/);
  assert.match(css, /\.assistant-dock\{[^}]*pointer-events:none/);
  assert.match(css, /\.assistant-dock\.is-open \.assistant-panel\{[^}]*pointer-events:auto/);
  assert.match(css, /\.assistant-trigger-orbit\{[^}]*pointer-events:none/);
});
