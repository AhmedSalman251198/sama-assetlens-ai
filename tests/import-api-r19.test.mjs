import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";

const listen = server => new Promise(resolvePromise => server.listen(0, "127.0.0.1", () => resolvePromise(server.address().port)));
const close = server => new Promise(resolvePromise => server.close(resolvePromise));

test("the production import endpoint stores 2,013 rows in batches and retry never duplicates records", { timeout: 75_000 }, async () => {
  const projectId = "c0000000-0000-4000-8000-000000000001";
  const categoryId = "c0000000-0000-4000-8000-000000000002";
  const stored = new Map();
  const mock = createServer(async (request, response) => {
    const url = new URL(request.url, "http://mock.local");
    let result = [];
    if (url.pathname === "/auth/v1/user") result = { id: "c0000000-0000-4000-8000-000000000003", email: "admin@example.com" };
    else if (url.pathname.endsWith("/rpc/asset_qr_public_snapshot")) result = [{ id: "c0000000-0000-4000-8000-000000000006", asset_no: "AST-QR", asset_type: "Chiller", project_name: "Demo", building_name: "B1", fields: [{ key: "manufacturer", value: "Carrier" }, { key: "privateNote", value: "DO NOT SHOW" }], condition_rating: 3, criticality_rating: 4, operational_status: "active", estimated_price: 999999, updated_at: "2026-09-12T00:00:00Z" }];
    else if (url.pathname.endsWith("/app_users")) result = [{ id: "c0000000-0000-4000-8000-000000000004", email: "admin@example.com", role: "admin", active: true }];
    else if (url.pathname.endsWith("/projects")) result = [{ id: projectId, name: "Demo", require_building: true, require_floor: false, require_zone: false, require_office: false }];
    else if (url.pathname.endsWith("/survey_config_versions")) result = [{ id: "c0000000-0000-4000-8000-000000000005", project_id: projectId, status: "published" }];
    else if (url.pathname.endsWith("/project_asset_categories")) result = [{ category_id: categoryId }];
    else if (url.pathname.endsWith("/assets") && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const rows = JSON.parse(Buffer.concat(chunks).toString());
      result = [];
      for (const row of rows) {
        if (stored.has(row.import_fingerprint)) continue;
        const inserted = { id: `asset-${stored.size + 1}`, import_fingerprint: row.import_fingerprint, fields: row.fields, category_id: row.category_id, condition_rating: row.condition_rating, criticality_rating: row.criticality_rating, overall_confidence: row.overall_confidence, operational_status: row.operational_status, status: row.status, warnings: row.warnings };
        stored.set(row.import_fingerprint, inserted);
        result.push(inserted);
      }
    } else if (url.pathname.endsWith("/assets")) result = [...stored.values()].map(({ fields }) => ({ fields }));
    const range = request.headers.range;
    if (Array.isArray(result) && range && request.method !== "POST") {
      const [from, to] = range.split("-").map(Number);
      result = result.slice(from, Math.min(to + 1, from + 1000));
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  });
  const mockPort = await listen(mock);
  const portHolder = createServer();
  const appPort = await listen(portHolder);
  await close(portHolder);
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_PUBLISHABLE_KEY: "mock-publishable-key", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startup = "";
  child.stdout.on("data", chunk => { startup += String(chunk); });
  child.stderr.on("data", chunk => { startup += String(chunk); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Production server exited: ${startup.slice(-500)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${appPort}/login`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) { ready = true; break; }
      } catch { /* Startup has not bound its port yet. */ }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    assert.equal(ready, true, `Production server failed to start: ${startup.slice(-500)}`);
    const rows = Array.from({ length: 2013 }, (_, index) => ({ sourceSheet: "All assets", sourceRow: index + 2, assetNo: `A-${index + 1}`, assetType: "Chiller", serial: `SN-${index + 1}`, categoryId, conditionRating: 3, criticalityRating: 4 }));
    const upload = async (batch, expectedStatus = 201) => {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/reports`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer mock-token" },
        body: JSON.stringify({ action: "importLegacy", projectId, fileName: "assets.xlsx", rows: batch, finalize: false }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(payload));
      return payload;
    };
    let total = 0;
    for (let index = 0; index < rows.length; index += 200) {
      const result = await upload(rows.slice(index, index + 200));
      total += result.imported;
      assert.equal(result.rejected.length, 0);
    }
    assert.equal(total, 2013);
    assert.equal(stored.size, 2013);
    assert.match(stored.values().next().value.warnings.join(" "), /building/);
    const retry = await upload(rows.slice(0, 200));
    assert.equal(retry.imported, 0);
    assert.equal(retry.skipped, 200);
    assert.equal(stored.size, 2013);
    const incomplete = await upload([{ ...rows[0], sourceRow: 9999, categoryId: "invalid", building: "", conditionRating: null, criticalityRating: null }]);
    assert.equal(incomplete.imported, 1);
    assert.equal(incomplete.rejected.length, 0);
    assert.equal(stored.size, 2014);
    const pending = stored.get([...stored.keys()].at(-1));
    assert.equal(pending.category_id, null);
    assert.equal(pending.condition_rating, null);
    assert.equal(pending.criticality_rating, null);
    assert.equal(pending.operational_status, "unknown");
    assert.equal(pending.overall_confidence, 0);
    assert.equal(pending.status, "review");
    assert.match(pending.warnings.join(" "), /Incomplete import/);
    const oversized = await fetch(`http://127.0.0.1:${appPort}/api/reports`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer mock-token" },
      body: JSON.stringify({ action: "importLegacy", projectId, rows: rows.slice(0, 251) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(stored.size, 2014);
    const deniedAssistant = await fetch(`http://127.0.0.1:${appPort}/api/assistant`, { headers: { Authorization: "Bearer mock-token" } });
    assert.equal(deniedAssistant.status, 403, "Assistant access must not be inherited from general admin rights");
    const deniedAiReport = await fetch(`http://127.0.0.1:${appPort}/api/reports/ai`, { method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
    assert.equal(deniedAiReport.status, 403, "AI report access must be a separate per-user privilege");
    const qrResponse = await fetch(`http://127.0.0.1:${appPort}/api/public/assets/c0000000-0000-4000-8000-000000000006`);
    assert.equal(qrResponse.status, 200);
    const qr = await qrResponse.json();
    assert.match(JSON.stringify(qr), /Carrier/);
    assert.doesNotMatch(JSON.stringify(qr), /DO NOT SHOW|999999|privateNote/);
  } finally {
    child.kill("SIGTERM");
    await close(mock);
  }
});
