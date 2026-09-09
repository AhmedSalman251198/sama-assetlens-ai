"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";
import { defaultModulePermissions, MODULE_LABELS, ModuleAction, ModulePermission } from "../lib/module-permissions";

type Floor = { id: string; name: string; sortOrder: number };
type Zone = { id: string; floorId: string | null; name: string };
type Office = { id: string; floorId: string | null; zoneId: string | null; name: string };
type LocationOption = { id: string; buildingId: string | null; floorId: string | null; zoneId: string | null; name: string };
type LocationLevel = { id: string; key: string; labelAr: string; labelEn: string; required: boolean; sortOrder: number; options: LocationOption[] };
type Building = { id: string; name: string; floors: Floor[]; zones: Zone[]; offices: Office[] };
type UserRole = "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
type FieldType = "text" | "textarea" | "number" | "date" | "select" | "boolean";
type CustomOption = { code: string; labelAr: string; labelEn: string };
type CustomField = { id: string; key: string; labelAr: string; labelEn: string; type: FieldType; enabled: boolean; required: boolean; options: CustomOption[]; sortOrder: number; helpAr: string; helpEn: string; assetTypes: string[]; unit: string; aiExtract: boolean; showInReports: boolean; showInQr: boolean };
type Project = { id: string; name: string; requireBuilding: boolean; requireFloor: boolean; requireZone: boolean; requireOffice: boolean; allowManual: boolean; buildings: Building[]; locationLevels: LocationLevel[]; publishedConfig: { id: string; version: number; publishedAt: string | null } | null; customFields: CustomField[]; draftConfig: { id: string; version: number; fields: CustomField[] } | null };
type User = { id: string; user_id: string | null; email: string; name: string; role: UserRole; active: boolean; projectIds: string[]; modulePermissions: ModulePermission[] };
type AuditLog = { id: number; actor_email: string; action: string; entity_type: string; entity_id: string | null; project_id: string | null; details: { asset_no?: string; status?: string; name?: string; active?: boolean }; created_at: string };
type Config = { currentUser: { id: string; email: string; name: string; role: UserRole; isSuperAdmin: boolean; modulePermissions: ModulePermission[] }; projects: Project[]; users: User[]; auditLogs: AuditLog[] };
type AdminDialog = { mode: "rename" | "confirm"; title: string; description: string; action: "archiveProject" | "updateBuilding" | "updateFloor" | "updateZone" | "updateOffice" | "archiveBuilding" | "deleteFloor" | "deleteZone" | "deleteOffice" | "deleteLocationLevel" | "deleteLocationOption"; id: string; value: string; extra?: Record<string, unknown> };

const requirementOptions = [
  { key: "requireBuilding", label: "المبنى / الموقع", hint: "يجب تحديد موقع الأصل" },
  { key: "requireFloor", label: "الطابق", hint: "يجب تحديد الطابق" },
  { key: "requireZone", label: "الزون / المنطقة", hint: "يجب تحديد الزون" },
  { key: "allowManual", label: "السماح بالإدخال اليدوي", hint: "عند عدم وجود القيمة في القائمة" },
] as const;

const successMessages: Record<string, string> = {
    createProject: "تم حفظ المشروع بنجاح.", updateProject: "تم تعديل المشروع ومتطلبات المسح.", archiveProject: "تمت أرشفة المشروع مع الحفاظ على سجلات أصوله.", addBuilding: "تمت إضافة المبنى / الموقع.", addFloor: "تمت إضافة الطابق.", addZone: "تمت إضافة الزون.", addOffice: "تمت إضافة المكتب / الغرفة.", updateBuilding: "تم تعديل اسم المبنى.", updateFloor: "تم تعديل الطابق.", updateZone: "تم تعديل الزون.", updateOffice: "تم تعديل المكتب.", archiveBuilding: "تمت أرشفة المبنى.", deleteFloor: "تم حذف الطابق.", deleteZone: "تم حذف الزون.", deleteOffice: "تم حذف المكتب.", addLocationLevel: "تمت إضافة مستوى مكاني مخصص.", updateLocationLevel: "تم تحديث المستوى المكاني.", deleteLocationLevel: "تم حذف المستوى مع الاحتفاظ بقيم الأصول السابقة.", addLocationOption: "تمت إضافة قيمة للمستوى المكاني.", deleteLocationOption: "تم حذف القيمة مع الاحتفاظ بسجلات الأصول السابقة.", createUser: "تم إنشاء الحساب ويمكن للمستخدم الدخول فورًا.", upsertUser: "تم حفظ المستخدم وصلاحياته.", setUserActive: "تم تحديث حالة المستخدم.", resetUserPassword: "تم تغيير كلمة مرور المستخدم.", createConfigDraft: "تم إنشاء مسودة من النسخة المنشورة.", saveCustomField: "تم حفظ الحقل داخل المسودة.", setCustomFieldEnabled: "تم تحديث حالة الحقل.", addSuggestedFields: "تمت إضافة حقول المسح والموبايل المقترحة إلى المسودة.", publishConfig: "تم نشر إعدادات المسح الجديدة.",
};

const roleLabels: Record<UserRole, string> = { admin: "مدير النظام", project_manager: "مدير مشروع", reviewer: "مراجع", surveyor: "مسّاح ميداني", viewer: "مشاهد فقط" };
const roleDescriptions: Record<UserRole, string> = { admin: "كل المشاريع والإعدادات، دون إدارة الحسابات إلا للسوبر أدمن.", project_manager: "إدارة الأصول والمراجعة والنقل في المشاريع المحددة.", reviewer: "مراجعة واعتماد أصول المشاريع المحددة.", surveyor: "التقاط وإضافة أصول المشاريع المحددة.", viewer: "قراءة الداشبورد والتقارير دون تعديل." };

