import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("reports API pages the asset register before loading related data", async () => {
  const route = await source("../app/api/reports/route.ts");
  assert.match(route, /supabaseRest<AssetRow\[\]>\(path, token/);
  assert.match(route, /const from = \(page - 1\) \* pageSize/);
  assert.match(route, /Range: `\$\{from\}-\$\{probeTo\}`/);
  assert.match(route, /data: rows\.slice\(0, pageSize\)/);
  assert.match(route, /hasNext: rows\.length > pageSize/);
  assert.match(route, /asset_custom_values\?select=[^`]+&asset_id=in\./);
  assert.match(route, /Math\.min\(500, Number\(params\.get\("pageSize"\)\) \|\| 100\)/);
});

test("reports API applies core filters and access scope before counting", async () => {
  const route = await source("../app/api/reports/route.ts");
  assert.match(route, /projectFilter,[\s\S]*"archived_at=is.null"/);
  assert.match(route, /criticality_rating=eq\.\$\{criticality\}/);
  assert.match(route, /condition_rating=eq\.\$\{condition\}/);
  assert.match(route, /status=in\.\(queued,processing\)/);
  assert.match(route, /overall_confidence=lt\.0\.75/);
  assert.match(route, /raw_text\.ilike\.\*\$\{search\}\*/);
  assert.match(route, /rpc\/assetlens_report_counts/);
  assert.match(route, /reportCountPayload\(params\)/);
  assert.match(route, /reportQueryFilters\(countParams, projectFilter\)/);
});

test("reports page requests bounded pages and offers a recoverable retry", async () => {
  const page = await source("../app/reports/page.tsx");
  assert.match(page, /const REPORT_PAGE_SIZE = 100/);
  assert.match(page, /pageSize: String\(REPORT_PAGE_SIZE\)/);
  assert.match(page, /includeCounts: "0"/);
  assert.match(page, /apiGet<ReportPayload>\(reportRequestUrl/);
  assert.match(page, /apiGet<ReportSummaryPayload>\(reportSummaryUrl/);
  assert.match(page, /params\.set\("summary", "1"\)/);
  assert.match(page, /setReloadKey\(\(current\) => current \+ 1\)/);
  assert.match(page, /className="report-pagination"/);
  assert.match(page, /disabled=\{!data\.hasNext \|\| loading\}/);
  assert.doesNotMatch(page, /apiGet<ReportPayload>\("\/api\/reports"/);
});

test("page-scoped quality totals and full exports are labelled honestly", async () => {
  const page = await source("../app/reports/page.tsx");
  assert.match(page, /سيريال مكرر في الصفحة/);
  assert.match(page, /بيانات ناقصة في الصفحة/);
  assert.match(page, /params\.set\("pageSize", "500"\)/);
  assert.match(page, /params\.set\("includeCounts", "0"\)/);
  assert.match(page, /\} while \(hasNext\)/);
  assert.match(page, /exportAllMatchingRows\(quality, "Filtered_Report"\)/);
  assert.match(page, /تحديد الصفحة الحالية/);
});
