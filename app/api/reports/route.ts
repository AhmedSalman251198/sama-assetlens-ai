import { createHash } from "node:crypto";
import { requestToken, supabaseRest, supabaseRestAll, verifyAuthUser } from "../../lib/server/supabase";
import { moduleAccessFor, hasModuleAccess } from "../../lib/server/module-access";
import { canUseModule } from "../../lib/module-permissions";
import type { AnalysisField } from "../../lib/server/analyze-images";
import { importedOperationalStatus, importedRating, incompleteImportFields } from "../../lib/import-normalization";

export const runtime = "nodejs";

type AssetRow = {
  id: string; asset_no: string; project_id: string; survey_config_id: string | null; created_by: string;
  project_name: string; building_name: string; floor_name: string; zone_name: string; office_name: string; additional_locations: DynamicLocationValue[]; surveyor_email: string;
  source_file_names: string[]; asset_type: string; summary: string; fields: AnalysisField[]; warnings: string[];
  overall_confidence: number; condition_rating: number | null; condition_justification: string; criticality_rating: number | null; status: string; error: string | null; created_at: string;
  category_id: string | null; operational_status: string; estimated_price: number | null; replacement_cost: number | null; price_currency: string; useful_life_years: number | null; remaining_life_years: number | null;
  asset_categories?: { label_ar: string; label_en: string } | null;
  latitude?: number | null; longitude?: number | null; gps_accuracy_m?: number | null; barcode?: string; captured_offline?: boolean; device_captured_at?: string | null;
};
type ProjectRow = { id: string; name: string; require_building: boolean; require_floor: boolean; require_zone: boolean; require_office: boolean };
type ConfigRow = { id: string; project_id: string; status: string };
type CustomFieldRow = { id: string; config_id: string; field_key: string; label_ar: string; label_en: string; required: boolean; enabled: boolean; asset_types?: string[]; unit?: string; show_in_reports?: boolean };
type CustomValueRow = { asset_id: string; custom_field_id: string; value_text: string };
type AssignmentRow = { app_user_id: string; project_id: string };
type DynamicLocationValue = { levelId: string; key: string; labelAr: string; labelEn: string; valueId: string; value: string };
type LocationLevelRow = { id: string; project_id: string; level_key: string; label_ar: string; label_en: string; required: boolean };
type ActorRow = { id: string; role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer"; active: boolean };
type ImportRow = {
  assetNo?: unknown; assetType?: unknown; manufacturer?: unknown; model?: unknown; serial?: unknown; summary?: unknown;
  building?: unknown; floor?: unknown; zone?: unknown; office?: unknown; customValues?: unknown; categoryId?: unknown;
  conditionRating?: unknown; conditionJustification?: unknown; criticalityRating?: unknown; operationalStatus?: unknown; sourceSheet?: unknown; sourceRow?: unknown;
  extraFields?: unknown; duplicateInFile?: unknown;
};
type CategoryRow = { id: string; label_ar: string; label_en: string; active: boolean };

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
  const baseFields = "id,asset_no,project_id,survey_config_id,created_by,project_name,building_name,floor_name,zone_name,office_name,additional_locations,surveyor_email,source_file_names,asset_type,summary,fields,warnings,overall_confidence,condition_rating,condition_justification,criticality_rating,status,error,created_at,category_id,operational_status,estimated_price,replacement_cost,price_currency,useful_life_years,remaining_life_years,asset_categories(label_ar,label_en)";
  try {
    return await supabaseRestAll<AssetRow>(`assets?select=${baseFields},latitude,longitude,gps_accuracy_m,barcode,captured_offline,device_captured_at&${projectFilter}&order=created_at.desc`, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/schema cache|column.*(latitude|longitude|gps_accuracy_m|barcode|captured_offline|device_captured_at)/i.test(message)) throw error;
    return supabaseRestAll<AssetRow>(`assets?select=${baseFields}&${projectFilter}&order=created_at.desc`, token);
  }
}