const fieldTypeLabels: Record<FieldType, string> = { text: "نص قصير", textarea: "نص طويل", number: "رقم", date: "تاريخ", select: "قائمة خيارات", boolean: "نعم / لا" };
const blankField = { id: "", key: "", labelAr: "", labelEn: "", type: "text" as FieldType, required: false, enabled: true, optionsText: "", sortOrder: 10, helpAr: "", helpEn: "", assetTypesText: "", unit: "", aiExtract: false, showInReports: true, showInQr: true };

async function readApiPayload<T extends { error?: string }>(response: Response) {
  const responseText = await response.text();
  if (!responseText) throw new Error(`الخادم أعاد استجابة فارغة (${response.status}). حاول مرة أخرى.`);
  try { return JSON.parse(responseText) as T; }
  catch { throw new Error(`تعذر قراءة استجابة الخادم (${response.status}). حاول مرة أخرى.`); }
}

export default function AdminPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [requirements, setRequirements] = useState({ requireBuilding: true, requireFloor: true, requireZone: false, requireOffice: false, allowManual: true });
  const [editProjectName, setEditProjectName] = useState("");
  const [editRequirements, setEditRequirements] = useState({ requireBuilding: true, requireFloor: true, requireZone: false, requireOffice: false, allowManual: true });
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [officeZoneId, setOfficeZoneId] = useState("");
  const [locationLevelLabelAr, setLocationLevelLabelAr] = useState("");
  const [locationLevelLabelEn, setLocationLevelLabelEn] = useState("");
  const [locationLevelKey, setLocationLevelKey] = useState("");
  const [locationLevelRequired, setLocationLevelRequired] = useState(false);
  const [locationLevelId, setLocationLevelId] = useState("");
  const [locationOptionName, setLocationOptionName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("surveyor");
  const [userPassword, setUserPassword] = useState("");
  const [userPasswordConfirm, setUserPasswordConfirm] = useState("");
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [userModulePermissions, setUserModulePermissions] = useState<ModulePermission[]>(() => defaultModulePermissions("surveyor"));
  const [userProjects, setUserProjects] = useState<string[]>([]);
  const [editingUserId, setEditingUserId] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [replacementPassword, setReplacementPassword] = useState("");
  const [replacementPasswordConfirm, setReplacementPasswordConfirm] = useState("");
  const [fieldDraft, setFieldDraft] = useState(blankField);
  const [auditFilter, setAuditFilter] = useState<"assets" | "all">("assets");
  const [dialog, setDialog] = useState<AdminDialog | null>(null);

  useEffect(() => { void (async () => {
    try {
      const payload = await apiGet<Config>("/api/config", { ttlMs: 60_000 });
      setConfig(payload);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) { window.location.replace("/login"); return; }
      setError(err instanceof Error ? err.message : "تعذر تحميل بيانات لوحة الإدارة.");
    }
  })(); }, []);
  useEffect(() => {
    if (!dialog) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setDialog(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dialog, busy]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getAccessToken();
      if (!token) { window.location.replace("/login"); return false; }
      const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      const result = await readApiPayload<Config & { error?: string }>(response);
      if (response.status === 401) { window.location.replace("/login"); return false; }
      if (!response.ok) throw new Error(result.error || "تعذر حفظ التغيير.");
      invalidateApiCache();
      setConfig(result); setNotice(successMessages[String(payload.action)] || "تم حفظ التغيير بنجاح.");
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "تعذر حفظ التغيير."); return false; }
    finally { setBusy(false); }
  }

  const project = config?.projects.find(item => item.id === projectId);
  const building = project?.buildings.find(item => item.id === buildingId);
  const filteredAuditLogs = config?.auditLogs.filter(log => auditFilter === "all" || log.entity_type === "assets") || [];
  const totals = useMemo(() => ({ projects: config?.projects.length || 0, buildings: config?.projects.reduce((sum, item) => sum + item.buildings.length, 0) || 0, users: config?.users.length || 0 }), [config]);

  function selectProject(id: string) {
    setProjectId(id); setBuildingId(""); setFloorId(""); setOfficeZoneId(""); setLocationLevelId(""); setFieldDraft(blankField);
    const selected = config?.projects.find(item => item.id === id);
    setEditProjectName(selected?.name || "");
    if (selected) setEditRequirements({ requireBuilding: selected.requireBuilding, requireFloor: selected.requireFloor, requireZone: selected.requireZone, requireOffice: selected.requireOffice, allowManual: selected.allowManual });
  }

  async function createProject(event: FormEvent) { event.preventDefault(); if (projectName.trim() && await post({ action: "createProject", name: projectName, ...requirements })) setProjectName(""); }
  async function updateProject(event: FormEvent) { event.preventDefault(); if (project && editProjectName.trim()) await post({ action: "updateProject", projectId: project.id, name: editProjectName, ...editRequirements }); }
  async function archiveProject() {
    if (!project) return;
    setDialog({ mode: "confirm", title: `أرشفة مشروع ${project.name}`, description: "سيتم إخفاء المشروع من القوائم مع الاحتفاظ بجميع الأصول وسجل التدقيق.", action: "archiveProject", id: project.id, value: project.name });
  }
  async function addBuilding(event: FormEvent) { event.preventDefault(); if (await post({ action: "addBuilding", projectId, name: buildingName })) setBuildingName(""); }
  async function addFloor(event: FormEvent) { event.preventDefault(); if (await post({ action: "addFloor", buildingId, name: floorName, sortOrder: (building?.floors.length || 0) + 1 })) setFloorName(""); }
  async function addZone(event: FormEvent) { event.preventDefault(); if (await post({ action: "addZone", buildingId, floorId, name: zoneName })) setZoneName(""); }
  async function addLocationLevel(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "addLocationLevel", projectId, key: locationLevelKey, labelAr: locationLevelLabelAr, labelEn: locationLevelLabelEn, required: locationLevelRequired, sortOrder: (project?.locationLevels.length || 0) * 10 + 10 })) {
      setLocationLevelLabelAr(""); setLocationLevelLabelEn(""); setLocationLevelKey(""); setLocationLevelRequired(false);
    }
  }
  async function addLocationOption(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "addLocationOption", levelId: locationLevelId, buildingId, floorId, zoneId: officeZoneId, name: locationOptionName })) setLocationOptionName("");
  }
  async function saveUser(event: FormEvent) {
    event.preventDefault();
    const action = editingUserId ? "upsertUser" : "createUser";
    if (!editingUserId && userPassword !== userPasswordConfirm) { setError("كلمتا المرور غير متطابقتين."); return; }
    if (await post({ action, email: userEmail, name: userName, role: userRole, password: editingUserId ? undefined : userPassword, projectIds: userProjects, modulePermissions: userModulePermissions })) resetUserForm();
  }
  function resetUserForm() { setEditingUserId(""); setUserEmail(""); setUserName(""); setUserRole("surveyor"); setUserPassword(""); setUserPasswordConfirm(""); setShowUserPassword(false); setUserModulePermissions(defaultModulePermissions("surveyor")); setUserProjects([]); }
  function editUser(user: User) { setEditingUserId(user.id); setUserEmail(user.email); setUserName(user.name); setUserRole(user.role); setUserPassword(""); setUserPasswordConfirm(""); setUserModulePermissions(user.modulePermissions?.length ? user.modulePermissions : defaultModulePermissions(user.role)); setUserProjects(user.projectIds); document.getElementById("users")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function setModulePermission(index: number, action: ModuleAction, checked: boolean) {
    setUserModulePermissions(current => current.map((permission, itemIndex) => {
      if (itemIndex !== index) return permission;
      if (action === "view" && !checked) return { ...permission, view: false, create: false, edit: false, delete: false, approve: false, export: false };
      return { ...permission, view: action === "view" ? checked : checked || permission.view, [action]: checked };
    }));
  }
  async function saveReplacementPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;
    if (replacementPassword !== replacementPasswordConfirm) { setError("كلمتا المرور غير متطابقتين."); return; }
    if (await post({ action: "resetUserPassword", userId: passwordTarget.id, password: replacementPassword })) {
      setPasswordTarget(null); setReplacementPassword(""); setReplacementPasswordConfirm("");
    }
  }
  async function renameLocation(action: "updateBuilding" | "updateFloor" | "updateZone" | "updateOffice", id: string, currentName: string, extra: Record<string, unknown> = {}) {
    setDialog({ mode: "rename", title: "تعديل اسم الموقع", description: "اكتب الاسم الجديد ثم احفظ التغيير.", action, id, value: currentName, extra });
  }
  async function removeLocation(action: "archiveBuilding" | "deleteFloor" | "deleteZone" | "deleteOffice" | "deleteLocationLevel" | "deleteLocationOption", id: string, name: string) {
    const description = action === "archiveBuilding" ? "سيتم إخفاء المبنى مع الحفاظ على بيانات الأصول السابقة." : "سيتم حذف العنصر من الهيكل، بينما تبقى أسماء المواقع محفوظة داخل الأصول السابقة.";
    setDialog({ mode: "confirm", title: `${action === "archiveBuilding" ? "أرشفة" : "حذف"}: ${name}`, description, action, id, value: name });
  }
  async function submitDialog() {
    if (!dialog) return;
    if (dialog.mode === "rename") {
      const name = dialog.value.trim();
      if (!name) return;
      if (await post({ action: dialog.action, id: dialog.id, name, ...(dialog.extra || {}) })) setDialog(null);
      return;
    }
    const succeeded = dialog.action === "archiveProject"
      ? await post({ action: dialog.action, projectId: dialog.id })
      : await post({ action: dialog.action, id: dialog.id });
    if (succeeded) {
      if (dialog.action === "archiveProject") { setProjectId(""); setBuildingId(""); }
      setDialog(null);
    }
  }
  function auditAction(log: AuditLog) {
    const action = log.action.toLowerCase();
    const operation = action.endsWith("_insert") ? "أضاف" : action.endsWith("_update") ? "عدّل" : action.endsWith("_delete") ? "حذف" : action.replaceAll("_", " ");
    const entity = log.entity_type === "assets" ? "الأصل" : log.entity_type === "projects" ? "المشروع" : log.entity_type === "buildings" ? "المبنى" : log.entity_type === "floors" ? "الطابق" : log.entity_type === "zones" ? "الزون" : log.entity_type === "offices" ? "المكتب" : log.entity_type === "location_levels" ? "المستوى المكاني" : log.entity_type === "location_options" ? "قيمة الموقع" : log.entity_type === "app_users" ? "المستخدم" : "السجل";
    return `${operation} ${entity}`;
  }
  async function saveCustomField(event: FormEvent) {
    event.preventDefault();
    if (!project?.draftConfig) return;
    const options = fieldDraft.optionsText.split("\n").map((line, index) => {
      const [code, labelAr, labelEn] = line.split("|").map(part => part.trim());
      return { code: code || `option_${index + 1}`, labelAr: labelAr || code, labelEn: labelEn || labelAr || code };
    }).filter(option => option.code && option.labelAr);
    const assetTypes = fieldDraft.assetTypesText.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
    if (await post({ action: "saveCustomField", configId: project.draftConfig.id, fieldId: fieldDraft.id, key: fieldDraft.key, labelAr: fieldDraft.labelAr, labelEn: fieldDraft.labelEn, type: fieldDraft.type, required: fieldDraft.required, enabled: fieldDraft.enabled, options, sortOrder: fieldDraft.sortOrder, helpAr: fieldDraft.helpAr, helpEn: fieldDraft.helpEn, assetTypes, unit: fieldDraft.unit, aiExtract: fieldDraft.aiExtract, showInReports: fieldDraft.showInReports, showInQr: fieldDraft.showInQr })) setFieldDraft(blankField);
  }
  function editCustomField(field: CustomField) {
    setFieldDraft({ id: field.id, key: field.key, labelAr: field.labelAr, labelEn: field.labelEn, type: field.type, required: field.required, enabled: field.enabled, optionsText: field.options.map(option => `${option.code}|${option.labelAr}|${option.labelEn}`).join("\n"), sortOrder: field.sortOrder, helpAr: field.helpAr, helpEn: field.helpEn, assetTypesText: field.assetTypes.join(", "), unit: field.unit, aiExtract: field.aiExtract, showInReports: field.showInReports, showInQr: field.showInQr });
  }

  if (!config && !error) return <main className="admin-shell" dir="rtl"><div className="admin-loading">جاري تحميل لوحة الإدارة…</div></main>;
  return <main className="admin-shell al-page" dir="rtl">
    <header className="al-page-head legacy-page-head"><div><span className="al-page-kicker">System administration</span><h2>إدارة AssetLens AI</h2><p>إعداد المشاريع والمواقع والحقول الإلزامية وصلاحيات فرق المسح الميداني.</p></div></header>
    {error && <div className="admin-error" role="alert">{error}</div>}
    {notice && <div className="admin-notice" role="status">✓ {notice}</div>}
    {config && config.currentUser.role !== "admin" ? <section className="admin-denied"><h2>هذه الصفحة للمدير فقط</h2><p>يمكنك استخدام شاشة المسح، لكن حسابك لا يملك صلاحية تعديل البيانات الأساسية.</p></section> : config && <>
      <section className="admin-stats" aria-label="ملخص لوحة الإدارة"><div><strong>{totals.projects}</strong><span>المشاريع</span></div><div><strong>{totals.buildings}</strong><span>المباني والمواقع</span></div><div><strong>{totals.users}</strong><span>المستخدمون</span></div></section>
      <nav className="admin-section-tabs" aria-label="أقسام الإدارة">
        <a href="#projects">Projects</a>
        <a href="#locations">Locations</a>
        <a href="#users">Users & Roles</a>
        <a href="#rules">Rules</a>
        <a href="#logs">Logs</a>
      </nav>
      <section className="admin-grid">
        <article className="admin-card" id="projects"><div className="admin-card-head"><span>01</span><div><h2>إضافة مشروع أو جهة</h2><p>مثال: سلال، MOE أو MOI.</p></div></div><form onSubmit={createProject}>
          <label>اسم المشروع / الجهة<input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="مثال: سلال" required /></label>
          <fieldset><legend>الحقول المطلوبة أثناء المسح</legend><div className="requirements-list">{requirementOptions.map(option => <label className="check-row" key={option.key}><input type="checkbox" checked={requirements[option.key]} onChange={event => setRequirements(current => ({ ...current, [option.key]: event.target.checked }))} /><span><b>{option.label}</b><small>{option.hint}</small></span></label>)}</div></fieldset>
          <button disabled={busy}>{busy ? "جاري الحفظ…" : "حفظ المشروع"}</button>
        </form><div className="project-edit-panel"><h3>تعديل أو أرشفة مشروع</h3><label>اختر المشروع<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">اختر المشروع</option>{config.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{project && <form onSubmit={updateProject}><label>اسم المشروع<input value={editProjectName} onChange={event => setEditProjectName(event.target.value)} required /></label><fieldset><legend>الحقول المطلوبة لهذا المشروع</legend><div className="requirements-list">{requirementOptions.map(option => <label className="check-row" key={option.key}><input type="checkbox" checked={editRequirements[option.key]} onChange={event => setEditRequirements(current => ({ ...current, [option.key]: event.target.checked }))} /><span><b>{option.label}</b><small>{option.hint}</small></span></label>)}</div></fieldset><div className="danger-actions"><button disabled={busy}>حفظ تعديلات المشروع</button><button type="button" className="danger-admin" disabled={busy} onClick={() => void archiveProject()}>حذف / أرشفة المشروع</button></div></form>}</div></article>

        <article className="admin-card" id="locations"><div className="admin-card-head"><span>02</span><div><h2>بناء هيكل المواقع الديناميكي</h2><p>أضف المباني والطوابق والزونات، ثم أنشئ أي مستويات إضافية حسب المشروع.</p></div></div>
          <div className="admin-selects"><label>المشروع<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">اختر المشروع</option>{config.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>المبنى / الموقع<select value={buildingId} disabled={!projectId} onChange={event => { setBuildingId(event.target.value); setFloorId(""); setOfficeZoneId(""); }}><option value="">اختر المبنى</option>{project?.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <form className="inline-admin-form" onSubmit={addBuilding}><input aria-label="اسم المبنى الجديد" value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="اسم المبنى / الموقع الجديد" required /><button disabled={busy || !projectId}>إضافة مبنى</button></form>
          <form className="inline-admin-form" onSubmit={addFloor}><input aria-label="اسم الطابق الجديد" value={floorName} onChange={event => setFloorName(event.target.value)} placeholder="اسم أو رقم الطابق الجديد" required /><button disabled={busy || !buildingId}>إضافة طابق</button></form>
          <form className="zone-form" onSubmit={addZone}><select aria-label="الطابق الخاص بالزون" value={floorId} disabled={!buildingId} onChange={event => setFloorId(event.target.value)}><option value="">كل المبنى / بدون طابق</option>{building?.floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="اسم الزون الجديد" value={zoneName} onChange={event => setZoneName(event.target.value)} placeholder="اسم الزون الجديد" required /><button disabled={busy || !buildingId}>إضافة زون</button></form>
          <section className="dynamic-location-admin">
            <h3>المستويات الإضافية التي يحددها الأدمن</h3>
            <p>مثال: مكتب، غرفة، جناح أو قسم. يمكن جعل كل مستوى إلزاميًا أو اختياريًا.</p>
            <form className="dynamic-level-form" onSubmit={addLocationLevel}>
              <input aria-label="اسم المستوى بالعربي" value={locationLevelLabelAr} onChange={event => setLocationLevelLabelAr(event.target.value)} placeholder="الاسم بالعربي: مكتب" required />
              <input className="ltr-input" aria-label="رمز المستوى" value={locationLevelKey} onChange={event => setLocationLevelKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="office" required />
              <input aria-label="اسم المستوى بالإنجليزي" value={locationLevelLabelEn} onChange={event => { const next = event.target.value; setLocationLevelLabelEn(next); if (!locationLevelKey) setLocationLevelKey(next.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")); }} placeholder="Office" />
              <label className="check-row"><input type="checkbox" checked={locationLevelRequired} onChange={event => setLocationLevelRequired(event.target.checked)} /><span><b>إلزامي</b></span></label>
              <button disabled={busy || !projectId}>إضافة المستوى</button>
            </form>
            {project?.locationLevels.length ? <>
              <form className="dynamic-option-form" onSubmit={addLocationOption}>
                <select aria-label="المستوى المكاني" value={locationLevelId} onChange={event => setLocationLevelId(event.target.value)} required><option value="">اختر المستوى</option>{project.locationLevels.map(level => <option key={level.id} value={level.id}>{level.labelAr}</option>)}</select>
                <select aria-label="الزون المرتبط بالقيمة" value={officeZoneId} disabled={!buildingId} onChange={event => setOfficeZoneId(event.target.value)}><option value="">كل المبنى / بدون زون</option>{building?.zones.filter(zone => !zone.floorId || !floorId || zone.floorId === floorId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <input value={locationOptionName} onChange={event => setLocationOptionName(event.target.value)} placeholder="اسم القيمة: مكتب 204" required />
                <button disabled={busy || !locationLevelId}>إضافة قيمة</button>
              </form>
              <div className="dynamic-level-list">{project.locationLevels.map(level => <article key={level.id}><div><strong>{level.labelAr}</strong><small>{level.labelEn || level.key} · {level.required ? "إلزامي" : "اختياري"}</small></div><button type="button" onClick={() => void post({ action: "updateLocationLevel", id: level.id, labelAr: level.labelAr, labelEn: level.labelEn, required: !level.required, sortOrder: level.sortOrder })}>{level.required ? "اجعله اختياريًا" : "اجعله إلزاميًا"}</button><button type="button" className="danger-mini" onClick={() => void removeLocation("deleteLocationLevel", level.id, level.labelAr)}>حذف المستوى</button><div>{level.options.filter(option => !buildingId || !option.buildingId || option.buildingId === buildingId).map(option => <span key={option.id}>{option.name}<button type="button" onClick={() => void removeLocation("deleteLocationOption", option.id, option.name)}>×</button></span>)}</div></article>)}</div>
            </> : <small>لا توجد مستويات إضافية لهذا المشروع حتى الآن.</small>}
          </section>
        </article>

        {config.currentUser.isSuperAdmin ? <article className="admin-card users-card" id="users"><div className="admin-card-head"><span>03</span><div><h2>{editingUserId ? "تعديل المستخدم والصلاحيات" : "إضافة مستخدم جديد"}</h2><p>حدد البريد وكلمة المرور والصلاحيات؛ يُنشأ الحساب مباشرة دون دعوة بريدية.</p></div>{editingUserId && <button type="button" className="cancel-user-edit" onClick={resetUserForm}>إلغاء التعديل</button>}</div><form onSubmit={saveUser}>
          <div className="user-fields"><label>البريد الإلكتروني<input className="ltr-input" type="email" value={userEmail} disabled={Boolean(editingUserId)} onChange={event => setUserEmail(event.target.value)} placeholder="user@company.com" required /></label><label>اسم المستخدم<input value={userName} onChange={event => setUserName(event.target.value)} placeholder="اسم المستخدم" required /></label><label>نوع الحساب<select value={userRole} onChange={event => { const role = event.target.value as UserRole; setUserRole(role); setUserModulePermissions(defaultModulePermissions(role)); }}>{(Object.keys(roleLabels) as UserRole[]).map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>{!editingUserId && <><label>كلمة المرور<div className="password-input-wrap"><input className="ltr-input" type={showUserPassword ? "text" : "password"} autoComplete="new-password" minLength={10} value={userPassword} onChange={event => setUserPassword(event.target.value)} required /><button type="button" onClick={() => setShowUserPassword(value => !value)}>{showUserPassword ? "إخفاء" : "إظهار"}</button></div><small>10 أحرف على الأقل وتشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.</small></label><label>تأكيد كلمة المرور<input className="ltr-input" type={showUserPassword ? "text" : "password"} autoComplete="new-password" minLength={10} value={userPasswordConfirm} onChange={event => setUserPasswordConfirm(event.target.value)} required /></label></>}</div>
          <div className="role-help"><div className="selected"><b>{roleLabels[userRole]}</b><span>{roleDescriptions[userRole]}</span></div></div>
          <fieldset className="module-permissions-fieldset"><legend>صلاحيات القائمة الجانبية والإجراءات</legend><p>إخفاء التاب يمنع أيضًا فتح الصفحة مباشرة أو تنفيذ عملياتها من الـAPI.</p><div className="module-permissions-table"><div className="permission-head"><b>التاب</b><span>عرض</span><span>إضافة</span><span>تعديل</span><span>حذف</span><span>اعتماد</span><span>تصدير</span></div>{userModulePermissions.map((permission, index) => <div className="permission-row" key={permission.module}><b>{MODULE_LABELS[permission.module].en}<small>{MODULE_LABELS[permission.module].ar}</small></b>{(["view", "create", "edit", "delete", "approve", "export"] as ModuleAction[]).map(action => <label key={action}><input type="checkbox" checked={permission[action]} onChange={event => setModulePermission(index, action, event.target.checked)} aria-label={`${MODULE_LABELS[permission.module].ar} ${action}`} /><span /></label>)}</div>)}</div></fieldset>
          <fieldset><legend>المشاريع المسموح بها</legend><div className="project-checks">{config.projects.length === 0 ? <p className="empty-checks">أضف مشروعًا أولًا حتى تتمكن من منحه للمستخدم.</p> : config.projects.map(item => <label className="check-row" key={item.id}><input type="checkbox" checked={userProjects.includes(item.id)} onChange={event => setUserProjects(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span><b>{item.name}</b></span></label>)}</div></fieldset>
          <button disabled={busy || (!editingUserId && (userPassword.length < 10 || userPassword !== userPasswordConfirm))}>{busy ? "جاري الحفظ…" : editingUserId ? "حفظ التعديلات" : "إنشاء حساب مباشر"}</button>
        </form><div className="user-list">{config.users.map(user => <div key={user.id} className={!user.active ? "inactive-user" : ""}><span className={`role-dot ${user.role}`} /><p><strong>{user.name || user.email}</strong><small>{user.email}</small></p><b>{!user.active ? "معطّل" : user.user_id ? "حساب نشط" : "ملف بدون حساب دخول"}<small>{roleLabels[user.role]}</small></b><em>{user.modulePermissions.filter(permission => permission.view).length} تابات · {user.role === "admin" ? "كل المشاريع" : `${user.projectIds.length} مشروع`}</em><div className="user-actions"><button type="button" onClick={() => editUser(user)}>تعديل</button>{user.user_id && <button type="button" disabled={busy} onClick={() => { setPasswordTarget(user); setReplacementPassword(""); setReplacementPasswordConfirm(""); setError(""); }}>تغيير كلمة المرور</button>}<button type="button" className={user.active ? "danger-mini" : "success-mini"} disabled={busy || user.id === config.currentUser.id} onClick={() => void post({ action: "setUserActive", userId: user.id, active: !user.active })}>{user.active ? "تعطيل" : "تفعيل"}</button></div></div>)}</div></article> : <article className="admin-card users-card super-admin-only"><div className="admin-card-head"><span>03</span><div><h2>المستخدمون والصلاحيات</h2><p>إدارة الحسابات محصورة بالسوبر أدمن Eng. Ahmed Salman.</p></div></div></article>}

        <article className="admin-card tree-card"><div className="admin-card-head"><span>04</span><div><h2>إدارة المباني والطوابق والزونات والمستويات الإضافية</h2><p>تعديل أو حذف عناصر الهيكل من مكان واحد.</p></div></div><div className="master-tree">{config.projects.length === 0 ? <p>لا توجد مشاريع مسجلة حتى الآن.</p> : config.projects.map(item => <details key={item.id}><summary><strong>{item.name}</strong><span>{item.buildings.length} موقع</span><em>{item.requireBuilding ? "المبنى مطلوب" : "المبنى اختياري"} • {item.requireFloor ? "الطابق مطلوب" : "الطابق اختياري"} • {item.requireZone ? "الزون مطلوب" : "الزون اختياري"} • {(item.locationLevels || []).map(level => `${level.labelAr} ${level.required ? "مطلوب" : "اختياري"}`).join(" • ")}</em></summary>{item.buildings.length === 0 ? <p className="tree-empty">لم تتم إضافة مبانٍ لهذا المشروع.</p> : item.buildings.map(site => <div className="tree-site managed-site" key={site.id}><div className="tree-row"><b>{site.name}</b><div><button onClick={() => void renameLocation("updateBuilding", site.id, site.name)}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("archiveBuilding", site.id, site.name)}>أرشفة</button></div></div><div className="tree-children"><section><h4>الطوابق</h4>{site.floors.length === 0 ? <small>لا توجد طوابق</small> : site.floors.map(floor => <div className="tree-child" key={floor.id}><span>{floor.name}</span><div><button onClick={() => void renameLocation("updateFloor", floor.id, floor.name, { sortOrder: floor.sortOrder })}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("deleteFloor", floor.id, floor.name)}>حذف</button></div></div>)}</section><section><h4>الزونات</h4>{site.zones.length === 0 ? <small>لا توجد زونات</small> : site.zones.map(zone => <div className="tree-child" key={zone.id}><span>{zone.name}<small>{site.floors.find(floor => floor.id === zone.floorId)?.name || "كل المبنى"}</small></span><div><button onClick={() => void renameLocation("updateZone", zone.id, zone.name, { floorId: zone.floorId || "" })}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("deleteZone", zone.id, zone.name)}>حذف</button></div></div>)}</section><section><h4>مكاتب قديمة (للتوافق)</h4>{site.offices.length === 0 ? <small>لا توجد مكاتب</small> : site.offices.map(office => <div className="tree-child" key={office.id}><span>{office.name}<small>{site.floors.find(floor => floor.id === office.floorId)?.name || "كل المبنى"} • {site.zones.find(zone => zone.id === office.zoneId)?.name || "بدون زون"}</small></span><div><button onClick={() => void renameLocation("updateOffice", office.id, office.name, { floorId: office.floorId || "", zoneId: office.zoneId || "" })}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("deleteOffice", office.id, office.name)}>حذف</button></div></div>)}</section></div></div>)}</details>)}</div></article>

        <article className="admin-card custom-fields-card" id="rules"><div className="admin-card-head"><span>05</span><div><h2>حقول المسح المخصصة</h2><p>أنشئ مسودة، أضف الحقول، ثم انشرها للمساحين.</p></div></div>
          <div className="config-toolbar"><label>المشروع<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">اختر المشروع</option>{config.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="version-pills"><span>المنشورة: v{project?.publishedConfig?.version || "—"}</span><span className={project?.draftConfig ? "has-draft" : ""}>المسودة: {project?.draftConfig ? `v${project.draftConfig.version}` : "لا توجد"}</span></div>{project && !project.draftConfig && <button disabled={busy} onClick={() => void post({ action: "createConfigDraft", projectId: project.id })}>إنشاء مسودة</button>}{project?.draftConfig && <><button className="preset-button" disabled={busy} onClick={() => void post({ action: "addSuggestedFields", configId: project.draftConfig?.id })}>＋ إضافة حقول المسح والموبايل</button><button className="publish-button" disabled={busy} onClick={() => void post({ action: "publishConfig", configId: project.draftConfig?.id })}>نشر النسخة v{project.draftConfig.version}</button></>}</div>
          {!project ? <p className="admin-placeholder">اختر مشروعًا لإدارة حقوله.</p> : !project.draftConfig ? <p className="admin-placeholder">النسخة المنشورة تعمل حاليًا. أنشئ مسودة آمنة قبل التعديل.</p> : <><form className="custom-field-form" onSubmit={saveCustomField}>
            <div className="custom-field-grid"><label>رمز الحقل<input className="ltr-input" value={fieldDraft.key} disabled={Boolean(fieldDraft.id)} onChange={event => setFieldDraft(current => ({ ...current, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} placeholder="power_supply_location" required /></label><label>الاسم بالعربي<input value={fieldDraft.labelAr} onChange={event => setFieldDraft(current => ({ ...current, labelAr: event.target.value }))} placeholder="مكان التغذية" required /></label><label>الاسم بالإنجليزي<input value={fieldDraft.labelEn} onChange={event => setFieldDraft(current => ({ ...current, labelEn: event.target.value }))} placeholder="Power Supply Location" /></label><label>نوع الحقل<select value={fieldDraft.type} onChange={event => setFieldDraft(current => ({ ...current, type: event.target.value as FieldType }))}>{Object.entries(fieldTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>وحدة القياس<input value={fieldDraft.unit} onChange={event => setFieldDraft(current => ({ ...current, unit: event.target.value }))} placeholder="kg / kW / V" /></label><label>الترتيب<input type="number" min="0" value={fieldDraft.sortOrder} onChange={event => setFieldDraft(current => ({ ...current, sortOrder: Number(event.target.value) }))} /></label></div>
            <label>أنواع الأصول التي يظهر لها الحقل — اتركه فارغًا ليظهر للجميع<input value={fieldDraft.assetTypesText} onChange={event => setFieldDraft(current => ({ ...current, assetTypesText: event.target.value }))} placeholder="Air Conditioner, Chiller" /></label>
            {fieldDraft.type === "select" && <label>الخيارات — سطر لكل خيار: code|العربي|English<textarea className="ltr-input" value={fieldDraft.optionsText} onChange={event => setFieldDraft(current => ({ ...current, optionsText: event.target.value }))} placeholder={"good|جيدة|Good\nrepair|تحتاج صيانة|Needs repair"} required /></label>}
            <div className="field-switches"><label><input type="checkbox" checked={fieldDraft.required} onChange={event => setFieldDraft(current => ({ ...current, required: event.target.checked }))} /> حقل إلزامي</label><label><input type="checkbox" checked={fieldDraft.enabled} onChange={event => setFieldDraft(current => ({ ...current, enabled: event.target.checked }))} /> مفعّل</label><label><input type="checkbox" checked={fieldDraft.aiExtract} onChange={event => setFieldDraft(current => ({ ...current, aiExtract: event.target.checked }))} /> يحاول AI استخراجه</label><label><input type="checkbox" checked={fieldDraft.showInReports} onChange={event => setFieldDraft(current => ({ ...current, showInReports: event.target.checked }))} /> يظهر في التقارير</label><label><input type="checkbox" checked={fieldDraft.showInQr} onChange={event => setFieldDraft(current => ({ ...current, showInQr: event.target.checked }))} /> يظهر في QR</label></div><div className="field-form-actions"><button disabled={busy}>{fieldDraft.id ? "حفظ التعديل" : "إضافة الحقل"}</button>{fieldDraft.id && <button type="button" className="secondary-admin" onClick={() => setFieldDraft(blankField)}>إلغاء التعديل</button>}</div>
          </form><div className="custom-fields-list">{project.draftConfig.fields.length === 0 ? <p>لا توجد حقول مخصصة في المسودة.</p> : project.draftConfig.fields.map(field => <div key={field.id} className={!field.enabled ? "disabled-field" : ""}><span className="field-order">{field.sortOrder}</span><p><strong>{field.labelAr}{field.unit ? ` (${field.unit})` : ""}</strong><small>{field.labelEn || field.key} • {fieldTypeLabels[field.type]} • {field.required ? "إلزامي" : "اختياري"} • {field.assetTypes.length ? field.assetTypes.join("، ") : "كل أنواع الأصول"}</small></p><button onClick={() => editCustomField(field)}>تعديل</button><button className="toggle-field" disabled={busy} onClick={() => void post({ action: "setCustomFieldEnabled", configId: project.draftConfig?.id, fieldId: field.id, enabled: !field.enabled })}>{field.enabled ? "تعطيل" : "تفعيل"}</button></div>)}</div></>}
        </article>

        <article className="admin-card audit-card" id="logs"><div className="admin-card-head"><span>06</span><div><h2>سجل من أضاف أو عدّل كل أصل</h2><p>هوية المستخدم، العملية، رقم الأصل، المشروع والتوقيت محفوظة تلقائيًا.</p></div><div className="audit-tabs"><button className={auditFilter === "assets" ? "active" : ""} onClick={() => setAuditFilter("assets")}>سجل الأصول</button><button className={auditFilter === "all" ? "active" : ""} onClick={() => setAuditFilter("all")}>كل العمليات</button></div></div><div className="audit-list">{filteredAuditLogs.length === 0 ? <p className="admin-placeholder">لا توجد عمليات مطابقة بعد.</p> : filteredAuditLogs.map(log => <div key={log.id}><span>{auditAction(log)}</span><p><strong>{log.actor_email || "System"}</strong><small>{log.details.asset_no || log.details.name || log.entity_id || "—"} • {config.projects.find(item => item.id === log.project_id)?.name || log.entity_type}</small></p><time>{new Intl.DateTimeFormat("ar-AE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.created_at))}</time></div>)}</div></article>
      </section>
    </>}
    {dialog && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) setDialog(null); }}><section className="al-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"><span className={`al-dialog-icon ${dialog.mode === "confirm" ? "danger" : ""}`}>{dialog.mode === "confirm" ? "!" : "✎"}</span><h3 id="admin-dialog-title">{dialog.title}</h3><p>{dialog.description}</p>{dialog.mode === "rename" && <label><span>الاسم الجديد</span><input autoFocus value={dialog.value} onChange={event => setDialog(current => current ? { ...current, value: event.target.value } : current)} onKeyDown={event => { if (event.key === "Enter") void submitDialog(); }} /></label>}<div><button className="al-secondary-button" disabled={busy} onClick={() => setDialog(null)}>إلغاء</button><button className={dialog.mode === "confirm" ? "al-danger-button" : "al-primary-button"} disabled={busy || (dialog.mode === "rename" && !dialog.value.trim())} onClick={() => void submitDialog()}>{busy ? "جاري الحفظ…" : dialog.mode === "confirm" ? "تأكيد العملية" : "حفظ الاسم"}</button></div></section></div>}
    {passwordTarget && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) setPasswordTarget(null); }}><form className="al-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" onSubmit={saveReplacementPassword}><span className="al-dialog-icon">🔐</span><h3 id="reset-password-title">تغيير كلمة مرور {passwordTarget.name || passwordTarget.email}</h3><p>اكتب كلمة المرور الجديدة التي سيستخدمها للدخول إلى النظام.</p><label><span>كلمة المرور الجديدة</span><input className="ltr-input" type="password" autoComplete="new-password" minLength={10} value={replacementPassword} onChange={event => setReplacementPassword(event.target.value)} required /></label><label><span>تأكيد كلمة المرور</span><input className="ltr-input" type="password" autoComplete="new-password" minLength={10} value={replacementPasswordConfirm} onChange={event => setReplacementPasswordConfirm(event.target.value)} required /></label><small>يجب أن تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.</small><div><button type="button" className="al-secondary-button" disabled={busy} onClick={() => setPasswordTarget(null)}>إلغاء</button><button className="al-primary-button" disabled={busy || replacementPassword.length < 10 || replacementPassword !== replacementPasswordConfirm}>{busy ? "جاري الحفظ…" : "حفظ كلمة المرور"}</button></div></form></div>}
  </main>;
}
