"use client";

import { ChangeEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { exportWorkbook, readSpreadsheetRows } from "../lib/excel-client";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";

type CustomValue = { key: string; labelAr: string; labelEn: string; value: string };
type RecordRow = {
  id: string; assetNo: string; projectId: string; project: string; building: string; floor: string; zone: string;
  surveyorEmail: string; sourceFiles: string[]; assetType: string; summary: string; manufacturer: string; model: string; serial: string;
  customValues: CustomValue[]; warnings: string[]; confidence: number; status: string; error: string; createdAt: string;
  isDuplicate: boolean; missingFields: string[]; barcode: string; latitude: number | null; longitude: number | null; gpsAccuracy: number | null; capturedOffline: boolean; deviceCapturedAt: string;
};
type ReportPayload = { currentUser: { role: "admin" | "surveyor" }; projects: Array<{ id: string; name: string }>; records: RecordRow[]; error?: string };
type ImportPreview = { assetNo: string; assetType: string; manufacturer: string; model: string; serial: string; summary: string; building: string; floor: string; zone: string; customValues: Record<string, string> };

const STATUS_LABELS: Record<string, string> = { queued: "في الانتظار", processing: "قيد التحليل", completed: "معتمد", review: "يحتاج مراجعة", failed: "فشل" };
const STANDARD_CUSTOM = ["room", "section", "asset_condition", "asset_status", "department", "gps_location"];

function normalizeHeader(value: string) { return value.toLowerCase().replace(/[\s_\-/.()]+/g, "").trim(); }
function findCell(row: Record<string, unknown>, aliases: string[]) {
  const wanted = aliases.map(normalizeHeader); const entry = Object.entries(row).find(([key]) => wanted.includes(normalizeHeader(key)));
  return entry && entry[1] !== null && entry[1] !== undefined ? String(entry[1]).trim() : "";
}
function parseLegacyRow(row: Record<string, unknown>): ImportPreview {
  return {
    assetNo: findCell(row, ["Asset No", "Asset Number", "Tag No", "رقم الأصل"]),
    assetType: findCell(row, ["Asset Type", "Equipment Type", "Type", "نوع الأصل"]),
    manufacturer: findCell(row, ["Manufacturer", "Make", "Brand", "الشركة المصنعة"]),
    model: findCell(row, ["Model", "Model No", "Model Number", "الموديل"]),
    serial: findCell(row, ["Serial", "Serial No", "Serial Number", "S/N", "الرقم التسلسلي"]),
    summary: findCell(row, ["Description", "Summary", "Asset Description", "الوصف"]),
    building: findCell(row, ["Building", "Site", "Location", "المبنى", "الموقع"]),
    floor: findCell(row, ["Floor", "Level", "الطابق"]),
    zone: findCell(row, ["Zone", "Area", "الزون", "المنطقة"]),
    customValues: {
      room: findCell(row, ["Room", "Room No", "الغرفة"]), section: findCell(row, ["Section", "القسم"]),
      asset_condition: findCell(row, ["Asset Condition", "Condition", "حالة الأصل"]), asset_status: findCell(row, ["Asset Status", "Status", "حالة التشغيل"]),
      department: findCell(row, ["Department", "Dept", "الإدارة"]), gps_location: findCell(row, ["GPS Location", "GPS", "Coordinates", "الموقع الجغرافي"]),
    },
  };
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character)); }

