import { requestToken, sendSupabaseMagicLink, supabaseRest, verifyAuthUser } from "../../lib/server/supabase";

export const runtime = "nodejs";

type Actor = { id: string; user_id: string | null; email: string; name: string; role: "admin" | "surveyor"; active: boolean };
type ProjectRow = { id: string; name: string; require_building: boolean; require_floor: boolean; require_zone: boolean; allow_manual: boolean };
type BuildingRow = { id: string; project_id: string; name: string };
type FloorRow = { id: string; building_id: string; name: string; sort_order: number };
type ZoneRow = { id: string; building_id: string; floor_id: string | null; name: string };
type AssignmentRow = { app_user_id: string; project_id: string };
type ConfigRow = { id: string; project_id: string; version: number; status: "draft" | "published" | "archived"; created_at: string; published_at: string | null };
type FieldType = "text" | "textarea" | "number" | "date" | "select" | "boolean";
type FieldRow = { id: string; config_id: string; field_key: string; label_ar: string; label_en: string; section: string; field_type: FieldType; enabled: boolean; required: boolean; option_values: unknown; sort_order: number; help_text_ar: string; help_text_en: string };
type AuditRow = { id: number; actor_email: string; action: string; entity_type: string; entity_id: string | null; project_id: string | null; details: Record<string, unknown>; created_at: string };
type ConfigScope = "structure" | "capture" | "admin";
type ConfigSnapshot = {
  actor: Actor | null;
  projects: ProjectRow[];
  buildings: BuildingRow[];
  floors: FloorRow[];
  zones: ZoneRow[];
  configs: ConfigRow[];
  fields: FieldRow[];
  users: Actor[];
  assignments: AssignmentRow[];
  auditLogs: AuditRow[];
};

async function actorFor(request: Request) {
  const token = requestToken(request); const authUser = await verifyAuthUser(token);
  if (!authUser) return null;
  const actors = await supabaseRest<Actor[]>(`app_users?select=id,user_id,email,name,role,active&user_id=eq.${encodeURIComponent(authUser.id)}&active=eq.true&limit=1`, token);
  return actors[0] ? { actor: actors[0], token } : null;
}

function mapField(field: FieldRow) {
  return { id: field.id, key: field.field_key, labelAr: field.label_ar, labelEn: field.label_en, section: field.section, type: field.field_type, enabled: field.enabled, required: field.required, options: normalizedOptions(field.option_values), sortOrder: field.sort_order, helpAr: field.help_text_ar, helpEn: field.help_text_en };
}

function grouped<T, K>(rows: T[], key: (row: T) => K) {
  const result = new Map<K, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) || []), row]);
  return result;
}

function assembleConfig(snapshot: ConfigSnapshot) {
  const { actor, projects: projectRows, buildings, floors, zones, configs, fields, users, assignments, auditLogs } = snapshot;
  if (!actor) throw new Error("Unauthorized.");
  const allowedIds = new Set(projectRows.map(project => project.id));
  const allowedBuildings = buildings.filter(row => allowedIds.has(row.project_id));
  const buildingIds = new Set(allowedBuildings.map(building => building.id));
  const allowedFloors = floors.filter(row => buildingIds.has(row.building_id));
  const allowedZones = zones.filter(row => buildingIds.has(row.building_id));
  const buildingsByProject = grouped(allowedBuildings, row => row.project_id);
  const floorsByBuilding = grouped(allowedFloors, row => row.building_id);
  const zonesByBuilding = grouped(allowedZones, row => row.building_id);
  const configsByProject = grouped([...configs].sort((left, right) => right.version - left.version), row => row.project_id);
  const fieldsByConfig = grouped(fields, row => row.config_id);
  const assignmentsByUser = grouped(assignments, row => row.app_user_id);
  const projects = projectRows.map(project => {
    const projectConfigs = configsByProject.get(project.id) || [];
    const published = projectConfigs.find(config => config.status === "published");
    const draft = actor.role === "admin" ? projectConfigs.find(config => config.status === "draft") : undefined;
    return {
      id: project.id, name: project.name, requireBuilding: project.require_building, requireFloor: project.require_floor, requireZone: project.require_zone, allowManual: project.allow_manual,
      publishedConfig: published ? { id: published.id, version: published.version, publishedAt: published.published_at } : null,
      customFields: published ? (fieldsByConfig.get(published.id) || []).filter(field => field.enabled).map(mapField) : [],
      draftConfig: draft ? { id: draft.id, version: draft.version, fields: (fieldsByConfig.get(draft.id) || []).map(mapField) } : null,
      buildings: (buildingsByProject.get(project.id) || []).map(building => ({
        id: building.id,
        name: building.name,
        floors: (floorsByBuilding.get(building.id) || []).map(floor => ({ id: floor.id, name: floor.name, sortOrder: floor.sort_order })),
        zones: (zonesByBuilding.get(building.id) || []).map(zone => ({ id: zone.id, floorId: zone.floor_id, name: zone.name })),
      })),
    };
  });
  return {
    currentUser: { id: actor.id, email: actor.email, name: actor.name, role: actor.role },
    projects,
    users: users.map(user => ({ ...user, projectIds: (assignmentsByUser.get(user.id) || []).map(item => item.project_id) })),
    auditLogs,
  };
}

