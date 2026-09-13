// Run with a production server on http://127.0.0.1:3212. All API responses
// are intercepted locally: this script does not authenticate against production.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const origin = "http://127.0.0.1:3212";
const id = "c0000000-0000-4000-8000-000000000001";
const modules = ["dashboard", "capture", "organization", "locations", "transfers", "reports", "intelligence", "assistant", "ai_reports", "administration"];
const permissions = modules.map(module => ({ module, view: true, create: true, edit: true, delete: true, approve: true, export: true }));
const user = { name: "AssetLens QA", email: "qa@example.com", role: "admin", modules, modulePermissions: permissions };
const categoryNames = ["Civil", "Electrical", "Fire Fighting", "Fire Alarm", "HVAC", "Plumbing", "Mechanical", "ELV / ICT", "Furniture", "Equipment", "Other", "CCTV"];
const categories = categoryNames.map((name, index) => ({ id: `${id.slice(0,-4)}${String(index + 2).padStart(4,"0")}`, code: name.toLowerCase().replace(/\W+/g,"_"), labelAr: `تصنيف ${index + 1}`, labelEn: name, icon: "◇", color: ["#117d78", "#c08819", "#d25950"][index % 3], defaultUsefulLifeYears: 15, defaultEstimatedPrice: null, currency: "AED", active: true, technicalFields: [], sortOrder: index }));
const project = { id, name: "Demo Project", requireBuilding: true, requireFloor: true, requireZone: false, requireOffice: false, allowManual: true, categoryIds: categories.map(item => item.id), buildings: [], locationLevels: [], customFields: [], draftConfig: null, publishedConfig: null };
const config = { currentUser: { ...user, id, isSuperAdmin: true }, projects: [project], categories, users: [], auditLogs: [] };
const dashboard = { currentUser: user, metrics: { totalAssets: 224, approvedAssets: 19, reviewAssets: 205, activeQueue: 0, failedAssets: 2, projects: 1, buildings: 3, floors: 8, zones: 4 }, status: { approved: 19, review: 205, queued: 0, processing: 0, failed: 0 }, health: { qualityScore: 8, completionRate: 9 }, activity: [], projects: [{ id, name: project.name, count: 224, percent: 100 }], criticality: { weightedIssuePercent: 1, problemWeight: 2, totalWeight: 300, problemAssets: 2, totalAssets: 224, distribution: [1,2,3,4,5].map(rating => ({ rating, count: rating === 3 ? 218 : 2, weight: rating })) } };

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("assetlens_supabase_session_v1", JSON.stringify({ access_token: "qa-token", refresh_token: "qa-refresh", expires_at: Math.floor(Date.now()/1000)+7200 }));
    localStorage.setItem("assetlens_language", "en");
  });
  await context.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === "/api/me" ? user : path === "/api/config" ? config : path === "/api/dashboard" ? dashboard : path === "/api/assistant" ? { projects: [{ id, name: project.name }] } : { error: "Not needed by visual QA" };
    return route.fulfill({ status: "error" in payload ? 404 : 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.goto(`${origin}/admin`);
  await page.locator("#projects .asset-category-picker label").first().waitFor();
  await page.locator(".assistant-trigger").waitFor();
  await page.screenshot({ path: "../qa-admin-r21-light.png" });
  await page.locator(".assistant-trigger").click();
  await page.locator(".assistant-panel.is-visible, .assistant-dock.is-open .assistant-panel").first().waitFor();
  await page.screenshot({ path: "../qa-assistant-r21-light.png" });
  await page.locator(".assistant-close").click();
  if (await page.locator(".assistant-trigger").getAttribute("aria-expanded") !== "false") throw Error("Assistant could not close");
  await page.evaluate(() => { localStorage.setItem("assetlens_theme", "dark"); window.dispatchEvent(new CustomEvent("assetlens-theme-change", { detail: "dark" })); });
  await page.locator(".assistant-trigger").click();
  await page.screenshot({ path: "../qa-assistant-r21-dark.png" });
  await page.locator(".assistant-close").click();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: "../qa-admin-r21-mobile.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw Error(`Mobile page overflows horizontally by ${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.locator(".dashboard-metric").first().waitFor();
  await page.screenshot({ path: "../qa-dashboard-r21-dark.png" });
  if (consoleErrors.length) throw Error(consoleErrors.join(" | "));
  process.stdout.write("Visual QA passed: admin light/mobile, dashboard dark, assistant opening and closing.\n");
} finally { await browser.close(); }
