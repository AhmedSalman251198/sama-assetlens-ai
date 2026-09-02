"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";

type Floor = { id: string; name: string; sortOrder: number };
type Zone = { id: string; floorId: string | null; name: string };
type Building = { id: string; name: string; floors: Floor[]; zones: Zone[] };
type FieldType = "text" | "textarea" | "number" | "date" | "select" | "boolean";
type CustomOption = { code: string; labelAr: string; labelEn: string };
type CustomField = { id: string; key: string; labelAr: string; labelEn: string; type: FieldType; enabled: boolean; required: boolean; options: CustomOption[]; sortOrder: number; helpAr: string; helpEn: string };
type Project = { id: string; name: string; requireBuilding: boolean; requireFloor: boolean; requireZone: boolean; allowManual: boolean; buildings: Building[]; publishedConfig: { id: string; version: number; publishedAt: string | null } | null; customFields: CustomField[]; draftConfig: { id: string; version: number; fields: CustomField[] } | null };
type User = { id: string; email: string; name: string; role: "admin" | "surveyor"; active: boolean; projectIds: string[] };
type AuditLog = { id: number; actor_email: string; action: string; entity_type: string; entity_id: string | null; project_id: string | null; details: { asset_no?: string; status?: string; name?: string; active?: boolean }; created_at: string };
type Config = { currentUser: { id: string; email: string; name: string; role: "admin" | "surveyor" }; projects: Project[]; users: User[]; auditLogs: AuditLog[] };
type AdminDialog = { mode: "rename" | "confirm"; title: string; description: string; action: "archiveProject" | "updateBuilding" | "updateFloor" | "updateZone" | "archiveBuilding" | "deleteFloor" | "deleteZone"; id: string; value: string; extra?: Record<string, unknown> };

const requirementOptions = [
  { key: "requireBuilding", label: "المبنى / الموقع", hint: "يجب تحديد موقع الأصل" },
  { key: "requireFloor", label: "الطابق", hint: "يجب تحديد الطابق" },
  { key: "requireZone", label: "الزون / المنطقة", hint: "يجب تحديد الزون" },
  { key: "allowManual", label: "السماح بالإدخال اليدوي", hint: "عند عدم وجود القيمة في القائمة" },
] as const;

const successMessages: Record<string, string> = {
  createProject: "تم حفظ المشروع بنجاح.", updateProject: "تم تعديل المشروع ومتطلبات المسح.", archiveProject: "تمت أرشفة المشروع مع الحفاظ على سجلات أصوله.", addBuilding: "تمت إضافة المبنى / الموقع.", addFloor: "تمت إضافة الطابق.", addZone: "تمت إضافة الزون.", updateBuilding: "تم تعديل اسم المبنى.", updateFloor: "تم تعديل الطابق.", updateZone: "تم تعديل الزون.", archiveBuilding: "تمت أرشفة المبنى.", deleteFloor: "تم حذف الطابق.", deleteZone: "تم حذف الزون.", upsertUser: "تم حفظ المستخدم وصلاحياته.", setUserActive: "تم تحديث حالة المستخدم.", inviteUser: "تم إرسال رابط الدعوة إلى البريد الإلكتروني.", createConfigDraft: "تم إنشاء مسودة من النسخة المنشورة.", saveCustomField: "تم حفظ الحقل داخل المسودة.", setCustomFieldEnabled: "تم تحديث حالة الحقل.", addSuggestedFields: "تمت إضافة حقول المسح والموبايل المقترحة إلى المسودة.", publishConfig: "تم نشر إعدادات المسح الجديدة.",
};

