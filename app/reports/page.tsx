"use client";
import { ChangeEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { exportWorkbook, inspectSpreadsheet } from "../lib/excel-client";
import { findImportCell, reconcileImportCounts } from "../lib/import-mapping";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { buildAssetQrPayload, createAssetQrValue, type AssetQrSource } from "../lib/asset-qr";
import { getAccessToken } from "../lib/supabase-auth";
import { ASSET_CONDITION_LEVELS, assetConditionLabel } from "../lib/asset-condition";
import { ASSET_CRITICALITY_LEVELS, assetCriticalityLabel, assetCriticalityWeight } from "../lib/asset-criticality";
import { ASSET_OPERATIONAL_STATUSES, assetOperationalStatusLabel } from "../lib/asset-operational-status";
import { canUseModule, ModulePermission } from "../lib/module-permissions";
import { languageText, useUiLanguage } from "../lib/use-ui-language";
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
    categoryId: string;
    categoryAr: string;
    categoryEn: string;
    operationalStatus: string;
    estimatedPrice: number | null;
    replacementCost: number | null;
    priceCurrency: string;
    usefulLifeYears: number | null;
    remainingLifeYears: number | null;
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
    categories: Array<{ id: string; labelAr: string; labelEn: string }>;
    records: RecordRow[];
    error?: string;
};
type QrSnapshotResponse = {
    source: AssetQrSource;
    error?: string;
};
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await task(items[index], index);
        }
    }
    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
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
    extraFields: Record<string, string>;
    duplicateInFile: boolean;
    conditionRating: number | null;
    conditionJustification: string;
    criticalityRating: number | null;
    sourceSheet: string;
    sourceRow: number;
};
const STATUS_LABELS_AR: Record<string, string> = { queued: "في الانتظار", processing: "قيد التحليل", completed: "معتمد", review: "يحتاج مراجعة", failed: "فشل" };
const STATUS_LABELS_EN: Record<string, string> = { queued: "Queued", processing: "Processing", completed: "Approved", review: "Needs review", failed: "Failed" };
function normalizeHeader(value: string) { return value.toLowerCase().replace(/[\s_\-/.()]+/g, "").trim(); }
type ImportColumnKey = "assetNo" | "assetType" | "manufacturer" | "model" | "serial" | "summary" | "building" | "floor" | "zone" | "office" | "conditionRating" | "conditionJustification" | "criticalityRating";
const IMPORT_ALIASES: Record<ImportColumnKey, string[]> = {
    assetNo: ["Asset No", "Asset Number", "Tag No", "رقم الأصل"], assetType: ["Asset Type", "Equipment Type", "Type", "نوع الأصل"], manufacturer: ["Manufacturer", "Make", "Brand", "الشركة المصنعة"], model: ["Model", "Model No", "Model Number", "الموديل"], serial: ["Serial", "Serial No", "Serial Number", "S/N", "الرقم التسلسلي"], summary: ["Description", "Summary", "Asset Description", "الوصف"], building: ["Building", "Site", "Location", "المبنى", "الموقع"], floor: ["Floor", "Level", "الطابق"], zone: ["Zone", "Area", "الزون", "المنطقة"], office: ["Office", "Room", "المكتب", "الغرفة"], conditionRating: ["Condition Rating", "Asset Condition Rating", "تقييم الحالة"], conditionJustification: ["Condition Justification", "Condition Notes", "ملاحظات الحالة", "سبب الحالة"], criticalityRating: ["Criticality", "Criticality Rating", "Importance", "الأهمية", "تقييم الأهمية"],
};
function ratingValue(value: string) { const match = value.match(/[1-5]/); return match ? Number(match[0]) : null; }
function spreadsheetExtraFields(row: Record<string, unknown>, mapping: Partial<Record<ImportColumnKey, string>>) {
    const knownHeaders = new Set([
        ...Object.values(mapping).filter(Boolean).map(normalizeHeader),
        ...Object.values(IMPORT_ALIASES).flat().map(normalizeHeader),
        normalizeHeader("__sheet"), normalizeHeader("__row"),
    ]);
    return Object.fromEntries(Object.entries(row)
        .filter(([key, value]) => !knownHeaders.has(normalizeHeader(key)) && value !== null && value !== undefined && String(value).trim())
        .map(([key, value]) => [key.slice(0, 120), String(value).trim().slice(0, 1000)]));
}
function parseLegacyRow(row: Record<string, unknown>, mapping: Partial<Record<ImportColumnKey, string>> = {}): ImportPreview {
    const cell = (key: ImportColumnKey) => findImportCell(row, IMPORT_ALIASES[key], mapping[key]);
    return {
        assetNo: cell("assetNo"), assetType: cell("assetType"), manufacturer: cell("manufacturer"), model: cell("model"), serial: cell("serial"), summary: cell("summary"), building: cell("building"), floor: cell("floor"), zone: cell("zone"), office: cell("office"),
        customValues: {
            room: findImportCell(row, ["Room", "Room No", "الغرفة"]), section: findImportCell(row, ["Section", "القسم"]),
            asset_condition: findImportCell(row, ["Asset Condition", "Condition", "حالة الأصل"]), asset_status: findImportCell(row, ["Asset Status", "Status", "حالة التشغيل"]),
            department: findImportCell(row, ["Department", "Dept", "الإدارة"]), gps_location: findImportCell(row, ["GPS Location", "GPS", "Coordinates", "الموقع الجغرافي"]),
        }, extraFields: spreadsheetExtraFields(row, mapping), duplicateInFile: false, conditionRating: ratingValue(cell("conditionRating")), conditionJustification: cell("conditionJustification"), criticalityRating: ratingValue(cell("criticalityRating")), sourceSheet: String(row.__sheet || "Sheet"), sourceRow: Number(row.__row) || 0,
    };
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character)); }
export default function ReportsPage() {
    const language = useUiLanguage();
    const l = (ar: string, en: string) => languageText(language, ar, en);
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
    const [category, setCategory] = useState("");
    const [operationalStatus, setOperationalStatus] = useState("");
    const [surveyor, setSurveyor] = useState("");
    const [quality, setQuality] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [visibleLimit, setVisibleLimit] = useState(150);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [importFile, setImportFile] = useState("");
    const [importFileData, setImportFileData] = useState<File | null>(null);
    const [importProject, setImportProject] = useState("");
    const [rawImportRows, setRawImportRows] = useState<Record<string, string>[]>([]);
    const [importHeaders, setImportHeaders] = useState<string[]>([]);
    const [importSheets, setImportSheets] = useState<Array<{ sheet: string; headerRow: number; rowCount: number }>>([]);
    const [importHeaderChoices, setImportHeaderChoices] = useState<Record<string, number>>({});
    const [importMapping, setImportMapping] = useState<Partial<Record<ImportColumnKey, string>>>({});
    const [importCategory, setImportCategory] = useState("");
    const [importCondition, setImportCondition] = useState("");
    const [importCriticality, setImportCriticality] = useState("");
    const [importJustification, setImportJustification] = useState("");
    const [importBuildingFallback, setImportBuildingFallback] = useState("");
    const [importBuildingOverrides, setImportBuildingOverrides] = useState<Record<string, string>>({});
    const [importProgress, setImportProgress] = useState(0);
    const [importRejected, setImportRejected] = useState<Array<{ row: number; sheet: string; reason: string }>>([]);
    const [detail, setDetail] = useState<RecordRow | null>(null);
    const [detailBuilding, setDetailBuilding] = useState("");
    const [savingLocation, setSavingLocation] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<RecordRow | null>(null);
    async function saveDetailBuilding() {
      if (!detail || savingLocation) return;
      setSavingLocation(true); setError("");
      try {
        const token = await getAccessToken(); if (!token) throw new Error(l("سجّل الدخول مجددًا.", "Sign in again."));
        const response = await fetch("/api/assets", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "amendLocation", id: detail.id, building: detailBuilding }) });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error || l("تعذر حفظ المبنى.", "Could not save the building."));
        const updated = { ...detail, building: detailBuilding.trim(), missingFields: detail.missingFields.filter(field => field !== "Building / Site") };
        setDetail(updated); setData(current => current && ({ ...current, records: current.records.map(record => record.id === detail.id ? updated : record) }));
        invalidateApiCache("/api/reports"); setNotice(l("تم حفظ المبنى للأصل؛ يمكنك استكمال بقية المعلومات لاحقًا.", "Building saved; complete the rest of the record later."));
      } catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر الحفظ.", "Save failed.")); }
      finally { setSavingLocation(false); }
    }
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
        const haystack = [row.id, row.assetNo, row.project, row.building, row.floor, row.zone, row.office, ...row.additionalLocations.map(item => item.value), row.assetType, row.categoryAr, row.categoryEn, row.manufacturer, row.model, row.serial, row.barcode, row.surveyorEmail, row.summary, row.conditionJustification, assetConditionLabel(row.conditionRating), assetCriticalityLabel(row.criticalityRating), assetOperationalStatusLabel(row.operationalStatus), ...row.customValues.map(item => item.value)].join(" ").toLowerCase();
        const created = row.createdAt.slice(0, 10);
        return (!normalizedSearch || haystack.includes(normalizedSearch)) && (!project || row.projectId === project) && (!building || row.building === building) && (!assetType || row.assetType === assetType) && (!category || row.categoryId === category) && (!operationalStatus || row.operationalStatus === operationalStatus) && (!status || row.status === status) && (!condition || row.conditionRating === Number(condition)) && (!criticality || row.criticalityRating === Number(criticality)) && (!surveyor || row.surveyorEmail === surveyor) && (!dateFrom || created >= dateFrom) && (!dateTo || created <= dateTo) && (!quality || (quality === "duplicates" ? row.isDuplicate : quality === "missing" ? row.missingFields.length > 0 : quality === "low" ? row.confidence < .75 : true));
    }), [records, normalizedSearch, project, building, assetType, category, operationalStatus, status, condition, criticality, surveyor, dateFrom, dateTo, quality]);
    const visibleRows = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
    const filterOptions = useMemo(() => ({
        buildings: Array.from(new Set(records.map(row => row.building).filter(Boolean))).sort(),
        assetTypes: Array.from(new Set(records.map(row => row.assetType).filter(Boolean))).sort(),
        categories: Array.from(new Map(records.filter(row => row.categoryId).map(row => [row.categoryId, { id: row.categoryId, label: row.categoryAr || row.categoryEn }])).values()).sort((a, b) => a.label.localeCompare(b.label, "ar")),
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
    const importRows = useMemo(() => {
        const parsed = rawImportRows.map(row => parseLegacyRow(row, importMapping));
        const serialCounts = new Map<string, number>();
        parsed.forEach(row => { const serial = normalizeHeader(row.serial); if (serial) serialCounts.set(serial, (serialCounts.get(serial) || 0) + 1); });
        return parsed.map(row => ({ ...row, duplicateInFile: Boolean(row.serial && (serialCounts.get(normalizeHeader(row.serial)) || 0) > 1) }));
    }, [rawImportRows, importMapping]);
    async function exportRows(rows: RecordRow[], suffix: string) {
        if (!rows.length) {
            setError("لا توجد بيانات مطابقة للتصدير.");
            return;
        }
        const allCustom = Array.from(new Map(rows.flatMap(row => row.customValues.map(value => [value.key, value]))).values());
        const allLocations = Array.from(new Map(rows.flatMap(row => row.additionalLocations.map(value => [value.key, value]))).values());
        const allDetected = Array.from(new Map(rows.flatMap(row => row.fields.map(value => [value.label || value.key, value]))).values());
        const sheetRows = rows.map(row => ({ "Asset No": row.assetNo, Project: row.project, "Building / Site": row.building, Floor: row.floor, Zone: row.zone, Office: row.office, ...Object.fromEntries(allLocations.map(field => [field.labelEn || field.labelAr, row.additionalLocations.find(value => value.key === field.key)?.value || ""])), Barcode: row.barcode, Latitude: row.latitude ?? "", Longitude: row.longitude ?? "", "GPS Accuracy (m)": row.gpsAccuracy ?? "", "Captured Offline": row.capturedOffline ? "Yes" : "No", "Device Captured At": row.deviceCapturedAt, "Asset Category": row.categoryEn || row.categoryAr, "Asset Type": row.assetType, Manufacturer: row.manufacturer, Model: row.model, "Serial Number": row.serial, "Operational Status": assetOperationalStatusLabel(row.operationalStatus, "en"), "Condition Rating": row.conditionRating || "", Condition: assetConditionLabel(row.conditionRating, "en"), "Condition Justification": row.conditionJustification, "Criticality Rating": row.criticalityRating || "", Criticality: assetCriticalityLabel(row.criticalityRating, "en"), "Asset Weight": assetCriticalityWeight(row.criticalityRating) || "", "Estimated Price": row.estimatedPrice ?? "", "Replacement Cost": row.replacementCost ?? "", Currency: row.priceCurrency, "Useful Life (years)": row.usefulLifeYears ?? "", "Remaining Life (years)": row.remainingLifeYears ?? "", Status: STATUS_LABELS_EN[row.status] || row.status, Confidence: `${Math.round(row.confidence * 100)}%`, Surveyor: row.surveyorEmail, "Created At": new Date(row.createdAt).toLocaleString(), "Duplicate Serial": row.isDuplicate ? "Yes" : "No", "Missing Fields": row.missingFields.join(" | "), Summary: row.summary, ...Object.fromEntries(allDetected.map(field => [`Field: ${field.label || field.key}`, row.fields.find(value => (value.label || value.key) === (field.label || field.key))?.value || ""])), ...Object.fromEntries(allCustom.map(field => [field.labelEn || field.labelAr, row.customValues.find(value => value.key === field.key)?.value || ""])) }));
        await exportWorkbook(`AssetLens_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Assets", rows: sheetRows }]);
    }
    async function inspectImportFile(file: File, headerRows: Record<string, number>) {
        const inspection = await inspectSpreadsheet(file, 100_000, headerRows);
        const autoMapping = Object.fromEntries((Object.keys(IMPORT_ALIASES) as ImportColumnKey[]).map(key => [key, inspection.headers.find(header => IMPORT_ALIASES[key].map(normalizeHeader).includes(normalizeHeader(header))) || ""])) as Partial<Record<ImportColumnKey, string>>;
        if (!inspection.rows.length) throw new Error(l("لم أجد صفوف بيانات قابلة للاستيراد في الملف.", "No importable data rows were found."));
        setRawImportRows(inspection.rows); setImportHeaders(inspection.headers); setImportMapping(autoMapping); setImportSheets(inspection.sheets.map(sheet => ({ sheet: sheet.sheet, headerRow: sheet.headerRow, rowCount: sheet.rowCount })));
        setImportHeaderChoices(Object.fromEntries(inspection.sheets.map(sheet => [sheet.sheet, sheet.headerRow])));
        setImportFileData(file); setImportFile(file.name); setImportRejected([]);
    }
    async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file)
            return;
        setError("");
        setNotice("");
        try {
            await inspectImportFile(file, {});
        }
        catch (err) {
            setRawImportRows([]); setImportHeaders([]); setImportSheets([]); setImportMapping({});
            setImportFile(""); setImportFileData(null); setImportHeaderChoices({});
            setError(err instanceof Error ? err.message : "تعذر قراءة ملف Excel.");
        }
        event.target.value = "";
    }
    async function applyImportHeaderChoices() {
        if (!importFileData) return;
        setError("");
        try { await inspectImportFile(importFileData, importHeaderChoices); }
        catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر تحديث صف العناوين.", "Could not update the header row.")); }
    }
    async function importLegacy() {
        if (importSheets.some(sheet => importHeaderChoices[sheet.sheet] !== sheet.headerRow)) { setError(l("طبّق اختيار صف العناوين قبل بدء الاستيراد.", "Apply the header-row choices before importing.")); return; }
        if (!importProject || !importRows.length) {
            setError(l("اختر المشروع وملف Excel أولاً.", "Choose a project and a spreadsheet first."));
            return;
        }
        setBusy(true);
        setImportProgress(10);
        setError("");
        setNotice("");
        setImportRejected([]);
        try {
            const token = await getAccessToken();
            if (!token) {
                window.location.replace("/login");
                return;
            }
            const preparedRows = importRows.map(row => ({ ...row, building: importBuildingOverrides[`${row.sourceSheet}:${row.sourceRow}`]?.trim() || row.building || importBuildingFallback.trim(), categoryId: importCategory || null, conditionRating: row.conditionRating || (importCondition ? Number(importCondition) : null), conditionJustification: row.conditionJustification || importJustification, criticalityRating: row.criticalityRating || (importCriticality ? Number(importCriticality) : null), operationalStatus: row.customValues.asset_status || "unknown" }));
            const batchSize = 200;
            const batches = Array.from({ length: Math.ceil(preparedRows.length / batchSize) }, (_, index) => preparedRows.slice(index * batchSize, (index + 1) * batchSize));
            let imported = 0;
            let skipped = 0;
            const rejected: Array<{ row: number; sheet: string; reason: string }> = [];
            for (let index = 0; index < batches.length; index += 1) {
                setImportProgress(Math.max(5, Math.round((index / batches.length) * 85)));
                const response = await fetch("/api/reports", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "importLegacy", projectId: importProject, fileName: importFile, rows: batches[index], finalize: false }) });
                const responseText = await response.text();
                let payload: { imported?: number; skipped?: number; report?: ReportPayload; error?: string; rejected?: Array<{ row: number; sheet: string; reason: string }> } = {};
                try { payload = responseText ? JSON.parse(responseText) as typeof payload : {}; }
                catch { throw new Error(l(`تعذر قراءة استجابة دفعة الاستيراد ${index + 1}.`, `Could not read import batch ${index + 1} response.`)); }
                rejected.push(...(payload.rejected || []));
                setImportRejected([...rejected]);
                if (!response.ok) throw new Error(payload.error || l(`تعذر استيراد الدفعة ${index + 1} (${response.status}).`, `Import batch ${index + 1} failed (${response.status}).`));
                imported += payload.imported || 0;
                skipped += payload.skipped || 0;
            }
            setImportRejected(rejected);
            reconcileImportCounts(preparedRows.length, imported, skipped, rejected.length);
            setImportProgress(90);
            invalidateApiCache();
            try { setData(await apiGet<ReportPayload>("/api/reports", { force: true, timeoutMs: 120_000 })); }
            catch { /* Imported rows are durable; refresh can be retried without duplicating them. */ }
            setRawImportRows([]); setImportHeaders([]); setImportSheets([]); setImportMapping({});
            setImportFile(""); setImportFileData(null); setImportHeaderChoices({});
            setImportBuildingOverrides({}); setImportBuildingFallback("");
            setNotice(l(`اكتمل الملف: تم استيراد ${imported} أصل، وتجاوز ${skipped} صف سبق استيراده، ورفض ${rejected.length} صف مع توضيح السبب.`, `File completed: ${imported} assets imported, ${skipped} previously imported rows skipped, and ${rejected.length} rows rejected with reasons.`));
            setImportProgress(100);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "تعذر استيراد السجل القديم.");
        }
        finally {
            setBusy(false);
            window.setTimeout(() => setImportProgress(0), 1200);
        }
    }
    async function exportImportRejections() {
        if (!importRejected.length) return;
        await exportWorkbook(`AssetLens_Import_Rejections_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Rejected Rows", rows: importRejected.map(item => ({ Sheet: item.sheet, Row: item.row, Reason: item.reason })) }]);
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
            let completed = 0;
            const labels = await mapWithConcurrency(rows, 4, async (row) => {
                // Never create a QR from the possibly stale report table. Re-read every
                // asset and all of its AI/custom fields from Supabase by its immutable ID.
                const snapshot = await apiGet<QrSnapshotResponse>(`/api/assets/${encodeURIComponent(row.id)}/qr`, { force: true, ttlMs: 0, timeoutMs: 60_000 });
                const payload = buildAssetQrPayload(snapshot.source);
                const target = await createAssetQrValue(window.location.origin, payload);
                const qr = await QRCode.toDataURL(target, { width: 360, margin: 2, errorCorrectionLevel: "L", color: { dark: "#052f3d", light: "#ffffff" } });
                completed += 1;
                if (!popup.closed && popup.document.body) popup.document.body.textContent = `جاري إنشاء رموز QR… ${completed} / ${rows.length}`;
                return `<article><img src="${qr}" alt="QR"><div><b>${escapeHtml(row.assetNo)}</b><strong>${escapeHtml(row.assetType || "Asset")}</strong><span>${escapeHtml(row.project)} · ${escapeHtml(row.building)} · ${escapeHtml(row.office || "")}</span><small>${escapeHtml(row.serial || row.id)}</small><em>البيانات الرئيسية داخل QR للعمل Offline، ومعرّف الأصل يتيح تحديثها Online داخل AssetLens</em></div></article>`;
            });
            popup.document.open();
            popup.document.write(`<!doctype html><html dir="rtl"><head><title>AssetLens AI QR Labels</title><style>body{font-family:Cairo,system-ui,Arial;margin:12px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}article{border:1px solid #234;padding:8px;display:flex;gap:10px;align-items:center;break-inside:avoid;min-height:138px}img{width:132px;height:132px;flex:0 0 132px;image-rendering:pixelated}b,strong,span,small,em{display:block;margin:2px 0}b{font-size:14px;color:#073646}strong{font-size:11px}span,small{font-size:9px}small{direction:ltr}em{font-size:7px;color:#087d72;font-style:normal;line-height:1.4}@media print{body{margin:0}}</style></head><body>${labels.join("")}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
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
        setCategory("");
        setOperationalStatus("");
        setSurveyor("");
        setQuality("");
        setDateFrom("");
        setDateTo("");
        setVisibleLimit(150);
    }
    function applyStatFilter(key: string) {
        setVisibleLimit(150);
        if (key === "duplicate") {
            setQuality("duplicates");
            return;
        }
        if (key === "missing") {
            setQuality("missing");
            return;
        }
        if (key === "completed") {
            setStatus("completed");
            return;
        }
        if (key === "review") {
            setStatus("review");
            return;
        }
        if (key === "failed")
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
    const statusLabels = language === "ar" ? STATUS_LABELS_AR : STATUS_LABELS_EN;
    const statItems = [
        { key: "total", value: counts.total, label: l("إجمالي الأصول", "Total assets") },
        { key: "completed", value: counts.completed, label: l("معتمدة", "Approved") },
        { key: "review", value: counts.review, label: l("تحتاج مراجعة", "Needs review") },
        { key: "active", value: counts.active, label: l("قيد التحليل", "In analysis") },
        { key: "failed", value: counts.failed, label: l("فشلت", "Failed") },
        { key: "duplicate", value: counts.duplicate, label: l("سيريال مكرر", "Duplicate serial") },
        { key: "missing", value: counts.missing, label: l("بيانات ناقصة", "Missing data") },
    ];
    return <main className="reports-shell al-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="al-page-head legacy-page-head"><div><span className="al-page-kicker">Reports & exports</span><h2>{l("سجل الأصول والتقارير", "Asset register & reports")}</h2><p>{l("بحث متقدم، متابعة التحليل، تقارير جودة البيانات، استيراد Excel وطباعة QR.", "Advanced search, workflow monitoring, data-quality reports, smart spreadsheet import and QR printing.")}</p></div></header>
    {error && <div className="reports-alert error">{error}</div>}{notice && <div className="reports-alert success">{notice}</div>}
    {!data ? <div className="reports-loading">{l("جاري تحميل سجل الأصول…", "Loading asset register…")}</div> : <>
      <section className="report-stats" aria-label={l("ملخص حالة السجل", "Register status summary")}>{statItems.map(item => <button key={item.key} onClick={() => applyStatFilter(item.key)}><strong>{item.value}</strong><span>{item.label}</span></button>)}</section>
      <section className="reports-card report-filters"><div className="reports-card-head"><span>01</span><div><h2>{l("البحث والفلاتر المتقدمة", "Advanced search and filters")}</h2><p>{l("اعرض البيانات حسب المشروع والموقع والنوع والحالة والمستخدم والتاريخ.", "Filter by project, location, type, condition, user and date.")}</p></div><button onClick={clearReportFilters}>{l("مسح الفلاتر", "Clear filters")}</button></div><div className="filter-grid">
        <label className="wide">{l("بحث شامل", "Global search")}<input value={search} onChange={event => setReportFilter(setSearch, event.target.value)} placeholder={l("رقم الأصل، السيريال، الموديل، الموقع…", "Asset no., serial, model, location…")}/></label>
        <label>{l("المشروع", "Project")}<select value={project} onChange={event => setReportFilter(setProject, event.target.value)}><option value="">{l("كل المشاريع", "All projects")}</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{l("المبنى / الموقع", "Building / site")}<select value={building} onChange={event => setReportFilter(setBuilding, event.target.value)}><option value="">{l("كل المواقع", "All locations")}</option>{filterOptions.buildings.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>{l("نوع الأصل", "Asset type")}<select value={assetType} onChange={event => setReportFilter(setAssetType, event.target.value)}><option value="">{l("كل الأنواع", "All types")}</option>{filterOptions.assetTypes.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>{l("تصنيف الأصل", "Asset category")}<select value={category} onChange={event => setReportFilter(setCategory, event.target.value)}><option value="">{l("كل التصنيفات", "All categories")}</option>{filterOptions.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{l("حالة التشغيل", "Operational status")}<select value={operationalStatus} onChange={event => setReportFilter(setOperationalStatus, event.target.value)}><option value="">{l("كل حالات التشغيل", "All operational states")}</option>{ASSET_OPERATIONAL_STATUSES.map(item => <option key={item.code} value={item.code}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>
        <label>{l("حالة التحليل", "Workflow status")}<select value={status} onChange={event => setReportFilter(setStatus, event.target.value)}><option value="">{l("كل الحالات", "All states")}</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>{l("حالة الأصل", "Asset condition")}<select value={condition} onChange={event => setReportFilter(setCondition, event.target.value)}><option value="">{l("كل التقييمات", "All ratings")}</option>{ASSET_CONDITION_LEVELS.map(level => <option key={level.rating} value={level.rating}>{level.rating}/5 — {language === "ar" ? level.labelAr : level.labelEn}</option>)}</select></label>
        <label>{l("أهمية الأصل", "Asset criticality")}<select value={criticality} onChange={event => setReportFilter(setCriticality, event.target.value)}><option value="">{l("كل درجات الأهمية", "All criticality levels")}</option>{ASSET_CRITICALITY_LEVELS.map(level => <option key={level.rating} value={level.rating}>{language === "ar" ? level.labelAr : level.labelEn} — {l("وزن", "weight")} {level.weight}</option>)}</select></label>
        <label>{l("المستخدم", "User")}<select value={surveyor} onChange={event => setReportFilter(setSurveyor, event.target.value)}><option value="">{l("كل المستخدمين", "All users")}</option>{filterOptions.surveyors.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>{l("جودة البيانات", "Data quality")}<select value={quality} onChange={event => setReportFilter(setQuality, event.target.value)}><option value="">{l("كل مستويات الجودة", "All quality levels")}</option><option value="missing">{l("بها بيانات ناقصة", "Has missing data")}</option><option value="duplicates">{l("سيريال مكرر", "Duplicate serial")}</option><option value="low">{l("ثقة أقل من 75%", "Confidence below 75%")}</option></select></label>
        <label>{l("من تاريخ", "From date")}<input type="date" value={dateFrom} onChange={event => setReportFilter(setDateFrom, event.target.value)}/></label><label>{l("إلى تاريخ", "To date")}<input type="date" value={dateTo} onChange={event => setReportFilter(setDateTo, event.target.value)}/></label>
      </div><div className="report-actions"><strong>{filtered.length} {l("نتيجة مطابقة", "matching results")}</strong>{canUseModule(data.currentUser.modulePermissions, "reports", "export") && <><button onClick={() => void exportRows(filtered, "Filtered_Report")}>{l("تصدير النتائج إلى Excel", "Export results to Excel")}</button><button className="missing-export" onClick={() => void exportRows(filtered.filter(row => row.missingFields.length), "Missing_Data")}>{l("تقرير البيانات الناقصة", "Missing-data report")}</button>{canUseModule(data.currentUser.modulePermissions, "ai_reports") && <Link className={project ? "ai-pdf-action" : "ai-pdf-action disabled"} aria-disabled={!project} href={project ? `/reports/ai?project=${encodeURIComponent(project)}${dateFrom ? `&from=${encodeURIComponent(dateFrom)}` : ""}${dateTo ? `&to=${encodeURIComponent(dateTo)}` : ""}` : "#"} onClick={event => { if (!project) { event.preventDefault(); setError(l("اختر مشروعًا واحدًا أولًا لإنشاء تقرير PDF الذكي.", "Choose one project before generating the AI PDF report.")); } }}>{l("تقرير ذكاء اصطناعي PDF", "AI PDF report")}</Link>}<button className="qr-action" onClick={() => void printQrLabels()}>{l("طباعة QR", "Print QR")} ({selected.size})</button></>}</div></section>
      <section className="reports-card report-table-card"><div className="reports-card-head"><span>02</span><div><h2>{l("سجل الأصول الموحد", "Unified asset register")}</h2><p>{l("حدد السجلات المطلوبة ثم اطبع ملصقات QR للوصول إليها مباشرة.", "Select records and print compact QR labels for direct access.")}</p></div><label className="select-all"><input type="checkbox" checked={filtered.length > 0 && filtered.every(row => selected.has(row.id))} onChange={event => setSelected(previous => { const next = new Set(previous); filtered.forEach(row => { if (event.target.checked)
            next.add(row.id);
        else
            next.delete(row.id); }); return next; })}/> {l("تحديد النتائج", "Select results")}</label></div><div className="advanced-table-wrap"><table className="advanced-table"><thead><tr><th></th><th>{l("رقم الأصل", "Asset no.")}</th><th>{l("المشروع والموقع", "Project & location")}</th><th>{l("التصنيف والنوع", "Category & type")}</th><th>{l("الشركة / الموديل", "Make / model")}</th><th>{l("السيريال", "Serial")}</th><th>{l("حالة الأصل", "Condition")}</th><th>{l("الأهمية", "Criticality")}</th><th>{l("التشغيل", "Operation")}</th><th>{l("حالة التحليل", "Workflow")}</th><th>{l("الجودة", "Quality")}</th><th>{l("المستخدم والتاريخ", "User & date")}</th><th>{l("الإجراءات", "Actions")}</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} className={row.missingFields.length ? "row-missing" : ""}><td><input type="checkbox" checked={selected.has(row.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked)
            next.add(row.id);
        else
            next.delete(row.id); return next; })}/></td><td><b>{row.assetNo}</b>{row.barcode && <small className="ltr-cell">▦ {row.barcode}</small>}<small>{Math.round(row.confidence * 100)}% {l("ثقة", "confidence")}</small></td><td><strong>{row.project}</strong><small>{[row.building, row.floor, row.zone, row.office, ...row.additionalLocations.map(item => item.value)].filter(Boolean).join(" · ") || "—"}</small>{row.latitude !== null && row.longitude !== null && <small className="ltr-cell">⌖ {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</small>}</td><td><strong>{language === "ar" ? (row.categoryAr || row.categoryEn || "—") : (row.categoryEn || row.categoryAr || "—")}</strong><small>{row.assetType || "—"}</small></td><td>{row.manufacturer || "—"}<small>{row.model || "—"}</small></td><td className="ltr-cell">{row.serial || "—"}{row.isDuplicate && <em>{l("مكرر", "Duplicate")}</em>}</td><td>{row.conditionRating ? <span className="report-condition"><b>{row.conditionRating}/5</b>{assetConditionLabel(row.conditionRating, language)}</span> : "—"}</td><td>{row.criticalityRating ? <span className={`report-criticality criticality-${row.criticalityRating}`}><b>{assetCriticalityLabel(row.criticalityRating, language)}</b><small>{l("وزن", "Weight")} {assetCriticalityWeight(row.criticalityRating)}</small></span> : "—"}</td><td>{assetOperationalStatusLabel(row.operationalStatus, language)}</td><td><span className={`report-status ${row.status}`}>{statusLabels[row.status] || row.status}</span>{row.capturedOffline && <small>{l("تمت مزامنته من Offline", "Synced from offline")}</small>}{row.error && <small>{row.error}</small>}</td><td>{row.missingFields.length ? <details><summary>{row.missingFields.length} {l("ناقص", "missing")}</summary><small>{row.missingFields.join("، ")}</small></details> : <span className="complete-data">{l("مكتملة", "Complete")}</span>}</td><td><span className="ltr-cell">{row.surveyorEmail}</span><small>{new Date(row.createdAt).toLocaleDateString(language === "ar" ? "ar-AE" : "en-GB")}</small></td><td><div className="asset-row-actions"><button onClick={() => { setDetailBuilding(row.building); setDetail(row); }}>{l("عرض", "View")}</button>{row.canTransfer && <Link href={`/transfers?asset=${encodeURIComponent(row.id)}`}>{l("نقل", "Transfer")}</Link>}{row.canDelete && <button onClick={() => setDeleteTarget(row)}>{l("حذف", "Delete")}</button>}</div></td></tr>)}</tbody></table>{!filtered.length && <p className="no-report-results">{l("لا توجد أصول تطابق الفلاتر الحالية.", "No assets match the current filters.")}</p>}</div>{visibleRows.length < filtered.length && <button className="load-more-records" onClick={() => setVisibleLimit(limit => limit + 150)}>{l(`عرض 150 سجل إضافي من ${filtered.length}`, `Show 150 more of ${filtered.length}`)}</button>}</section>
      {data.currentUser.role === "admin" && <section className="reports-card import-card"><div className="reports-card-head"><span>03</span><div><h2>{l("استيراد ذكي من Excel / CSV", "Smart Excel / CSV import")}</h2><p>{l("يكتشف صف العناوين وجميع الأوراق تلقائيًا، ثم يتيح مراجعة ربط الأعمدة قبل الإدخال.", "Automatically detects header rows and all worksheets, then lets you review column mapping before import.")}</p></div></div><div className="import-grid smart-import-grid"><label>{l("المشروع المستهدف", "Target project")}<select value={importProject} onChange={event => setImportProject(event.target.value)}><option value="">{l("اختر المشروع", "Choose project")}</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="file-picker">{l("ملف XLSX / CSV", "XLSX / CSV file")}<input type="file" accept=".xlsx,.csv,.tsv" onChange={chooseImport}/><span>{importFile || l("اختر الملف", "Choose file")}</span></label><label>{l("تصنيف الأصل", "Asset category")}<select value={importCategory} onChange={event => setImportCategory(event.target.value)}><option value="">{l("بدون تصنيف · يُستكمل لاحقًا", "No category · complete later")}</option>{data.categories.map(item => <option key={item.id} value={item.id}>{language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label><label>{l("تقييم الحالة الافتراضي", "Default condition rating")}<select value={importCondition} onChange={event => setImportCondition(event.target.value)}><option value="">—</option>{ASSET_CONDITION_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label><label>{l("الأهمية الافتراضية", "Default criticality")}<select value={importCriticality} onChange={event => setImportCriticality(event.target.value)}><option value="">—</option>{ASSET_CRITICALITY_LEVELS.map(item => <option key={item.rating} value={item.rating}>{item.rating} — {language === "ar" ? item.labelAr : item.labelEn}</option>)}</select></label>{Boolean(importCondition) && Number(importCondition) <= 2 && <label className="wide">{l("مبرر الحالة", "Condition justification")}<input value={importJustification} onChange={event => setImportJustification(event.target.value)} placeholder={l("سبب الحالة والإجراء المقترح", "Reason and proposed action")} /></label>}<button disabled={busy || !importRows.length || !importProject} onClick={() => void importLegacy()}>{busy ? l("جاري الاستيراد…", "Importing…") : l(`استيراد ${importRows.length || ""} أصل`, `Import ${importRows.length || ""} assets`)}</button></div>{importProgress > 0 && <div className="import-progress" aria-label={l("تقدم الاستيراد", "Import progress")}><i style={{ width: `${importProgress}%` }} /><span>{importProgress}%</span></div>}{importRows.length > 0 && <div className="import-preview smart-import-preview"><div className="import-detection-summary"><strong>{l("نتيجة الاكتشاف", "Detection result")}</strong>{importSheets.map(sheet => <span key={sheet.sheet}>{sheet.sheet}: {sheet.rowCount} {l("صف · العناوين في صف", "rows · header row")} {sheet.headerRow}</span>)}</div><details open><summary>{l("مراجعة وربط الأعمدة", "Review column mapping")}</summary><div className="import-mapping-grid">{(["assetNo","assetType","manufacturer","model","serial","summary","building","floor","zone","office","conditionRating","conditionJustification","criticalityRating"] as ImportColumnKey[]).map(key => <label key={key}><span>{key}</span><select value={importMapping[key] || ""} onChange={event => setImportMapping(current => ({ ...current, [key]: event.target.value }))}><option value="">{l("غير مربوط", "Not mapped")}</option>{importHeaders.filter(header => !header.startsWith("__")).map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></details><strong>{l("معاينة أول 5 صفوف", "First 5 rows")}</strong><table><thead><tr><th>{l("المصدر", "Source")}</th><th>{l("رقم الأصل", "Asset no.")}</th><th>{l("النوع", "Type")}</th><th>{l("الشركة", "Manufacturer")}</th><th>{l("الموديل", "Model")}</th><th>{l("السيريال", "Serial")}</th><th>{l("الموقع", "Location")}</th></tr></thead><tbody>{importRows.slice(0, 5).map((row, index) => <tr key={index}><td>{row.sourceSheet}:{row.sourceRow}</td><td>{row.assetNo || "—"}</td><td>{row.assetType || "—"}</td><td>{row.manufacturer || "—"}</td><td>{row.model || "—"}</td><td>{row.serial || "—"}</td><td>{row.building || "—"}</td></tr>)}</tbody></table><small>{l(`يتم حفظ كل عمود غير فارغ؛ الحقول المعروفة تُربط تلقائيًا والباقي يُحفظ كمعلومة مصدر. السيريال المكرر يُعلّم للمراجعة، وإعادة رفع الملف نفسه لا تنشئ نسخًا مكررة.`, `Every non-empty column is preserved. Known fields are mapped automatically and the rest are stored as source information. Duplicate serials are flagged for review, and retrying the same file does not create duplicate assets.`)}</small></div>}{importRejected.length > 0 && <div className="import-rejections"><strong>{l("تقرير الصفوف المرفوضة", "Rejected rows report")}</strong><button type="button" onClick={() => void exportImportRejections()}>{l("تحميل Excel", "Download Excel")}</button>{importRejected.slice(0, 100).map((item, index) => <p key={`${item.sheet}-${item.row}-${index}`}><b>{item.sheet}:{item.row}</b> — {item.reason}</p>)}</div>}</section>}
      {data.currentUser.role === "admin" && importRows.length > 0 && <section className="reports-card import-building-review">
        <div className="reports-card-head"><span>04</span><div><h3>{l("تصحيح المبنى قبل الاستيراد", "Correct buildings before importing")}</h3><p>{l(`المبنى الناقص في ${importRows.filter(row => !row.building).length} صف. بإمكانك تركه فارغًا ليرفع الأصل للمراجعة، أو تعيين اسم واحد لكل الصفوف الناقصة، أو تعديل كل صف منفردًا.`, `Building missing in ${importRows.filter(row => !row.building).length} rows. Import incomplete assets for later review, fill all missing buildings at once, or edit individual rows.`)}</p></div></div>
        <label>{l("اسم المبنى الافتراضي للصفوف الناقصة · اختياري", "Default building for missing rows · optional")}<input value={importBuildingFallback} onChange={event => setImportBuildingFallback(event.target.value)} placeholder={l("مثال: مبنى الإدارة", "E.g. Main Building")} /></label>
        <details><summary>{l(`تعديل اسم المبنى لكل صف (${importRows.length})`, `Edit building for individual rows (${importRows.length})`)}</summary><div className="import-building-rows">{importRows.map(row => <label key={`${row.sourceSheet}:${row.sourceRow}`}><span>{row.sourceSheet}:{row.sourceRow} · {row.assetNo || row.assetType || l("أصل بلا اسم", "Unnamed asset")}</span><input aria-label={`${row.sourceSheet}:${row.sourceRow} ${l("اسم المبنى", "Building name")}`} value={importBuildingOverrides[`${row.sourceSheet}:${row.sourceRow}`] ?? ""} onChange={event => setImportBuildingOverrides(previous => ({ ...previous, [`${row.sourceSheet}:${row.sourceRow}`]: event.target.value }))} placeholder={row.building || importBuildingFallback || l("غير محدد · سيُراجع لاحقًا", "Unassigned · review later")} /></label>)}</div></details>
      </section>}
      {data.currentUser.role === "admin" && importSheets.length > 0 && <section className="reports-card import-header-review">
        <div className="reports-card-head"><span>04</span><div><h3>{l("مراجعة أوراق الاستيراد", "Review import sheets")}</h3><p>{l("لو اختار النظام صف عناوين غير صحيح، حدده يدويًا لكل ورقة ثم اضغط تطبيق قبل الاستيراد.", "If a header row was detected incorrectly, set it for each sheet and apply before importing.")}</p></div></div>
        <div className="import-header-grid">{importSheets.map(sheet => <label key={sheet.sheet}>{sheet.sheet} · {sheet.rowCount} {l("صف بيانات", "data rows")}<input type="number" min="1" max="100" value={importHeaderChoices[sheet.sheet] ?? sheet.headerRow} onChange={event => setImportHeaderChoices(previous => ({ ...previous, [sheet.sheet]: Number(event.target.value) }))} aria-label={`${sheet.sheet} ${l("صف العناوين", "header row")}`} /></label>)}</div>
        <button type="button" disabled={!importFileData || !importSheets.some(sheet => importHeaderChoices[sheet.sheet] !== sheet.headerRow) || busy} onClick={() => void applyImportHeaderChoices()}>{l("تطبيق صفوف العناوين وإعادة المعاينة", "Apply header rows and refresh preview")}</button>
      </section>}
      {detail && <div className="al-dialog-backdrop report-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget)
            setDetail(null); }}><section className="al-dialog report-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="report-detail-title"><header><div><small>ASSET DETAILS</small><h3 id="report-detail-title">{detail.assetNo}</h3><p>{detail.assetType} · {[detail.project, detail.building, detail.floor, detail.zone, detail.office, ...detail.additionalLocations.map(item => item.value)].filter(Boolean).join(" / ")}</p></div><button onClick={() => setDetail(null)}>×</button></header>{detail.canEdit && detail.status === "review" && <div className="report-location-correction"><label>{l("اسم المبنى / الموقع · قابل للتعديل", "Building / site · editable")}<input value={detailBuilding} onChange={event => setDetailBuilding(event.target.value)} placeholder={l("اكتب اسم المبنى لاستكمال السجل", "Enter a building to complete the record")} /></label><button className="al-primary-button" disabled={savingLocation || detailBuilding.trim() === detail.building} onClick={() => void saveDetailBuilding()}>{savingLocation ? l("جاري الحفظ…", "Saving…") : l("حفظ المبنى", "Save building")}</button></div>}<dl><div><dt>{l("تصنيف الأصل", "Asset category")}</dt><dd>{language === "ar" ? (detail.categoryAr || detail.categoryEn || "—") : (detail.categoryEn || detail.categoryAr || "—")}</dd></div><div><dt>{l("الشركة المصنعة", "Manufacturer")}</dt><dd>{detail.manufacturer || "—"}</dd></div><div><dt>{l("الموديل", "Model")}</dt><dd>{detail.model || "—"}</dd></div><div><dt>{l("السيريال", "Serial")}</dt><dd className="ltr-cell">{detail.serial || "—"}</dd></div><div><dt>{l("حالة التشغيل", "Operational status")}</dt><dd>{assetOperationalStatusLabel(detail.operationalStatus, language)}</dd></div><div><dt>{l("حالة الأصل", "Asset condition")}</dt><dd>{detail.conditionRating ? `${detail.conditionRating}/5 — ${assetConditionLabel(detail.conditionRating, language)}` : l("غير مقيّم", "Not rated")}</dd></div>{detail.conditionJustification && <div><dt>{l("سبب تقييم الحالة", "Condition justification")}</dt><dd>{detail.conditionJustification}</dd></div>}<div><dt>{l("أهمية الأصل", "Asset criticality")}</dt><dd>{detail.criticalityRating ? `${assetCriticalityLabel(detail.criticalityRating, language)} — ${l("الوزن التلقائي", "automatic weight")} ${assetCriticalityWeight(detail.criticalityRating)}` : l("غير محددة", "Not rated")}</dd></div><div><dt>{l("السعر التقديري", "Estimated price")}</dt><dd>{detail.estimatedPrice == null ? "—" : `${detail.estimatedPrice.toLocaleString()} ${detail.priceCurrency}`}</dd></div><div><dt>{l("تكلفة الاستبدال", "Replacement cost")}</dt><dd>{detail.replacementCost == null ? "—" : `${detail.replacementCost.toLocaleString()} ${detail.priceCurrency}`}</dd></div><div><dt>{l("العمر الافتراضي / المتبقي", "Useful / remaining life")}</dt><dd>{detail.usefulLifeYears == null ? "—" : `${detail.usefulLifeYears} / ${detail.remainingLifeYears ?? "—"} ${l("سنة", "years")}`}</dd></div><div><dt>{l("حالة التحليل", "Workflow status")}</dt><dd>{statusLabels[detail.status] || detail.status}</dd></div>{detail.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.value || "—"}</dd></div>)}{detail.customValues.map(field => <div key={field.key}><dt>{language === "ar" ? (field.labelAr || field.labelEn || field.key) : (field.labelEn || field.labelAr || field.key)}{field.unit ? ` (${field.unit})` : ""}</dt><dd>{field.value || "—"}</dd></div>)}</dl><footer>{detail.canTransfer && <Link className="al-secondary-button" href={`/transfers?asset=${encodeURIComponent(detail.id)}`}>{l("نقل الأصل", "Transfer asset")}</Link>}<button className="al-primary-button" onClick={() => setDetail(null)}>{l("إغلاق", "Close")}</button></footer></section></div>}
      {deleteTarget && <div className="al-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy)
            setDeleteTarget(null); }}><section className="al-dialog" role="dialog" aria-modal="true" aria-labelledby="report-delete-title"><span className="al-dialog-icon danger">!</span><h3 id="report-delete-title">{l("حذف الأصل", "Delete asset")} {deleteTarget.assetNo}</h3><p>{l("سيتم حذف السجل والصور المرتبطة به. هذه العملية لا يمكن التراجع عنها.", "The record and linked images will be deleted. This cannot be undone.")}</p><div><button className="al-secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>{l("إلغاء", "Cancel")}</button><button className="al-danger-button" disabled={busy} onClick={() => void removeAsset()}>{busy ? l("جاري الحذف…", "Deleting…") : l("حذف نهائي", "Delete permanently")}</button></div></section></div>}
    </>}
  </main>;
}
