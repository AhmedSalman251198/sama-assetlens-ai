import type { AssetQrSource } from "../../../../lib/asset-qr";
import { requestToken, supabaseRest, verifyAuthUser } from "../../../../lib/server/supabase";
import { hasModuleAccess } from "../../../../lib/server/module-access";

export const runtime = "nodejs";

type ActorRow = { id: string };
type AnalysisField = { key?: string; label?: string; value?: unknown };
type DynamicLocationValue = { key?: string; labelAr?: string; labelEn?: string; value?: unknown };
type AssetRow = {
  id: string;
  asset_no: string;
  project_id: string;
  project_name: string;
  building_name: string;
  floor_name: string;
  zone_name: string;
  office_name: string;
  additional_locations: DynamicLocationValue[];
  surveyor_email: string;
  source_file_names: string[];
  asset_type: string;
  summary: string;
  fields: AnalysisField[];
  warnings: string[];
  overall_confidence: number;
  condition_rating: number | null;
  criticality_rating: number | null;
  operational_status: string;
  estimated_price: number | null;
  replacement_cost: number | null;
  price_currency: string;
  useful_life_years: number | null;
  remaining_life_years: number | null;
  enrichment_data: Record<string, unknown>;
  asset_categories: { label_ar: string; label_en: string } | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy_m?: number | null;
  barcode?: string;
  captured_offline?: boolean;
  device_captured_at?: string | null;
};
function safeId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

async function fetchAsset(token: string, id: string) {
  const core = "id,asset_no,project_id,project_name,building_name,floor_name,zone_name,office_name,additional_locations,surveyor_email,source_file_names,asset_type,summary,fields,warnings,overall_confidence,condition_rating,criticality_rating,operational_status,estimated_price,replacement_cost,price_currency,useful_life_years,remaining_life_years,enrichment_data,status,error,created_at,updated_at,completed_at,asset_categories(label_ar,label_en)";
  try {
    const rows = await supabaseRest<AssetRow[]>(`assets?select=${core},latitude,longitude,gps_accuracy_m,barcode,captured_offline,device_captured_at&id=eq.${encodeURIComponent(id)}&limit=1`, token);
    return rows[0] || null;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "";
    if (!/schema cache|column.*(latitude|longitude|gps_accuracy_m|barcode|captured_offline|device_captured_at)/i.test(message)) throw reason;
    const rows = await supabaseRest<AssetRow[]>(`assets?select=${core}&id=eq.${encodeURIComponent(id)}&limit=1`, token);
    return rows[0] || null;
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!await hasModuleAccess(token, user.id, "reports", "export")) return Response.json({ error: "QR export permission is required." }, { status: 403 });

    const profile = await supabaseRest<ActorRow[]>(`app_users?select=id&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`, token);
    if (!profile[0]) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });

    const id = safeId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid Asset ID." }, { status: 400 });
    const asset = await fetchAsset(token, id);
    if (!asset) return Response.json({ error: "Asset not found or access is not allowed." }, { status: 404 });

    const source: AssetQrSource = {
      id: asset.id,
      assetNo: asset.asset_no,
      projectId: asset.project_id,
      project: asset.project_name,
      building: asset.building_name,
      floor: asset.floor_name,
      zone: asset.zone_name,
      office: asset.office_name,
      additionalLocations: Array.isArray(asset.additional_locations) ? asset.additional_locations : [],
      assetType: asset.asset_type,
      barcode: asset.barcode || "",
      conditionRating: asset.condition_rating,
      criticalityRating: asset.criticality_rating,
      operationalStatus: asset.operational_status,
      category: asset.asset_categories?.label_ar || asset.asset_categories?.label_en || "",
      estimatedPrice: asset.estimated_price,
      replacementCost: asset.replacement_cost,
      priceCurrency: asset.price_currency,
      usefulLifeYears: asset.useful_life_years,
      remainingLifeYears: asset.remaining_life_years,
      enrichmentData: asset.enrichment_data || {},
      fields: Array.isArray(asset.fields) ? asset.fields : [],
    };

    return Response.json({ source }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Unable to build the asset QR snapshot." }, { status: 500 });
  }
}
