import { answerAssetLens } from "../../lib/server/ask-assetlens";
import { compareRepairAndReplacement } from "../../lib/repair-decision";
import { canUseModule } from "../../lib/module-permissions";
import { moduleAccessFor } from "../../lib/server/module-access";
import { requestToken, supabaseRest, supabaseRestAll, verifyAuthUser } from "../../lib/server/supabase";
import { dependencyImpact, type AssetDependency, type IntelligenceAsset } from "../../lib/asset-intelligence";
import { apiErrorResponse } from "../../lib/server/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssetRow = { id: string; asset_no: string; project_id: string; asset_type: string; building_name: string; floor_name: string; zone_name: string; office_name: string; fields: IntelligenceAsset["fields"]; condition_rating: number | null; criticality_rating: number | null; operational_status: string; status: string; replacement_cost: number | null; price_currency: string | null; remaining_life_years: number | null };
type DependencyRow = { upstream_asset_id: string; downstream_asset_id: string; dependency_type: string; impact: AssetDependency["impact"] };
const noStore = { "Cache-Control": "private, no-store" };
const uuid = (value: unknown) => typeof value === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value) ? value : "";

async function accessFor(request: Request) {
  const token = requestToken(request);
  const user = await verifyAuthUser(token);
  if (!user) return null;
  const access = await moduleAccessFor(token, user.id);
  return access && canUseModule(access.permissions, "assistant") ? { token, access } : null;
}

async function allowedProjects(token: string) {
  return supabaseRest<Array<{ id: string; name: string }>>("projects?select=id,name&active=eq.true&order=name", token);
}

export async function GET(request: Request) {
  try {
    const authorized = await accessFor(request);
    if (!authorized) return Response.json({ error: "Assistant access is not permitted." }, { status: 403 });
    const projects = await allowedProjects(authorized.token);
    return Response.json({ projects }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error, "تعذر فتح المساعد الذكي."); }
}