const fieldTypeLabels: Record<FieldType, string> = { text: "نص قصير", textarea: "نص طويل", number: "رقم", date: "تاريخ", select: "قائمة خيارات", boolean: "نعم / لا" };
const blankField = { id: "", key: "", labelAr: "", labelEn: "", type: "text" as FieldType, required: false, enabled: true, optionsText: "", sortOrder: 10, helpAr: "", helpEn: "" };

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
  const [requirements, setRequirements] = useState({ requireBuilding: true, requireFloor: true, requireZone: false, allowManual: true });
  const [editProjectName, setEditProjectName] = useState("");
  const [editRequirements, setEditRequirements] = useState({ requireBuilding: true, requireFloor: true, requireZone: false, allowManual: true });
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [floorName, setFloorName] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<"admin" | "surveyor">("surveyor");
  const [userProjects, setUserProjects] = useState<string[]>([]);
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
    setProjectId(id); setBuildingId(""); setFloorId(""); setFieldDraft(blankField);
    const selected = config?.projects.find(item => item.id === id);
    setEditProjectName(selected?.name || "");
    if (selected) setEditRequirements({ requireBuilding: selected.requireBuilding, requireFloor: selected.requireFloor, requireZone: selected.requireZone, allowManual: selected.allowManual });
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
  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "upsertUser", email: userEmail, name: userName, role: userRole, projectIds: userProjects })) { setUserEmail(""); setUserName(""); setUserRole("surveyor"); setUserProjects([]); }
  }
  function editUser(user: User) { setUserEmail(user.email); setUserName(user.name); setUserRole(user.role); setUserProjects(user.projectIds); window.scrollTo({ top: 720, behavior: "smooth" }); }
  async function renameLocation(action: "updateBuilding" | "updateFloor" | "updateZone", id: string, currentName: string, extra: Record<string, unknown> = {}) {
    setDialog({ mode: "rename", title: "تعديل اسم الموقع", description: "اكتب الاسم الجديد ثم احفظ التغيير.", action, id, value: currentName, extra });
  }
  async function removeLocation(action: "archiveBuilding" | "deleteFloor" | "deleteZone", id: string, name: string) {
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
    const entity = log.entity_type === "assets" ? "الأصل" : log.entity_type === "projects" ? "المشروع" : log.entity_type === "buildings" ? "المبنى" : log.entity_type === "floors" ? "الطابق" : log.entity_type === "zones" ? "الزون" : log.entity_type === "app_users" ? "المستخدم" : "السجل";
    return `${operation} ${entity}`;
  }
  async function saveCustomField(event: FormEvent) {
    event.preventDefault();
    if (!project?.draftConfig) return;
    const options = fieldDraft.optionsText.split("\n").map((line, index) => {
      const [code, labelAr, labelEn] = line.split("|").map(part => part.trim());
      return { code: code || `option_${index + 1}`, labelAr: labelAr || code, labelEn: labelEn || labelAr || code };
    }).filter(option => option.code && option.labelAr);
    if (await post({ action: "saveCustomField", configId: project.draftConfig.id, fieldId: fieldDraft.id, key: fieldDraft.key, labelAr: fieldDraft.labelAr, labelEn: fieldDraft.labelEn, type: fieldDraft.type, required: fieldDraft.required, enabled: fieldDraft.enabled, options, sortOrder: fieldDraft.sortOrder, helpAr: fieldDraft.helpAr, helpEn: fieldDraft.helpEn })) setFieldDraft(blankField);
  }
  function editCustomField(field: CustomField) {
    setFieldDraft({ id: field.id, key: field.key, labelAr: field.labelAr, labelEn: field.labelEn, type: field.type, required: field.required, enabled: field.enabled, optionsText: field.options.map(option => `${option.code}|${option.labelAr}|${option.labelEn}`).join("\n"), sortOrder: field.sortOrder, helpAr: field.helpAr, helpEn: field.helpEn });
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

        <article className="admin-card" id="locations"><div className="admin-card-head"><span>02</span><div><h2>بناء هيكل المواقع</h2><p>اختر المشروع، ثم أضف المباني والطوابق والزونات.</p></div></div>
          <div className="admin-selects"><label>المشروع<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">اختر المشروع</option>{config.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>المبنى / الموقع<select value={buildingId} disabled={!projectId} onChange={event => { setBuildingId(event.target.value); setFloorId(""); }}><option value="">اختر المبنى</option>{project?.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <form className="inline-admin-form" onSubmit={addBuilding}><input aria-label="اسم المبنى الجديد" value={buildingName} onChange={event => setBuildingName(event.target.value)} placeholder="اسم المبنى / الموقع الجديد" required /><button disabled={busy || !projectId}>إضافة مبنى</button></form>
          <form className="inline-admin-form" onSubmit={addFloor}><input aria-label="اسم الطابق الجديد" value={floorName} onChange={event => setFloorName(event.target.value)} placeholder="اسم أو رقم الطابق الجديد" required /><button disabled={busy || !buildingId}>إضافة طابق</button></form>
          <form className="zone-form" onSubmit={addZone}><select aria-label="الطابق الخاص بالزون" value={floorId} disabled={!buildingId} onChange={event => setFloorId(event.target.value)}><option value="">كل المبنى / بدون طابق</option>{building?.floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="اسم الزون الجديد" value={zoneName} onChange={event => setZoneName(event.target.value)} placeholder="اسم الزون الجديد" required /><button disabled={busy || !buildingId}>إضافة زون</button></form>
        </article>

        <article className="admin-card users-card" id="users"><div className="admin-card-head"><span>03</span><div><h2>المستخدمون والصلاحيات</h2><p>كل مستخدم يرى المشاريع المسموح له بالعمل عليها فقط.</p></div></div><form onSubmit={saveUser}>
          <div className="user-fields"><label>البريد الإلكتروني<input className="ltr-input" type="email" value={userEmail} onChange={event => setUserEmail(event.target.value)} placeholder="surveyor@company.com" required /></label><label>اسم المستخدم<input value={userName} onChange={event => setUserName(event.target.value)} placeholder="اسم موظف المسح" /></label><label>نوع الحساب<select value={userRole} onChange={event => setUserRole(event.target.value as "admin" | "surveyor")}><option value="surveyor">موظف مسح</option><option value="admin">مدير النظام</option></select></label></div>
          <fieldset><legend>المشاريع المسموح بها</legend><div className="project-checks">{config.projects.length === 0 ? <p className="empty-checks">أضف مشروعًا أولًا حتى تتمكن من منحه للمستخدم.</p> : config.projects.map(item => <label className="check-row" key={item.id}><input type="checkbox" checked={userProjects.includes(item.id)} onChange={event => setUserProjects(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span><b>{item.name}</b></span></label>)}</div></fieldset>
          <button disabled={busy}>{busy ? "جاري الحفظ…" : "حفظ المستخدم والصلاحيات"}</button>
        </form><div className="user-list">{config.users.map(user => <div key={user.id} className={!user.active ? "inactive-user" : ""}><span className={`role-dot ${user.role}`} /><p><strong>{user.name || user.email}</strong><small>{user.email}</small></p><b>{user.active ? (user.role === "admin" ? "مدير" : "مسح ميداني") : "معطّل"}</b><em>{user.projectIds.length} مشروع</em><div className="user-actions"><button onClick={() => editUser(user)}>تعديل</button><button onClick={() => void post({ action: "inviteUser", email: user.email, name: user.name })}>إرسال دعوة</button><button className={user.active ? "danger-mini" : "success-mini"} disabled={busy || user.id === config.currentUser.id} onClick={() => void post({ action: "setUserActive", userId: user.id, active: !user.active })}>{user.active ? "تعطيل" : "تفعيل"}</button></div></div>)}</div></article>

        <article className="admin-card tree-card"><div className="admin-card-head"><span>04</span><div><h2>إدارة المباني والطوابق والزونات</h2><p>تعديل أو حذف عناصر الهيكل من مكان واحد.</p></div></div><div className="master-tree">{config.projects.length === 0 ? <p>لا توجد مشاريع مسجلة حتى الآن.</p> : config.projects.map(item => <details key={item.id}><summary><strong>{item.name}</strong><span>{item.buildings.length} موقع</span><em>{item.requireBuilding ? "المبنى مطلوب" : "المبنى اختياري"} • {item.requireFloor ? "الطابق مطلوب" : "الطابق اختياري"} • {item.requireZone ? "الزون مطلوب" : "الزون اختياري"}</em></summary>{item.buildings.length === 0 ? <p className="tree-empty">لم تتم إضافة مبانٍ لهذا المشروع.</p> : item.buildings.map(site => <div className="tree-site managed-site" key={site.id}><div className="tree-row"><b>{site.name}</b><div><button onClick={() => void renameLocation("updateBuilding", site.id, site.name)}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("archiveBuilding", site.id, site.name)}>أرشفة</button></div></div><div className="tree-children"><section><h4>الطوابق</h4>{site.floors.length === 0 ? <small>لا توجد طوابق</small> : site.floors.map(floor => <div className="tree-child" key={floor.id}><span>{floor.name}</span><div><button onClick={() => void renameLocation("updateFloor", floor.id, floor.name, { sortOrder: floor.sortOrder })}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("deleteFloor", floor.id, floor.name)}>حذف</button></div></div>)}</section><section><h4>الزونات</h4>{site.zones.length === 0 ? <small>لا توجد زونات</small> : site.zones.map(zone => <div className="tree-child" key={zone.id}><span>{zone.name}<small>{site.floors.find(floor => floor.id === zone.floorId)?.name || "كل المبنى"}</small></span><div><button onClick={() => void renameLocation("updateZone", zone.id, zone.name, { floorId: zone.floorId || "" })}>تعديل</button><button className="danger-mini" onClick={() => void removeLocation("deleteZone", zone.id, zone.name)}>حذف</button></div></div>)}</section></div></div>)}</details>)}</div></article>

        <article className="admin-card custom-fields-card" id="rules"><div className="admin-card-head"><span>05</span><div><h2>حقول المسح المخصصة</h2><p>أنشئ مسودة، أضف الحقول، ثم انشرها للمساحين.</p></div></div>
          <div className="config-toolbar"><label>المشروع<select value={projectId} onChange={event => selectProject(event.target.value)}><option value="">اختر المشروع</option>{config.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="version-pills"><span>المنشورة: v{project?.publishedConfig?.version || "—"}</span><span className={project?.draftConfig ? "has-draft" : ""}>المسودة: {project?.draftConfig ? `v${project.draftConfig.version}` : "لا توجد"}</span></div>{project && !project.draftConfig && <button disabled={busy} onClick={() => void post({ action: "createConfigDraft", projectId: project.id })}>إنشاء مسودة</button>}{project?.draftConfig && <><button className="preset-button" disabled={busy} onClick={() => void post({ action: "addSuggestedFields", configId: project.draftConfig?.id })}>＋ إضافة حقول المسح والموبايل</button><button className="publish-button" disabled={busy} onClick={() => void post({ action: "publishConfig", configId: project.draftConfig?.id })}>نشر النسخة v{project.draftConfig.version}</button></>}</div>
          {!project ? <p className="admin-placeholder">اختر مشروعًا لإدارة حقوله.</p> : !project.draftConfig ? <p className="admin-placeholder">النسخة المنشورة تعمل حاليًا. أنشئ مسودة آمنة قبل التعديل.</p> : <><form className="custom-field-form" onSubmit={saveCustomField}>
            <div className="custom-field-grid"><label>رمز الحقل<input className="ltr-input" value={fieldDraft.key} disabled={Boolean(fieldDraft.id)} onChange={event => setFieldDraft(current => ({ ...current, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))} placeholder="asset_condition" required /></label><label>الاسم بالعربي<input value={fieldDraft.labelAr} onChange={event => setFieldDraft(current => ({ ...current, labelAr: event.target.value }))} required /></label><label>الاسم بالإنجليزي<input value={fieldDraft.labelEn} onChange={event => setFieldDraft(current => ({ ...current, labelEn: event.target.value }))} /></label><label>نوع الحقل<select value={fieldDraft.type} onChange={event => setFieldDraft(current => ({ ...current, type: event.target.value as FieldType }))}>{Object.entries(fieldTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>الترتيب<input type="number" min="0" value={fieldDraft.sortOrder} onChange={event => setFieldDraft(current => ({ ...current, sortOrder: Number(event.target.value) }))} /></label></div>
            {fieldDraft.type === "select" && <label>الخيارات — سطر لكل خيار: code|العربي|English<textarea className="ltr-input" value={fieldDraft.optionsText} onChange={event => setFieldDraft(current => ({ ...current, optionsText: event.target.value }))} placeholder={"good|جيدة|Good\nrepair|تحتاج صيانة|Needs repair"} required /></label>}
            <div className="field-switches"><label><input type="checkbox" checked={fieldDraft.required} onChange={event => setFieldDraft(current => ({ ...current, required: event.target.checked }))} /> حقل إلزامي</label><label><input type="checkbox" checked={fieldDraft.enabled} onChange={event => setFieldDraft(current => ({ ...current, enabled: event.target.checked }))} /> مفعّل</label></div><div className="field-form-actions"><button disabled={busy}>{fieldDraft.id ? "حفظ التعديل" : "إضافة الحقل"}</button>{fieldDraft.id && <button type="button" className="secondary-admin" onClick={() => setFieldDraft(blankField)}>إلغاء التعديل</button>}</div>
          </form><div className="custom-fields-list">{project.draftConfig.fields.length === 0 ? <p>لا توجد حقول مخصصة في المسودة.</p> : project.draftConfig.fields.map(field => <div key={field.id} className={!field.enabled ? "disabled-field" : ""}><span className="field-order">{field.sortOrder}</span><p><strong>{field.labelAr}</strong><small>{field.labelEn || field.key} • {fieldTypeLabels[field.type]} • {field.required ? "إلزامي" : "اختياري"}</small></p><button onClick={() => editCustomField(field)}>تعديل</button><button className="toggle-field" disabled={busy} onClick={() => void post({ action: "setCustomFieldEnabled", configId: project.draftConfig?.id, fieldId: field.id, enabled: !field.enabled })}>{field.enabled ? "تعطيل" : "تفعيل"}</button></div>)}</div></>}
        </article>

        <article className="admin-card audit-card" id="logs"><div className="admin-card-head"><span>06</span><div><h2>سجل من أضاف أو عدّل كل أصل</h2><p>هوية المستخدم، العملية، رقم الأصل، المشروع والتوقيت محفوظة تلقائيًا.</p></div><div className="audit-tabs"><button className={auditFilter === "assets" ? "active" : ""} onClick={() => setAuditFilter("assets")}>سجل الأصول</button><button className={auditFilter === "all" ? "active" : ""} onClick={() => setAuditFilter("all")}>كل العمليات</button></div></div><div className="audit-list">{filteredAuditLogs.length === 0 ? <p className="admin-placeholder">لا توجد عمليات مطابقة بعد.</p> : filteredAuditLogs.map(log => <div key={log.id}><span>{auditAction(log)}</span><p><strong>{log.actor_email || "System"}</strong><small>{log.details.asset_no || log.details.name || log.entity_id || "—"} • {config.projects.find(item => item.id === log.project_id)?.name || log.entity_type}</small></p><time>{new Intl.DateTimeFormat("ar-AE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.created_at))}</time></div>)}</div></article>
      </section>
    </>}
    {dialog && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) setDialog(null); }}><section className="al-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"><span className={`al-dialog-icon ${dialog.mode === "confirm" ? "danger" : ""}`}>{dialog.mode === "confirm" ? "!" : "✎"}</span><h3 id="admin-dialog-title">{dialog.title}</h3><p>{dialog.description}</p>{dialog.mode === "rename" && <label><span>الاسم الجديد</span><input autoFocus value={dialog.value} onChange={event => setDialog(current => current ? { ...current, value: event.target.value } : current)} onKeyDown={event => { if (event.key === "Enter") void submitDialog(); }} /></label>}<div><button className="al-secondary-button" disabled={busy} onClick={() => setDialog(null)}>إلغاء</button><button className={dialog.mode === "confirm" ? "al-danger-button" : "al-primary-button"} disabled={busy || (dialog.mode === "rename" && !dialog.value.trim())} onClick={() => void submitDialog()}>{busy ? "جاري الحفظ…" : dialog.mode === "confirm" ? "تأكيد العملية" : "حفظ الاسم"}</button></div></section></div>}
  </main>;
}
