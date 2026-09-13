import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGeminiModelCandidates, isGeminiModelUnavailable } from "../app/lib/server/gemini-models.mjs";
import { parseAnalysis } from "../app/lib/server/analyze-images.ts";
import { canUseModule, defaultModulePermissions, normalizeModulePermissions } from "../app/lib/module-permissions.ts";

async function readText(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the production build renders every primary product route", async () => {
  const routes = ["index", "capture", "assets", "organization", "locations", "transfers", "reports", "admin", "login"];
  const pages = await Promise.all(routes.map(route => readText(`../.next/server/app/${route}.html`)));
  for (const html of pages) {
    assert.match(html, /<title>AssetLens AI<\/title>/);
    assert.doesNotMatch(html, /Sama AssetLens|SAMA TECH/);
  }
  assert.match(pages[0], /لوحة متابعة الأصول/);
  assert.match(pages[3], /هيكل واضح لكل مشروع وموقع/);
  assert.match(pages[4], /Asset Management/);
  assert.match(pages[5], /Asset Transfer/);
});

test("the unified shell provides real navigation and an operable mobile drawer", async () => {
  const shell = await readText("../app/components/app-shell.tsx");
  const layout = await readText("../app/layout.tsx");
  const css = await readText("../app/globals.css");
  for (const route of ["/capture", "/organization", "/locations", "/transfers", "/reports", "/admin"]) assert.match(shell, new RegExp(`href: \"${route}\"`));
  assert.doesNotMatch(shell, /href: "\/assets"/);
  assert.match(shell, /onClick=\{\(\) => setDrawerOpen\(true\)\}/);
  assert.match(shell, /aria-controls="assetlens-navigation"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /al-mobile-nav/);
  assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);
  assert.match(css, /\.al-sidebar\.is-open/);
  assert.match(css, /@media \(max-width:760px\)/);
});

test("dashboard is analytics-only, radial, and uses a compact server snapshot", async () => {
  const page = await readText("../app/page.tsx");
  const route = await readText("../app/api/dashboard/route.ts");
  const migration = await readText("../supabase/migrations/006_performance_config_snapshot.sql");
  assert.match(page, /CriticalityRadialChart/);
  assert.match(page, /رسم شعاعي يوضح عدد الأصول/);
  assert.match(page, /\/reports\?criticality=/);
  assert.match(page, /\/api\/dashboard/);
  assert.doesNotMatch(page, /dropzone|transfer-section|organization-command|register-table|dash-recent|<table/);
  assert.match(route, /rpc\/assetlens_dashboard_snapshot/);
  assert.match(route, /private, max-age=15, stale-while-revalidate=30/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.assetlens_dashboard_snapshot\(\) to authenticated/);
  assert.doesNotMatch(migration, /'recent'/);
});

