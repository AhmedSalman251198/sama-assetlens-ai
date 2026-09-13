import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importedOperationalStatus, importedRating, incompleteImportFields } from "../app/lib/import-normalization.ts";
import { compareRepairAndReplacement } from "../app/lib/repair-decision.ts";
import { canUseModule, defaultModulePermissions, normalizeModulePermissions } from "../app/lib/module-permissions.ts";
import { assetRiskScore, simulateCapitalPlan } from "../app/lib/asset-intelligence.ts";

test("AI access defaults to off independently for regular users and to on for the super administrator", () => {
  for (const role of ["admin", "project_manager", "reviewer", "surveyor", "viewer"]) {
    const permissions = defaultModulePermissions(role);
    assert.equal(canUseModule(permissions, "assistant"), false);
    assert.equal(canUseModule(permissions, "ai_reports"), false);
  }
  const allowed = normalizeModulePermissions([{ module: "assistant", view: true }, { module: "ai_reports", view: false }], "viewer");
  assert.equal(canUseModule(allowed, "assistant"), true);
  assert.equal(canUseModule(allowed, "ai_reports"), false);
  assert.equal(canUseModule(normalizeModulePermissions([], "admin", true), "assistant"), true);
});

test("unknown and blank operational states remain unknown; imported missing ratings remain empty", () => {
  assert.equal(importedOperationalStatus(""), "unknown");
  assert.equal(importedOperationalStatus(" Unrecognized Vendor Status "), "unknown");
  assert.equal(importedOperationalStatus("تحت الصيانة"), "maintenance");
  assert.equal(importedOperationalStatus("Working"), "active");
  assert.equal(importedRating(""), null);
  assert.equal(importedRating(null), null);
  assert.equal(importedRating("3"), 3);
  assert.equal(importedRating("Very Good"), null);
  assert.deepEqual(incompleteImportFields({ building: "", categoryId: null, conditionRating: null, criticalityRating: null }, { building: true, floor: false, zone: false, office: false }), ["building", "category", "condition", "criticality"]);
});

test("repair comparison only uses explicit inputs and never manufactures a replacement price", () => {
  assert.deepEqual(compareRepairAndReplacement(1500, null), { repairCost: 1500, replacementCost: null, gap: null, ratio: null });
  assert.deepEqual(compareRepairAndReplacement(1500, 5000), { repairCost: 1500, replacementCost: 5000, gap: 3500, ratio: 30 });
  assert.throws(() => compareRepairAndReplacement(-1, 5000), /valid repair/);
  assert.throws(() => compareRepairAndReplacement(100, 0), /valid replacement/);
});

test("AI reports label unverified notes and never include invented energy tariffs or operation hours", async () => {
  const route = await readFile(new URL("../app/api/reports/ai/route.ts", import.meta.url), "utf8");
  assert.match(route, /hasModuleAccess\(token, user.id, "ai_reports"\)/);
  assert.match(route, /unverifiedUserNotes/);
  assert.match(route, /annualEnergySavingKwh: null/);
  assert.match(route, /Number\(asset\.replacement_cost \?\? asset\.estimated_price\) > 0/);
  assert.doesNotMatch(route, /annualOperatingHours:\s*2400|electricityTariffAedPerKwh:\s*0\.38/);
});

test("unrated imported assets never receive an invented risk score or a capital replacement recommendation", () => {
  const unknown = { id: "imported", assetNo: "A-1", projectId: "project", assetType: "Fan", location: "", building: "", conditionRating: null, criticalityRating: null, replacementCost: 1000, remainingLifeYears: null, operationalStatus: "unknown", fields: [] };
  assert.equal(assetRiskScore(unknown), 0);
  assert.equal(simulateCapitalPlan([unknown], 2000, 1).plannedSpend, 0);
});

test("assistant cost comparison uses the asset's currency, and dashboard widgets expose dark and small-screen layouts", async () => {
  const route = await readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8");
  const widget = await readFile(new URL("../app/components/assetlens-assistant.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/assistant.css", import.meta.url), "utf8");
  assert.match(route, /replacement_cost,price_currency,remaining_life_years/);
  assert.match(route, /const currency = asset\.priceCurrency \|\| "AED"/);
  assert.match(widget, /comparisonAsset\.priceCurrency/);
  assert.match(styles, /html\[data-theme="dark"\] \.radial-legend>a/);
  assert.match(styles, /@media\(max-width:680px\).*\.radial-legend\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});
