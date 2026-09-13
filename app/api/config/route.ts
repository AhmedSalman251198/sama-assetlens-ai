import { assertSupabaseAdminConfigured, createSupabasePasswordUser, requestToken, supabaseRest, supabaseRestAll, updateSupabaseUserIdentity, updateSupabaseUserPassword, verifyAuthUser } from "../../lib/server/supabase";
import { isSuperAdminEmail } from "../../lib/server/super-admin";
import { canUseModule, ModuleAction, ModuleKey, ModulePermission, normalizeModulePermissions } from "../../lib/module-permissions";
import { hasModuleAccess, mapPermissionRows } from "../../lib/server/module-access";

export const runtime = "nodejs";

type ActorRole = "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
type Actor = { id: string; user_id: string | null; email: string; name: string; role: ActorRole; active: boolean };
type ProjectRow = { id: string; name: string; require_building: boolean; require_floor: boolean; require_zone: boolean; require_office: boolean; allow_manual: boolean };
type BuildingRow = { id: string; project_id: string; name: string };
type FloorRow = { id: string; building_id: string; name: string; sort_order: number };
type ZoneRow = { id: string; building_id: string; floor_id: string | null; name: string };
type OfficeRow = { id: string; building_id: string; floor_id: string | null; zone_id: string | null; name: string };
type LocationLevelRow = { id: string; project_id: string; parent_level_id: string | null; level_key: string; label_ar: string; label_en: string; required: boolean; sort_order: number };
type LocationOptionRow = { id: string; level_id: string; building_id: string | null; floor_id: string | null; zone_id: string | null; office_id: string | null; parent_option_id: string | null; name: string };
type AssignmentRow = { app_user_id: string; project_id: string };
type ModulePermissionRow = { app_user_id: string; module_key: ModuleKey; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_approve: boolean; can_export: boolean };
type ConfigRow = { id: string; project_id: string; version: number; status: "draft" | "published" | "archived"; created_at: string; published_at: string | null };
type FieldType = "text" | "textarea" | "number" | "date" | "select" | "boolean";
type FieldRow = { id: string; config_id: string; field_key: string; label_ar: string; label_en: string; section: string; field_type: FieldType; enabled: boolean; required: boolean; option_values: unknown; sort_order: number; help_text_ar: string; help_text_en: string; asset_types?: string[]; unit?: string; ai_extract?: boolean; show_in_reports?: boolean; show_in_qr?: boolean };
type AuditRow = { id: number; actor_email: string; action: string; entity_type: string; entity_id: string | null; project_id: string | null; details: Record<string, unknown>; created_at: string };
type AssetCategoryRow = { id: string; code: string; label_ar: string; label_en: string; color: string; icon: string; default_useful_life_years: number | null; default_estimated_price: number | null; currency: string; default_criticality_rating: number | null; technical_fields: unknown; active: boolean; sort_order: number };
type ProjectCategoryRow = { project_id: string; category_id: string; asset_type_required: boolean; active: boolean };
type ConfigScope = "structure" | "capture" | "admin";
type ConfigSnapshot = {
  actor: Actor | null;
  projects: ProjectRow[];
  buildings: BuildingRow[];
  floors: FloorRow[];
  zones: ZoneRow[];
  offices: OfficeRow[];
  locationLevels: LocationLevelRow[];
  locationOptions: LocationOptionRow[];
  configs: ConfigRow[];
  fields: FieldRow[];
  users: Actor[];
  assignments: AssignmentRow[];
  modulePermissions?: ModulePermissionRow[];
  auditLogs: AuditRow[];
};

