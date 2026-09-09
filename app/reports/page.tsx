"use client";
import { ChangeEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { exportWorkbook, readSpreadsheetRows } from "../lib/excel-client";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { buildAssetQrPayload, createAssetQrText, type AssetQrSource } from "../lib/asset-qr";
import { getAccessToken } from "../lib/supabase-auth";
import { ASSET_CONDITION_LEVELS, assetConditionLabel } from "../lib/asset-condition";
import { ASSET_CRITICALITY_LEVELS, assetCriticalityLabel, assetCriticalityWeight } from "../lib/asset-criticality";
import { canUseModule, ModulePermission } from "../lib/module-permissions";
type CustomValue = {
    key: string;
    labelAr: string;
    labelEn: string;
    value: string;
    unit?: string;
};
type DynamicLocationValue = { levelId: string; key: string; labelAr: string; labelEn: string; valueId: string; value: string };
type RecordRow = {
    id: string;
    assetNo: string;
    projectId: string;
    project: string;
    building: string;
    floor: string;
    zone: string;
    office: string;
    additionalLocations: DynamicLocationValue[];
    surveyorEmail: string;
    sourceFiles: string[];
    assetType: string;
    summary: string;
    manufacturer: string;
    model: string;
    serial: string;
    fields: Array<{
        key: string;
        label: string;
        value: string;
        confidence: number;
    }>;
    customValues: CustomValue[];
    warnings: string[];
    confidence: number;
    conditionRating: number | null;
    conditionJustification: string;
    criticalityRating: number | null;
    status: string;
    error: string;
    createdAt: string;
    isDuplicate: boolean;
    missingFields: string[];
    barcode: string;
    latitude: number | null;
    longitude: number | null;
    gpsAccuracy: number | null;
    capturedOffline: boolean;
    deviceCapturedAt: string;
    canEdit: boolean;
    canTransfer: boolean;
    canDelete: boolean;
};
type ReportPayload = {
    currentUser: {
        role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
        modulePermissions: ModulePermission[];
    };
    projects: Array<{
        id: string;
        name: string;
    }>;
    records: RecordRow[];
    error?: string;
};
type QrSnapshotResponse = {
    source: AssetQrSource;
    error?: string;
};
type ImportPreview = {
    assetNo: string;
    assetType: string;
    manufacturer: string;
    model: string;
    serial: string;
    summary: string;
    building: string;
    floor: string;
    zone: string;
    office: string;
    customValues: Record<string, string>;
};
const STATUS_LABELS: Record<string, string> = { queued: "في الانتظار", processing: "قيد التحليل", completed: "معتمد", review: "يحتاج مراجعة", failed: "فشل" };
const STANDARD_CUSTOM = ["room", "section", "asset_condition", "asset_status", "department", "gps_location"];
function normalizeHeader(value: string) { return value.toLowerCase().replace(/[\s_\-/.()]+/g, "").trim(); }
function findCell(row: Record<string, unknown>, aliases: string[]) {
    const wanted = aliases.map(normalizeHeader);
    const entry = Object.entries(row).find(([key]) => wanted.includes(normalizeHeader(key)));
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
        office: findCell(row, ["Office", "Room", "المكتب", "الغرفة"]),
        customValues: {
            room: findCell(row, ["Room", "Room No", "الغرفة"]), section: findCell(row, ["Section", "القسم"]),
            asset_condition: findCell(row, ["Asset Condition", "Condition", "حالة الأصل"]), asset_status: findCell(row, ["Asset Status", "Status", "حالة التشغيل"]),
            department: findCell(row, ["Department", "Dept", "الإدارة"]), gps_location: findCell(row, ["GPS Location", "GPS", "Coordinates", "الموقع الجغرافي"]),
        },
    };
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character)); }
export default function ReportsPage() {
    const [data, setData] = useState<ReportPayload | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [project, setProject] = useState("");
    const [building, setBuilding] = useState("");
    const [assetType, setAssetType] = useState("");
    const [status, setStatus] = useState("");
    const [condition, setCondition] = useState("");
    const [criticality, setCriticality] = useState("");
    const [surveyor, setSurveyor] = useState("");
    const [quality, setQuality] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [visibleLimit, setVisibleLimit] = useState(150);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [importRows, setImportRows] = useState<ImportPreview[]>([]);
    const [importFile, setImportFile] = useState("");
    const [importProject, setImportProject] = useState("");
    const [detail, setDetail] = useState<RecordRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RecordRow | null>(null);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const assetQuery = params.get("asset");
        const criticalityQuery = params.get("criticality");
        const timer = window.setTimeout(() => {
            if (assetQuery) setSearch(assetQuery);
            if (criticalityQuery && /^[1-5]$/.test(criticalityQuery)) setCriticality(criticalityQuery);
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);
    useEffect(() => {
        void (async () => {
            try {
                const payload = await apiGet<ReportPayload>("/api/reports", { ttlMs: 30000 });
                setData(payload);
            }
            catch (err) {
                if (err instanceof ApiClientError && err.status === 401) {
                    window.location.replace("/login");
                    return;
                }
                setError(err instanceof Error ? err.message : "تعذر تحميل التقارير.");
            }
        })();
    }, []);
    const records = useMemo(() => data?.records || [], [data]);
    const deferredSearch = useDeferredValue(search);
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    const filtered = useMemo(() => records.filter(row => {
        const haystack = [row.id, row.assetNo, row.project, row.building, row.floor, row.zone, row.office, ...row.additionalLocations.map(item => item.value), row.assetType, row.manufacturer, row.model, row.serial, row.barcode, row.surveyorEmail, row.summary, row.conditionJustification, assetConditionLabel(row.conditionRating), assetCriticalityLabel(row.criticalityRating), ...row.customValues.map(item => item.value)].join(" ").toLowerCase();
        const created = row.createdAt.slice(0, 10);
        return (!normalizedSearch || haystack.includes(normalizedSearch)) && (!project || row.projectId === project) && (!building || row.building === building) && (!assetType || row.assetType === assetType) && (!status || row.status === status) && (!condition || row.conditionRating === Number(condition)) && (!criticality || row.criticalityRating === Number(criticality)) && (!surveyor || row.surveyorEmail === surveyor) && (!dateFrom || created >= dateFrom) && (!dateTo || created <= dateTo) && (!quality || (quality === "duplicates" ? row.isDuplicate : quality === "missing" ? row.missingFields.length > 0 : quality === "low" ? row.confidence < .75 : true));
    }), [records, normalizedSearch, project, building, assetType, status, condition, criticality, surveyor, dateFrom, dateTo, quality]);
    const visibleRows = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
    const filterOptions = useMemo(() => ({
        buildings: Array.from(new Set(records.map(row => row.building).filter(Boolean))).sort(),
        assetTypes: Array.from(new Set(records.map(row => row.assetType).filter(Boolean))).sort(),
        surveyors: Array.from(new Set(records.map(row => row.surveyorEmail).filter(Boolean))).sort(),
    }), [records]);
    const counts = useMemo(() => records.reduce((summary, row) => {
        summary.total += 1;
        if (row.status === "completed")
            summary.completed += 1;
        else if (row.status === "review")
            summary.review += 1;
        else if (row.status === "failed")
            summary.failed += 1;
        else if (row.status === "queued" || row.status === "processing")
            summary.active += 1;
        if (row.isDuplicate)
            summary.duplicate += 1;
        if (row.missingFields.length)
            summary.missing += 1;
        return summary;
    }, { total: 0, completed: 0, review: 0, active: 0, failed: 0, duplicate: 0, missing: 0 }), [records]);
    async function exportRows(rows: RecordRow[], suffix: string) {
        if (!rows.length) {
            setError("لا توجد بيانات مطابقة للتصدير.");
            return;
        }
        const allCustom = Array.from(new Map(rows.flatMap(row => row.customValues.map(value => [value.key, value]))).values());
        const allLocations = Array.from(new Map(rows.flatMap(row => row.additionalLocations.map(value => [value.key, value]))).values());
        const sheetRows = rows.map(row => ({ "Asset No": row.assetNo, Project: row.project, "Building / Site": row.building, Floor: row.floor, Zone: row.zone, ...Object.fromEntries(allLocations.map(field => [field.labelEn || field.labelAr, row.additionalLocations.find(value => value.key === field.key)?.value || ""])), Barcode: row.barcode, Latitude: row.latitude ?? "", Longitude: row.longitude ?? "", "GPS Accuracy (m)": row.gpsAccuracy ?? "", "Captured Offline": row.capturedOffline ? "Yes" : "No", "Device Captured At": row.deviceCapturedAt, "Asset Type": row.assetType, Manufacturer: row.manufacturer, Model: row.model, "Serial Number": row.serial, "Condition Rating": row.conditionRating || "", Condition: assetConditionLabel(row.conditionRating, "en"), "Condition Justification": row.conditionJustification, "Criticality Rating": row.criticalityRating || "", Criticality: assetCriticalityLabel(row.criticalityRating, "en"), "Asset Weight": assetCriticalityWeight(row.criticalityRating) || "", Status: STATUS_LABELS[row.status] || row.status, Confidence: `${Math.round(row.confidence * 100)}%`, Surveyor: row.surveyorEmail, "Created At": new Date(row.createdAt).toLocaleString(), "Duplicate Serial": row.isDuplicate ? "Yes" : "No", "Missing Fields": row.missingFields.join(" | "), Summary: row.summary, ...Object.fromEntries(allCustom.map(field => [field.labelEn || field.labelAr, row.customValues.find(value => value.key === field.key)?.value || ""])) }));
        await exportWorkbook(`AssetLens_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Assets", rows: sheetRows }]);
    }
    async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file)
            return;
        setError("");
        setNotice("");
        try {
            const raw = await readSpreadsheetRows(file, 500);
            const parsed = raw.map(parseLegacyRow).filter(row => Object.values(row).some(value => typeof value === "string" && value));
            if (!parsed.length)
                throw new Error("لم أجد صفوف بيانات قابلة للاستيراد في الورقة الأولى.");
            setImportRows(parsed);
            setImportFile(file.name);
        }
        catch (err) {
            setImportRows([]);
            setImportFile("");
            setError(err instanceof Error ? err.message : "تعذر قراءة ملف Excel.");
        }
    }
    async function importLegacy() {
        if (!importProject || !importRows.length) {
            setError("اختر المشروع وملف Excel أولاً.");
            return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const token = await getAccessToken();
            if (!token) {
                window.location.replace("/login");
                return;
            }
            const response = await fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "importLegacy", projectId: importProject, fileName: importFile, rows: importRows }) });
            const responseText = await response.text();
            const payload = responseText ? JSON.parse(responseText) as {
                imported?: number;
                report?: ReportPayload;
                error?: string;
            } : {};
            if (!response.ok)
                throw new Error(payload.error || `تعذر الاستيراد (${response.status}).`);
            invalidateApiCache();
            if (payload.report)
                setData(payload.report);
            setImportRows([]);
            setImportFile("");
            setNotice(`تم استيراد ${payload.imported || 0} أصل إلى سجل المراجعة.`);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "تعذر استيراد السجل القديم.");
        }
        finally {
            setBusy(false);
        }
    }
    async function printQrLabels() {
        const rows = records.filter(row => selected.has(row.id));
        if (!rows.length) {
            setError("حدد أصلًا واحدًا على الأقل لطباعة الملصقات.");
            return;
        }
        const popup = window.open("", "_blank");
        if (!popup) {
            setError("اسمح بالنوافذ المنبثقة لفتح صفحة الطباعة.");
            return;
        }
        popup.opener = null;
        popup.document.write("<!doctype html><html dir=\"rtl\"><head><title>تجهيز QR</title></head><body style=\"font-family:Cairo,system-ui,Arial;padding:30px\">جاري إنشاء رموز QR من بيانات Supabase…</body></html>");
        try {
            const labels = await Promise.all(rows.map(async (row) => {
                // Never create a QR from the possibly stale report table. Re-read every
                // asset and all of its AI/custom fields from Supabase by its immutable ID.
                const snapshot = await apiGet<QrSnapshotResponse>(`/api/assets/${encodeURIComponent(row.id)}/qr`, { force: true, ttlMs: 0 });
                const payload = buildAssetQrPayload(snapshot.source);
                const target = createAssetQrText(payload);
                if (new TextEncoder().encode(target).byteLength > 1100)
                    throw new Error(`${row.assetNo}: البيانات الأساسية أكبر من سعة QR الآمنة للمسح.`);
                const qr = await QRCode.toDataURL(target, { width: 620, margin: 4, errorCorrectionLevel: "M", color: { dark: "#052f3d", light: "#ffffff" } });
                return `<article><img src="${qr}" alt="QR"><div><b>${escapeHtml(row.assetNo)}</b><strong>${escapeHtml(row.assetType || "Asset")}</strong><span>${escapeHtml(row.project)} · ${escapeHtml(row.building)} · ${escapeHtml(row.office || "")}</span><small>${escapeHtml(row.serial || row.id)}</small><em>QR خفيف — المعلومات الأساسية محفوظة داخله وتظهر بدون إنترنت</em></div></article>`;
            }));
            popup.document.open();
            popup.document.write(`<!doctype html><html dir="rtl"><head><title>AssetLens AI QR Labels</title><style>body{font-family:Cairo,system-ui,Arial;margin:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px}article{border:1px solid #234;padding:10px;display:flex;gap:12px;align-items:center;break-inside:avoid;min-height:190px}img{width:190px;height:190px;flex:0 0 190px;image-rendering:pixelated}b,strong,span,small,em{display:block;margin:3px 0}b{font-size:16px;color:#073646}small{direction:ltr}em{font-size:8px;color:#087d72;font-style:normal}@media print{body{margin:0}}</style></head><body>${labels.join("")}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
            popup.document.close();
        }
        catch (reason) {
            popup.close();
            setError(reason instanceof Error ? `تعذر إنشاء QR: ${reason.message}` : "تعذر إنشاء رموز QR.");
        }
    }
    function setReportFilter(setter: (value: string) => void, value: string) {
        setter(value);
        setVisibleLimit(150);
    }
    function clearReportFilters() {
        setSearch("");
        setProject("");
        setBuilding("");
        setAssetType("");
        setStatus("");
        setCondition("");
        setCriticality("");
        setSurveyor("");
        setQuality("");
        setDateFrom("");
        setDateTo("");
        setVisibleLimit(150);
    }
    function applyStatFilter(label: string) {
        setVisibleLimit(150);
        if (label === "سيريال مكرر") {
            setQuality("duplicates");
            return;
        }
        if (label === "بيانات ناقصة") {
            setQuality("missing");
            return;
        }
        if (label === "معتمدة") {
            setStatus("completed");
            return;
        }
        if (label === "تحتاج مراجعة") {
            setStatus("review");
            return;
        }
        if (label === "فشلت")
            setStatus("failed");
    }
    async function removeAsset() {
        if (!deleteTarget)
            return;
        setBusy(true);
        setError("");
        try {
            const token = await getAccessToken();
            if (!token) {
                window.location.replace("/login");
                return;
            }
            const response = await fetch(`/api/assets?id=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            const payload = await response.json() as {
                error?: string;
            };
            if (!response.ok)
                throw new Error(payload.error || "تعذر حذف الأصل.");
            setData(current => current ? { ...current, records: current.records.filter(row => row.id !== deleteTarget.id) } : current);
            setSelected(current => { const next = new Set(current); next.delete(deleteTarget.id); return next; });
            if (detail?.id === deleteTarget.id)
                setDetail(null);
            setDeleteTarget(null);
            invalidateApiCache();
            setNotice("تم حذف الأصل من السجل.");
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : "تعذر حذف الأصل.");
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="reports-shell al-page" dir="rtl">
    <header className="al-page-head legacy-page-head"><div><span className="al-page-kicker">Reports & exports</span><h2>سجل الأصول والتقارير</h2><p>بحث متقدم، متابعة التحليل، تقارير جودة البيانات، استيراد Excel وطباعة QR.</p></div></header>
    {error && <div className="reports-alert error">{error}</div>}{notice && <div className="reports-alert success">{notice}</div>}
    {!data ? <div className="reports-loading">جاري تحميل سجل الأصول…</div> : <>
      <section className="report-stats" aria-label="ملخص حالة السجل">{[[counts.total, "إجمالي الأصول"], [counts.completed, "معتمدة"], [counts.review, "تحتاج مراجعة"], [counts.active, "قيد التحليل"], [counts.failed, "فشلت"], [counts.duplicate, "سيريال مكرر"], [counts.missing, "بيانات ناقصة"]].map(([value, label]) => <button key={String(label)} onClick={() => applyStatFilter(String(label))}><strong>{value}</strong><span>{label}</span></button>)}</section>
      <section className="reports-card report-filters"><div className="reports-card-head"><span>01</span><div><h2>البحث والفلاتر المتقدمة</h2><p>اعرض البيانات حسب المشروع والموقع والنوع والحالة والمستخدم والتاريخ.</p></div><button onClick={clearReportFilters}>مسح الفلاتر</button></div><div className="filter-grid">
        <label className="wide">بحث شامل<input value={search} onChange={event => setReportFilter(setSearch, event.target.value)} placeholder="رقم الأصل، السيريال، الموديل، الموقع…"/></label>
        <label>المشروع<select value={project} onChange={event => setReportFilter(setProject, event.target.value)}><option value="">كل المشاريع</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>المبنى / الموقع<select value={building} onChange={event => setReportFilter(setBuilding, event.target.value)}><option value="">كل المواقع</option>{filterOptions.buildings.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>نوع الأصل<select value={assetType} onChange={event => setReportFilter(setAssetType, event.target.value)}><option value="">كل الأنواع</option>{filterOptions.assetTypes.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>حالة التحليل<select value={status} onChange={event => setReportFilter(setStatus, event.target.value)}><option value="">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>حالة الأصل<select value={condition} onChange={event => setReportFilter(setCondition, event.target.value)}><option value="">كل التقييمات</option>{ASSET_CONDITION_LEVELS.map(level => <option key={level.rating} value={level.rating}>{level.rating}/5 — {level.labelAr}</option>)}</select></label>
        <label>أهمية الأصل<select value={criticality} onChange={event => setReportFilter(setCriticality, event.target.value)}><option value="">كل درجات الأهمية</option>{ASSET_CRITICALITY_LEVELS.map(level => <option key={level.rating} value={level.rating}>{level.labelAr} — وزن {level.weight}</option>)}</select></label>
        <label>المستخدم<select value={surveyor} onChange={event => setReportFilter(setSurveyor, event.target.value)}><option value="">كل المستخدمين</option>{filterOptions.surveyors.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>جودة البيانات<select value={quality} onChange={event => setReportFilter(setQuality, event.target.value)}><option value="">كل مستويات الجودة</option><option value="missing">بها بيانات ناقصة</option><option value="duplicates">سيريال مكرر</option><option value="low">ثقة أقل من 75%</option></select></label>
        <label>من تاريخ<input type="date" value={dateFrom} onChange={event => setReportFilter(setDateFrom, event.target.value)}/></label><label>إلى تاريخ<input type="date" value={dateTo} onChange={event => setReportFilter(setDateTo, event.target.value)}/></label>
      </div><div className="report-actions"><strong>{filtered.length} نتيجة مطابقة</strong>{canUseModule(data.currentUser.modulePermissions, "reports", "export") && <><button onClick={() => void exportRows(filtered, "Filtered_Report")}>تصدير النتائج إلى Excel</button><button className="missing-export" onClick={() => void exportRows(filtered.filter(row => row.missingFields.length), "Missing_Data")}>تقرير البيانات الناقصة</button><button className="qr-action" onClick={() => void printQrLabels()}>طباعة QR Offline ({selected.size})</button></>}</div></section>
      <section className="reports-card report-table-card"><div className="reports-card-head"><span>02</span><div><h2>سجل الأصول الموحد</h2><p>حدد السجلات المطلوبة ثم اطبع ملصقات QR للوصول إليها مباشرة.</p></div><label className="select-all"><input type="checkbox" checked={filtered.length > 0 && filtered.every(row => selected.has(row.id))} onChange={event => setSelected(previous => { const next = new Set(previous); filtered.forEach(row => { if (event.target.checked)
            next.add(row.id);
        else
            next.delete(row.id); }); return next; })}/> تحديد النتائج</label></div><div className="advanced-table-wrap"><table className="advanced-table"><thead><tr><th></th><th>رقم الأصل</th><th>المشروع والموقع</th><th>نوع الأصل</th><th>الشركة / الموديل</th><th>السيريال</th><th>حالة الأصل</th><th>أهمية الأصل</th><th>حالة التحليل</th><th>الجودة</th><th>المستخدم والتاريخ</th><th>الإجراءات</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} className={row.missingFields.length ? "row-missing" : ""}><td><input type="checkbox" checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked)
            next.add(row.id);
        else
            next.delete(row.id); return next; })}/></td><td><b>{row.assetNo}</b>{row.barcode && <small className="ltr-cell">▦ {row.barcode}</small>}<small>{Math.round(row.confidence * 100)}% ثقة</small></td><td><strong>{row.project}</strong><small>{[row.building, row.floor, row.zone, row.office, ...row.additionalLocations.map(item => item.value)].filter(Boolean).join(" · ") || "—"}</small>{row.latitude !== null && row.longitude !== null && <small className="ltr-cell">⌖ {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</small>}</td><td>{row.assetType || "—"}</td><td>{row.manufacturer || "—"}<small>{row.model || "—"}</small></td><td className="ltr-cell">{row.serial || "—"}{row.isDuplicate && <em>مكرر</em>}</td><td>{row.conditionRating ? <span className="report-condition"><b>{row.conditionRating}/5</b>{assetConditionLabel(row.conditionRating)}</span> : "—"}</td><td>{row.criticalityRating ? <span className={`report-criticality criticality-${row.criticalityRating}`}><b>{assetCriticalityLabel(row.criticalityRating)}</b><small>وزن {assetCriticalityWeight(row.criticalityRating)}</small></span> : "—"}</td><td><span className={`report-status ${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span>{row.capturedOffline && <small>تمت مزامنته من Offline</small>}{row.error && <small>{row.error}</small>}</td><td>{row.missingFields.length ? <details><summary>{row.missingFields.length} ناقص</summary><small>{row.missingFields.join("، ")}</small></details> : <span className="complete-data">مكتملة</span>}</td><td><span className="ltr-cell">{row.surveyorEmail}</span><small>{new Date(row.createdAt).toLocaleDateString("ar-AE")}</small></td><td><div className="asset-row-actions"><button onClick={() => setDetail(row)}>عرض</button>{row.canTransfer && <Link href={`/transfers?asset=${encodeURIComponent(row.id)}`}>نقل</Link>}{row.canDelete && <button onClick={() => setDeleteTarget(row)}>حذف</button>}</div></td></tr>)}</tbody></table>{!filtered.length && <p className="no-report-results">لا توجد أصول تطابق الفلاتر الحالية.</p>}</div>{visibleRows.length < filtered.length && <button className="load-more-records" onClick={() => setVisibleLimit(limit => limit + 150)}>عرض 150 سجل إضافي من {filtered.length}</button>}</section>
      {data.currentUser.role === "admin" && <section className="reports-card import-card"><div className="reports-card-head"><span>03</span><div><h2>استيراد سجل Excel قديم</h2><p>تُقرأ الورقة الأولى حتى 500 صف، وتُنقل الأصول إلى حالة المراجعة مع فحص السيريال المكرر.</p></div></div><div className="import-grid"><label>المشروع المستهدف<select value={importProject} onChange={event => setImportProject(event.target.value)}><option value="">اختر المشروع</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="file-picker">ملف Excel / CSV<input type="file" accept=".xlsx,.csv" onChange={chooseImport}/><span>{importFile || "اختر الملف"}</span></label><button disabled={busy || !importRows.length || !importProject} onClick={() => void importLegacy()}>{busy ? "جاري الاستيراد…" : `استيراد ${importRows.length || ""} أصل`}</button></div>{importRows.length > 0 && <div className="import-preview"><strong>معاينة أول 5 صفوف</strong><table><thead><tr><th>رقم الأصل</th><th>النوع</th><th>الشركة</th><th>الموديل</th><th>السيريال</th><th>الموقع</th></tr></thead><tbody>{importRows.slice(0, 5).map((row, index) => <tr key={index}><td>{row.assetNo || "—"}</td><td>{row.assetType || "—"}</td><td>{row.manufacturer || "—"}</td><td>{row.model || "—"}</td><td>{row.serial || "—"}</td><td>{row.building || "—"}</td></tr>)}</tbody></table><small>تم التعرف تلقائيًا على الحقول القياسية: Asset No, Asset Type, Manufacturer, Model, Serial, Building, Floor, Zone, Office و{STANDARD_CUSTOM.join(", ")}.</small></div>}</section>}
      {detail && <div className="al-dialog-backdrop report-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget)
            setDetail(null); }}><section className="al-dialog report-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="report-detail-title"><header><div><small>ASSET DETAILS</small><h3 id="report-detail-title">{detail.assetNo}</h3><p>{detail.assetType} · {[detail.project, detail.building, detail.floor, detail.zone, detail.office, ...detail.additionalLocations.map(item => item.value)].filter(Boolean).join(" / ")}</p></div><button onClick={() => setDetail(null)}>×</button></header><dl><div><dt>الشركة المصنعة</dt><dd>{detail.manufacturer || "—"}</dd></div><div><dt>الموديل</dt><dd>{detail.model || "—"}</dd></div><div><dt>السيريال</dt><dd className="ltr-cell">{detail.serial || "—"}</dd></div><div><dt>حالة الأصل</dt><dd>{detail.conditionRating ? `${detail.conditionRating}/5 — ${assetConditionLabel(detail.conditionRating)}` : "غير مقيّم"}</dd></div>{detail.conditionJustification && <div><dt>سبب تقييم الحالة</dt><dd>{detail.conditionJustification}</dd></div>}<div><dt>أهمية الأصل</dt><dd>{detail.criticalityRating ? `${assetCriticalityLabel(detail.criticalityRating)} — الوزن التلقائي ${assetCriticalityWeight(detail.criticalityRating)}` : "غير محددة"}</dd></div><div><dt>حالة التحليل</dt><dd>{STATUS_LABELS[detail.status] || detail.status}</dd></div>{detail.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.value || "—"}</dd></div>)}{detail.customValues.map(field => <div key={field.key}><dt>{field.labelAr || field.labelEn || field.key}{field.unit ? ` (${field.unit})` : ""}</dt><dd>{field.value || "—"}</dd></div>)}</dl><footer>{detail.canTransfer && <Link className="al-secondary-button" href={`/transfers?asset=${encodeURIComponent(detail.id)}`}>نقل الأصل</Link>}<button className="al-primary-button" onClick={() => setDetail(null)}>إغلاق</button></footer></section></div>}
      {deleteTarget && <div className="al-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy)
            setDeleteTarget(null); }}><section className="al-dialog" role="dialog" aria-modal="true" aria-labelledby="report-delete-title"><span className="al-dialog-icon danger">!</span><h3 id="report-delete-title">حذف الأصل {deleteTarget.assetNo}</h3><p>سيتم حذف السجل والصور المرتبطة به. هذه العملية لا يمكن التراجع عنها.</p><div><button className="al-secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>إلغاء</button><button className="al-danger-button" disabled={busy} onClick={() => void removeAsset()}>{busy ? "جاري الحذف…" : "حذف نهائي"}</button></div></section></div>}
    </>}
  </main>;
}
