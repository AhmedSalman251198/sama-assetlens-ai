import { buildDigitalTwin, dependencyImpact, simulateCapitalPlan, type AssetDependency, type IntelligenceAsset } from "../../lib/asset-intelligence";
import { answerAssetLens } from "../../lib/server/ask-assetlens";
import { canUseModule } from "../../lib/module-permissions";
import { moduleAccessFor } from "../../lib/server/module-access";
import { requestToken, supabaseRest, supabaseRestAll, verifyAuthUser } from "../../lib/server/supabase";
import { apiErrorResponse } from "../../lib/server/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssetRow = {
  id: string; asset_no: string; project_id: string; asset_type: string; building_name: string; floor_name: string; zone_name: string; office_name: string;
  fields: Array<{ key?: string; label?: string; value?: unknown }>; condition_rating: number | null; criticality_rating: number | null;
  operational_status: string; replacement_cost: number | null; estimated_price: number | null; remaining_life_years: number | null;
};
type DependencyRow = { id: string; upstream_asset_id: string; downstream_asset_id: string; dependency_type: string; impact: AssetDependency["impact"]; note: string };
type ScenarioRow = { id: string; project_id: string; name: string; annual_budget: number; horizon_years: number; assumptions: Record<string, unknown>; created_at: string };

function text(value: unknown, max = 300) { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : ""; }
function uuid(value: unknown) { const clean = text(value, 80); return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(clean) ? clean : ""; }

function mapAsset(asset: AssetRow): IntelligenceAsset {
  return {
    id: asset.id, assetNo: asset.asset_no, projectId: asset.project_id, assetType: asset.asset_type || "Unclassified Asset",
    building: asset.building_name || "Unassigned",
    location: [asset.building_name, asset.floor_name, asset.zone_name, asset.office_name].filter(Boolean).join(" / ") || "Unassigned",
    conditionRating: asset.condition_rating, criticalityRating: asset.criticality_rating, operationalStatus: asset.operational_status || "active",
    replacementCost: asset.replacement_cost, remainingLifeYears: asset.remaining_life_years,
    fields: Array.isArray(asset.fields) ? asset.fields : [],
  };
}

async function loadAssets(token: string, projectId = "") {
  const select = "id,asset_no,project_id,asset_type,building_name,floor_name,zone_name,office_name,fields,condition_rating,criticality_rating,operational_status,replacement_cost,estimated_price,remaining_life_years";
  const filter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
  const rows = await supabaseRestAll<AssetRow>(`assets?select=${select}&archived_at=is.null&status=in.(review,completed)${filter}&order=criticality_rating.desc,condition_rating.asc`, token);
  return rows.map(mapAsset);
}

function mapDependencies(rows: DependencyRow[]): AssetDependency[] {
  return rows.map(row => ({ id: row.id, upstreamAssetId: row.upstream_asset_id, downstreamAssetId: row.downstream_asset_id, dependencyType: row.dependency_type, impact: row.impact, note: row.note }));
}

export async function GET(request: Request) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const access = await moduleAccessFor(token, user.id);
    if (!access || !canUseModule(access.permissions, "intelligence")) return Response.json({ error: "Asset Intelligence access is not allowed for this account." }, { status: 403 });
    const rawProject = new URL(request.url).searchParams.get("project");
    const requestedProject = uuid(rawProject);
    if (rawProject && !requestedProject) return Response.json({ error: "Choose a valid project." }, { status: 400 });
    const projects = await supabaseRest<Array<{ id: string; name: string }>>("projects?select=id,name&active=eq.true&order=name", token);
    if (requestedProject && !projects.some(project => project.id === requestedProject)) return Response.json({ error: "Choose an accessible project." }, { status: 403 });
    const projectId = requestedProject || projects[0]?.id || "";
    if (!projectId) return Response.json({ projects: [], projectId: "", assets: [], dependencies: [], scenarios: [], twin: [] });
    const [assets, dependencyRows, scenarios] = await Promise.all([
      loadAssets(token, projectId),
      supabaseRest<DependencyRow[]>(`asset_dependencies?select=id,upstream_asset_id,downstream_asset_id,dependency_type,impact,note&project_id=eq.${encodeURIComponent(projectId)}&order=created_at`, token),
      supabaseRest<ScenarioRow[]>(`capital_scenarios?select=id,project_id,name,annual_budget,horizon_years,assumptions,created_at&project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=20`, token),
    ]);
    const dependencies = mapDependencies(dependencyRows);
    return Response.json({ projects, projectId, assets, dependencies, scenarios, twin: buildDigitalTwin(assets), permissions: access.permissions.find(permission => permission.module === "intelligence"), aiReportAccess: canUseModule(access.permissions, "ai_reports") && canUseModule(access.permissions, "reports", "export") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) { return apiErrorResponse(reason, "تعذر تحميل مركز ذكاء الأصول."); }
}

