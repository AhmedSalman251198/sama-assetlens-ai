import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("administration configuration excludes the heavy audit query", async () => {
  const route = await source("../app/api/config/route.ts");
  assert.match(route, /include_admin: false/);
  assert.match(route, /auditLogs: \[\]/);
  assert.doesNotMatch(
    route,
    /audit_logs\?select=id,actor_email,action,entity_type,entity_id,project_id,details,created_at/,
  );
});

test("activity history is permission checked, bounded, and independently retryable", async () => {
  const route = await source("../app/api/admin/audit/route.ts");
  const page = await source("../app/admin/page.tsx");
  assert.match(route, /verifyAuthUser/);
  assert.match(route, /canUseModule\(access\.permissions, "administration"\)/);
  assert.match(route, /order=created_at\.desc,id\.desc&limit=100/);
  assert.match(route, /status: timeout \? 504 : 500/);
  assert.match(page, /apiGet<\{ auditLogs: AuditLog\[\] \}>\("\/api\/admin\/audit"/);
  assert.match(page, /setAuditLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
});

test("administration timeouts are localized and do not expose database text", async () => {
  const page = await source("../app/admin/page.tsx");
  assert.match(page, /gateway timeout\|statement timeout/);
  assert.match(page, /لن يمنع سجل العمليات تحميل بقية الصفحة/);
  assert.match(page, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(page, /admin-section-warning/);
});

test("large audit logs have a newest-first database index", async () => {
  const migration = await source(
    "../supabase/migrations/020_large_audit_log_performance.sql",
  );
  const combined = await source("../supabase/ASSETLENS_R22_SUPABASE.sql");
  for (const sql of [migration, combined]) {
    assert.match(sql, /audit_logs_recent_idx/);
    assert.match(sql, /audit_logs\(created_at desc, id desc\)/);
    assert.match(sql, /analyze public\.audit_logs/);
  }
});