export default function ReportsPage() {
  const [data, setData] = useState<ReportPayload | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""); const [project, setProject] = useState(""); const [building, setBuilding] = useState(""); const [assetType, setAssetType] = useState(""); const [status, setStatus] = useState(""); const [surveyor, setSurveyor] = useState(""); const [quality, setQuality] = useState(""); const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(150);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [importRows, setImportRows] = useState<ImportPreview[]>([]); const [importFile, setImportFile] = useState(""); const [importProject, setImportProject] = useState("");

  useEffect(() => {
    const assetQuery = new URLSearchParams(window.location.search).get("asset");
    const timer = window.setTimeout(() => { if (assetQuery) setSearch(assetQuery); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { void (async () => {
    try {
      const payload = await apiGet<ReportPayload>("/api/reports", { ttlMs: 30_000 });
      setData(payload);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) { window.location.replace("/login"); return; }
      setError(err instanceof Error ? err.message : "تعذر تحميل التقارير.");
    }
  })(); }, []);

  const records = useMemo(() => data?.records || [], [data]);
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filtered = useMemo(() => records.filter(row => {
    const haystack = [row.id, row.assetNo, row.project, row.building, row.floor, row.zone, row.assetType, row.manufacturer, row.model, row.serial, row.barcode, row.surveyorEmail, row.summary, ...row.customValues.map(item => item.value)].join(" ").toLowerCase();
    const created = row.createdAt.slice(0, 10);
    return (!normalizedSearch || haystack.includes(normalizedSearch)) && (!project || row.projectId === project) && (!building || row.building === building) && (!assetType || row.assetType === assetType) && (!status || row.status === status) && (!surveyor || row.surveyorEmail === surveyor) && (!dateFrom || created >= dateFrom) && (!dateTo || created <= dateTo) && (!quality || (quality === "duplicates" ? row.isDuplicate : quality === "missing" ? row.missingFields.length > 0 : quality === "low" ? row.confidence < .75 : true));
  }), [records, normalizedSearch, project, building, assetType, status, surveyor, dateFrom, dateTo, quality]);
  const visibleRows = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const filterOptions = useMemo(() => ({
    buildings: Array.from(new Set(records.map(row => row.building).filter(Boolean))).sort(),
    assetTypes: Array.from(new Set(records.map(row => row.assetType).filter(Boolean))).sort(),
    surveyors: Array.from(new Set(records.map(row => row.surveyorEmail).filter(Boolean))).sort(),
  }), [records]);
  const counts = useMemo(() => records.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === "completed") summary.completed += 1;
    else if (row.status === "review") summary.review += 1;
    else if (row.status === "failed") summary.failed += 1;
    else if (row.status === "queued" || row.status === "processing") summary.active += 1;
    if (row.isDuplicate) summary.duplicate += 1;
    if (row.missingFields.length) summary.missing += 1;
    return summary;
  }, { total:0, completed:0, review:0, active:0, failed:0, duplicate:0, missing:0 }), [records]);

  async function exportRows(rows: RecordRow[], suffix: string) {
    if (!rows.length) { setError("لا توجد بيانات مطابقة للتصدير."); return; }
    const allCustom = Array.from(new Map(rows.flatMap(row => row.customValues.map(value => [value.key, value]))).values());
    const sheetRows = rows.map(row => ({ "Asset No": row.assetNo, Project: row.project, "Building / Site": row.building, Floor: row.floor, Zone: row.zone, Barcode: row.barcode, Latitude: row.latitude ?? "", Longitude: row.longitude ?? "", "GPS Accuracy (m)": row.gpsAccuracy ?? "", "Captured Offline": row.capturedOffline ? "Yes" : "No", "Device Captured At": row.deviceCapturedAt, "Asset Type": row.assetType, Manufacturer: row.manufacturer, Model: row.model, "Serial Number": row.serial, Status: STATUS_LABELS[row.status] || row.status, Confidence: `${Math.round(row.confidence * 100)}%`, Surveyor: row.surveyorEmail, "Created At": new Date(row.createdAt).toLocaleString(), "Duplicate Serial": row.isDuplicate ? "Yes" : "No", "Missing Fields": row.missingFields.join(" | "), Summary: row.summary, ...Object.fromEntries(allCustom.map(field => [field.labelEn || field.labelAr, row.customValues.find(value => value.key === field.key)?.value || ""])) }));
    await exportWorkbook(`AssetLens_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Assets", rows: sheetRows }]);
  }

  async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; setError(""); setNotice("");
    try {
      const raw = await readSpreadsheetRows(file, 500); const parsed = raw.map(parseLegacyRow).filter(row => Object.values(row).some(value => typeof value === "string" && value));
      if (!parsed.length) throw new Error("لم أجد صفوف بيانات قابلة للاستيراد في الورقة الأولى."); setImportRows(parsed); setImportFile(file.name);
    } catch (err) { setImportRows([]); setImportFile(""); setError(err instanceof Error ? err.message : "تعذر قراءة ملف Excel."); }
  }
  async function importLegacy() {
    if (!importProject || !importRows.length) { setError("اختر المشروع وملف Excel أولاً."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "importLegacy", projectId: importProject, fileName: importFile, rows: importRows }) });
      const responseText = await response.text(); const payload = responseText ? JSON.parse(responseText) as { imported?: number; report?: ReportPayload; error?: string } : {};
      if (!response.ok) throw new Error(payload.error || `تعذر الاستيراد (${response.status}).`); invalidateApiCache(); if (payload.report) setData(payload.report); setImportRows([]); setImportFile(""); setNotice(`تم استيراد ${payload.imported || 0} أصل إلى سجل المراجعة.`);
    } catch (err) { setError(err instanceof Error ? err.message : "تعذر استيراد السجل القديم."); } finally { setBusy(false); }
  }

  function printQrLabels() {
    const rows = records.filter(row => selected.has(row.id)); if (!rows.length) { setError("حدد أصلًا واحدًا على الأقل لطباعة الملصقات."); return; }
    const popup = window.open("", "_blank"); if (!popup) { setError("اسمح بالنوافذ المنبثقة لفتح صفحة الطباعة."); return; } popup.opener = null;
    const labels = rows.map(row => { const target = `${window.location.origin}/reports?asset=${encodeURIComponent(row.id)}`; const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(target)}`; return `<article><img src="${qr}" alt="QR"><div><b>${escapeHtml(row.assetNo)}</b><strong>${escapeHtml(row.assetType || "Asset")}</strong><span>${escapeHtml(row.project)} · ${escapeHtml(row.building)}</span><small>${escapeHtml(row.serial || row.id)}</small></div></article>`; }).join("");
    popup.document.write(`<!doctype html><html dir="rtl"><head><title>AssetLens AI QR Labels</title><style>body{font-family:Arial;margin:20px;display:grid;grid-template-columns:repeat(2,1fr);gap:12px}article{border:1px solid #234;padding:10px;display:flex;gap:12px;align-items:center;break-inside:avoid}img{width:115px;height:115px}b,strong,span,small{display:block;margin:4px 0}b{font-size:17px;color:#073646}small{direction:ltr}@media print{body{margin:0}}</style></head><body>${labels}<script>window.onload=()=>setTimeout(()=>window.print(),800)<\/script></body></html>`); popup.document.close();
  }
  function setReportFilter(setter: (value: string) => void, value: string) {
    setter(value); setVisibleLimit(150);
  }
  function clearReportFilters() {
    setSearch(""); setProject(""); setBuilding(""); setAssetType(""); setStatus(""); setSurveyor(""); setQuality(""); setDateFrom(""); setDateTo(""); setVisibleLimit(150);
  }
  function applyStatFilter(label: string) {
    setVisibleLimit(150);
    if (label === "سيريال مكرر") { setQuality("duplicates"); return; }
    if (label === "بيانات ناقصة") { setQuality("missing"); return; }
    if (label === "معتمدة") { setStatus("completed"); return; }
    if (label === "تحتاج مراجعة") { setStatus("review"); return; }
    if (label === "فشلت") setStatus("failed");
  }

  return <main className="reports-shell al-page" dir="rtl">
    <header className="al-page-head legacy-page-head"><div><span className="al-page-kicker">Reports & exports</span><h2>سجل الأصول والتقارير</h2><p>بحث متقدم، متابعة التحليل، تقارير جودة البيانات، استيراد Excel وطباعة QR.</p></div></header>
    {error && <div className="reports-alert error">{error}</div>}{notice && <div className="reports-alert success">{notice}</div>}
    {!data ? <div className="reports-loading">جاري تحميل سجل الأصول…</div> : <>
      <section className="report-stats" aria-label="ملخص حالة السجل">{[[counts.total,"إجمالي الأصول"],[counts.completed,"معتمدة"],[counts.review,"تحتاج مراجعة"],[counts.active,"قيد التحليل"],[counts.failed,"فشلت"],[counts.duplicate,"سيريال مكرر"],[counts.missing,"بيانات ناقصة"]].map(([value,label]) => <button key={String(label)} onClick={() => applyStatFilter(String(label))}><strong>{value}</strong><span>{label}</span></button>)}</section>
      <section className="reports-card report-filters"><div className="reports-card-head"><span>01</span><div><h2>البحث والفلاتر المتقدمة</h2><p>اعرض البيانات حسب المشروع والموقع والنوع والحالة والمستخدم والتاريخ.</p></div><button onClick={clearReportFilters}>مسح الفلاتر</button></div><div className="filter-grid">
        <label className="wide">بحث شامل<input value={search} onChange={event => setReportFilter(setSearch, event.target.value)} placeholder="رقم الأصل، السيريال، الموديل، الموقع…" /></label>
        <label>المشروع<select value={project} onChange={event => setReportFilter(setProject, event.target.value)}><option value="">كل المشاريع</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>المبنى / الموقع<select value={building} onChange={event => setReportFilter(setBuilding, event.target.value)}><option value="">كل المواقع</option>{filterOptions.buildings.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>نوع الأصل<select value={assetType} onChange={event => setReportFilter(setAssetType, event.target.value)}><option value="">كل الأنواع</option>{filterOptions.assetTypes.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>حالة التحليل<select value={status} onChange={event => setReportFilter(setStatus, event.target.value)}><option value="">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>المستخدم<select value={surveyor} onChange={event => setReportFilter(setSurveyor, event.target.value)}><option value="">كل المستخدمين</option>{filterOptions.surveyors.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>جودة البيانات<select value={quality} onChange={event => setReportFilter(setQuality, event.target.value)}><option value="">كل مستويات الجودة</option><option value="missing">بها بيانات ناقصة</option><option value="duplicates">سيريال مكرر</option><option value="low">ثقة أقل من 75%</option></select></label>
        <label>من تاريخ<input type="date" value={dateFrom} onChange={event => setReportFilter(setDateFrom, event.target.value)} /></label><label>إلى تاريخ<input type="date" value={dateTo} onChange={event => setReportFilter(setDateTo, event.target.value)} /></label>
      </div><div className="report-actions"><strong>{filtered.length} نتيجة مطابقة</strong><button onClick={() => void exportRows(filtered, "Filtered_Report")}>تصدير النتائج إلى Excel</button><button className="missing-export" onClick={() => void exportRows(filtered.filter(row => row.missingFields.length), "Missing_Data")}>تقرير البيانات الناقصة</button><button className="qr-action" onClick={printQrLabels}>طباعة QR ({selected.size})</button></div></section>
      <section className="reports-card report-table-card"><div className="reports-card-head"><span>02</span><div><h2>سجل الأصول الموحد</h2><p>حدد السجلات المطلوبة ثم اطبع ملصقات QR للوصول إليها مباشرة.</p></div><label className="select-all"><input type="checkbox" checked={filtered.length > 0 && filtered.every(row => selected.has(row.id))} onChange={event => setSelected(previous => { const next = new Set(previous); filtered.forEach(row => { if (event.target.checked) next.add(row.id); else next.delete(row.id); }); return next; })} /> تحديد النتائج</label></div><div className="advanced-table-wrap"><table className="advanced-table"><thead><tr><th></th><th>رقم الأصل</th><th>المشروع والموقع</th><th>نوع الأصل</th><th>الشركة / الموديل</th><th>السيريال</th><th>الحالة</th><th>الجودة</th><th>المستخدم والتاريخ</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} className={row.missingFields.length ? "row-missing" : ""}><td><input type="checkbox" checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td><b>{row.assetNo}</b>{row.barcode && <small className="ltr-cell">▦ {row.barcode}</small>}<small>{Math.round(row.confidence*100)}% ثقة</small></td><td><strong>{row.project}</strong><small>{[row.building,row.floor,row.zone].filter(Boolean).join(" · ") || "—"}</small>{row.latitude !== null && row.longitude !== null && <small className="ltr-cell">⌖ {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</small>}</td><td>{row.assetType || "—"}</td><td>{row.manufacturer || "—"}<small>{row.model || "—"}</small></td><td className="ltr-cell">{row.serial || "—"}{row.isDuplicate && <em>مكرر</em>}</td><td><span className={`report-status ${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span>{row.capturedOffline && <small>تمت مزامنته من Offline</small>}{row.error && <small>{row.error}</small>}</td><td>{row.missingFields.length ? <details><summary>{row.missingFields.length} ناقص</summary><small>{row.missingFields.join("، ")}</small></details> : <span className="complete-data">مكتملة</span>}</td><td><span className="ltr-cell">{row.surveyorEmail}</span><small>{new Date(row.createdAt).toLocaleDateString("ar-AE")}</small></td></tr>)}</tbody></table>{!filtered.length && <p className="no-report-results">لا توجد أصول تطابق الفلاتر الحالية.</p>}</div>{visibleRows.length < filtered.length && <button className="load-more-records" onClick={() => setVisibleLimit(limit => limit + 150)}>عرض 150 سجل إضافي من {filtered.length}</button>}</section>
      {data.currentUser.role === "admin" && <section className="reports-card import-card"><div className="reports-card-head"><span>03</span><div><h2>استيراد سجل Excel قديم</h2><p>تُقرأ الورقة الأولى حتى 500 صف، وتُنقل الأصول إلى حالة المراجعة مع فحص السيريال المكرر.</p></div></div><div className="import-grid"><label>المشروع المستهدف<select value={importProject} onChange={event => setImportProject(event.target.value)}><option value="">اختر المشروع</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="file-picker">ملف Excel / CSV<input type="file" accept=".xlsx,.csv" onChange={chooseImport} /><span>{importFile || "اختر الملف"}</span></label><button disabled={busy || !importRows.length || !importProject} onClick={() => void importLegacy()}>{busy ? "جاري الاستيراد…" : `استيراد ${importRows.length || ""} أصل`}</button></div>{importRows.length > 0 && <div className="import-preview"><strong>معاينة أول 5 صفوف</strong><table><thead><tr><th>رقم الأصل</th><th>النوع</th><th>الشركة</th><th>الموديل</th><th>السيريال</th><th>الموقع</th></tr></thead><tbody>{importRows.slice(0,5).map((row,index) => <tr key={index}><td>{row.assetNo || "—"}</td><td>{row.assetType || "—"}</td><td>{row.manufacturer || "—"}</td><td>{row.model || "—"}</td><td>{row.serial || "—"}</td><td>{row.building || "—"}</td></tr>)}</tbody></table><small>تم التعرف تلقائيًا على الحقول القياسية: Asset No, Asset Type, Manufacturer, Model, Serial, Building, Floor, Zone و{STANDARD_CUSTOM.join(", ")}.</small></div>}</section>}
    </>}
  </main>;
}