async function configFor(actor: Actor, token: string, scope: ConfigScope = "admin") {
  const [projectRows, buildings, floors, zones] = await Promise.all([
    supabaseRest<ProjectRow[]>("projects?select=id,name,require_building,require_floor,require_zone,allow_manual&active=eq.true&order=name", token),
    supabaseRest<BuildingRow[]>("buildings?select=id,project_id,name&active=eq.true&order=name", token),
    supabaseRest<FloorRow[]>("floors?select=id,building_id,name,sort_order&order=sort_order,name", token),
    supabaseRest<ZoneRow[]>("zones?select=id,building_id,floor_id,name&order=name", token),
  ]);
  const [configs, fields] = scope === "structure" ? [[], []] as [ConfigRow[], FieldRow[]] : await Promise.all([
    supabaseRest<ConfigRow[]>("survey_config_versions?select=id,project_id,version,status,created_at,published_at&order=version.desc", token),
    supabaseRest<FieldRow[]>("custom_fields?select=id,config_id,field_key,label_ar,label_en,section,field_type,enabled,required,option_values,sort_order,help_text_ar,help_text_en&order=sort_order,field_key", token),
  ]);
  const [users, assignments, auditLogs] = actor.role === "admin" && scope === "admin" ? await Promise.all([
    supabaseRest<Actor[]>("app_users?select=id,user_id,email,name,role,active&order=role,name,email", token),
    supabaseRest<AssignmentRow[]>("user_projects?select=app_user_id,project_id", token),
    supabaseRest<AuditRow[]>("audit_logs?select=id,actor_email,action,entity_type,entity_id,project_id,details,created_at&order=created_at.desc&limit=100", token),
  ]) : [[], [], []] as [Actor[], AssignmentRow[], AuditRow[]];
  return assembleConfig({ actor, projects: projectRows, buildings, floors, zones, configs, fields, users, assignments, auditLogs });
}

async function optimizedConfig(token: string, scope: ConfigScope) {
  return supabaseRest<ConfigSnapshot>("rpc/assetlens_config_snapshot", token, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ include_forms: scope !== "structure", include_admin: scope === "admin" }),
  }).catch(() => null);
}

