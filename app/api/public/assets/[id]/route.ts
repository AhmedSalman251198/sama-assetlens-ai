import { buildAssetQrPayload, type AssetQrSource } from "../../../../lib/asset-qr";
import { supabasePublicRest } from "../../../../lib/server/supabase";

export const runtime = "nodejs";

type AnalysisField = { key?: string; label?: string; value?: unknown };
const SAFE_QR_FIELDS = new Set(["manufacturer", "brand", "make", "model", "modelnumber", "modelno", "serial", "serialnumber", "serialno", "sn"]);
function safeQrFields(fields: unknown): AnalysisField[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    if (!field || typeof field !== "object") return [];
    const item = field as AnalysisField;
    const key = String(item.key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!SAFE_QR_FIELDS.has(key) || typeof item.value !== "string" && typeof item.value !== "number") return [];
    return [{ key, value: String(item.value).slice(0, 160) }];
  });
}
type AssetRow = {
  id: string; asset_no: string; asset_type: string; project_name: string; building_name: string; floor_name: string; zone_name: string; office_name: string;
  fields: AnalysisField[]; condition_rating: number | null; criticality_rating: number | null; operational_status: string;
  updated_at: string; category: string;
};

function safeId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = safeId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid Asset ID." }, { status: 400 });
    const rows = await supabasePublicRest<AssetRow[]>("rpc/asset_qr_public_snapshot", { method: "POST", body: JSON.stringify({ target_asset: id }) });
    const asset = rows[0];
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    const source: AssetQrSource = {
      id: asset.id, assetNo: asset.asset_no, assetType: asset.asset_type,
      project: asset.project_name, building: asset.building_name, floor: asset.floor_name, zone: asset.zone_name, office: asset.office_name,
      fields: safeQrFields(asset.fields),
      conditionRating: asset.condition_rating, criticalityRating: asset.criticality_rating,
      operationalStatus: asset.operational_status,
      category: asset.category || "",
    };
    const payload = buildAssetQrPayload(source);
    payload.version = 3; payload.snapshotAt = asset.updated_at || new Date().toISOString();
    return Response.json({ payload, updatedAt: payload.snapshotAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Unable to load current asset data." }, { status: 500 });
  }
}