export async function POST(request: Request) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const access = await moduleAccessFor(token, user.id);
    if (!access || !canUseModule(access.permissions, "intelligence")) return Response.json({ error: "Asset Intelligence access is not allowed for this account." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action, 40); const projectId = uuid(body.projectId);
    if (!projectId) return Response.json({ error: "Choose a valid project." }, { status: 400 });
    const allowedProjects = await supabaseRest<Array<{ id: string }>>("projects?select=id&active=eq.true", token);
    if (!allowedProjects.some(project => project.id === projectId)) return Response.json({ error: "Choose an accessible project." }, { status: 403 });
    const assets = await loadAssets(token, projectId);
    const allowedAssetIds = new Set(assets.map(asset => asset.id));

    if (action === "ask") {
      if (!canUseModule(access.permissions, "assistant")) return Response.json({ error: "Assistant access is not permitted." }, { status: 403 });
      const question = text(body.question, 500);
      if (!question) return Response.json({ error: "Enter a question about the asset register." }, { status: 400 });
      return Response.json(await answerAssetLens(question, assets, body.language === "ar" ? "ar" : "en"), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action === "simulate") {
      return Response.json(simulateCapitalPlan(assets, Number(body.annualBudget), Number(body.horizonYears) || 5));
    }
    if (action === "impact") {
      const rootAssetId = uuid(body.assetId);
      if (!allowedAssetIds.has(rootAssetId)) return Response.json({ error: "Choose an asset in this project." }, { status: 400 });
      const rows = await supabaseRest<DependencyRow[]>(`asset_dependencies?select=id,upstream_asset_id,downstream_asset_id,dependency_type,impact,note&project_id=eq.${encodeURIComponent(projectId)}`, token);
      return Response.json({ rootAssetId, impacted: dependencyImpact(rootAssetId, mapDependencies(rows)) });
    }
    if (action === "saveDependency") {
      if (!canUseModule(access.permissions, "intelligence", "create") && !canUseModule(access.permissions, "intelligence", "edit")) return Response.json({ error: "Dependency editing permission is required." }, { status: 403 });
      const upstream = uuid(body.upstreamAssetId); const downstream = uuid(body.downstreamAssetId);
      if (!allowedAssetIds.has(upstream) || !allowedAssetIds.has(downstream) || upstream === downstream) return Response.json({ error: "Choose two different assets in this project." }, { status: 400 });
      const dependencyType = ["unverified","supplies","controls","protects","serves","feeds","depends_on","other"].includes(text(body.dependencyType, 30)) ? text(body.dependencyType, 30) : "unverified";
      const impact = ["unassessed","low","medium","high","critical"].includes(text(body.impact, 20)) ? text(body.impact, 20) : "unassessed";
      const rows = await supabaseRest<DependencyRow[]>("asset_dependencies?on_conflict=upstream_asset_id,downstream_asset_id", token, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ project_id: projectId, upstream_asset_id: upstream, downstream_asset_id: downstream, dependency_type: dependencyType, impact, note: text(body.note, 1000), created_by: user.id }) });
      return Response.json({ dependency: mapDependencies(rows)[0] }, { status: 201 });
    }
    if (action === "deleteDependency") {
      if (!canUseModule(access.permissions, "intelligence", "delete")) return Response.json({ error: "Dependency deletion permission is required." }, { status: 403 });
      const dependencyId = uuid(body.dependencyId);
      await supabaseRest(`asset_dependencies?id=eq.${encodeURIComponent(dependencyId)}&project_id=eq.${encodeURIComponent(projectId)}`, token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return Response.json({ deleted: true });
    }
    if (action === "saveScenario") {
      if (!canUseModule(access.permissions, "intelligence", "create")) return Response.json({ error: "Scenario creation permission is required." }, { status: 403 });
      const name = text(body.name, 120); const annualBudget = Number(body.annualBudget); const horizonYears = Math.trunc(Number(body.horizonYears) || 5);
      if (!name || !Number.isFinite(annualBudget) || annualBudget < 0 || horizonYears < 1 || horizonYears > 20) return Response.json({ error: "Enter a name, a non-negative annual budget and a 1–20 year horizon." }, { status: 400 });
      const rows = await supabaseRest<ScenarioRow[]>("capital_scenarios", token, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ project_id: projectId, name, annual_budget: annualBudget, horizon_years: horizonYears, assumptions: { strategy: "risk_then_life", currency: "AED" }, created_by: user.id }) });
      return Response.json({ scenario: rows[0], simulation: simulateCapitalPlan(assets, annualBudget, horizonYears) }, { status: 201 });
    }
    return Response.json({ error: "Unsupported intelligence action." }, { status: 400 });
  } catch (reason) { return apiErrorResponse(reason, "تعذر إكمال عملية ذكاء الأصول."); }
}