async function actorFor(request: Request) {
  const token = requestToken(request); const authUser = await verifyAuthUser(token);
  if (!authUser) return null;
  const actors = await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&user_id=eq.${encodeURIComponent(authUser.id)}&active=eq.true&limit=1`, token);
  return actors[0] ? { actor: actors[0], token } : null;
}

function mapField(field: FieldRow) {
  return { id: field.id, key: field.field_key, labelAr: field.label_ar, labelEn: field.label_en, section: field.section, type: field.field_type, enabled: field.enabled, required: field.required, options: normalizedOptions(field.option_values), sortOrder: field.sort_order, helpAr: field.help_text_ar, helpEn: field.help_text_en, assetTypes: field.asset_types || [], unit: field.unit || "", aiExtract: field.ai_extract === true, showInReports: field.show_in_reports !== false, showInQr: field.show_in_qr !== false };
}

async function customFieldsFor(token: string) {
  const modern = "custom_fields?select=id,config_id,field_key,label_ar,label_en,section,field_type,enabled,required,option_values,sort_order,help_text_ar,help_text_en,asset_types,unit,ai_extract,show_in_reports,show_in_qr&order=sort_order,field_key";
  try { return await supabaseRest<FieldRow[]>(modern, token); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/schema cache|column.*(asset_types|unit|ai_extract|show_in_reports|show_in_qr)/i.test(message)) throw error;
    return supabaseRest<FieldRow[]>("custom_fields?select=id,config_id,field_key,label_ar,label_en,section,field_type,enabled,required,option_values,sort_order,help_text_ar,help_text_en&order=sort_order,field_key", token);
  }
}

function grouped<T, K>(rows: T[], key: (row: T) => K) {
  const result = new Map<K, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) || []), row]);
  return result;
}

function assembleConfig(snapshot: ConfigSnapshot) {
  const { actor, projects: projectRows, buildings, floors, zones, configs, fields, users, assignments, auditLogs } = snapshot;
  const permissionRows = snapshot.modulePermissions || [];
  const offices = snapshot.offices || [];
  const locationLevels = snapshot.locationLevels || [];
  const locationOptions = snapshot.locationOptions || [];
  if (!actor) throw new Error("Unauthorized.");
  const allowedIds = new Set(projectRows.map(project => project.id));
  const allowedBuildings = buildings.filter(row => allowedIds.has(row.project_id));
  const buildingIds = new Set(allowedBuildings.map(building => building.id));
  const allowedFloors = floors.filter(row => buildingIds.has(row.building_id));
  const allowedZones = zones.filter(row => buildingIds.has(row.building_id));
  const allowedOffices = offices.filter(row => buildingIds.has(row.building_id));
  const buildingsByProject = grouped(allowedBuildings, row => row.project_id);
  const floorsByBuilding = grouped(allowedFloors, row => row.building_id);
  const zonesByBuilding = grouped(allowedZones, row => row.building_id);
  const officesByBuilding = grouped(allowedOffices, row => row.building_id);
  const optionsByLevel = grouped(locationOptions, row => row.level_id);
  const levelsByProject = grouped(locationLevels.filter(row => allowedIds.has(row.project_id)), row => row.project_id);
  const configsByProject = grouped([...configs].sort((left, right) => right.version - left.version), row => row.project_id);
  const fieldsByConfig = grouped(fields, row => row.config_id);
  const assignmentsByUser = grouped(assignments, row => row.app_user_id);
  const permissionsByUser = grouped(permissionRows, row => row.app_user_id);
  const projects = projectRows.map(project => {
    const projectConfigs = configsByProject.get(project.id) || [];
    const published = projectConfigs.find(config => config.status === "published");
    const draft = actor.role === "admin" ? projectConfigs.find(config => config.status === "draft") : undefined;
    return {
      id: project.id, name: project.name, requireBuilding: project.require_building, requireFloor: project.require_floor, requireZone: project.require_zone, requireOffice: project.require_office, allowManual: project.allow_manual,
      publishedConfig: published ? { id: published.id, version: published.version, publishedAt: published.published_at } : null,
      customFields: published ? (fieldsByConfig.get(published.id) || []).filter(field => field.enabled).map(mapField) : [],
      locationLevels: (levelsByProject.get(project.id) || []).sort((left, right) => left.sort_order - right.sort_order).map(level => ({
        id: level.id, key: level.level_key, labelAr: level.label_ar, labelEn: level.label_en,
        required: level.required, sortOrder: level.sort_order, parentLevelId: level.parent_level_id || "",
        options: (optionsByLevel.get(level.id) || []).map(option => ({ id: option.id, buildingId: option.building_id, floorId: option.floor_id, zoneId: option.zone_id, officeId: option.office_id, parentOptionId: option.parent_option_id, name: option.name })),
      })),
      draftConfig: draft ? { id: draft.id, version: draft.version, fields: (fieldsByConfig.get(draft.id) || []).map(mapField) } : null,
      buildings: (buildingsByProject.get(project.id) || []).map(building => ({
        id: building.id,
        name: building.name,
        floors: (floorsByBuilding.get(building.id) || []).map(floor => ({ id: floor.id, name: floor.name, sortOrder: floor.sort_order })),
        zones: (zonesByBuilding.get(building.id) || []).map(zone => ({ id: zone.id, floorId: zone.floor_id, name: zone.name })),
        offices: (officesByBuilding.get(building.id) || []).map(office => ({ id: office.id, floorId: office.floor_id, zoneId: office.zone_id, name: office.name })),
      })),
    };
  });
  const isSuperAdmin = isSuperAdminEmail(actor.email);
  const currentPermissions = mapPermissionRows(permissionsByUser.get(actor.id) || [], actor.role, isSuperAdmin);
  return {
    currentUser: { id: actor.id, email: actor.email, name: actor.name, role: actor.role, isSuperAdmin, modulePermissions: currentPermissions, modules: currentPermissions.filter(permission => permission.view).map(permission => permission.module) },
    projects,
    users: isSuperAdmin ? users.map(user => ({ ...user, projectIds: (assignmentsByUser.get(user.id) || []).map(item => item.project_id), modulePermissions: mapPermissionRows(permissionsByUser.get(user.id) || [], user.role, isSuperAdminEmail(user.email)) })) : [],
    auditLogs,
  };
}

function mappedCategory(row: AssetCategoryRow) {
  return {
    id: row.id, code: row.code, labelAr: row.label_ar, labelEn: row.label_en,
    color: row.color, icon: row.icon, defaultUsefulLifeYears: row.default_useful_life_years === null ? null : Number(row.default_useful_life_years),
    defaultEstimatedPrice: row.default_estimated_price === null ? null : Number(row.default_estimated_price),
    currency: row.currency || "AED", defaultCriticalityRating: row.default_criticality_rating === null ? null : Number(row.default_criticality_rating),
    technicalFields: Array.isArray(row.technical_fields) ? row.technical_fields.filter((item): item is string => typeof item === "string") : [], active: row.active, sortOrder: row.sort_order,
  };
}

async function attachAssetCategories<T extends { projects: Array<{ id: string }> }>(config: T, token: string) {
  const [categoryRows, assignmentRows] = await Promise.all([
    supabaseRest<AssetCategoryRow[]>("asset_categories?select=id,code,label_ar,label_en,color,icon,default_useful_life_years,default_estimated_price,currency,default_criticality_rating,technical_fields,active,sort_order&order=sort_order,label_en", token).catch(() => []),
    supabaseRest<ProjectCategoryRow[]>("project_asset_categories?select=project_id,category_id,asset_type_required,active", token).catch(() => []),
  ]);
  const enabledByProject = grouped(assignmentRows.filter(item => item.active), item => item.project_id);
  return {
    ...config,
    categories: categoryRows.map(mappedCategory),
    projects: config.projects.map(project => ({
      ...project,
      categoryIds: (enabledByProject.get(project.id) || []).map(item => item.category_id),
      categorySettings: (enabledByProject.get(project.id) || []).map(item => ({ categoryId: item.category_id, assetTypeRequired: item.asset_type_required })),
    })),
  };
}

async function configFor(actor: Actor, token: string, scope: ConfigScope = "admin") {
  const [projectRows, buildings, floors, zones, offices, locationLevels, locationOptions] = await Promise.all([
    supabaseRest<ProjectRow[]>("projects?select=id,name,require_building,require_floor,require_zone,require_office,allow_manual&active=eq.true&order=name", token),
    supabaseRest<BuildingRow[]>("buildings?select=id,project_id,name&active=eq.true&order=name", token),
    supabaseRest<FloorRow[]>("floors?select=id,building_id,name,sort_order&order=sort_order,name", token),
    supabaseRest<ZoneRow[]>("zones?select=id,building_id,floor_id,name&order=name", token),
    supabaseRest<OfficeRow[]>("offices?select=id,building_id,floor_id,zone_id,name&active=eq.true&order=name", token),
    supabaseRestAll<LocationLevelRow>("location_levels?select=id,project_id,parent_level_id,level_key,label_ar,label_en,required,sort_order&active=eq.true&order=sort_order,label_ar", token),
    supabaseRestAll<LocationOptionRow>("location_options?select=id,level_id,building_id,floor_id,zone_id,office_id,parent_option_id,name&active=eq.true&order=name", token),
  ]);
  const [configs, fields] = scope === "structure" ? [[], []] as [ConfigRow[], FieldRow[]] : await Promise.all([
    supabaseRest<ConfigRow[]>("survey_config_versions?select=id,project_id,version,status,created_at,published_at&order=version.desc", token),
    customFieldsFor(token),
  ]);
  const [users, assignments, auditLogs] = actor.role === "admin" && scope === "admin" ? await Promise.all([
    supabaseRest<Actor[]>("app_users?select=id,user_id,email,name,role,active&order=role,name,email", token),
    supabaseRest<AssignmentRow[]>("user_projects?select=app_user_id,project_id", token),
    supabaseRest<AuditRow[]>("audit_logs?select=id,actor_email,action,entity_type,entity_id,project_id,details,created_at&order=created_at.desc&limit=100", token),
  ]) : [[], [], []] as [Actor[], AssignmentRow[], AuditRow[]];
  const modulePermissions = await supabaseRest<ModulePermissionRow[]>(`user_module_permissions?select=app_user_id,module_key,can_view,can_create,can_edit,can_delete,can_approve,can_export${actor.role === "admin" && scope === "admin" ? "" : `&app_user_id=eq.${encodeURIComponent(actor.id)}`}`, token).catch(() => []);
  return assembleConfig({ actor, projects: projectRows, buildings, floors, zones, offices, locationLevels, locationOptions, configs, fields, users, assignments, modulePermissions, auditLogs });
}

async function optimizedConfig(token: string, scope: ConfigScope) {
  const snapshot = await supabaseRest<ConfigSnapshot>("rpc/assetlens_config_snapshot", token, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ include_forms: scope !== "structure", include_admin: scope === "admin" }),
  }).catch(() => null);
  // The existing SQL snapshot predates parent/office links. Hydrate these
  // tables directly until a revised snapshot is deployed, so capture and
  // transfers never receive a stale or incomplete dynamic hierarchy.
  if (snapshot) {
    [snapshot.locationLevels, snapshot.locationOptions] = await Promise.all([
      supabaseRestAll<LocationLevelRow>("location_levels?select=id,project_id,parent_level_id,level_key,label_ar,label_en,required,sort_order&active=eq.true&order=sort_order,label_ar", token),
      supabaseRestAll<LocationOptionRow>("location_options?select=id,level_id,building_id,floor_id,zone_id,office_id,parent_option_id,name&active=eq.true&order=name", token),
    ]);
  }
  if (snapshot && scope !== "structure") snapshot.fields = await customFieldsFor(token).catch(() => snapshot.fields);
  if (snapshot?.actor) snapshot.modulePermissions = await supabaseRest<ModulePermissionRow[]>(`user_module_permissions?select=app_user_id,module_key,can_view,can_create,can_edit,can_delete,can_approve,can_export${snapshot.actor.role === "admin" && scope === "admin" ? "" : `&app_user_id=eq.${encodeURIComponent(snapshot.actor.id)}`}`, token).catch(() => []);
  return snapshot;
}

function value(body: Record<string, unknown>, key: string, max = 160) { return typeof body[key] === "string" ? body[key].trim().slice(0, max) : ""; }
function boolean(body: Record<string, unknown>, key: string, fallback = false) { return typeof body[key] === "boolean" ? body[key] : fallback; }
function validPassword(password: string) { return password.length >= 10 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password); }
const FIELD_TYPES = new Set<FieldType>(["text", "textarea", "number", "date", "select", "boolean"]);
const ACTOR_ROLES = new Set<ActorRole>(["admin", "project_manager", "reviewer", "surveyor", "viewer"]);
const ADMIN_CREATE_ACTIONS = new Set(["createProject", "addBuilding", "addFloor", "addZone", "addOffice", "addLocationLevel", "addLocationOption", "createUser", "createConfigDraft", "addSuggestedFields", "saveAssetCategory"]);
const ADMIN_DELETE_ACTIONS = new Set(["archiveProject", "archiveBuilding", "deleteFloor", "deleteZone", "deleteOffice", "deleteLocationLevel", "deleteLocationOption", "setAssetCategoryActive", "deleteAssetCategory"]);
const ADMIN_APPROVE_ACTIONS = new Set(["publishConfig"]);
function permissionForAdminAction(action: string): ModuleAction {
  if (ADMIN_CREATE_ACTIONS.has(action)) return "create";
  if (ADMIN_DELETE_ACTIONS.has(action)) return "delete";
  if (ADMIN_APPROVE_ACTIONS.has(action)) return "approve";
  return "edit";
}
const SUGGESTED_FIELDS = [
  { field_key: "room", label_ar: "الغرفة", label_en: "Room", field_type: "text", required: false, option_values: [], sort_order: 10 },
  { field_key: "section", label_ar: "القسم / المنطقة", label_en: "Section", field_type: "text", required: false, option_values: [], sort_order: 20 },
  { field_key: "asset_condition", label_ar: "حالة الأصل الفنية", label_en: "Asset Condition", field_type: "select", required: false, option_values: [{ code: "excellent", labelAr: "ممتازة", labelEn: "Excellent" }, { code: "good", labelAr: "جيدة", labelEn: "Good" }, { code: "fair", labelAr: "متوسطة", labelEn: "Fair" }, { code: "poor", labelAr: "ضعيفة", labelEn: "Poor" }, { code: "damaged", labelAr: "تالفة", labelEn: "Damaged" }], sort_order: 30 },
  { field_key: "department", label_ar: "الإدارة / القسم", label_en: "Department", field_type: "text", required: false, option_values: [], sort_order: 50 },
  { field_key: "gps_location", label_ar: "الموقع الجغرافي GPS", label_en: "GPS Location", field_type: "text", required: false, option_values: [], sort_order: 60 },
  { field_key: "barcode", label_ar: "رمز الأصل QR / Barcode", label_en: "Asset QR / Barcode", field_type: "text", required: false, option_values: [], sort_order: 70 },
] as const;
function normalizedOptions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((item, index) => {
    if (typeof item === "string") return { code: item.trim().slice(0, 80), labelAr: item.trim().slice(0, 120), labelEn: item.trim().slice(0, 120) };
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const code = typeof row.code === "string" ? row.code.trim().slice(0, 80) : `option_${index + 1}`;
    const labelAr = typeof row.labelAr === "string" ? row.labelAr.trim().slice(0, 120) : code;
    const labelEn = typeof row.labelEn === "string" ? row.labelEn.trim().slice(0, 120) : code;
    return { code, labelAr, labelEn };
  }).filter(option => option.code && option.labelAr);
}

export async function GET(request: Request) {
  try {
    const requestedScope = new URL(request.url).searchParams.get("scope");
    const scope: ConfigScope = requestedScope === "structure" || requestedScope === "capture" ? requestedScope : "admin";
    const token = requestToken(request);
    if (!token) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
    const snapshot = await optimizedConfig(token, scope);
    if (snapshot) {
      if (!snapshot.actor?.active) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
      // The older compact SQL snapshot deliberately pre-dates the parent
      // columns. Hydrate these two lightweight lists so all pages receive the
      // same live, nested hierarchy after migration 016.
      [snapshot.locationLevels, snapshot.locationOptions] = await Promise.all([
        supabaseRestAll<LocationLevelRow>("location_levels?select=id,project_id,parent_level_id,level_key,label_ar,label_en,required,sort_order&active=eq.true&order=sort_order,label_ar", token),
        supabaseRestAll<LocationOptionRow>("location_options?select=id,level_id,building_id,floor_id,zone_id,office_id,parent_option_id,name&active=eq.true&order=name", token),
      ]);
      const config = await attachAssetCategories(assembleConfig(snapshot), token);
      const permissions = config.currentUser.modulePermissions;
      const allowed = scope === "admin"
        ? canUseModule(permissions, "administration")
        : scope === "capture"
          ? canUseModule(permissions, "capture")
          : ["dashboard", "capture", "organization", "locations", "transfers"].some(module => canUseModule(permissions, module as ModuleKey));
      if (!allowed) return Response.json({ error: "Your account cannot access this module." }, { status: 403 });
      return Response.json(config, { headers: { "Cache-Control": scope === "admin" ? "private, max-age=20" : "private, max-age=60, stale-while-revalidate=300" } });
    }
    const auth = await actorFor(request);
    if (!auth) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
    const config = await attachAssetCategories(await configFor(auth.actor, auth.token, scope), auth.token);
    const permissions = config.currentUser.modulePermissions;
    const allowed = scope === "admin"
      ? canUseModule(permissions, "administration")
      : scope === "capture"
        ? canUseModule(permissions, "capture")
        : ["dashboard", "capture", "organization", "locations", "transfers"].some(module => canUseModule(permissions, module as ModuleKey));
    if (!allowed) return Response.json({ error: "Your account cannot access this module." }, { status: 403 });
    return Response.json(config, { headers: { "Cache-Control": scope === "admin" ? "private, max-age=20" : "private, max-age=60, stale-while-revalidate=300" } });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load configuration." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const auth = await actorFor(request);
    if (!auth) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
    if (auth.actor.role !== "admin") return Response.json({ error: "Administrator permission is required." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>; const action = value(body, "action", 50);
    const requiredPermission = permissionForAdminAction(action);
    if (!auth.actor.user_id || !await hasModuleAccess(auth.token, auth.actor.user_id, "administration", requiredPermission)) return Response.json({ error: `Administration ${requiredPermission} permission is required.` }, { status: 403 });
    const accountActions = new Set(["createUser", "upsertUser", "setUserActive", "resetUserPassword"]);
    if (accountActions.has(action) && !isSuperAdminEmail(auth.actor.email)) return Response.json({ error: "Only the AssetLens super administrator can create or manage user accounts." }, { status: 403 });
    if (action === "deleteAssetCategory" && !isSuperAdminEmail(auth.actor.email)) return Response.json({ error: "Only the AssetLens super administrator can permanently delete asset categories." }, { status: 403 });
    if (action === "createProject") {
      const name = value(body, "name"); if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
      const existing = await supabaseRest<Array<{ id: string }>>(`projects?select=id&name=eq.${encodeURIComponent(name)}&limit=1`, auth.token);
      if (!existing.length) {
        const created = await supabaseRest<Array<{ id: string }>>("projects", auth.token, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name, require_building: boolean(body, "requireBuilding", true), require_floor: boolean(body, "requireFloor", true), require_zone: boolean(body, "requireZone"), require_office: boolean(body, "requireOffice"), allow_manual: boolean(body, "allowManual", true) }) });
        if (created[0]?.id) {
          await supabaseRest("survey_config_versions", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ project_id: created[0].id, version: 1, status: "published", published_at: new Date().toISOString() }) });
          const requestedCategoryIds = Array.isArray(body.categoryIds) ? body.categoryIds.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
          const categoryIds = requestedCategoryIds.length ? requestedCategoryIds : (await supabaseRest<Array<{ id: string }>>("asset_categories?select=id&active=eq.true&order=sort_order", auth.token).catch(() => [])).map(item => item.id);
          if (categoryIds.length) await supabaseRest("project_asset_categories", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(categoryIds.map(categoryId => ({ project_id: created[0].id, category_id: categoryId, active: true }))) });
        }
      }
    } else if (action === "updateProject") {
      const projectId = value(body, "projectId"); const name = value(body, "name"); if (!projectId || !name) return Response.json({ error: "Project and name are required." }, { status: 400 });
      await supabaseRest(`projects?id=eq.${encodeURIComponent(projectId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name, require_building: boolean(body, "requireBuilding", true), require_floor: boolean(body, "requireFloor", true), require_zone: boolean(body, "requireZone"), require_office: boolean(body, "requireOffice"), allow_manual: boolean(body, "allowManual", true) }) });
    } else if (action === "archiveProject") {
      const projectId = value(body, "projectId"); if (!projectId) return Response.json({ error: "Project is required." }, { status: 400 });
      await supabaseRest(`projects?id=eq.${encodeURIComponent(projectId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
    } else if (action === "setProjectCategories") {
      const projectId = value(body, "projectId");
      const categoryIds = Array.isArray(body.categoryIds) ? Array.from(new Set(body.categoryIds.filter((item): item is string => typeof item === "string" && item.length > 0))) : [];
      if (!projectId || !categoryIds.length) return Response.json({ error: "Choose a project and at least one asset category." }, { status: 400 });
      await supabaseRest(`project_asset_categories?project_id=eq.${encodeURIComponent(projectId)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await supabaseRest("project_asset_categories", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(categoryIds.map(categoryId => ({ project_id: projectId, category_id: categoryId, active: true }))) });
    } else if (action === "saveAssetCategory") {
      const id = value(body, "id"); const labelAr = value(body, "labelAr"); const labelEn = value(body, "labelEn");
      const rawCode = value(body, "code", 64).toLowerCase(); const code = rawCode.replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
      const color = value(body, "color", 7).toUpperCase(); const life = Number(body.defaultUsefulLifeYears); const price = Number(body.defaultEstimatedPrice);
      if (!labelAr || !labelEn || !/^[a-z][a-z0-9_]{1,63}$/.test(code) || !/^#[0-9A-F]{6}$/.test(color)) return Response.json({ error: "Category names, valid code and color are required." }, { status: 400 });
      const technicalFields = Array.isArray(body.technicalFields) ? Array.from(new Set(body.technicalFields.map(item => typeof item === "string" ? item.trim().slice(0, 80) : "").filter(Boolean))).slice(0, 40) : [];
      const payload = { code, label_ar: labelAr, label_en: labelEn, color, icon: "", default_useful_life_years: Number.isFinite(life) && life > 0 ? life : null, default_estimated_price: Number.isFinite(price) && price >= 0 ? price : null, currency: value(body, "currency", 3).toUpperCase() || "AED", default_criticality_rating: null, technical_fields: technicalFields, active: true, sort_order: Math.max(0, Math.min(9999, Number(body.sortOrder) || 0)), updated_at: new Date().toISOString() };
      await supabaseRest(id ? `asset_categories?id=eq.${encodeURIComponent(id)}` : "asset_categories", auth.token, { method: id ? "PATCH" : "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "setAssetCategoryActive") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Asset category is required." }, { status: 400 });
      await supabaseRest(`asset_categories?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: boolean(body, "active"), updated_at: new Date().toISOString() }) });
    } else if (action === "deleteAssetCategory") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Asset category is required." }, { status: 400 });
      const linkedAssets = await supabaseRest<Array<{ id: string }>>(`assets?select=id&category_id=eq.${encodeURIComponent(id)}&limit=1`, auth.token);
      if (linkedAssets.length) return Response.json({ error: "This category is already used by assets. Disable it instead to preserve history." }, { status: 409 });
      await supabaseRest(`asset_categories?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } else if (action === "addBuilding" || action === "addFloor" || action === "addZone" || action === "addOffice") {
      const name = value(body, "name"); const buildingId = value(body, "buildingId"); const projectId = value(body, "projectId"); if (!name || (action === "addBuilding" ? !projectId : !buildingId)) return Response.json({ error: "Parent location and name are required." }, { status: 400 });
      const table = action === "addBuilding" ? "buildings" : action === "addFloor" ? "floors" : action === "addZone" ? "zones" : "offices";
      const payload = action === "addBuilding" ? { project_id: projectId, name } : action === "addFloor" ? { building_id: buildingId, name, sort_order: Number(body.sortOrder) || 0 } : action === "addZone" ? { building_id: buildingId, floor_id: value(body, "floorId") || null, name } : { building_id: buildingId, floor_id: value(body, "floorId") || null, zone_id: value(body, "zoneId") || null, name, active: true };
      await supabaseRest(table, auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "updateBuilding" || action === "updateFloor" || action === "updateZone" || action === "updateOffice") {
      const id = value(body, "id"); const name = value(body, "name"); if (!id || !name) return Response.json({ error: "Location and name are required." }, { status: 400 });
      const table = action === "updateBuilding" ? "buildings" : action === "updateFloor" ? "floors" : action === "updateZone" ? "zones" : "offices";
      const payload = action === "updateFloor" ? { name, sort_order: Number(body.sortOrder) || 0 } : action === "updateZone" ? { name, floor_id: value(body, "floorId") || null } : action === "updateOffice" ? { name, floor_id: value(body, "floorId") || null, zone_id: value(body, "zoneId") || null } : { name };
      await supabaseRest(`${table}?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "archiveBuilding") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Building is required." }, { status: 400 });
      await supabaseRest(`buildings?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
    } else if (action === "deleteFloor" || action === "deleteZone" || action === "deleteOffice") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Location is required." }, { status: 400 });
      await supabaseRest(`${action === "deleteFloor" ? "floors" : action === "deleteZone" ? "zones" : "offices"}?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } else if (action === "addLocationLevel" || action === "updateLocationLevel") {
      const projectId = value(body, "projectId");
      const id = value(body, "id");
      const labelAr = value(body, "labelAr");
      const labelEn = value(body, "labelEn");
      const rawKey = value(body, "key", 64).toLowerCase();
      const levelKey = rawKey.replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
      if (!labelAr || (action === "addLocationLevel" && (!projectId || !/^[a-z][a-z0-9_]{1,63}$/.test(levelKey))) || (action === "updateLocationLevel" && !id)) return Response.json({ error: "Project, Arabic label and a valid English key are required." }, { status: 400 });
      const parentLevelId = value(body, "parentLevelId", 80);
      let sortOrder = Math.max(0, Math.min(9999, Number(body.sortOrder) || 10));
      if (parentLevelId) {
        const parentRows = await supabaseRest<Array<{ project_id: string; sort_order: number }>>(`location_levels?select=project_id,sort_order&id=eq.${encodeURIComponent(parentLevelId)}&limit=1`, auth.token);
        const effectiveProjectId = action === "addLocationLevel" ? projectId : (await supabaseRest<Array<{ project_id: string }>>(`location_levels?select=project_id&id=eq.${encodeURIComponent(id)}&limit=1`, auth.token))[0]?.project_id;
        if (!parentRows[0] || parentRows[0].project_id !== effectiveProjectId) return Response.json({ error: "The preceding level must belong to the same project." }, { status: 400 });
        sortOrder = Math.max(sortOrder, parentRows[0].sort_order + 10);
      }
      const payload = { label_ar: labelAr, label_en: labelEn, required: boolean(body, "required"), sort_order: sortOrder, ...(action === "addLocationLevel" ? { project_id: projectId, level_key: levelKey, parent_level_id: parentLevelId || null, active: true } : {}) };
      await supabaseRest(action === "addLocationLevel" ? "location_levels" : `location_levels?id=eq.${encodeURIComponent(id)}`, auth.token, { method: action === "addLocationLevel" ? "POST" : "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "deleteLocationLevel") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Location level is required." }, { status: 400 });
      await supabaseRest(`location_levels?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } else if (action === "addLocationOption") {
      const levelId = value(body, "levelId"); const name = value(body, "name");
      if (!levelId || !name) return Response.json({ error: "Location level and option name are required." }, { status: 400 });
      const [level] = await supabaseRest<Array<{ parent_level_id: string | null }>>(`location_levels?select=parent_level_id&id=eq.${encodeURIComponent(levelId)}&limit=1`, auth.token);
      if (!level) return Response.json({ error: "This location level is unavailable." }, { status: 404 });
      const parentOptionId = value(body, "parentOptionId", 80);
      if (level.parent_level_id && !parentOptionId) return Response.json({ error: "Select the preceding location value first." }, { status: 400 });
      if (!level.parent_level_id && parentOptionId) return Response.json({ error: "This level does not use a preceding custom level." }, { status: 400 });
      await supabaseRest("location_options", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ level_id: levelId, building_id: value(body, "buildingId") || null, floor_id: value(body, "floorId") || null, zone_id: value(body, "zoneId") || null, office_id: value(body, "officeId") || null, parent_option_id: parentOptionId || null, name, active: true }) });
    } else if (action === "deleteLocationOption") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Location option is required." }, { status: 400 });
      await supabaseRest(`location_options?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } else if (action === "createUser" || action === "upsertUser") {
      const email = value(body, "email").toLowerCase(); const name = value(body, "name"); const requestedRole = value(body, "role", 40) as ActorRole;
      const role: ActorRole = isSuperAdminEmail(email) ? "admin" : ACTOR_ROLES.has(requestedRole) ? requestedRole : "viewer";
      const projectIds = Array.isArray(body.projectIds) ? body.projectIds.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean) : [];
      const password = value(body, "password", 128);
      if (!email || !email.includes("@")) return Response.json({ error: "A valid user email is required." }, { status: 400 });
      if (!name) return Response.json({ error: "User name is required." }, { status: 400 });
      if (action === "createUser" && !validPassword(password)) return Response.json({ error: "Password must be at least 10 characters and include uppercase, lowercase, number and symbol." }, { status: 400 });
      if (action === "createUser") assertSupabaseAdminConfigured();
      const targetUserId = value(body, "userId");
      const previousRows = action === "createUser"
        ? await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&email=eq.${encodeURIComponent(email)}&limit=1`, auth.token)
        : await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&id=eq.${encodeURIComponent(targetUserId)}&limit=1`, auth.token);
      if (action === "createUser" && previousRows[0]?.user_id) return Response.json({ error: "A login account already exists for this email." }, { status: 409 });
      if (action === "upsertUser" && !previousRows[0]) return Response.json({ error: "The user account was not found." }, { status: 404 });
      if (action === "upsertUser" && isSuperAdminEmail(previousRows[0].email) && previousRows[0].email !== email) return Response.json({ error: "The super administrator identity cannot be changed." }, { status: 409 });
      if (action === "upsertUser" && previousRows[0].user_id && (previousRows[0].email !== email || previousRows[0].name !== name)) {
        assertSupabaseAdminConfigured();
        await updateSupabaseUserIdentity(previousRows[0].user_id, email, name);
      }
      const rows = action === "createUser"
        ? await supabaseRest<Actor[]>("app_users?on_conflict=email", auth.token, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ email, name, role, active: true }) })
        : await supabaseRest<Actor[]>(`app_users?id=eq.${encodeURIComponent(targetUserId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ email, name, role, active: true }) });
      const appUserId = rows[0]?.id; if (!appUserId) throw new Error("The user profile could not be saved.");
      // Pre-approve the profile first; migration 007 then links the Auth row.
      if (action === "createUser" && !rows[0]?.user_id) {
        try { await createSupabasePasswordUser(email, name, password); }
        catch (reason) {
          if (!previousRows[0]) await supabaseRest(`app_users?id=eq.${encodeURIComponent(appUserId)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => undefined);
          else await supabaseRest(`app_users?id=eq.${encodeURIComponent(appUserId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name: previousRows[0].name, role: previousRows[0].role, active: previousRows[0].active }) }).catch(() => undefined);
          throw reason;
        }
      }
      await supabaseRest(`user_projects?app_user_id=eq.${encodeURIComponent(appUserId)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (projectIds.length) await supabaseRest("user_projects", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(projectIds.map(projectId => ({ app_user_id: appUserId, project_id: projectId }))) });
      const permissions = normalizeModulePermissions(body.modulePermissions, role, isSuperAdminEmail(email));
      await supabaseRest(`user_module_permissions?app_user_id=eq.${encodeURIComponent(appUserId)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await supabaseRest("user_module_permissions", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(permissions.map((permission: ModulePermission) => ({ app_user_id: appUserId, module_key: permission.module, can_view: permission.view, can_create: permission.create, can_edit: permission.edit, can_delete: permission.delete, can_approve: permission.approve, can_export: permission.export }))) });
    } else if (action === "setUserActive") {
      const userId = value(body, "userId"); if (!userId) return Response.json({ error: "User is required." }, { status: 400 });
      if (userId === auth.actor.id && !boolean(body, "active")) return Response.json({ error: "You cannot disable your own administrator account." }, { status: 409 });
      const target = await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&id=eq.${encodeURIComponent(userId)}&limit=1`, auth.token);
      if (isSuperAdminEmail(target[0]?.email) && !boolean(body, "active")) return Response.json({ error: "The super administrator account cannot be disabled." }, { status: 409 });
      await supabaseRest(`app_users?id=eq.${encodeURIComponent(userId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: boolean(body, "active") }) });
    } else if (action === "resetUserPassword") {
      const userId = value(body, "userId");
      if (!userId) return Response.json({ error: "User is required." }, { status: 400 });
      const password = value(body, "password", 128);
      if (!validPassword(password)) return Response.json({ error: "Password must be at least 10 characters and include uppercase, lowercase, number and symbol." }, { status: 400 });
      const target = await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&id=eq.${encodeURIComponent(userId)}&limit=1`, auth.token);
      if (!target[0]?.user_id) return Response.json({ error: "This profile has no login account yet." }, { status: 409 });
      await updateSupabaseUserPassword(target[0].user_id, password);
    } else if (action === "createConfigDraft") {
      const projectId = value(body, "projectId"); if (!projectId) return Response.json({ error: "Choose a project first." }, { status: 400 });
      await supabaseRest("rpc/create_survey_config_draft", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ target_project_id: projectId }) });
    } else if (action === "saveCustomField") {
      const configId = value(body, "configId"); const fieldId = value(body, "fieldId"); const key = value(body, "key", 64).toLowerCase(); const labelAr = value(body, "labelAr"); const labelEn = value(body, "labelEn"); const requestedType = value(body, "type", 20) as FieldType;
      if (!configId || !labelAr || !FIELD_TYPES.has(requestedType)) return Response.json({ error: "Draft, Arabic label and a valid field type are required." }, { status: 400 });
      const drafts = await supabaseRest<ConfigRow[]>(`survey_config_versions?select=id,project_id,version,status,created_at,published_at&id=eq.${encodeURIComponent(configId)}&status=eq.draft&limit=1`, auth.token);
      if (!drafts[0]) return Response.json({ error: "Only a draft configuration can be edited." }, { status: 409 });
      let finalKey = key;
      if (fieldId) { const existing = await supabaseRest<FieldRow[]>(`custom_fields?select=id,config_id,field_key,label_ar,label_en,section,field_type,enabled,required,option_values,sort_order,help_text_ar,help_text_en&id=eq.${encodeURIComponent(fieldId)}&config_id=eq.${encodeURIComponent(configId)}&limit=1`, auth.token); if (!existing[0]) return Response.json({ error: "The field is not part of this draft." }, { status: 404 }); finalKey = existing[0].field_key; }
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(finalKey)) return Response.json({ error: "Field key must use lowercase letters, numbers and underscores." }, { status: 400 });
      const options = normalizedOptions(body.options); if (requestedType === "select" && !options.length) return Response.json({ error: "Add at least one option for a list field." }, { status: 400 });
      const assetTypes = Array.isArray(body.assetTypes) ? Array.from(new Set(body.assetTypes.map(item => typeof item === "string" ? item.trim().slice(0, 80) : "").filter(Boolean))).slice(0, 30) : [];
      const payload = { config_id: configId, field_key: finalKey, label_ar: labelAr, label_en: labelEn, section: "survey", field_type: requestedType, enabled: boolean(body, "enabled", true), required: boolean(body, "required"), option_values: requestedType === "select" ? options : [], sort_order: Math.max(0, Math.min(9999, Number(body.sortOrder) || 0)), help_text_ar: value(body, "helpAr", 400), help_text_en: value(body, "helpEn", 400), asset_types: assetTypes, unit: value(body, "unit", 40), ai_extract: boolean(body, "aiExtract"), show_in_reports: boolean(body, "showInReports", true), show_in_qr: boolean(body, "showInQr", true) };
      await supabaseRest(fieldId ? `custom_fields?id=eq.${encodeURIComponent(fieldId)}&config_id=eq.${encodeURIComponent(configId)}` : "custom_fields", auth.token, { method: fieldId ? "PATCH" : "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "setCustomFieldEnabled") {
      const configId = value(body, "configId"); const fieldId = value(body, "fieldId"); if (!configId || !fieldId) return Response.json({ error: "Draft and field are required." }, { status: 400 });
      await supabaseRest(`custom_fields?id=eq.${encodeURIComponent(fieldId)}&config_id=eq.${encodeURIComponent(configId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ enabled: boolean(body, "enabled") }) });
    } else if (action === "addSuggestedFields") {
      const configId = value(body, "configId"); if (!configId) return Response.json({ error: "Create a draft first." }, { status: 400 });
      const drafts = await supabaseRest<ConfigRow[]>(`survey_config_versions?select=id,project_id,version,status,created_at,published_at&id=eq.${encodeURIComponent(configId)}&status=eq.draft&limit=1`, auth.token);
      if (!drafts[0]) return Response.json({ error: "Only a draft configuration can be edited." }, { status: 409 });
      await supabaseRest("custom_fields?on_conflict=config_id,field_key", auth.token, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(SUGGESTED_FIELDS.map(field => ({ config_id: configId, ...field, section: "survey", enabled: true, help_text_ar: "", help_text_en: "" }))) });
    } else if (action === "publishConfig") {
      const configId = value(body, "configId"); if (!configId) return Response.json({ error: "Choose a draft to publish." }, { status: 400 });
      await supabaseRest("rpc/publish_survey_config", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ target_config_id: configId }) });
    } else return Response.json({ error: "Unsupported administration action." }, { status: 400 });
    const snapshot = await optimizedConfig(auth.token, "admin");
    const config = await attachAssetCategories(snapshot?.actor ? assembleConfig(snapshot) : await configFor(auth.actor, auth.token), auth.token);
    return Response.json(config);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The change could not be saved." }, { status: 500 }); }
}
