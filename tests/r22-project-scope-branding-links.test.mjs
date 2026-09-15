import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("global project scope belongs only to the nominated super administrator", async () => {
  const sql = await source(
    "../supabase/migrations/019_project_scope_branding_relationships.sql",
  );
  assert.match(
    sql,
    /create or replace function private\.is_app_admin\(\)[\s\S]*select private\.is_assetlens_super_admin\(\)/i,
  );
  assert.match(
    sql,
    /create or replace function private\.can_access_project[\s\S]*private\.is_assetlens_super_admin\(\) or exists[\s\S]*public\.user_projects/i,
  );
  assert.match(
    sql,
    /create or replace function private\.can_administer_project[\s\S]*profile\.role = 'admin'/i,
  );
});

test("dashboard checks identity, module access and requested scope before RPC aggregation", async () => {
  const route = await source("../app/api/dashboard/route.ts");
  const auth = route.indexOf("await verifyAuthUser(token)");
  const moduleCheck = route.indexOf(
    'hasModuleAccess(token, user.id, "dashboard")',
  );
  const scope = route.indexOf("await assertDashboardScope(token, filterBody)");
  const rpc = route.indexOf('"rpc/assetlens_dashboard_filtered"');
  assert.ok(
    auth > -1 && moduleCheck > auth && scope > moduleCheck && rpc > scope,
  );
  assert.match(route, /PROJECT_SCOPE_DENIED[\s\S]*status: 403/);
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("asset and report workspaces do not grant global scope to every admin role", async () => {
  const assets = await source("../app/api/assets/route.ts");
  const reports = await source("../app/api/reports/route.ts");
  assert.match(assets, /if \(!isSuperAdminEmail\(profile\.email\)\)/);
  assert.match(reports, /if \(!isSuperAdminEmail\(profile\.email\)\)/);
  assert.match(assets, /user_projects\?select=project_id/);
  assert.match(reports, /user_projects\?select=project_id/);
});

test("project logos are private, project-scoped and validated by bytes and size", async () => {
  const route = await source("../app/api/project-branding/route.ts");
  const sql = await source(
    "../supabase/migrations/019_project_scope_branding_relationships.sql",
  );
  assert.match(route, /MAX_LOGO_BYTES = 2 \* 1024 \* 1024/);
  assert.match(route, /validImageSignature/);
  assert.match(route, /image\/png/);
  assert.match(route, /image\/jpeg/);
  assert.match(route, /image\/webp/);
  assert.match(route, /Project is unavailable to this administrator/);
  assert.match(sql, /'project-branding',[\s\S]*false,[\s\S]*2097152/);
  assert.match(
    sql,
    /project users read project branding[\s\S]*can_access_project/,
  );
  assert.match(
    sql,
    /project admins insert project branding[\s\S]*can_administer_project/,
  );
});

test("AI report renders both identities and suppresses browser margin footers", async () => {
  const page = await source("../app/reports/ai/page.tsx");
  const styles = await source("../app/globals.css");
  assert.match(page, /assetlens-logo\.png/);
  assert.match(page, /client-project-logo/);
  assert.match(page, /\/api\/project-branding\?project=/);
  assert.match(page, /document\.title = `AssetLens AI/);
  assert.match(styles, /@page\{size:A4;margin:0\}/);
  assert.match(styles, /\.ai-report-sheet\{[^}]*padding:10mm!important/);
});

test("capture relationship choices only load assets from the selected registered building", async () => {
  const page = await source("../app/capture/page.tsx");
  const route = await source("../app/api/assets/route.ts");
  assert.match(page, /هل هذا الأصل مرتبط بأصل آخر؟/);
  assert.match(page, /currentAssetRole === "parent"/);
  assert.match(page, /view=relationship-options/);
  assert.match(
    route,
    /project_id=eq\.\$\{encodeURIComponent\(projectId\)\}&building_id=eq\.\$\{encodeURIComponent\(buildingId\)\}/,
  );
  assert.match(route, /dependency_type: "unverified"/);
  assert.match(route, /impact: "unassessed"/);
});

test("database rejects self, duplicate, cross-project and cross-building relationships", async () => {
  const sql = await source(
    "../supabase/migrations/019_project_scope_branding_relationships.sql",
  );
  const base = await source(
    "../supabase/migrations/015_asset_intelligence_suite.sql",
  );
  assert.match(base, /upstream_asset_id <> downstream_asset_id/);
  assert.match(
    sql,
    /Both relationship assets must be active and belong to the selected project/,
  );
  assert.match(
    sql,
    /Parent and child assets must belong to the same registered building/,
  );
  assert.match(sql, /A relationship between these assets already exists/);
  assert.match(sql, /existing\.upstream_asset_id = new\.downstream_asset_id/);
});

test("moving a linked asset across buildings returns and displays a review warning", async () => {
  const route = await source("../app/api/assets/route.ts");
  const page = await source("../app/transfers/page.tsx");
  assert.match(route, /current\.building_id !== location\.buildingId/);
  assert.match(route, /code: "linked_asset_changed_building"/);
  assert.match(page, /payload\.relationshipWarning\?\.count/);
  assert.match(
    page,
    /راجع الربط لأن الأصل المرتبط قد يكون بقي في المبنى السابق/,
  );
  assert.match(page, /className="al-alert warning"/);
});

test("asset register and digital twin expose recorded relationship counts", async () => {
  const route = await source("../app/api/assets/route.ts");
  const reports = await source("../app/reports/page.tsx");
  const intelligence = await source("../app/intelligence/page.tsx");
  assert.match(
    route,
    /relationshipCount: relationshipCounts\.get\(asset\.id\) \|\| 0/,
  );
  assert.match(route, /preliminaryRelationshipCount/);
  assert.match(reports, /register-relationship-badge/);
  assert.match(intelligence, /relationshipCountByAsset/);
  assert.match(intelligence, /علاقة أولية — تحتاج مراجعة/);
});

test("semantic notices and dark project cards remain distinguishable", async () => {
  const styles = await source("../app/globals.css");
  const intelligence = await source("../app/intelligence/page.tsx");
  assert.match(styles, /\.al-alert\.success[^}]*background:#edf9f3/);
  assert.match(styles, /\.al-alert\.warning[^}]*background:#fff8e7/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.user-account-dialog \.project-checks \.check-row/,
  );
  assert.match(styles, /\.check-row:has\(input:checked\)/);
  assert.match(
    intelligence,
    /className="al-alert success"[\s\S]*role="status"/,
  );
});

test("assistant identifies AI capability while separating calculations from direct search", async () => {
  const assistant = await source("../app/components/assetlens-assistant.tsx");
  const server = await source("../app/lib/server/ask-assetlens.ts");
  assert.match(assistant, /أحلّل سجل مشروعك بالذكاء الاصطناعي/);
  assert.match(assistant, /بحث في السجل · ليس AI/);
  assert.match(server, /محرك الصياغة بالذكاء الاصطناعي غير مفعّل/);
  assert.match(server, /محسوبة مباشرة من سجل الأصول/);
  assert.match(assistant, /assistant-evidence-meta/);
  assert.match(assistant, /تغطية الحالة/);
});

test("assigned administrators can publish only configurations in their project scope", async () => {
  const sql = await source(
    "../supabase/migrations/019_project_scope_branding_relationships.sql",
  );
  assert.match(
    sql,
    /create or replace function public\.publish_survey_config[\s\S]*private\.can_administer_project\(target\.project_id\)/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.publish_survey_config\(uuid\) to authenticated/,
  );
});
