"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, invalidateApiCache } from "../lib/api-client";
import { parseAssetListFilters } from "../lib/asset-list-filters";
import { getAccessToken } from "../lib/supabase-auth";
import { ASSET_CONDITION_LEVELS, assetConditionLabel } from "../lib/asset-condition";
import { ASSET_CRITICALITY_LEVELS, assetCriticalityLabel, assetCriticalityWeight } from "../lib/asset-criticality";
import { ASSET_OPERATIONAL_STATUSES, AssetOperationalStatus, assetOperationalStatusLabel } from "../lib/asset-operational-status";
import { AssetCategory } from "../lib/asset-categories";
import { readUiLanguage, UI_LANGUAGE_EVENT, UiLanguage } from "../lib/ui-preferences";
import { PaginationJump } from "../components/pagination-jump";

type StructureFloor = { id: string; name: string };
type StructureZone = { id: string; name: string; floorId: string | null };
type StructureBuilding = { id: string; name: string; floors: StructureFloor[]; zones: StructureZone[] };
type Project = { id: string; name: string; categoryIds: string[]; buildings: StructureBuilding[] };
type Config = { projects: Project[]; categories: AssetCategory[] };
type Asset = {
  id: string; assetNo: string; assetType: string; summary: string; manufacturer: string; model: string; serial: string;
  categoryId: string; operationalStatus: AssetOperationalStatus; conditionRating: number; conditionJustification: string; criticalityRating: number;
  estimatedPrice: number | null; replacementCost: number | null; priceCurrency: string; usefulLifeYears: number | null; installationDate: string; remainingLifeYears: number | null;
  estimateSource: string; estimateConfidence: string; enrichmentData: Record<string, unknown>; enrichmentSourceUrl: string; enrichmentFetchedAt: string | null;
  status: string; canEdit: boolean; projectId: string; project: string; building: string; floor: string; zone: string; office: string; createdAt: string;
};
type AssetPage = { records: Asset[]; total: number; page: number; pageSize: number };
type EditAsset = Pick<Asset, "id" | "assetNo" | "assetType" | "summary" | "manufacturer" | "model" | "serial" | "categoryId" | "operationalStatus" | "conditionRating" | "conditionJustification" | "criticalityRating" | "estimatedPrice" | "replacementCost" | "priceCurrency" | "usefulLifeYears" | "installationDate" | "estimateSource" | "projectId">;

const blankPage: AssetPage = { records: [], total: 0, page: 1, pageSize: 50 };