export async function POST(request: Request) {
  try {
    const authorized = await accessFor(request);
    if (!authorized) return Response.json({ error: "Assistant access is not permitted." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const projectId = uuid(body.projectId);
    const projects = await allowedProjects(authorized.token);
    if (!projects.some(project => project.id === projectId)) return Response.json({ error: "Choose an accessible project." }, { status: 400 });
    const rows = await supabaseRestAll<AssetRow>(`assets?select=id,asset_no,project_id,asset_type,building_name,floor_name,zone_name,office_name,fields,condition_rating,criticality_rating,operational_status,status,replacement_cost,price_currency,remaining_life_years&project_id=eq.${encodeURIComponent(projectId)}&archived_at=is.null&status=in.(review,completed)`, authorized.token);
    const assets: IntelligenceAsset[] = rows.map(row => ({ id: row.id, assetNo: row.asset_no, projectId: row.project_id, assetType: row.asset_type || "Unclassified Asset", building: row.building_name || "Unassigned", location: [row.building_name, row.floor_name, row.zone_name, row.office_name].filter(Boolean).join(" / ") || "Unassigned", conditionRating: row.condition_rating, criticalityRating: row.criticality_rating, operationalStatus: row.operational_status || "unknown", workflowStatus: row.status, replacementCost: row.replacement_cost, priceCurrency: row.price_currency || "AED", remainingLifeYears: row.remaining_life_years, fields: Array.isArray(row.fields) ? row.fields : [] }));
    const language = body.language === "en" ? "en" : "ar";
    if (body.action === "compare") {
      const asset = assets.find(item => item.id === uuid(body.assetId));
      if (!asset) return Response.json({ error: "Choose an asset in your project." }, { status: 400 });
      const repairCost = Number(body.repairCost);
      const submittedReplacement = body.replacementCost === "" || body.replacementCost == null ? null : Number(body.replacementCost);
      const replacementCost = submittedReplacement ?? (asset.replacementCost && asset.replacementCost > 0 ? asset.replacementCost : null);
      const comparison = compareRepairAndReplacement(repairCost, replacementCost);
      const currency = asset.priceCurrency || "AED";
      const dependencyRows = await supabaseRestAll<DependencyRow>(`asset_dependencies?select=upstream_asset_id,downstream_asset_id,dependency_type,impact&project_id=eq.${encodeURIComponent(projectId)}`, authorized.token);
      const impacted = dependencyImpact(asset.id, dependencyRows.map(row => ({ upstreamAssetId: row.upstream_asset_id, downstreamAssetId: row.downstream_asset_id, dependencyType: row.dependency_type || "unverified", impact: row.impact || "unassessed" })));
      const impactRank = { unassessed: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
      const highestImpact = impacted.reduce<AssetDependency["impact"]>((highest, row) => impactRank[row.impact] > impactRank[highest] ? row.impact : highest, "unassessed");
      const knownEvidence = [asset.conditionRating != null, asset.criticalityRating != null, replacementCost != null, impacted.length === 0 || highestImpact !== "unassessed"].filter(Boolean).length;
      const evidenceCoverage = Math.round(knownEvidence * 25);
      const continuityAr = impacted.length ? `يرتبط به ${impacted.length} أصلًا تابعًا بصورة مباشرة أو غير مباشرة، وأعلى أثر مسجل ${highestImpact === "unassessed" ? "غير مقيّم" : highestImpact}.` : "لا تظهر علاقات تابعة مسجلة لهذا الأصل؛ وقد يعني ذلك عدم وجودها أو نقص توثيقها.";
      const continuityEn = impacted.length ? `${impacted.length} downstream assets are linked directly or indirectly; the highest recorded impact is ${highestImpact}.` : "No downstream links are recorded; this may mean no dependency or incomplete documentation.";
      const postureAr = replacementCost === null ? "الأدلة المالية غير كافية للمفاضلة." : comparison.ratio != null && comparison.ratio <= 40 && Number(asset.conditionRating) >= 3 ? "الإصلاح يستحق الدراسة أولًا، بشرط تأكيد سبب العطل والعمر بعد الإصلاح." : comparison.ratio != null && comparison.ratio >= 70 && Number(asset.conditionRating) <= 2 ? "الاستبدال يستحق دراسة أقوى، مع مراجعة أثر التوقف والضمان والعمر المتبقي." : "النتيجة غير حاسمة؛ قارن العمر بعد الإصلاح والموثوقية وأثر التوقف قبل القرار.";
      const postureEn = replacementCost === null ? "Financial evidence is insufficient for a choice." : comparison.ratio != null && comparison.ratio <= 40 && Number(asset.conditionRating) >= 3 ? "Repair merits first consideration, subject to confirming the failure cause and post-repair life." : comparison.ratio != null && comparison.ratio >= 70 && Number(asset.conditionRating) <= 2 ? "Replacement merits stronger consideration after reviewing downtime impact, warranty and remaining life." : "The result is inconclusive; compare post-repair life, reliability and downtime impact.";
      const summary = replacementCost === null
        ? (language === "ar" ? `تكلفة إصلاح ${asset.assetNo}: ${repairCost.toLocaleString()} ${currency} (مدخلة منك). لا توجد تكلفة استبدال موثقة. الحالة ${asset.conditionRating ?? "غير محددة"}/5، والأهمية ${asset.criticalityRating ?? "غير محددة"}/5. ${continuityAr} ${postureAr} تغطية الأدلة ${evidenceCoverage}%.` : `Repair for ${asset.assetNo}: ${currency} ${repairCost.toLocaleString()} (your input). No documented replacement cost is available. Condition ${asset.conditionRating ?? "unknown"}/5; criticality ${asset.criticalityRating ?? "unknown"}/5. ${continuityEn} ${postureEn} Evidence coverage: ${evidenceCoverage}%.`)
        : (language === "ar" ? `إصلاح ${asset.assetNo}: ${repairCost.toLocaleString()} ${currency} (مدخل منك). الاستبدال: ${replacementCost.toLocaleString()} ${currency} (${submittedReplacement === null ? "مسجل في النظام" : "تقدير مدخل منك"})؛ نسبة الإصلاح إلى الاستبدال ${comparison.ratio}%. الحالة ${asset.conditionRating ?? "غير محددة"}/5، والأهمية ${asset.criticalityRating ?? "غير محددة"}/5. ${continuityAr} ${postureAr} تغطية الأدلة ${evidenceCoverage}%.` : `Repair for ${asset.assetNo}: ${currency} ${repairCost.toLocaleString()} (your input). Replacement: ${currency} ${replacementCost.toLocaleString()} (${submittedReplacement === null ? "recorded in the register" : "your estimate"}); repair is ${comparison.ratio}% of replacement. Condition ${asset.conditionRating ?? "unknown"}/5; criticality ${asset.criticalityRating ?? "unknown"}/5. ${continuityEn} ${postureEn} Evidence coverage: ${evidenceCoverage}%.`);
      return Response.json({ summary, comparison, dependencyContext: { affectedAssets: impacted.length, highestImpact, evidenceCoverage }, asset: { id: asset.id, assetNo: asset.assetNo }, mode: "calculation", citations: [asset.id] }, { headers: noStore });
    }
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    if (question.length < 3) return Response.json({ error: "Enter a question about your assets." }, { status: 400 });
    const history = Array.isArray(body.history) ? body.history.slice(-6).filter((entry): entry is { role: "user" | "assistant"; text: string } => Boolean(entry && typeof entry === "object" && (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string")).map(entry => ({ role: entry.role, text: entry.text.slice(0, 500) })) : [];
    const answer = await answerAssetLens(question, assets, language, history);
    const selectedProject = projects.find(project => project.id === projectId);
    const plan = "plan" in answer ? answer.plan : undefined;
    const registerParams = new URLSearchParams({ project: projectId });
    if (plan?.building) registerParams.set("building", plan.building);
    if (plan?.assetType) registerParams.set("assetType", plan.assetType);
    if (plan?.operationalStatus) registerParams.set("operationalStatus", plan.operationalStatus);
    if (plan?.conditionMin === plan?.conditionMax && plan?.conditionMin)
      registerParams.set("condition", String(plan.conditionMin));
    if (plan?.criticalityMin === plan?.criticalityMax && plan?.criticalityMin)
      registerParams.set("criticality", String(plan.criticalityMin));
    if (answer.matches?.length === 1 && answer.totalMatches === 1)
      registerParams.set("asset", answer.matches[0].assetNo);
    return Response.json({
      ...answer,
      scope: {
        projectId,
        projectName: selectedProject?.name || "",
        building: plan?.building || "",
      },
      source: answer.source,
      registerUrl: `/reports?${registerParams.toString()}`,
    }, { headers: noStore });
  } catch (error) { return apiErrorResponse(error, "تعذر إكمال طلب المساعد الذكي."); }
}
