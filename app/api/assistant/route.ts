import { answerAssetLens } from "../../lib/server/ask-assetlens";
import { compareRepairAndReplacement } from "../../lib/repair-decision";
import { canUseModule } from "../../lib/module-permissions";
import { moduleAccessFor } from "../../lib/server/module-access";
import { requestToken, supabaseRest, supabaseRestAll, verifyAuthUser } from "../../lib/server/supabase";
import type { IntelligenceAsset } from "../../lib/asset-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssetRow = { id: string; asset_no: string; project_id: string; asset_type: string; building_name: string; floor_name: string; zone_name: string; office_name: string; fields: IntelligenceAsset["fields"]; condition_rating: number | null; criticality_rating: number | null; operational_status: string; replacement_cost: number | null; price_currency: string | null; remaining_life_years: number | null };
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
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to open the assistant." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const authorized = await accessFor(request);
    if (!authorized) return Response.json({ error: "Assistant access is not permitted." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const projectId = uuid(body.projectId);
    const projects = await allowedProjects(authorized.token);
    if (!projects.some(project => project.id === projectId)) return Response.json({ error: "Choose an accessible project." }, { status: 400 });
    const rows = await supabaseRestAll<AssetRow>(`assets?select=id,asset_no,project_id,asset_type,building_name,floor_name,zone_name,office_name,fields,condition_rating,criticality_rating,operational_status,replacement_cost,price_currency,remaining_life_years&project_id=eq.${encodeURIComponent(projectId)}&archived_at=is.null&status=in.(review,completed)`, authorized.token);
    const assets: IntelligenceAsset[] = rows.map(row => ({ id: row.id, assetNo: row.asset_no, projectId: row.project_id, assetType: row.asset_type || "Unclassified Asset", building: row.building_name || "Unassigned", location: [row.building_name, row.floor_name, row.zone_name, row.office_name].filter(Boolean).join(" / ") || "Unassigned", conditionRating: row.condition_rating, criticalityRating: row.criticality_rating, operationalStatus: row.operational_status || "unknown", replacementCost: row.replacement_cost, priceCurrency: row.price_currency || "AED", remainingLifeYears: row.remaining_life_years, fields: Array.isArray(row.fields) ? row.fields : [] }));
    const language = body.language === "en" ? "en" : "ar";
    if (body.action === "compare") {
      const asset = assets.find(item => item.id === uuid(body.assetId));
      if (!asset) return Response.json({ error: "Choose an asset in your project." }, { status: 400 });
      const repairCost = Number(body.repairCost);
      const submittedReplacement = body.replacementCost === "" || body.replacementCost == null ? null : Number(body.replacementCost);
      const replacementCost = submittedReplacement ?? (asset.replacementCost && asset.replacementCost > 0 ? asset.replacementCost : null);
      const comparison = compareRepairAndReplacement(repairCost, replacementCost);
      const currency = asset.priceCurrency || "AED";
      const summary = replacementCost === null
        ? (language === "ar" ? `تكلفة إصلاح ${asset.assetNo} التي أدخلتها هي ${repairCost.toLocaleString()} ${currency}. لا يوجد سعر استبدال موثوق؛ لا يمكن إجراء مقارنة مالية حتى تُدخل سعرًا تقريبيًا. حالة الأصل ${asset.conditionRating ?? "غير محددة"}/5 وأهميته ${asset.criticalityRating ?? "غير محددة"}/5.` : `You entered a ${currency} ${repairCost.toLocaleString()} repair cost for ${asset.assetNo}. There is no documented replacement cost; enter an estimate before making a financial comparison. Condition ${asset.conditionRating ?? "unknown"}/5; criticality ${asset.criticalityRating ?? "unknown"}/5.`)
        : (language === "ar" ? `تكلفة إصلاح ${asset.assetNo}: ${repairCost.toLocaleString()} ${currency} (مدخل منك). تكلفة الاستبدال: ${replacementCost.toLocaleString()} ${currency} (${submittedReplacement === null ? "مسجلة في النظام" : "تقدير مدخل منك"}). الفرق المبدئي: ${Math.abs(comparison.gap || 0).toLocaleString()} ${currency}. هذه مقارنة تكلفة أولية وليست توصية نهائية؛ راجع تاريخ الأعطال، تفاصيل التركيب، والضمان قبل القرار.` : `Repair for ${asset.assetNo}: ${currency} ${repairCost.toLocaleString()} (your input). Replacement: ${currency} ${replacementCost.toLocaleString()} (${submittedReplacement === null ? "recorded in the register" : "your estimate"}). Upfront difference: ${currency} ${Math.abs(comparison.gap || 0).toLocaleString()}. This is a preliminary cost comparison, not a final recommendation; verify failures, installation and warranty.`);
      return Response.json({ summary, comparison, asset: { id: asset.id, assetNo: asset.assetNo }, mode: "calculation", citations: [asset.id] }, { headers: noStore });
    }
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    if (question.length < 3) return Response.json({ error: "Enter a question about your assets." }, { status: 400 });
    const history = Array.isArray(body.history) ? body.history.slice(-6).filter((entry): entry is { role: "user" | "assistant"; text: string } => Boolean(entry && typeof entry === "object" && (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string")).map(entry => ({ role: entry.role, text: entry.text.slice(0, 500) })) : [];
    const answer = await answerAssetLens(question, assets, language, history);
    return Response.json(answer, { headers: noStore });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Assistant request failed." }, { status: 500 }); }
}