test("asset register is merged into reports and legacy deep links stay safe", async () => {
  const assetsPage = await readText("../app/assets/page.tsx");
  const assetApi = await readText("../app/api/assets/route.ts");
  const reports = await readText("../app/reports/page.tsx");
  const locations = await readText("../app/locations/page.tsx");
  const capture = await readText("../app/capture/page.tsx");
  assert.match(assetsPage, /redirect\("\/reports"\)/);
  assert.match(assetApi, /supabaseRestWithCount/);
  assert.match(assetApi, /view === "list" \|\| view === "transfer"/);
  assert.match(reports, /\[\s*row\.id,\s*row\.assetNo/);
  assert.match(reports, /setDetail\(row\)/);
  assert.match(reports, /\/transfers\?asset=/);
  assert.match(locations, /view: "manage"/);
  assert.match(locations, /action: "manage"/);
  assert.match(capture, /prefillAppliedRef/);
});

test("analysis endpoints are authenticated, bounded, and non-blocking", async () => {
  const analyzeRoute = await readText("../app/api/analyze/route.ts");
  const assetsRoute = await readText("../app/api/assets/route.ts");
  const jobsRoute = await readText("../app/api/jobs/route.ts");
  const analyzer = await readText("../app/lib/server/analyze-images.ts");
  const queue = await readText("../app/lib/server/asset-queue.ts");
  assert.match(analyzeRoute, /verifyAuthUser/);
  assert.match(analyzeRoute, /active=eq\.true/);
  assert.match(assetsRoute, /activeJobs\.count >= 50/);
  assert.match(assetsRoute, /after\(async \(\) =>/);
  assert.match(jobsRoute, /after\(async \(\) =>/);
  assert.match(analyzer, /Date\.now\(\) \+ 45_000/);
  assert.match(analyzer, /v1beta\/models\?pageSize=1000/);
  assert.match(analyzer, /buildGeminiModelCandidates/);
  assert.doesNotMatch(analyzer, /"gemini-2\.5-flash"/);
  assert.match(analyzer, /parseAnalysis/);
  assert.doesNotMatch(queue, /processed < 2/);
});

test("Gemini model selection replaces retired configuration and keeps modern fallbacks", () => {
  assert.deepEqual(
    buildGeminiModelCandidates("models/gemini-2.5-flash", ["models/gemini-3.6-flash", "models/gemini-3.1-flash-live"]),
    ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"],
  );
  assert.equal(isGeminiModelUnavailable(404, "model is not found"), true);
  assert.equal(isGeminiModelUnavailable(400, "model is no longer available to new users"), true);
});

test("image uploads are optimized below common serverless body limits", async () => {
  const capture = await readText("../app/capture/page.tsx");
  const assetsRoute = await readText("../app/api/assets/route.ts");
  assert.match(capture, /optimizeSelectedFiles/);
  assert.match(capture, /3_600_000/);
  assert.match(capture, /Math\.floor\(3_600_000 \/ Math\.max\(1, files\.length\)\)/);
  assert.match(capture, /Math\.min\(2, files\.length\)/);
  assert.match(assetsRoute, /MAX_TOTAL_BYTES = 4 \* 1024 \* 1024/);
});

test("administration uses product dialogs instead of browser prompts", async () => {
  const admin = await readText("../app/admin/page.tsx");
  assert.match(admin, /type AdminDialog/);
  assert.match(admin, /role="dialog"/);
  assert.doesNotMatch(admin, /window\.(prompt|confirm|alert)/);
});

test("Excel handling is lazy, bounded, and free of the vulnerable xlsx package", async () => {
  const pkg = JSON.parse(await readText("../package.json"));
  const excelClient = await readText("../app/lib/excel-client.ts");
  const reports = await readText("../app/reports/page.tsx");
  assert.equal(pkg.dependencies.xlsx, undefined);
  assert.equal(pkg.dependencies.exceljs, "^4.4.0");
  assert.match(excelClient, /await import\("exceljs"\)/);
  assert.match(excelClient, /limit = 500/);
  assert.match(reports, /accept="\.xlsx,\.csv,\.tsv"/);
  assert.match(excelClient, /headerScore/);
  assert.match(excelClient, /workbook\.worksheets\.map/);
});

test("PWA shell includes offline capture and avoids caching login or APIs", async () => {
  const manifest = JSON.parse(await readText("../public/manifest.webmanifest"));
  const worker = await readText("../public/sw.js");
  const offlineQueue = await readText("../app/lib/offline-queue.ts");
  const shell = await readText("../app/components/app-shell.tsx");
  const layout = await readText("../app/layout.tsx");
  const css = await readText("../app/globals.css");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.shortcuts.length, 3);
  assert.match(worker, /assetlens-shell-\$\{VERSION\}/);
  assert.match(worker, /"\/capture"/);
  assert.doesNotMatch(worker, /const PRECACHE = \[[^\]]*"\/login"/);
  assert.match(worker, /url\.pathname === "\/login"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.searchParams\.has\("_rsc"\)/);
  assert.match(worker, /Next-Router-State-Tree/);
  assert.match(shell, /updateViaCache: "none"/);
  const serviceWorkerVersion = shell.match(/SERVICE_WORKER_VERSION = "(\d+\.\d+\.\d+)"/)?.[1];
  assert.ok(serviceWorkerVersion);
  assert.ok(worker.includes(`|| "${serviceWorkerVersion}"`));
  assert.match(shell, /process\.env\.NODE_ENV !== "production"/);
  assert.match(layout, /data-scroll-behavior="smooth"/);
  assert.match(layout, /assetlens_dev_cache_reset_19_0_0/);
  assert.match(css, /\.auth-logo\s*\{[\s\S]*?height:auto;/);
  assert.match(css, /\.al-content>\.assetlens-shell>\.app-sidebar/);
  assert.match(offlineQueue, /indexedDB\.open/);
});

test("asset QR embeds an offline snapshot and refreshes from Supabase when online", async () => {
  const reports = await readText("../app/reports/page.tsx");
  const qr = await readText("../app/lib/asset-qr.ts");
  const endpoint = await readText("../app/api/assets/[id]/qr/route.ts");
  const scan = await readText("../app/scan/page.tsx");
  const worker = await readText("../public/sw.js");
  assert.match(reports, /\/api\/assets\/\$\{encodeURIComponent\(row\.id\)\}\/qr/);
  assert.match(reports, /force: true/);
  assert.match(reports, /buildAssetQrPayload\(snapshot\.source\)/);
  assert.match(reports, /createAssetQrValue\(\s*window\.location\.origin,\s*payload,?\s*\)/);
  assert.match(reports, /QRCode\.toDataURL/);
  assert.match(reports, /width:\s*360,\s*margin:\s*2/);
  assert.match(reports, /width:132px;height:132px/);
  assert.doesNotMatch(reports, /api\.qrserver\.com/);
  assert.match(endpoint, /operational_status/);
  assert.match(endpoint, /asset_categories\(label_ar,label_en\)/);
  assert.match(endpoint, /id=eq\.\$\{encodeURIComponent\(id\)\}/);
  assert.match(qr, /addField\(fields, seen, "ID"/);
  assert.match(qr, /STABLE_PREFIX = "alqr3"/);
  assert.match(qr, /embedded immutable ID/);
  assert.match(qr, /ASSETLENS ASSET V2/);
  assert.match(scan, /parseAssetQrValue\(window\.location\.href\)/);
  assert.match(scan, /\/api\/public\/assets\/\$\{encodeURIComponent\(assetId\)\}/);
  assert.match(scan, /localStorage\.setItem\(cacheKey\(assetId\)/);
  assert.match(worker, /"\/scan"/);
});

test("mobile web offers separate camera and gallery controls", async () => {
  const capture = await readText("../app/capture/page.tsx");
  assert.match(capture, /cameraInputRef/);
  assert.match(capture, /capture="environment"/);
  assert.match(capture, /اختيار من المعرض/);
  assert.match(capture, /التقاط بالكاميرا/);
  assert.match(capture, /ref=\{inputRef\} hidden type="file" multiple accept="image\/jpeg,image\/png,image\/webp" onChange/);
});

test("self signup is removed and account management is super-admin only", async () => {
  const login = await readText("../app/login/page.tsx");
  const config = await readText("../app/api/config/route.ts");
  const admin = await readText("../app/admin/page.tsx");
  const migration = await readText("../supabase/migrations/009_roles_offices_accounts.sql");
  const signupGuard = await readText("../supabase/migrations/007_super_admin_account_control.sql");
  assert.doesNotMatch(login, /signUp|mode === "signup"|إنشاء حساب جديد/);
  assert.match(login, /إنشاء الحسابات متاح فقط للسوبر أدمن/);
  assert.match(config, /accountActions/);
  assert.match(config, /isSuperAdminEmail\(auth\.actor\.email\)/);
  assert.match(config, /action === "createUser" && !rows\[0\]\?\.user_id/);
  assert.match(config, /createSupabasePasswordUser/);
  assert.match(config, /assertSupabaseAdminConfigured/);
  assert.match(config, /A login account already exists for this email/);
  assert.match(admin, /إنشاء حساب مباشر/);
  assert.match(admin, /resetUserPassword|كلمة المرور/);
  assert.match(admin, /value=\{userPassword\}/);
  assert.match(config, /validPassword/);
  assert.match(config, /updateSupabaseUserPassword/);
  assert.doesNotMatch(admin, /إرسال الدعوة/);
  assert.match(migration, /eng\.ahmedsalman96@gmail\.com/);
  assert.match(signupGuard, /has not been approved by the AssetLens super administrator/);
});

test("database policies and audit controls remain enabled", async () => {
  const setup = await readText("../supabase/setup.sql");
  const workflow = await readText("../supabase/migrations/002_asset_workflow.sql");
  const audit = await readText("../supabase/migrations/003_custom_fields_audit.sql");
  assert.match(setup, /alter table public\.projects enable row level security/);
  assert.match(workflow, /alter table public\.assets enable row level security/);
  assert.match(workflow, /create or replace function public\.claim_next_analysis_job/);
  assert.match(audit, /create trigger assetlens_audit_change/);
});

test("route navigation shares authenticated data and never renders hidden legacy pages", async () => {
  const apiClient = await readText("../app/lib/api-client.ts");
  const shell = await readText("../app/components/app-shell.tsx");
  const structure = await readText("../app/lib/use-structure.ts");
  const capture = await readText("../app/capture/page.tsx");
  const reports = await readText("../app/reports/page.tsx");
  assert.match(apiClient, /const responseCache = new Map/);
  assert.match(apiClient, /const inFlight = new Map/);
  assert.match(apiClient, /AbortController/);
  assert.match(shell, /prefetchApi\("\/api\/config\?scope=structure"/);
  assert.match(shell, /router\.prefetch\(href\)/);
  assert.match(structure, /apiGet<StructureConfig>/);
  assert.doesNotMatch(capture, /className="(?:dashboard-overview|organization-command|transfer-section|register-section)"/);
  assert.match(reports, /useDeferredValue\(search\)/);
});

test("R14 database snapshots and compact bulk uploads remove repeated round trips", async () => {
  const migration = await readText("../supabase/migrations/006_performance_config_snapshot.sql");
  const configRoute = await readText("../app/api/config/route.ts");
  const dashboardRoute = await readText("../app/api/dashboard/route.ts");
  const assetsRoute = await readText("../app/api/assets/route.ts");
  const capture = await readText("../app/capture/page.tsx");
  const supabase = await readText("../app/lib/server/supabase.ts");
  assert.match(migration, /assetlens_current_actor\(\)/);
  assert.match(migration, /assetlens_config_snapshot\(/);
  assert.match(migration, /'currentUser'/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /assets_project_created_desc_idx/);
  assert.match(configRoute, /rpc\/assetlens_config_snapshot/);
  assert.match(dashboardRoute, /snapshot\?\.currentUser/);
  assert.match(assetsRoute, /searchParams\.get\("compact"\) === "1"/);
  assert.match(assetsRoute, /Promise\.all\(images\.map/);
  assert.match(capture, /\/api\/assets\?compact=1/);
  assert.match(supabase, /AbortSignal\.timeout/);
});

test("R15 adds dynamic asset fields, manual capture, filtered dashboards and branded loading", async () => {
  const migration = await readText("../supabase/migrations/008_global_product_upgrade.sql");
  const config = await readText("../app/api/config/route.ts");
  const capture = await readText("../app/capture/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  const dashboard = await readText("../app/api/dashboard/route.ts");
  const dashboardPage = await readText("../app/page.tsx");
  const analyzer = await readText("../app/lib/server/analyze-images.ts");
  const queue = await readText("../app/lib/server/asset-queue.ts");
  const shell = await readText("../app/components/app-shell.tsx");
  const css = await readText("../app/globals.css");
  assert.match(migration, /asset_types text\[\]/);
  assert.match(migration, /assetlens_dashboard_filtered/);
  assert.match(migration, /as series\(generated_at\)/);
  assert.doesNotMatch(migration, /\)::date day/);
  assert.match(migration, /project_stats as/);
  assert.doesNotMatch(migration, /jsonb_agg[\s\S]{0,500}max\(asset_count\) over/);
  assert.match(config, /show_in_qr/);
  assert.match(capture, /captureStep/);
  assert.match(capture, /createManualAsset/);
  assert.match(assets, /action.*createManual/);
  assert.match(dashboard, /rpc\/assetlens_dashboard_filtered/);
  assert.match(dashboardPage, /dashboard-filters/);
  assert.match(analyzer, /Administrator-configured fields/);
  assert.match(queue, /configuredAnalysisFields/);
  assert.match(shell, /al-navigation-loader/);
  assert.match(css, /font-family:"Cairo",system-ui/);
});

test("R16 supports administrator-defined location levels across capture, reports, transfers and QR", async () => {
  const migration = await readText("../supabase/migrations/009_roles_offices_accounts.sql");
  const config = await readText("../app/api/config/route.ts");
  const admin = await readText("../app/admin/page.tsx");
  const capture = await readText("../app/capture/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  const reports = await readText("../app/reports/page.tsx");
  const transfers = await readText("../app/transfers/page.tsx");
  const qr = await readText("../app/lib/asset-qr.ts");
  assert.match(migration, /create table if not exists public\.location_levels/);
  assert.match(migration, /create table if not exists public\.location_options/);
  assert.match(migration, /additional_locations jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /admins manage location levels/);
  for (const source of [config, admin, capture, assets, reports, transfers, qr]) assert.match(source, /additionalLocations|locationLevels/);
  assert.match(config, /addLocationLevel/);
  assert.match(config, /deleteLocationLevel/);
  assert.match(config, /updateLocationLevel/);
  assert.match(admin, /اجعله اختياريًا/);
  assert.match(capture, /dynamicLocationsValid/);
  assert.match(assets, /does not belong to this (building|floor|zone)/);
});

test("R16 always returns core asset identity fields even when AI values are empty", () => {
  const parsed = parseAnalysis(JSON.stringify({ assetType: "Pump", fields: [], warnings: [], overallConfidence: 0.8 }), [
    { key: "color", label: "Color" },
  ]);
  assert.deepEqual(parsed.fields.slice(0, 4).map(field => field.key), ["assetName", "manufacturer", "modelNumber", "serialNumber"]);
  assert.equal(parsed.fields.find(field => field.key === "color")?.value, "");
});

test("R16.1 requires and exports a five-level asset condition rating", async () => {
  const migration = await readText("../supabase/migrations/010_asset_condition_rating.sql");
  const capture = await readText("../app/capture/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  const reports = await readText("../app/reports/page.tsx");
  const qr = await readText("../app/lib/asset-qr.ts");
  const levels = await readText("../app/lib/asset-condition.ts");
  assert.match(migration, /condition_rating smallint/);
  assert.match(migration, /check \(condition_rating between 1 and 5\)/);
  assert.match(capture, /asset-condition-rating/);
  assert.match(capture, /ASSET_CONDITION_LEVELS\.map/);
  assert.match(capture, /pre-capture-condition/);
  assert.match(capture, /قبل إرفاق أي صورة للتحليل/);
  assert.match(assets, /Choose the asset condition rating from 1 to 5 before saving/);
  assert.match(reports, /Condition Rating/);
  assert.match(qr, /addField\(fields, seen, "Condition"/);
  assert.equal((levels.match(/rating: [1-5]/g) || []).length, 5);
});

test("R16.2 derives weight from criticality and filters reports and dashboards", async () => {
  const migration = await readText("../supabase/migrations/011_asset_criticality_weighted_dashboard.sql");
  const capture = await readText("../app/capture/page.tsx");
  const reports = await readText("../app/reports/page.tsx");
  const dashboard = await readText("../app/page.tsx");
  const levels = await readText("../app/lib/asset-criticality.ts");
  assert.match(migration, /criticality_rating smallint/);
  assert.match(migration, /assetlens_criticality_snapshot/);
  assert.match(migration, /condition_rating <= 2/);
  assert.match(capture, /أهمية الأصل \(Criticality\)/);
  assert.match(capture, /لا توجد خانة وزن منفصلة/);
  assert.match(reports, /كل درجات الأهمية/);
  assert.match(reports, /Asset Weight/);
  assert.match(dashboard, /توزيع أهمية الأصول/);
  assert.match(dashboard, /تأثير الأعطال الموزون/);
  assert.equal((levels.match(/rating: [1-5], weight: [1-5]/g) || []).length, 5);
});

test("R16.3 enforces condition evidence, idempotent manual creation, and per-asset Bulk ratings", async () => {
  const migration = await readText("../supabase/migrations/012_condition_justification_module_permissions.sql");
  const capture = await readText("../app/capture/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  const reports = await readText("../app/reports/page.tsx");
  assert.match(migration, /condition_justification text not null default ''/);
  assert.match(migration, /assets_poor_condition_justification_check/);
  assert.match(capture, /condition-justification/);
  assert.match(capture, /bulk-rating-list/);
  assert.match(capture, /bulkRatingsComplete/);
  assert.match(capture, /manualSubmissionIdRef/);
  assert.match(capture, /تم تصفير النموذج للبدء من جديد/);
  assert.match(assets, /validatedConditionJustification/);
  assert.match(assets, /offline_client_id=eq/);
  assert.match(assets, /created: false, duplicate: true/);
  assert.match(reports, /Condition Justification/);
  assert.match(reports, /conditionJustification/);
});

test("R16.3 module permissions hide tabs and deny disallowed actions", async () => {
  const migration = await readText("../supabase/migrations/012_condition_justification_module_permissions.sql");
  const shell = await readText("../app/components/app-shell.tsx");
  const config = await readText("../app/api/config/route.ts");
  const admin = await readText("../app/admin/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  assert.match(migration, /create table if not exists public\.user_module_permissions/);
  assert.match(migration, /private\.has_module_permission/);
  assert.match(shell, /canUseModule/);
  assert.match(shell, /visibleNavigation/);
  assert.match(config, /normalizeModulePermissions/);
  assert.match(config, /Only the AssetLens super administrator can create or manage user accounts/);
  assert.match(admin, /صلاحيات التابات والإجراءات/);
  assert.match(assets, /hasModuleAccess/);
  const reviewer = defaultModulePermissions("reviewer");
  assert.equal(canUseModule(reviewer, "administration"), false);
  assert.equal(canUseModule(reviewer, "reports", "approve"), true);
  const normalized = normalizeModulePermissions([{ module: "capture", view: false, create: true }], "surveyor");
  assert.equal(canUseModule(normalized, "capture", "create"), false);
});

test("R17 integrates categories, lifecycle, asset management, retention and AI PDF reports", async () => {
  const migration = await readText("../supabase/migrations/013_asset_management_categories_retention.sql");
  const capture = await readText("../app/capture/page.tsx");
  const assets = await readText("../app/api/assets/route.ts");
  const queue = await readText("../app/lib/server/asset-queue.ts");
  const management = await readText("../app/locations/page.tsx");
  const config = await readText("../app/api/config/route.ts");
  const publicAsset = await readText("../app/api/public/assets/[id]/route.ts");
  const cleanup = await readText("../app/api/maintenance/nameplate-cleanup/route.ts");
  const aiReport = await readText("../app/api/reports/ai/route.ts");
  const reportPage = await readText("../app/reports/ai/page.tsx");
  const shell = await readText("../app/components/app-shell.tsx");
  const vercel = JSON.parse(await readText("../vercel.json"));

  assert.match(migration, /create table if not exists public\.asset_categories/);
  assert.match(migration, /project_asset_categories/);
  assert.match(migration, /operational_status in \('active','maintenance','out_of_service','transferred','disposed'\)/);
  assert.match(migration, /estimated_price numeric/);
  assert.match(migration, /useful_life_years numeric/);
  assert.match(migration, /image_role text not null default 'asset'/);
  assert.match(capture, /categoryId/);
  assert.match(capture, /operationalStatus/);
  assert.match(capture, /queue-section queue-section-at-end/);
  assert.match(assets, /image_role: index === 0 \? "nameplate" : "asset"/);
  assert.match(assets, /Date\.now\(\) \+ 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(queue, /status: "review"/);
  assert.doesNotMatch(queue, /autoApproved/);
  assert.match(management, /إدارة الأصول|Asset Management/);
  assert.match(management, /assetOperationalStatusLabel/);
  assert.match(management, /\/enrich/);
  assert.match(config, /setProjectCategories/);
  assert.match(config, /saveAssetCategory/);
  assert.match(publicAsset, /supabasePublicRest/);
  assert.match(publicAsset, /asset_qr_public_snapshot/);
  assert.match(cleanup, /deleteAssetImagesAdmin/);
  assert.ok(vercel.crons.some(item => item.path === "/api/maintenance/nameplate-cleanup"));
  assert.match(aiReport, /GEMINI_API_KEY/);
  assert.match(aiReport, /temperature: 0\.1/);
  assert.match(reportPage, /window\.print\(\)/);
  assert.match(shell, /saveUiLanguage/);
  assert.match(shell, /saveUiTheme/);
});

test("R18 fixes review approval, direct account management and independent category ratings", async () => {
  const capture = await readText("../app/capture/page.tsx");
  const admin = await readText("../app/admin/page.tsx");
  const config = await readText("../app/api/config/route.ts");
  const migration = await readText("../supabase/migrations/014_independent_asset_criticality.sql");
  assert.match(capture, /openRecordForReview/);
  assert.match(capture, /queue-review/);
  assert.match(capture, /canApproveAssets/);
  assert.match(admin, /user-account-dialog/);
  assert.match(admin, /professional-user-table/);
  assert.match(admin, /category-professional-list/);
  assert.doesNotMatch(admin, /Criticality افتراضية/);
  assert.match(config, /updateSupabaseUserIdentity/);
  assert.match(config, /deleteAssetCategory/);
  assert.match(migration, /default_criticality_rating = null/);
  assert.match(migration, /check \(default_criticality_rating is null\)/);
});

test("R18 delivers smart imports, richer AI reports and accessible dark surfaces", async () => {
  const reports = await readText("../app/reports/page.tsx");
  const reportsApi = await readText("../app/api/reports/route.ts");
  const aiApi = await readText("../app/api/reports/ai/route.ts");
  const aiPage = await readText("../app/reports/ai/page.tsx");
  const css = await readText("../app/globals.css");
  assert.match(reports, /inspectSpreadsheet/);
  assert.match(reports, /import-mapping-grid/);
  assert.match(reportsApi, /import_fingerprint/);
  assert.match(reportsApi, /on_conflict=import_fingerprint/);
  assert.match(reportsApi, /Duplicate serial/);
  assert.match(reportsApi, /status: "review"/);
  assert.match(reportsApi, /Incomplete import/);
  assert.match(aiApi, /riskMatrix/);
  assert.match(aiApi, /actionPlan/);
  assert.match(aiApi, /dataQuality/);
  assert.match(aiPage, /risk-matrix-section/);
  assert.match(aiPage, /action-plan-section/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*--ux-muted:#a8bdc5/);
  assert.match(css, /prefers-contrast:more/);
});

test("the closed floating assistant cannot intercept clicks outside visible controls", async () => {
  const assistant = await readText("../app/components/assetlens-assistant.tsx");
  const css = await readText("../app/assistant.css");
  assert.match(css, /\.assistant-dock\{[^}]*pointer-events:none/);
  assert.match(css, /\.assistant-dock>\.assistant-trigger,\.assistant-dock>\.assistant-welcome\{pointer-events:auto\}/);
  assert.match(css, /\.assistant-panel\{[^}]*pointer-events:none/);
  assert.match(css, /\.assistant-dock\.is-open \.assistant-panel\{[^}]*pointer-events:auto/);
  assert.match(css, /\.assistant-trigger-orbit\{[^}]*pointer-events:none/);
  assert.match(assistant, /inert=\{!open\}/);
});

test("Asset Intelligence keeps the latest project choice and exposes keyboard-operable tabs", async () => {
  const page = await readText("../app/intelligence/page.tsx");
  const route = await readText("../app/api/intelligence/route.ts");
  assert.match(page, /loadRequestRef/);
  assert.match(page, /requestId !== loadRequestRef\.current/);
  assert.match(page, /payload\.projectId !== nextProject/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-selected=\{tab === item\[0\]\}/);
  assert.match(page, /ArrowRight/);
  assert.match(route, /rawProject && !requestedProject/);
  assert.match(route, /requestedProject && !projects\.some/);
});

test("important action feedback scrolls into view without reacting to ordinary background updates", async () => {
  const shell = await readText("../app/components/app-shell.tsx");
  assert.match(shell, /new MutationObserver/);
  assert.match(shell, /\[role="alert"\], \[data-scroll-alert="true"\]/);
  assert.match(shell, /prefers-reduced-motion: reduce/);
  assert.match(shell, /scrollIntoView/);
});

test("AI reports expose an evidence-aware confidence map and keep Gemini server-side", async () => {
  const route = await readText("../app/api/reports/ai/route.ts");
  const page = await readText("../app/reports/ai/page.tsx");
  assert.match(route, /confidenceEligible/);
  assert.match(route, /raw_text/);
  assert.match(route, /confidenceMap/);
  assert.match(route, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(page, /x-gemini-api-key/);
  assert.match(page, /AI Confidence Map/);
  assert.match(page, /غير مقيّم لم تُمنح ثقة اصطناعية/);
});
