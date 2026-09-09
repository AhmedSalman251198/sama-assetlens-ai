import { requestToken, supabaseRest, verifyAuthUser } from "../../lib/server/supabase";
import { moduleAccessFor, hasModuleAccess } from "../../lib/server/module-access";
import { canUseModule } from "../../lib/module-permissions";
import type { AnalysisField } from "../../lib/server/analyze-images";

export const runtime = "nodejs";

type AssetRow = {
  id: string; asset_no: string; project_id: string; survey_config_id: string | null; created_by: string;
  project_name: string; building_name: string; floor_name: string; zone_name: string; office_name: string; additional_locations: DynamicLocationValue[]; surveyor_email: string;
  source_file_names: string[]; asset_type: string; summary: string; fields: AnalysisField[]; warnings: string[];
  overall_confidence: number; condition_rating: number | null; condition_justification: string; criticality_rating: number | null; status: string; error: string | null; created_at: string;
  latitude?: number | null; longitude?: number | null; gps_accuracy_m?: number | null; barcode?: string; captured_offline?: boolean; device_captured_at?: string | null;
};
type ProjectRow = { id: string; name: string; require_building: boolean; require_floor: boolean; require_zone: boolean; require_office: boolean };
type ConfigRow = { id: string; project_id: string; status: string };
type CustomFieldRow = { id: string; config_id: string; field_key: string; label_ar: string; label_en: string; required: boolean; enabled: boolean; asset_types?: string[]; unit?: string; show_in_reports?: boolean };
type CustomValueRow = { asset_id: string; custom_field_id: string; value_text: string };
type AssignmentRow = { app_user_id: string; project_id: string };
type DynamicLocationValue = { levelId: string; key: string; labelAr: string; labelEn: string; valueId: string; value: string };
type LocationLevelRow = { id: string; project_id: string; label_ar: string; label_en: string; required: boolean };
type ActorRow = { id: string; role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer"; active: boolean };
type ImportRow = {
  assetNo?: unknown; assetType?: unknown; manufacturer?: unknown; model?: unknown; serial?: unknown; summary?: unknown;
  building?: unknown; floor?: unknown; zone?: unknown; office?: unknown; customValues?: unknown;
};

function text(value: unknown, max = 300) { return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : ""; }
function normalized(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function fieldValue(fields: AnalysisField[] | null | undefined, aliases: string[]) {
  const wanted = aliases.map(normalized);
  const match = (fields || []).find(field => wanted.includes(normalized(field.key)) || wanted.includes(normalized(field.label)));
  return text(match?.value, 500);
}
function duplicateWarning(warnings: string[] | null | undefined) {
  return (warnings || []).some(warning => /duplicate serial|serial.*duplicate|سيريال.*مكرر/i.test(warning));
}

async function actor(token: string, userId: string) {
  const rows = await supabaseRest<ActorRow[]>(`app_users?select=id,role,active&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`, token);
  return rows[0] || null;
}

async function reportAssets(token: string, projectFilter: string) {
  const baseFields = "id,asset_no,project_id,survey_config_id,created_by,project_name,building_name,floor_name,zone_name,office_name,additional_locations,surveyor_email,source_file_names,asset_type,summary,fields,warnings,overall_confidence,condition_rating,condition_justification,criticality_rating,status,error,created_at";
  try {
    return await supabaseRest<AssetRow[]>(`assets?select=${baseFields},latitude,longitude,gps_accuracy_m,barcode,captured_offline,device_captured_at&${projectFilter}&order=created_at.desc&limit=10000`, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/schema cache|column.*(latitude|longitude|gps_accuracy_m|barcode|captured_offline|device_captured_at)/i.test(message)) throw error;
    return supabaseRest<AssetRow[]>(`assets?select=${baseFields}&${projectFilter}&order=created_at.desc&limit=10000`, token);
  }
}

async function reportCustomFields(token: string) {
  try {
    return await supabaseRest<CustomFieldRow[]>("custom_fields?select=id,config_id,field_key,label_ar,label_en,required,enabled,asset_types,unit,show_in_reports&enabled=eq.true&order=sort_order&limit=10000", token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/schema cache|column.*(asset_types|unit|show_in_reports)/i.test(message)) throw error;
    return supabaseRest<CustomFieldRow[]>("custom_fields?select=id,config_id,field_key,label_ar,label_en,required,enabled&enabled=eq.true&order=sort_order&limit=10000", token);
  }
}

function fieldApplies(field: CustomFieldRow, assetType: string) {
  const targets = field.asset_types || [];
  if (!targets.length) return true;
  const normalizedType = assetType.trim().toLowerCase().replace(/\s+/g, " ");
  return targets.some(target => target.trim().toLowerCase().replace(/\s+/g, " ") === normalizedType);
}

async function reportData(token: string, profile: ActorRow, viewerId: string) {
  // Fetch only assigned projects for surveyors
  let projectFilter = "";
  if (profile.role !== "admin") {
    const assignments = await supabaseRest<AssignmentRow[]>(`user_projects?select=project_id&app_user_id=eq.${encodeURIComponent(profile.id)}`, token);
    const assignedIds = assignments.map(a => a.project_id);
    if (assignedIds.length === 0) return { currentUser: { role: profile.role }, projects: [], records: [] };
    projectFilter = `project_id=in.(${assignedIds.map(encodeURIComponent).join(",")})`;
  }

  const [assets, projects, customFields, customValues, locationLevels] = await Promise.all([
    reportAssets(token, projectFilter),
    supabaseRest<ProjectRow[]>(`projects?select=id,name,require_building,require_floor,require_zone,require_office&active=eq.true&${projectFilter}&order=name`, token),
    reportCustomFields(token),
    supabaseRest<CustomValueRow[]>("asset_custom_values?select=asset_id,custom_field_id,value_text&limit=20000", token),
    supabaseRest<LocationLevelRow[]>("location_levels?select=id,project_id,label_ar,label_en,required&active=eq.true&order=sort_order", token),
  ]);
  const projectById = new Map(projects.map(project => [project.id, project]));
  const fieldById = new Map(customFields.map(field => [field.id, field]));
  const valuesByAsset = new Map<string, CustomValueRow[]>();
  for (const value of customValues) valuesByAsset.set(value.asset_id, [...(valuesByAsset.get(value.asset_id) || []), value]);
  const requiredByConfig = new Map<string, CustomFieldRow[]>();
  for (const field of customFields) if (field.required) requiredByConfig.set(field.config_id, [...(requiredByConfig.get(field.config_id) || []), field]);

  const records = assets.map(asset => {
    const manufacturer = fieldValue(asset.fields, ["manufacturer", "brand", "make"]);
    const model = fieldValue(asset.fields, ["model", "modelNumber", "modelNo"]);
    const serial = fieldValue(asset.fields, ["serial", "serialNumber", "serialNo", "sn"]);
    const project = projectById.get(asset.project_id);
    const values = valuesByAsset.get(asset.id) || [];
    const valueByField = new Map(values.map(value => [value.custom_field_id, text(value.value_text, 1000)]));
    const custom = values.map(value => {
      const field = fieldById.get(value.custom_field_id);
      return field && field.show_in_reports !== false ? { key: field.field_key, labelAr: field.label_ar, labelEn: field.label_en, value: text(value.value_text, 1000), unit: field.unit || "" } : null;
    }).filter(Boolean);
    const missingFields: string[] = [];
    if (!manufacturer) missingFields.push("Manufacturer");
    if (!model) missingFields.push("Model Number");
    if (!serial) missingFields.push("Serial Number");
    if (!asset.condition_rating) missingFields.push("Asset Condition Rating");
    if (asset.condition_rating && asset.condition_rating <= 2 && (asset.condition_justification || "").trim().length < 3) missingFields.push("Condition Justification");
    if (!asset.criticality_rating) missingFields.push("Asset Criticality");
    if (project?.require_building && !asset.building_name) missingFields.push("Building / Site");
    if (project?.require_floor && !asset.floor_name) missingFields.push("Floor");
    if (project?.require_zone && !asset.zone_name) missingFields.push("Zone");
    if (project?.require_office && !asset.office_name) missingFields.push("Office / Room");
    const additionalLocations = Array.isArray(asset.additional_locations) ? asset.additional_locations : [];
    for (const level of locationLevels.filter(item => item.project_id === asset.project_id && item.required)) if (!additionalLocations.some(item => item.levelId === level.id && item.value)) missingFields.push(level.label_en || level.label_ar);
    for (const field of requiredByConfig.get(asset.survey_config_id || "") || []) if (fieldApplies(field, asset.asset_type) && !valueByField.get(field.id)) missingFields.push(field.label_en || field.label_ar);
    return {
      id: asset.id, assetNo: asset.asset_no, projectId: asset.project_id, project: asset.project_name,
      building: asset.building_name, floor: asset.floor_name, zone: asset.zone_name, office: asset.office_name, surveyorEmail: asset.surveyor_email,
      additionalLocations,
      sourceFiles: asset.source_file_names || [], assetType: asset.asset_type, summary: asset.summary, manufacturer, model, serial,
      fields: asset.fields || [], customValues: custom, warnings: asset.warnings || [], confidence: Number(asset.overall_confidence) || 0,
      status: asset.status, conditionRating: asset.condition_rating, conditionJustification: asset.condition_justification || "", criticalityRating: asset.criticality_rating, error: asset.error || "", createdAt: asset.created_at, isDuplicate: duplicateWarning(asset.warnings), missingFields,
      barcode: asset.barcode || "", latitude: asset.latitude ?? null, longitude: asset.longitude ?? null,
      gpsAccuracy: asset.gps_accuracy_m ?? null, capturedOffline: asset.captured_offline || false, deviceCapturedAt: asset.device_captured_at || "",
      canEdit: profile.role === "admin" || profile.role === "project_manager" || profile.role === "reviewer" || (profile.role === "surveyor" && asset.created_by === viewerId),
      canTransfer: profile.role === "admin" || profile.role === "project_manager" || (profile.role === "surveyor" && asset.created_by === viewerId),
      canDelete: profile.role === "admin" || (profile.role === "surveyor" && asset.created_by === viewerId),
    };
  });
  return { currentUser: { role: profile?.role || "surveyor" }, projects: projects.map(project => ({ id: project.id, name: project.name })), records };
}

export async function GET(request: Request) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const access = await moduleAccessFor(token, user.id);
    if (!access || !canUseModule(access.permissions, "reports")) return Response.json({ error: "Reports access is not allowed for this account." }, { status: 403 });
    const profile = await actor(token, user.id);
    if (!profile) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });
    const payload = await reportData(token, profile, user.id);
    return Response.json({ ...payload, currentUser: { ...payload.currentUser, modulePermissions: access.permissions } }, { headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load reports." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!await hasModuleAccess(token, user.id, "reports", "create")) return Response.json({ error: "Report import permission is required." }, { status: 403 });
    const profile = await actor(token, user.id);
    if (!profile) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });
    const body = await request.json() as { action?: unknown; projectId?: unknown; fileName?: unknown; rows?: unknown };
    if (body.action !== "importLegacy") return Response.json({ error: "Unsupported reporting action." }, { status: 400 });
    if (profile.role !== "admin") return Response.json({ error: "Only an administrator can import a legacy register." }, { status: 403 });
    const projectId = text(body.projectId, 80); const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) as ImportRow[] : [];
    if (!projectId || !rows.length) return Response.json({ error: "Choose a project and a non-empty Excel file." }, { status: 400 });
    const [projects, configs, allFields, existingAssets] = await Promise.all([
      supabaseRest<ProjectRow[]>(`projects?select=id,name,require_building,require_floor,require_zone,require_office&id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`, token),
      supabaseRest<ConfigRow[]>(`survey_config_versions?select=id,project_id,status&project_id=eq.${encodeURIComponent(projectId)}&status=eq.published&limit=1`, token),
      reportCustomFields(token),
      supabaseRest<Array<{ fields: AnalysisField[] }>>("assets?select=fields&limit=10000", token),
    ]);
    const project = projects[0]; const config = configs[0];
    if (!project || !config) return Response.json({ error: "The selected project or its published form is unavailable." }, { status: 409 });
    const knownSerials = new Set(existingAssets.map(asset => normalized(fieldValue(asset.fields, ["serial", "serialNumber", "serialNo", "sn"]))).filter(Boolean));
    const batchSerials = new Set<string>();
    const prepared = rows.map((row, index) => {
      const assetType = text(row.assetType) || "Legacy asset"; const manufacturer = text(row.manufacturer); const model = text(row.model); const serial = text(row.serial); const serialKey = normalized(serial);
      const duplicate = Boolean(serialKey && (knownSerials.has(serialKey) || batchSerials.has(serialKey))); if (serialKey) batchSerials.add(serialKey);
      const fields: AnalysisField[] = [
        manufacturer && { key: "manufacturer", label: "Manufacturer", value: manufacturer, confidence: 1 },
        model && { key: "modelNumber", label: "Model Number", value: model, confidence: 1 },
        serial && { key: "serialNumber", label: "Serial Number", value: serial, confidence: 1 },
        text(row.assetNo) && { key: "legacyAssetNo", label: "Legacy Asset Number", value: text(row.assetNo), confidence: 1 },
      ].filter(Boolean) as AnalysisField[];
      return {
        project_id: projectId, survey_config_id: config.id, created_by: user.id, project_name: project.name,
        building_name: text(row.building), floor_name: text(row.floor), zone_name: text(row.zone), office_name: text(row.office), surveyor_email: user.email,
        source_file_names: [text(body.fileName, 200) || "legacy-register.xlsx"], asset_type: assetType, summary: text(row.summary, 1000) || `Imported legacy asset ${index + 1}`,
        fields, warnings: ["Imported from legacy Excel — verify source data.", ...(duplicate ? [`Duplicate serial detected: ${serial}`] : [])],
        raw_text: "", overall_confidence: 1, condition_rating: null, criticality_rating: 3, status: "review", error: null,
      };
    });
    const inserted = await supabaseRest<Array<{ id: string }>>("assets", token, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(prepared) });
    const fieldsForConfig = allFields.filter(field => field.config_id === config.id);
    const customRows: Array<{ asset_id: string; custom_field_id: string; value_text: string }> = [];
    inserted.forEach((asset, index) => {
      const values = rows[index]?.customValues && typeof rows[index].customValues === "object" && !Array.isArray(rows[index].customValues) ? rows[index].customValues as Record<string, unknown> : {};
      for (const field of fieldsForConfig) { const value = text(values[field.field_key], 1000); if (value) customRows.push({ asset_id: asset.id, custom_field_id: field.id, value_text: value }); }
    });
    if (customRows.length) await supabaseRest("asset_custom_values", token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(customRows) });
    const report = await reportData(token, profile, user.id);
    const access = await moduleAccessFor(token, user.id);
    return Response.json({ imported: inserted.length, report: { ...report, currentUser: { ...report.currentUser, modulePermissions: access?.permissions || [] } } }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The legacy register could not be imported." }, { status: 500 }); }
}