export default function AssetManagementPage() {
  const [language, setLanguage] = useState<UiLanguage>("ar");
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<AssetPage>(blankPage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enrichingId, setEnrichingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<EditAsset | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState("");
  const [operationalStatus, setOperationalStatus] = useState("");
  const [condition, setCondition] = useState("");
  const [criticality, setCriticality] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [routeReady, setRouteReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLanguage(readUiLanguage()), 0);
    const listener = (event: Event) => setLanguage((event as CustomEvent<UiLanguage>).detail || readUiLanguage());
    window.addEventListener(UI_LANGUAGE_EVENT, listener);
    return () => { window.clearTimeout(timer); window.removeEventListener(UI_LANGUAGE_EVENT, listener); };
  }, []);

  useEffect(() => {
    const initial = parseAssetListFilters(new URLSearchParams(window.location.search));
    const timer = window.setTimeout(() => {
      setSearch(initial.search);
      setProject(initial.project);
      setBuilding(initial.building);
      setFloor(initial.floor);
      setZone(initial.zone);
      setCategory(initial.category);
      setOperationalStatus(initial.operationalStatus);
      setCondition(initial.condition);
      setCriticality(initial.criticality);
      setWorkflow(initial.workflow || initial.status);
      setPage(1);
      setRouteReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ view: "manage", page: String(page), pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (project) params.set("project", project);
    if (building) params.set("building", building);
    if (floor) params.set("floor", floor);
    if (zone) params.set("zone", zone);
    if (category) params.set("category", category);
    if (operationalStatus) params.set("operationalStatus", operationalStatus);
    if (condition) params.set("condition", condition);
    if (criticality) params.set("criticality", criticality);
    if (workflow === "active") params.set("workflow", "active");
    else if (workflow) params.set("status", workflow);
    return `/api/assets?${params}`;
  }, [page, search, project, building, floor, zone, category, operationalStatus, condition, criticality, workflow]);

  const load = useCallback(async () => {
    if (!routeReady) return;
    setLoading(true); setError("");
    try {
      const [assetPage, nextConfig] = await Promise.all([
        apiGet<AssetPage>(query, { force: true, ttlMs: 0, timeoutMs: 60_000 }),
        config ? Promise.resolve(config) : apiGet<Config>("/api/config?scope=structure", { ttlMs: 5 * 60_000 }),
      ]);
      setData(assetPage); setConfig(nextConfig);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تحميل الأصول."); }
    finally { setLoading(false); }
  }, [query, config, routeReady]);

  useEffect(() => { if (!routeReady) return; const timer = window.setTimeout(() => void load(), search ? 350 : 0); return () => window.clearTimeout(timer); }, [load, search, routeReady]);

  const categoryMap = useMemo(() => new Map((config?.categories || []).map(item => [item.id, item])), [config]);
  const selectedProject = config?.projects.find(item => item.id === project);
  const selectedBuilding = selectedProject?.buildings.find(item => item.id === building);
  const availableFloors = selectedBuilding?.floors || [];
  const availableZones = (selectedBuilding?.zones || []).filter(item => !floor || !item.floorId || item.floorId === floor);
  const categoriesForEdit = (config?.categories || []).filter(item => item.active !== false && config?.projects.find(projectItem => projectItem.id === editing?.projectId)?.categoryIds.includes(item.id));
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  async function saveAsset() {
    if (!editing || saving) return;
    if (!editing.assetType.trim() || !editing.categoryId || !Number.isInteger(Number(editing.conditionRating)) || !Number.isInteger(Number(editing.criticalityRating))) { setError(language === "ar" ? "نوع الأصل والتصنيف وتقييما الحالة والأهمية إلزامية." : "Asset type, category, condition and criticality are required."); return; }
    if (Number(editing.conditionRating) <= 2 && editing.conditionJustification.trim().length < 3) { setError(language === "ar" ? "اكتب سبب الحالة الحرجة أو الضعيفة." : "Explain the Critical or Poor condition."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const token = await getAccessToken();
      if (!token) { window.location.replace("/login"); return; }
      const response = await fetch("/api/assets", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "manage", ...editing }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "تعذر حفظ الأصل.");
      invalidateApiCache("/api/assets"); invalidateApiCache("/api/dashboard"); invalidateApiCache("/api/reports");
      setEditing(null); setNotice(language === "ar" ? `تم تحديث الأصل ${editing.assetNo}. وسيظهر التحديث عند مسح QR بمجرد الاتصال.` : `Asset ${editing.assetNo} was updated. Its QR shows the update when online.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حفظ الأصل."); }
    finally { setSaving(false); }
  }

  function openEditor(asset: Asset) {
    setEditing({ id: asset.id, assetNo: asset.assetNo, assetType: asset.assetType, summary: asset.summary, manufacturer: asset.manufacturer, model: asset.model, serial: asset.serial, categoryId: asset.categoryId, operationalStatus: asset.operationalStatus || "active", conditionRating: asset.conditionRating, conditionJustification: asset.conditionJustification || "", criticalityRating: asset.criticalityRating, estimatedPrice: asset.estimatedPrice, replacementCost: asset.replacementCost, priceCurrency: asset.priceCurrency || "AED", usefulLifeYears: asset.usefulLifeYears, installationDate: asset.installationDate || "", estimateSource: asset.estimateSource || "", projectId: asset.projectId });
    setError(""); setNotice("");
  }

  async function enrichAsset(asset: Asset) {
    if (enrichingId) return;
    setEnrichingId(asset.id); setError(""); setNotice("");
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const geminiKey = window.sessionStorage.getItem("assetlens_gemini_key") || "";
      const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/enrich`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...(geminiKey ? { "x-gemini-api-key": geminiKey } : {}) } });
      const payload = await response.json() as { exactModelVerified?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "تعذر جلب المواصفات.");
      setNotice(language === "ar" ? `تم جلب وحفظ المواصفات الموثقة للأصل ${asset.assetNo}.` : `Verified specifications were saved for ${asset.assetNo}.`);
      invalidateApiCache("/api/assets"); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر جلب المواصفات."); }
    finally { setEnrichingId(""); }
  }

  return <section className="al-page asset-management-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="al-page-head"><div><span className="al-page-kicker">Asset management</span><h2>{language === "ar" ? "إدارة الأصول وحالاتها" : "Assets and status management"}</h2><p>{language === "ar" ? "ابحث عن أي أصل وعدّل بياناته وحالته التشغيلية وتقييماته دون تغيير QR المطبوع." : "Find any asset and update its details, operational state and ratings without replacing its printed QR."}</p></div><div className="asset-total"><small>{language === "ar" ? "إجمالي النتائج" : "Total results"}</small><strong>{data.total}</strong></div></header>
    {error && !editing && <div className="al-alert" role="alert">{error}</div>}{notice && <div className="al-success" role="status">✓ {notice}</div>}
    <section className="al-card asset-manager-filters">
      <label><span>{language === "ar" ? "بحث" : "Search"}</span><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={language === "ar" ? "رقم الأصل، النوع، الموقع…" : "Asset no., type or location…"} /></label>
      <label><span>{language === "ar" ? "المشروع" : "Project"}</span><select value={project} onChange={event => { setProject(event.target.value); setBuilding(""); setFloor(""); setZone(""); setPage(1); }}><option value="">{language === "ar" ? "كل المشاريع" : "All projects"}</option>{config?.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{language === "ar" ? "المبنى / الموقع" : "Building / site"}</span><select value={building} disabled={!selectedProject} onChange={event => { setBuilding(event.target.value); setFloor(""); setZone(""); setPage(1); }}><option value="">{language === "ar" ? "كل المباني" : "All buildings"}</option>{selectedProject?.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{language === "ar" ? "الطابق" : "Floor"}</span><select value={floor} disabled={!selectedBuilding} onChange={event => { setFloor(event.target.value); setZone(""); setPage(1); }}><option value="">{language === "ar" ? "كل الطوابق" : "All floors"}</option>{availableFloors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{language === "ar" ? "الزون / المنطقة" : "Zone / area"}</span><select value={zone} disabled={!selectedBuilding} onChange={event => { setZone(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل الزونات" : "All zones"}</option>{availableZones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{language === "ar" ? "التصنيف" : "Category"}</span><select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل التصنيفات" : "All categories"}</option>{config?.categories.filter(item => item.active !== false).map(item => <option key={item.id} value={item.id}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
      <label><span>{language === "ar" ? "حالة التشغيل" : "Operational status"}</span><select value={operationalStatus} onChange={event => { setOperationalStatus(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل الحالات" : "All statuses"}</option>{ASSET_OPERATIONAL_STATUSES.map(item => <option key={item.code} value={item.code}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
      <label><span>{language === "ar" ? "حالة السجل" : "Workflow status"}</span><select value={workflow} onChange={event => { setWorkflow(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل الحالات" : "All workflow states"}</option><option value="completed">{language === "ar" ? "معتمدة" : "Approved"}</option><option value="review">{language === "ar" ? "تحتاج مراجعة" : "Needs review"}</option><option value="active">{language === "ar" ? "قيد التحليل" : "In analysis"}</option><option value="queued">{language === "ar" ? "في الانتظار" : "Queued"}</option><option value="processing">{language === "ar" ? "جاري التحليل" : "Processing"}</option><option value="failed">{language === "ar" ? "فشلت" : "Failed"}</option></select></label>
      <label><span>Condition</span><select value={condition} onChange={event => { setCondition(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل التقييمات" : "All ratings"}</option>{ASSET_CONDITION_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
      <label><span>Criticality</span><select value={criticality} onChange={event => { setCriticality(event.target.value); setPage(1); }}><option value="">{language === "ar" ? "كل الأهميات" : "All criticalities"}</option>{ASSET_CRITICALITY_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
    </section>
    {loading ? <div className="al-loading-grid"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data.records.length === 0 ? <section className="al-card al-empty-state"><div><span>◇</span><h3>{language === "ar" ? "لا توجد أصول مطابقة" : "No matching assets"}</h3><p>{language === "ar" ? "غيّر الفلاتر أو عبارة البحث." : "Change the filters or search text."}</p></div></section> : <div className="asset-manager-list">{data.records.map(asset => {
      const assetCategory = categoryMap.get(asset.categoryId);
      return <article className="al-card asset-manager-row" key={asset.id}>
        <div className="asset-manager-id"><span style={{ background: assetCategory?.color || "#87939a" }}>{assetCategory?.icon || "◇"}</span><div><strong>{asset.assetNo}</strong><small>{asset.project} · {[asset.building, asset.floor, asset.zone, asset.office].filter(Boolean).join(" / ") || "—"}</small></div></div>
        <div><small>{language === "ar" ? "الأصل" : "Asset"}</small><strong>{asset.assetType || "—"}</strong><span>{[asset.manufacturer, asset.model, asset.serial].filter(Boolean).join(" · ") || "—"}</span></div>
        <div><small>{language === "ar" ? "التصنيف" : "Category"}</small><strong>{assetCategory ? (language === "ar" ? assetCategory.labelAr : assetCategory.labelEn) : "—"}</strong><span>{assetOperationalStatusLabel(asset.operationalStatus, language)}</span></div>
        <div className="asset-manager-ratings"><span className={`condition-${asset.conditionRating}`}>{asset.conditionRating}/5 {assetConditionLabel(asset.conditionRating, language)}</span><span className={`criticality-${asset.criticalityRating}`}>{assetCriticalityLabel(asset.criticalityRating, language)} · W{assetCriticalityWeight(asset.criticalityRating)}</span></div>
        <div className="asset-manager-actions"><button className="al-primary-button" disabled={!asset.canEdit} onClick={() => openEditor(asset)}>{language === "ar" ? "تعديل الأصل" : "Edit asset"}</button><button className="al-secondary-button" disabled={!asset.canEdit || enrichingId === asset.id || !asset.manufacturer || !asset.model} onClick={() => void enrichAsset(asset)}>{enrichingId === asset.id ? (language === "ar" ? "جاري البحث…" : "Researching…") : (language === "ar" ? "جلب المواصفات" : "Enrich online")}</button></div>
      </article>;
    })}</div>}
    <footer className="asset-manager-pagination"><button disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}>{language === "ar" ? "السابق" : "Previous"}</button><span>{page} / {pageCount}</span><PaginationJump page={page} pageCount={pageCount} busy={loading} language={language} onPageChange={setPage}/><button disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>{language === "ar" ? "التالي" : "Next"}</button></footer>
    {editing && <div className="al-dialog-backdrop asset-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(null); }}><section className="al-dialog asset-editor" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
      <header><div><small>{editing.assetNo}</small><h3 id="asset-editor-title">{language === "ar" ? "تعديل الأصل وحالته" : "Edit asset and status"}</h3></div><button disabled={saving} onClick={() => setEditing(null)}>×</button></header>
      <div className="asset-editor-grid">
        <label><span>{language === "ar" ? "نوع الأصل" : "Asset type"} *</span><input value={editing.assetType} onChange={event => setEditing(current => current && ({ ...current, assetType: event.target.value }))} /></label>
        <label><span>{language === "ar" ? "التصنيف" : "Category"} *</span><select value={editing.categoryId} onChange={event => setEditing(current => current && ({ ...current, categoryId: event.target.value }))}>{categoriesForEdit.map(item => <option key={item.id} value={item.id}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
        <label><span>{language === "ar" ? "الشركة / البراند" : "Manufacturer / Brand"}</span><input value={editing.manufacturer} onChange={event => setEditing(current => current && ({ ...current, manufacturer: event.target.value }))} /></label>
        <label><span>{language === "ar" ? "الموديل" : "Model"}</span><input value={editing.model} onChange={event => setEditing(current => current && ({ ...current, model: event.target.value }))} /></label>
        <label><span>{language === "ar" ? "السيريال" : "Serial number"}</span><input value={editing.serial} onChange={event => setEditing(current => current && ({ ...current, serial: event.target.value }))} /></label>
        <label><span>{language === "ar" ? "حالة التشغيل" : "Operational status"} *</span><select value={editing.operationalStatus} onChange={event => setEditing(current => current && ({ ...current, operationalStatus: event.target.value as AssetOperationalStatus }))}>{ASSET_OPERATIONAL_STATUSES.map(item => <option key={item.code} value={item.code}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
        <label><span>Condition *</span><select value={editing.conditionRating} onChange={event => setEditing(current => current && ({ ...current, conditionRating: Number(event.target.value) }))}>{ASSET_CONDITION_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
        <label><span>Criticality *</span><select value={editing.criticalityRating} onChange={event => setEditing(current => current && ({ ...current, criticalityRating: Number(event.target.value) }))}>{ASSET_CRITICALITY_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn} (W{item.weight})</option>)}</select></label>
        {editing.conditionRating <= 3 && <label className="asset-editor-wide"><span>{language === "ar" ? "سبب الحالة والإجراء المقترح" : "Condition justification and action"}{editing.conditionRating <= 2 ? " *" : ""}</span><textarea maxLength={1000} value={editing.conditionJustification} onChange={event => setEditing(current => current && ({ ...current, conditionJustification: event.target.value }))} placeholder="Compressor defective; disconnect and replace." /></label>}
        <label><span>{language === "ar" ? "السعر التقريبي" : "Estimated price"}</span><input type="number" min="0" value={editing.estimatedPrice ?? ""} onChange={event => setEditing(current => current && ({ ...current, estimatedPrice: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
        <label><span>{language === "ar" ? "تكلفة الاستبدال" : "Replacement cost"}</span><input type="number" min="0" value={editing.replacementCost ?? ""} onChange={event => setEditing(current => current && ({ ...current, replacementCost: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
        <label><span>{language === "ar" ? "العملة" : "Currency"}</span><input maxLength={3} value={editing.priceCurrency} onChange={event => setEditing(current => current && ({ ...current, priceCurrency: event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) }))} /></label>
        <label><span>{language === "ar" ? "العمر الاستهلاكي" : "Useful life (years)"}</span><input type="number" min="1" max="100" value={editing.usefulLifeYears ?? ""} onChange={event => setEditing(current => current && ({ ...current, usefulLifeYears: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
        <label><span>{language === "ar" ? "تاريخ التركيب" : "Installation date"}</span><input type="date" value={editing.installationDate} onChange={event => setEditing(current => current && ({ ...current, installationDate: event.target.value }))} /></label>
        <label className="asset-editor-wide"><span>{language === "ar" ? "وصف مختصر" : "Summary"}</span><textarea value={editing.summary} onChange={event => setEditing(current => current && ({ ...current, summary: event.target.value }))} /></label>
        <label className="asset-editor-wide"><span>{language === "ar" ? "مصدر تقدير السعر/العمر" : "Price/life estimate source"}</span><input value={editing.estimateSource} onChange={event => setEditing(current => current && ({ ...current, estimateSource: event.target.value }))} placeholder={language === "ar" ? "عرض سعر، كتالوج المصنع، تقدير هندسي…" : "Quotation, manufacturer catalog, engineering estimate…"} /></label>
      </div>
      {error && <div className="al-alert" role="alert">{error}</div>}
      <footer><button className="al-secondary-button" disabled={saving} onClick={() => setEditing(null)}>{language === "ar" ? "إلغاء" : "Cancel"}</button><button className="al-primary-button" disabled={saving} onClick={() => void saveAsset()}>{saving ? (language === "ar" ? "جاري الحفظ…" : "Saving…") : (language === "ar" ? "حفظ التعديلات" : "Save changes")}</button></footer>
    </section></div>}
  </section>;
}