async function reportCustomFields(token: string) {
  try {
    return await supabaseRestAll<CustomFieldRow>("custom_fields?select=id,config_id,field_key,label_ar,label_en,required,enabled,asset_types,unit,show_in_reports&enabled=eq.true&order=sort_order", token, { maxRows: 20_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/schema cache|column.*(asset_types|unit|show_in_reports)/i.test(message)) throw error;
    return supabaseRestAll<CustomFieldRow>("custom_fields?select=id,config_id,field_key,label_ar,label_en,required,enabled&enabled=eq.true&order=sort_order", token, { maxRows: 20_000 });
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

  const [assets, projects, customFields, customValues, locationLevels, categories] = await Promise.all([
    reportAssets(token, projectFilter),
    supabaseRest<ProjectRow[]>(`projects?select=id,name,require_building,require_floor,require_zone,require_office&active=eq.true&${projectFilter}&order=name`, token),
    reportCustomFields(token),
    supabaseRestAll<CustomValueRow>("asset_custom_values?select=asset_id,custom_field_id,value_text", token),
    supabaseRest<LocationLevelRow[]>("location_levels?select=id,project_id,level_key,label_ar,label_en,required&active=eq.true&order=sort_order", token),
    supabaseRest<CategoryRow[]>("asset_categories?select=id,label_ar,label_en,active&active=eq.true&order=sort_order,label_en", token).catch(() => []),
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
      categoryId: asset.category_id || "", categoryAr: asset.asset_categories?.label_ar || "", categoryEn: asset.asset_categories?.label_en || "", operationalStatus: asset.operational_status || "active",
      estimatedPrice: asset.estimated_price == null ? null : Number(asset.estimated_price), replacementCost: asset.replacement_cost == null ? null : Number(asset.replacement_cost), priceCurrency: asset.price_currency || "AED", usefulLifeYears: asset.useful_life_years == null ? null : Number(asset.useful_life_years), remainingLifeYears: asset.remaining_life_years == null ? null : Number(asset.remaining_life_years),
      barcode: asset.barcode || "", latitude: asset.latitude ?? null, longitude: asset.longitude ?? null,
      gpsAccuracy: asset.gps_accuracy_m ?? null, capturedOffline: asset.captured_offline || false, deviceCapturedAt: asset.device_captured_at || "",
      canEdit: profile.role === "admin" || profile.role === "project_manager" || profile.role === "reviewer" || (profile.role === "surveyor" && asset.created_by === viewerId),
      canTransfer: profile.role === "admin" || profile.role === "project_manager" || (profile.role === "surveyor" && asset.created_by === viewerId),
      canDelete: profile.role === "admin" || (profile.role === "surveyor" && asset.created_by === viewerId),
    };
  });
  return { currentUser: { role: profile?.role || "surveyor" }, projects: projects.map(project => ({ id: project.id, name: project.name })), categories: categories.map(category => ({ id: category.id, labelAr: category.label_ar, labelEn: category.label_en })), records };
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
    const body = await request.json() as { action?: unknown; projectId?: unknown; fileName?: unknown; rows?: unknown; finalize?: unknown };
    if (body.action !== "importLegacy") return Response.json({ error: "Unsupported reporting action." }, { status: 400 });
    if (profile.role !== "admin") return Response.json({ error: "Only an administrator can import a legacy register." }, { status: 403 });
    if (Array.isArray(body.rows) && body.rows.length > 250) return Response.json({ error: "Import batches must contain at most 250 rows. No rows were saved." }, { status: 413 });
    const projectId = text(body.projectId, 80); const rows = Array.isArray(body.rows) ? body.rows as ImportRow[] : [];
    if (!projectId || !rows.length) return Response.json({ error: "Choose a project and a non-empty Excel file." }, { status: 400 });
    const [projects, configs, allFields, existingAssets, projectCategories, importLocationLevels] = await Promise.all([
      supabaseRest<ProjectRow[]>(`projects?select=id,name,require_building,require_floor,require_zone,require_office&id=eq.${encodeURIComponent(projectId)}&active=eq.true&limit=1`, token),
      supabaseRest<ConfigRow[]>(`survey_config_versions?select=id,project_id,status&project_id=eq.${encodeURIComponent(projectId)}&status=eq.published&limit=1`, token),
      reportCustomFields(token),
      supabaseRestAll<{ fields: AnalysisField[] }>(`assets?select=fields&project_id=eq.${encodeURIComponent(projectId)}`, token),
      supabaseRest<Array<{ category_id: string }>>(`project_asset_categories?select=category_id&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true`, token),
      supabaseRest<LocationLevelRow[]>(`location_levels?select=id,project_id,level_key,label_ar,label_en,required&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&order=sort_order`, token),
    ]);
    const project = projects[0]; const config = configs[0];
    if (!project || !config) return Response.json({ error: "The selected project or its published form is unavailable." }, { status: 409 });
    const knownSerials = new Set(existingAssets.map(asset => normalized(fieldValue(asset.fields, ["serial", "serialNumber", "serialNo", "sn"]))).filter(Boolean));
    const allowedCategoryIds = new Set(projectCategories.map(item => item.category_id));
    const batchSerials = new Set<string>();
    const rejected: Array<{ row: number; sheet: string; reason: string }> = [];
    const prepared: Array<Record<string, unknown>> = [];
    const sourceByFingerprint = new Map<string, ImportRow>();
    rows.forEach((row, index) => {
      const sourceRow = Number(row.sourceRow) || index + 2; const sourceSheet = text(row.sourceSheet, 120) || "Sheet";
      const assetType = text(row.assetType) || text(row.summary) || "Unclassified Asset"; const manufacturer = text(row.manufacturer); const model = text(row.model); const serial = text(row.serial); const serialKey = normalized(serial);
      const requestedCategory = text(row.categoryId, 80); const categoryId = allowedCategoryIds.has(requestedCategory) ? requestedCategory : null;
      const conditionJustification = text(row.conditionJustification, 1000);
      const rawCondition = importedRating(row.conditionRating);
      const conditionRating = rawCondition !== null && rawCondition <= 2 && conditionJustification.length < 3 ? null : rawCondition;
      const criticalityRating = importedRating(row.criticalityRating);
      const missing = incompleteImportFields({ ...row, categoryId, conditionRating, criticalityRating }, { building: project.require_building, floor: project.require_floor, zone: project.require_zone, office: project.require_office });
      const duplicateSerial = Boolean(serialKey && (knownSerials.has(serialKey) || batchSerials.has(serialKey) || row.duplicateInFile === true));
      if (serialKey) batchSerials.add(serialKey);
      const extraFields = row.extraFields && typeof row.extraFields === "object" && !Array.isArray(row.extraFields) ? Object.entries(row.extraFields as Record<string, unknown>) : [];
      if (extraFields.length > 200) { rejected.push({ row: sourceRow, sheet: sourceSheet, reason: "More than 200 additional columns were found. Split this file by column group so no fields are lost." }); return; }
      const fields: AnalysisField[] = [
        manufacturer && { key: "manufacturer", label: "Manufacturer", value: manufacturer, confidence: 1 },
        model && { key: "modelNumber", label: "Model Number", value: model, confidence: 1 },
        serial && { key: "serialNumber", label: "Serial Number", value: serial, confidence: 1 },
        text(row.assetNo) && { key: "legacyAssetNo", label: "Legacy Asset Number", value: text(row.assetNo), confidence: 1 },
        ...extraFields.map(([label, value]) => text(value, 1000) && ({ key: `source_${normalized(label).slice(0, 48) || "field"}`, label: text(label, 120), value: text(value, 1000), confidence: 1 })).filter(Boolean),
      ].filter(Boolean) as AnalysisField[];
      const additionalLocations = importLocationLevels.map(level => {
        const aliases = [level.level_key, level.label_ar, level.label_en].map(normalized);
        const match = extraFields.find(([label]) => aliases.includes(normalized(label)));
        const value = text(match?.[1] ?? (level.level_key === "office" ? row.office : undefined), 300);
        return value ? { levelId: level.id, key: level.level_key, labelAr: level.label_ar, labelEn: level.label_en, valueId: "", value } : null;
      }).filter(Boolean);
      for (const level of importLocationLevels) if (level.required && !additionalLocations.some(item => item?.levelId === level.id)) missing.push(level.label_en || level.label_ar || level.level_key);
      if (rawCondition !== null && conditionRating === null) fields.push({ key: "sourceConditionRating", label: "Source condition rating (requires justification)", value: String(rawCondition), confidence: 1 });
      const importFingerprint = createHash("sha256").update(JSON.stringify({
        projectId, sourceSheet, sourceRow, assetNo: text(row.assetNo), assetType, manufacturer, model, serial,
        building: text(row.building), floor: text(row.floor), zone: text(row.zone), office: text(row.office), extraFields,
      })).digest("hex");
      prepared.push({
        project_id: projectId, survey_config_id: config.id, created_by: user.id, project_name: project.name,
        building_name: text(row.building), floor_name: text(row.floor), zone_name: text(row.zone), office_name: text(row.office), additional_locations: additionalLocations, surveyor_email: user.email,
        source_file_names: [text(body.fileName, 200) || "legacy-register.xlsx"], asset_type: assetType, summary: text(row.summary, 1000) || `Imported asset from ${sourceSheet} row ${sourceRow}`,
        fields, warnings: ["Imported from spreadsheet — verify source data.", ...(missing.length ? [`Incomplete import — fill in: ${Array.from(new Set(missing)).join(", ")}`] : []), ...(duplicateSerial ? [`Duplicate serial detected for review: ${serial}`] : [])],
        category_id: categoryId, operational_status: importedOperationalStatus(row.operationalStatus),
        raw_text: "", overall_confidence: 0, condition_rating: conditionRating, condition_justification: conditionJustification, criticality_rating: criticalityRating, status: "review", error: null, import_fingerprint: importFingerprint,
      });
      sourceByFingerprint.set(importFingerprint, row);
    });
    if (!prepared.length) {
      if (body.finalize === true) {
        const report = await reportData(token, profile, user.id);
        const access = await moduleAccessFor(token, user.id);
        return Response.json({ imported: 0, skipped: 0, rejected, report: { ...report, currentUser: { ...report.currentUser, modulePermissions: access?.permissions || [] } } });
      }
      return Response.json({ imported: 0, skipped: 0, rejected });
    }
    const inserted = await supabaseRest<Array<{ id: string; import_fingerprint: string }>>("assets?on_conflict=import_fingerprint&select=id,import_fingerprint", token, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(prepared) });
    const fieldsForConfig = allFields.filter(field => field.config_id === config.id);
    // Backfill custom values on retry as well: an earlier request could have
    // stored asset rows but timed out before the related value inserts.
    const assetIds = [...inserted];
    if (fieldsForConfig.length && inserted.length < prepared.length) {
      const fingerprints = prepared.map(item => String(item.import_fingerprint));
      for (let offset = 0; offset < fingerprints.length; offset += 50) {
        const batch = fingerprints.slice(offset, offset + 50);
        const found = await supabaseRest<Array<{ id: string; import_fingerprint: string }>>(`assets?select=id,import_fingerprint&import_fingerprint=in.(${batch.join(",")})`, token);
        assetIds.push(...found);
      }
    }
    const customRows: Array<{ asset_id: string; custom_field_id: string; value_text: string }> = [];
    new Map(assetIds.map(asset => [asset.import_fingerprint, asset])).forEach(asset => {
      const source = sourceByFingerprint.get(asset.import_fingerprint);
      const values = source?.customValues && typeof source.customValues === "object" && !Array.isArray(source.customValues) ? source.customValues as Record<string, unknown> : {};
      const extras = source?.extraFields && typeof source.extraFields === "object" && !Array.isArray(source.extraFields) ? source.extraFields as Record<string, unknown> : {};
      for (const field of fieldsForConfig) {
        const aliases = [field.field_key, field.label_ar, field.label_en].map(normalized);
        const extraMatch = Object.entries(extras).find(([label]) => aliases.includes(normalized(label)));
        const value = text(values[field.field_key] ?? extraMatch?.[1], 1000);
        if (value) customRows.push({ asset_id: asset.id, custom_field_id: field.id, value_text: value });
      }
    });
    for (let offset = 0; offset < customRows.length; offset += 500) {
      await supabaseRest("asset_custom_values?on_conflict=asset_id,custom_field_id", token, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(customRows.slice(offset, offset + 500)) });
    }
    if (body.finalize !== true) return Response.json({ imported: inserted.length, skipped: prepared.length - inserted.length, rejected }, { status: 201 });
    const report = await reportData(token, profile, user.id);
    const access = await moduleAccessFor(token, user.id);
    return Response.json({ imported: inserted.length, skipped: prepared.length - inserted.length, rejected, report: { ...report, currentUser: { ...report.currentUser, modulePermissions: access?.permissions || [] } } }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The legacy register could not be imported." }, { status: 500 }); }
}
