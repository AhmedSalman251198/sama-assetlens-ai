import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  askAssetLens,
  isExplicitRegisterSearchQuestion,
} from "../app/lib/asset-intelligence.ts";
import {
  canUseModule,
  defaultModulePermissions,
} from "../app/lib/module-permissions.ts";
import { publicApiError } from "../app/lib/server/api-errors.ts";
import { hasOnlyGroundedNumbers } from "../app/lib/server/grounded-numbers.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const ratedAssets = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    assetNo: "AC-123",
    projectId: "project-a",
    assetType: "Air conditioner",
    location: "B1 / L1",
    building: "B1",
    conditionRating: 1,
    criticalityRating: 5,
    operationalStatus: "maintenance",
    workflowStatus: "review",
    replacementCost: 5000,
    remainingLifeYears: 1,
    fields: [{ key: "model", value: "ZX-10" }],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    assetNo: "DB-20",
    projectId: "project-a",
    assetType: "Distribution board",
    location: "B1 / L1",
    building: "B1",
    conditionRating: 4,
    criticalityRating: 4,
    operationalStatus: "active",
    workflowStatus: "completed",
    replacementCost: null,
    remainingLifeYears: null,
    fields: [],
  },
];

test("every restricted role has an explicit least-privilege module matrix", () => {
  const admin = defaultModulePermissions("admin");
  const manager = defaultModulePermissions("project_manager");
  const reviewer = defaultModulePermissions("reviewer");
  const surveyor = defaultModulePermissions("surveyor");
  const viewer = defaultModulePermissions("viewer");

  assert.equal(canUseModule(admin, "administration", "delete"), true);
  assert.equal(canUseModule(admin, "assistant"), false);
  assert.equal(canUseModule(manager, "dashboard"), true);
  assert.equal(canUseModule(manager, "locations", "edit"), true);
  assert.equal(canUseModule(manager, "locations", "delete"), false);
  assert.equal(canUseModule(reviewer, "reports", "approve"), true);
  assert.equal(canUseModule(reviewer, "capture", "create"), false);
  assert.equal(canUseModule(surveyor, "capture", "create"), true);
  assert.equal(canUseModule(surveyor, "capture", "delete"), true);
  assert.equal(canUseModule(surveyor, "dashboard"), false);
  assert.equal(canUseModule(viewer, "reports"), true);
  assert.equal(canUseModule(viewer, "reports", "export"), true);
  assert.equal(canUseModule(viewer, "reports", "edit"), false);
  assert.equal(canUseModule(viewer, "administration"), false);
});