function value(body: Record<string, unknown>, key: string, max = 160) { return typeof body[key] === "string" ? body[key].trim().slice(0, max) : ""; }
function boolean(body: Record<string, unknown>, key: string, fallback = false) { return typeof body[key] === "boolean" ? body[key] : fallback; }
const FIELD_TYPES = new Set<FieldType>(["text", "textarea", "number", "date", "select", "boolean"]);
const SUGGESTED_FIELDS = [
  { field_key: "room", label_ar: "الغرفة", label_en: "Room", field_type: "text", required: false, option_values: [], sort_order: 10 },
  { field_key: "section", label_ar: "القسم / المنطقة", label_en: "Section", field_type: "text", required: false, option_values: [], sort_order: 20 },
  { field_key: "asset_condition", label_ar: "حالة الأصل الفنية", label_en: "Asset Condition", field_type: "select", required: false, option_values: [{ code: "excellent", labelAr: "ممتازة", labelEn: "Excellent" }, { code: "good", labelAr: "جيدة", labelEn: "Good" }, { code: "fair", labelAr: "متوسطة", labelEn: "Fair" }, { code: "poor", labelAr: "ضعيفة", labelEn: "Poor" }, { code: "damaged", labelAr: "تالفة", labelEn: "Damaged" }], sort_order: 30 },
  { field_key: "asset_status", label_ar: "حالة تشغيل الأصل", label_en: "Asset Status", field_type: "select", required: false, option_values: [{ code: "active", labelAr: "يعمل", labelEn: "Active" }, { code: "inactive", labelAr: "متوقف", labelEn: "Inactive" }, { code: "maintenance", labelAr: "تحت الصيانة", labelEn: "Under Maintenance" }, { code: "disposed", labelAr: "مستبعد", labelEn: "Disposed" }], sort_order: 40 },
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
      return Response.json(assembleConfig(snapshot), { headers: { "Cache-Control": scope === "admin" ? "private, max-age=20" : "private, max-age=60, stale-while-revalidate=300" } });
    }
    const auth = await actorFor(request);
    if (!auth) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
    return Response.json(await configFor(auth.actor, auth.token, scope), { headers: { "Cache-Control": scope === "admin" ? "private, max-age=20" : "private, max-age=60, stale-while-revalidate=300" } });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load configuration." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const auth = await actorFor(request);
    if (!auth) return Response.json({ error: "Sign in with an authorized AssetLens AI account." }, { status: 401 });
    if (auth.actor.role !== "admin") return Response.json({ error: "Administrator permission is required." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>; const action = value(body, "action", 50);
    if (action === "createProject") {
      const name = value(body, "name"); if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
      const existing = await supabaseRest<Array<{ id: string }>>(`projects?select=id&name=eq.${encodeURIComponent(name)}&limit=1`, auth.token);
      if (!existing.length) {
        const created = await supabaseRest<Array<{ id: string }>>("projects", auth.token, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name, require_building: boolean(body, "requireBuilding", true), require_floor: boolean(body, "requireFloor", true), require_zone: boolean(body, "requireZone"), allow_manual: boolean(body, "allowManual", true) }) });
        if (created[0]?.id) await supabaseRest("survey_config_versions", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ project_id: created[0].id, version: 1, status: "published", published_at: new Date().toISOString() }) });
      }
    } else if (action === "updateProject") {
      const projectId = value(body, "projectId"); const name = value(body, "name"); if (!projectId || !name) return Response.json({ error: "Project and name are required." }, { status: 400 });
      await supabaseRest(`projects?id=eq.${encodeURIComponent(projectId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name, require_building: boolean(body, "requireBuilding", true), require_floor: boolean(body, "requireFloor", true), require_zone: boolean(body, "requireZone"), allow_manual: boolean(body, "allowManual", true) }) });
    } else if (action === "archiveProject") {
      const projectId = value(body, "projectId"); if (!projectId) return Response.json({ error: "Project is required." }, { status: 400 });
      await supabaseRest(`projects?id=eq.${encodeURIComponent(projectId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
    } else if (action === "addBuilding" || action === "addFloor" || action === "addZone") {
      const name = value(body, "name"); const buildingId = value(body, "buildingId"); const projectId = value(body, "projectId"); if (!name || (action === "addBuilding" ? !projectId : !buildingId)) return Response.json({ error: "Parent location and name are required." }, { status: 400 });
      const table = action === "addBuilding" ? "buildings" : action === "addFloor" ? "floors" : "zones";
      const payload = action === "addBuilding" ? { project_id: projectId, name } : action === "addFloor" ? { building_id: buildingId, name, sort_order: Number(body.sortOrder) || 0 } : { building_id: buildingId, floor_id: value(body, "floorId") || null, name };
      await supabaseRest(table, auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "updateBuilding" || action === "updateFloor" || action === "updateZone") {
      const id = value(body, "id"); const name = value(body, "name"); if (!id || !name) return Response.json({ error: "Location and name are required." }, { status: 400 });
      const table = action === "updateBuilding" ? "buildings" : action === "updateFloor" ? "floors" : "zones";
      const payload = action === "updateFloor" ? { name, sort_order: Number(body.sortOrder) || 0 } : action === "updateZone" ? { name, floor_id: value(body, "floorId") || null } : { name };
      await supabaseRest(`${table}?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
    } else if (action === "archiveBuilding") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Building is required." }, { status: 400 });
      await supabaseRest(`buildings?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }) });
    } else if (action === "deleteFloor" || action === "deleteZone") {
      const id = value(body, "id"); if (!id) return Response.json({ error: "Location is required." }, { status: 400 });
      await supabaseRest(`${action === "deleteFloor" ? "floors" : "zones"}?id=eq.${encodeURIComponent(id)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    } else if (action === "upsertUser") {
      const email = value(body, "email").toLowerCase(); const name = value(body, "name"); const role = body.role === "admin" ? "admin" : "surveyor";
      const projectIds = Array.isArray(body.projectIds) ? body.projectIds.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean) : [];
      if (!email || !email.includes("@")) return Response.json({ error: "A valid user email is required." }, { status: 400 });
      const rows = await supabaseRest<Actor[]>("app_users?on_conflict=email", auth.token, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ email, name, role, active: true }) });
      const appUserId = rows[0]?.id; if (!appUserId) throw new Error("The user profile could not be saved.");
      await supabaseRest(`user_projects?app_user_id=eq.${encodeURIComponent(appUserId)}`, auth.token, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (projectIds.length) await supabaseRest("user_projects", auth.token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(projectIds.map(projectId => ({ app_user_id: appUserId, project_id: projectId }))) });
    } else if (action === "setUserActive") {
      const userId = value(body, "userId"); if (!userId) return Response.json({ error: "User is required." }, { status: 400 });
      if (userId === auth.actor.id && !boolean(body, "active")) return Response.json({ error: "You cannot disable your own administrator account." }, { status: 409 });
      await supabaseRest(`app_users?id=eq.${encodeURIComponent(userId)}`, auth.token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: boolean(body, "active") }) });
    } else if (action === "inviteUser") {
      const email = value(body, "email").toLowerCase(); const name = value(body, "name"); if (!email || !email.includes("@")) return Response.json({ error: "A valid user email is required." }, { status: 400 });
      await sendSupabaseMagicLink(email, name);
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
      const payload = { config_id: configId, field_key: finalKey, label_ar: labelAr, label_en: labelEn, section: "survey", field_type: requestedType, enabled: boolean(body, "enabled", true), required: boolean(body, "required"), option_values: requestedType === "select" ? options : [], sort_order: Math.max(0, Math.min(9999, Number(body.sortOrder) || 0)), help_text_ar: value(body, "helpAr", 400), help_text_en: value(body, "helpEn", 400) };
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
    return Response.json(snapshot?.actor ? assembleConfig(snapshot) : await configFor(auth.actor, auth.token));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The change could not be saved." }, { status: 500 }); }
}
