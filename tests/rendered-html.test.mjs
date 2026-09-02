import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGeminiModelCandidates, isGeminiModelUnavailable } from "../app/lib/server/gemini-models.mjs";

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
  assert.match(pages[4], /Locations/);
  assert.match(pages[5], /Asset Transfer/);
});

test("the unified shell provides real navigation and an operable mobile drawer", async () => {
  const shell = await readText("../app/components/app-shell.tsx");
  const layout = await readText("../app/layout.tsx");
  const css = await readText("../app/globals.css");
  for (const route of ["/capture", "/assets", "/organization", "/locations", "/transfers", "/reports", "/admin"]) assert.match(shell, new RegExp(`href: \"${route}\"`));
  assert.match(shell, /onClick=\{\(\) => setDrawerOpen\(true\)\}/);
  assert.match(shell, /aria-controls="assetlens-navigation"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /al-mobile-nav/);
  assert.match(layout, /<AppShell>\{children\}<\/AppShell>/);
  assert.match(css, /\.al-sidebar\.is-open/);
  assert.match(css, /@media \(max-width:760px\)/);
});

test("dashboard is analytics-only and uses a compact server snapshot", async () => {
  const page = await readText("../app/page.tsx");
  const route = await readText("../app/api/dashboard/route.ts");
  const migration = await readText("../supabase/migrations/006_performance_config_snapshot.sql");
  assert.match(page, /ActivityChart/);
  assert.match(page, /نشاط الالتقاط والتحليل/);
  assert.match(page, /\/api\/dashboard/);
  assert.doesNotMatch(page, /dropzone|transfer-section|organization-command|register-table|dash-recent|<table/);
  assert.match(route, /rpc\/assetlens_dashboard_snapshot/);
  assert.match(route, /private, max-age=15, stale-while-revalidate=30/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.assetlens_dashboard_snapshot\(\) to authenticated/);
  assert.doesNotMatch(migration, /'recent'/);
});

test("asset register is server-paginated and deep links work across pages", async () => {
  const assetsPage = await readText("../app/assets/page.tsx");
  const assetApi = await readText("../app/api/assets/route.ts");
  const reports = await readText("../app/reports/page.tsx");
  const locations = await readText("../app/locations/page.tsx");
  const capture = await readText("../app/capture/page.tsx");
  assert.match(assetsPage, /pageSize:\s*"50"/);
  assert.match(assetApi, /supabaseRestWithCount/);
  assert.match(assetApi, /view === "list" \|\| view === "transfer"/);
  assert.match(reports, /\[row\.id, row\.assetNo/);
  assert.match(locations, /\/capture\?project=\$\{building\.projectId\}&building=\$\{building\.id\}/);
  assert.match(locations, /params\.get\("building"\)/);
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
  assert.match(reports, /accept="\.xlsx,\.csv"/);
});

test("PWA shell includes offline capture and avoids caching login or APIs", async () => {
  const manifest = JSON.parse(await readText("../public/manifest.webmanifest"));
  const worker = await readText("../public/sw.js");
  const offlineQueue = await readText("../app/lib/offline-queue.ts");
  const shell = await readText("../app/components/app-shell.tsx");
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
  assert.match(shell, /SERVICE_WORKER_VERSION = "14\.0\.0"/);
  assert.match(css, /\.al-content>\.assetlens-shell>\.app-sidebar/);
  assert.match(offlineQueue, /indexedDB\.open/);
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