test("dashboard filters and localized role labels work for every allowed role", async () => {
  const dashboard = await source("../app/page.tsx");
  const shell = await source("../app/components/app-shell.tsx");
  assert.match(dashboard, /data && structure && <section className="dashboard-filters"/);
  assert.doesNotMatch(dashboard, /currentUser\.role === "admin" && structure/);
  assert.match(shell, /project_manager: \{ ar: "مدير مشروع"/);
  assert.match(shell, /surveyor: \{ ar: "ماسح ميداني"/);
  assert.match(shell, /viewer: \{ ar: "مشاهد"/);
});

test("restricted-role SQL resolves only active assigned projects before aggregation", async () => {
  const sql = await source(
    "../supabase/migrations/021_restricted_role_scale_and_scope.sql",
  );
  assert.match(sql, /create or replace function private\.assetlens_allowed_projects/);
  assert.match(
    sql,
    /where user_id = auth\.uid\(\) and active = true[\s\S]*assignment\.app_user_id = actor\.id[\s\S]*assignment\.project_id = project\.id/i,
  );
  assert.match(
    sql,
    /create or replace function private\.can_access_project[\s\S]*private\.assetlens_allowed_projects\(\)/i,
  );
  assert.match(
    sql,
    /create policy "project assets are visible"[\s\S]*using \(private\.can_access_project\(project_id\)\)/i,
  );
  assert.doesNotMatch(sql, /'%'\s*\|\|\s*filters\s*->>/);
  assert.match(
    sql,
    /asset\.asset_no ilike concat\('%', filters->>'search', '%'\)/,
  );
  assert.doesNotMatch(
    sql.match(/create policy "project assets are visible"[\s\S]*?;/i)?.[0] || "",
    /created_by\s*=\s*auth\.uid/i,
  );
  for (const rpc of [
    "assetlens_asset_list_count",
    "assetlens_report_counts",
    "assetlens_config_snapshot",
    "assetlens_dashboard_filtered",
  ]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`));
  }
  assert.match(sql, /join allowed_projects allowed on allowed\.project_id = asset\.project_id/);
  assert.match(sql, /revoke all on function public\.assetlens_report_counts\(jsonb\) from public, anon/);
});

test("project/report routes use assignment-safe filters and never query projects.project_id", async () => {
  const reports = await source("../app/api/reports/route.ts");
  const assets = await source("../app/api/assets/route.ts");
  assert.match(reports, /projectIdFilter = `id=in\./);
  assert.match(reports, /projects\?select=[^`]+\$\{projectIdFilter/);
  assert.doesNotMatch(reports, /projects\?select=[^`]+\$\{projectFilter/);
  assert.match(assets, /permissionFilter = `project_id=in\./);
  assert.match(assets, /rpc\/assetlens_asset_list_count/);
});

test("timeouts stay single-shot and database implementation text is not shown", async () => {
  const dashboard = await source("../app/api/dashboard/route.ts");
  const reports = await source("../app/api/reports/route.ts");
  const config = await source("../app/api/config/route.ts");
  assert.match(dashboard, /if \(!isMissingDashboardRpc\(error\)\) throw error/);
  assert.match(reports, /if \(!isMissingReportCountsRpc\(error\)\) throw error/);
  assert.match(config, /if \(!\/assetlens_config_snapshot/);
  for (const route of [dashboard, reports, config])
    assert.match(route, /apiErrorResponse/);

  const timeout = publicApiError(
    new Error("canceling statement due to statement timeout"),
  );
  assert.equal(timeout.code, "DATA_TIMEOUT");
  assert.equal(timeout.retryable, true);
  assert.doesNotMatch(timeout.message, /statement|postgres|gateway/i);
  const schema = publicApiError(new Error("column projects.project_id does not exist"));
  assert.equal(schema.code, "SCHEMA_MISMATCH");
  assert.doesNotMatch(schema.message, /projects\.project_id/i);
});

test("analytical questions never degrade into lexical search", () => {
  const condition = askAssetLens(
    "ما هي حالة الأصول بشكل عام في المشروع؟",
    ratedAssets,
    "ar",
  );
  assert.equal(condition.mode, "calculation");
  assert.equal(condition.source, "system_calculation");
  assert.match(condition.summary, /تغطية تقييم الحالة/);
  assert.doesNotMatch(condition.summary, /لم أجد أصل/);

  const sparse = askAssetLens(
    "ما هي الحالة العامة للأصول؟",
    ratedAssets.map((asset, index) => ({
      ...asset,
      conditionRating: index === 0 ? 1 : null,
    })).concat([
      { ...ratedAssets[1], id: "33333333-3333-4333-8333-333333333333", conditionRating: null },
    ]),
    "ar",
  );
  assert.equal(sparse.mode, "calculation");
  assert.match(sparse.summary, /لا توجد بيانات كافية/);
  assert.equal(sparse.coverage.percent, 33);
});

test("only explicit asset, serial or model lookup uses register search", () => {
  assert.equal(isExplicitRegisterSearchQuestion("كيف هي حالة المشروع؟"), false);
  assert.equal(isExplicitRegisterSearchQuestion("ابحث عن المكيف رقم 123"), true);
  const result = askAssetLens("ابحث عن الأصل AC-123", ratedAssets, "ar");
  assert.equal(result.mode, "register_search");
  assert.equal(result.totalMatches, 1);
  assert.equal(result.matches[0].assetNo, "AC-123");
});

test("AI prose is rejected when it introduces a number absent from evidence", () => {
  const evidence = { total: 36, coverage: 75, ratingScale: [1, 5] };
  assert.equal(
    hasOnlyGroundedNumbers("36 assets; 75% coverage on a 1–5 scale", evidence),
    true,
  );
  assert.equal(
    hasOnlyGroundedNumbers("36 assets and an invented saving of 9000", evidence),
    false,
  );
  assert.equal(
    hasOnlyGroundedNumbers("عدد الأصول ٣٦ والتغطية ٧٥٪", evidence),
    true,
  );
});

test("assistant responses expose scope, source, coverage and a filtered register link", async () => {
  const route = await source("../app/api/assistant/route.ts");
  const component = await source("../app/components/assetlens-assistant.tsx");
  assert.match(route, /scope: \{[\s\S]*projectName[\s\S]*building/);
  assert.match(route, /source: answer\.source/);
  assert.match(route, /registerUrl/);
  assert.match(component, /assistant-evidence-meta/);
  assert.match(component, /assistant-register-link/);
  assert.match(component, /تغطية الحالة/);
});

test("filtered report summaries, page jump and safe bulk deletion share active UI state", async () => {
  const page = await source("../app/reports/page.tsx");
  const locations = await source("../app/locations/page.tsx");
  const pagination = await source("../app/components/pagination-jump.tsx");
  const assets = await source("../app/api/assets/route.ts");
  assert.match(page, /const reportSummaryUrl = useMemo/);
  assert.match(page, /new URL\(reportRequestUrl/);
  assert.match(page, /apiGet<ReportSummaryPayload>\(reportSummaryUrl/);
  assert.match(page, /className="bulk-delete-action"/);
  assert.match(page, /حذف المحدد/);
  assert.match(page, /selected\.size > 500/);
  assert.match(assets, /ids\.length > 500/);
  assert.match(assets, /assets\.length !== ids\.length/);
  assert.match(page, /<PaginationJump/);
  assert.match(locations, /<PaginationJump/);
  assert.match(pagination, /type="number"/);
  assert.match(pagination, /Math\.max\(1, Math\.min\(pageCount, requested\)\)/);
});

test("AI replacement report considers notes without turning them into facts", async () => {
  const route = await source("../app/api/reports/ai/route.ts");
  const page = await source("../app/reports/ai/page.tsx");
  const intelligence = await source("../app/intelligence/page.tsx");
  assert.match(route, /noteConsideration/);
  assert.match(route, /replacementStudy/);
  assert.match(route, /recommendations/);
  assert.match(route, /User notes are unverified context, never evidence/i);
  assert.match(route, /hasOnlyGroundedNumbers/);
  assert.match(route, /completeReplacementCost/);
  assert.doesNotMatch(route, /replacementCost: asset\.replacement_cost \?\? asset\.estimated_price/);
  assert.match(page, /كيف أُخذت في الاعتبار/);
  assert.match(page, /التوصيات المقترحة للعميل/);
  assert.match(page, /تقرير دراسة استبدال وتجديد الأصول/);
  assert.match(intelligence, /دراسة استبدال الأصول/);
  assert.match(intelligence, /replacementReadiness/);
});

test("generated asset identifiers use a collision-resistant 48-bit suffix", async () => {
  const sql = await source(
    "../supabase/migrations/021_restricted_role_scale_and_scope.sql",
  );
  assert.match(sql, /substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 12\)/);
  assert.doesNotMatch(sql, /substr\(replace\(gen_random_uuid\(\)::text, '-', ''\), 1, 6\)/);
});
