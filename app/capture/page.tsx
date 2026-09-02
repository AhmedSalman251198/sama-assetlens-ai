"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, CSSProperties, DragEvent, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";
import { exportWorkbook } from "../lib/excel-client";
import { clearExpiredOfflineSubmissions, listOfflineSubmissions, loadDeviceConfig, OfflineSubmission, removeOfflineSubmission, saveDeviceConfig, saveOfflineSubmission, submissionFormData, updateOfflineSubmission } from "../lib/offline-queue";

type Language = "ar" | "en";
type Field = { key: string; label: string; value: string; confidence: number };
type Result = { assetType: string; summary: string; fields: Field[]; warnings: string[]; rawText: string; overallConfidence: number };
type CustomValue = { key: string; labelAr: string; labelEn: string; value: string };
type GPSPosition = { latitude: number; longitude: number; accuracy: number; capturedAt: string };
type SurveyContext = { projectId: string; project: string; buildingId: string; building: string; floorId: string; floor: string; zoneId: string; zone: string; surveyorEmail: string; customValues?: Record<string, string>; mobile?: { latitude: number | null; longitude: number | null; accuracy: number | null; capturedAt: string; barcode: string; capturedOffline: boolean; offlineClientId: string } };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type BarcodeDetectorInstance = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type RecordStatus = "completed" | "review";
type StoredRecord = Result & { id: string; assetNo: string; createdAt: string; fileName: string; status: RecordStatus; customValues?: CustomValue[]; isDuplicate?: boolean; canEdit?: boolean; surveyContext?: SurveyContext };
type JobStatus = "queued" | "processing" | "completed" | "failed";
type AnalysisJob = { id: string; assetId: string; order: number; imageCount: number; fileName: string; createdAt: string; status: JobStatus; surveyContext: SurveyContext; result?: Result; error?: string };
type BulkSession = { id: string; startedAt: string; total: number; assetIds: string[]; fileNames: string[]; context: Pick<SurveyContext, "project" | "building" | "floor" | "zone" | "surveyorEmail"> };
type MasterFloor = { id: string; name: string; sortOrder: number };
type MasterZone = { id: string; floorId: string | null; name: string };
type MasterBuilding = { id: string; name: string; floors: MasterFloor[]; zones: MasterZone[] };
type CustomOption = { code: string; labelAr: string; labelEn: string };
type CustomSurveyField = { id: string; key: string; labelAr: string; labelEn: string; type: "text" | "textarea" | "number" | "date" | "select" | "boolean"; required: boolean; options: CustomOption[]; sortOrder: number; helpAr: string; helpEn: string };
type MasterProject = { id: string; name: string; requireBuilding: boolean; requireFloor: boolean; requireZone: boolean; allowManual: boolean; buildings: MasterBuilding[]; customFields: CustomSurveyField[] };
type MasterConfig = { currentUser: { email: string; name: string; role: "admin" | "surveyor" }; projects: MasterProject[] };

const SINGLE_ASSET_LIMIT = 5;
const BULK_ZONE_LIMIT = 20;
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const SINGLE_TOTAL_LIMIT_BYTES = 25 * 1024 * 1024;
const BULK_TOTAL_LIMIT_BYTES = BULK_ZONE_LIMIT * IMAGE_LIMIT_BYTES;

const copy = {
  ar: {
    tagline: "تحليل لوحات بيانات الأصول بالذكاء الاصطناعي", secure: "معالجة آمنة", version: "الإصدار R14",
    title: "حوّل صورة الـ Nameplate إلى بيانات منظمة",
    lead: "ارفع صورة واضحة للوحة البيانات، وسيستخرج النظام المعلومات الفنية تلقائيًا لتتمكن من مراجعتها وتصديرها.",
    uploadTitle: "التقط أو ارفع صور الأصل", uploadHint: "أرفق الـNameplate وصور الأصل من زوايا مختلفة", formats: "حتى 5 صور • تحسين تلقائي سريع قبل الرفع",
    choose: "فتح الكاميرا أو اختيار الصور", addMore: "إضافة صور أخرى", photoTip: "مثل Google Lens: صوّر الـNameplate بوضوح، ويمكنك إضافة صور كاملة للأصل أو زوايا أخرى لتحسين النتيجة.",
    ready: "الصور جاهزة للتحليل", remove: "إزالة الكل", removePhoto: "إزالة الصورة", analyze: "إضافة إلى طابور التحليل", analyzing: "جاري التحليل في الخلفية",
    bulkMode: "Bulk Zone", bulkModeLead: "كل صورة تتحفظ كأصل منفصل تحت نفس المشروع والمبنى والطابق والزون.", bulkFormats: "حتى 20 صورة • كل صورة أصل مستقل", bulkAnalyze: "إضافة كل الصور كأصول منفصلة", bulkReport: "تحميل تقرير جلسة CSV", bulkSession: "جلسة Bulk Zone", bulkQueued: "تمت إضافة صور الجلسة إلى الطابور", bulkInvalid: "وضع Bulk يسمح حتى 20 صورة، بحد أقصى 10 MB للصورة.",
    queueTitle: "طابور التحليل", queueLead: "ارفع الأصل التالي فورًا؛ النظام يحلل الأصول واحدًا بعد الآخر حسب ترتيب الإضافة.", queued: "في الانتظار", processing: "جاري التحليل", completed: "تم التحليل", failedStatus: "فشل التحليل", retry: "إعادة المحاولة", cancel: "إلغاء", keepOpen: "يمكنك متابعة رفع الصور؛ كل المهام محفوظة في السحابة وتُستأنف تلقائيًا.",
    contextTitle: "بيانات موقع الأصل", contextLead: "اختر المشروع وموقع الأصل قبل إرفاق الصور. الحقول الإلزامية يحددها الـAdmin.", project: "المشروع / الجهة", building: "المبنى / الموقع", floor: "الطابق", zone: "الزون", chooseValue: "اختر من القائمة", yes: "نعم", no: "لا", manualEntry: "غير موجود — إدخال يدوي", enterManually: "اكتب القيمة يدويًا", required: "إلزامي", optional: "اختياري", contextRequired: "أكمل بيانات موقع الأصل الإلزامية قبل إضافته إلى طابور التحليل.", noProjects: "لا توجد مشاريع متاحة لحسابك. اطلب من الـAdmin إضافة المشروع أو منحك الصلاحية.", adminPanel: "لوحة الإدارة", reports: "التقارير", logout: "تسجيل الخروج",
    resultTitle: "البيانات المستخرجة", emptyTitle: "ستظهر البيانات هنا",
    emptyText: "بعد رفع الصورة وتشغيل التحليل، ستظهر الحقول وقيمة كل منها مع مستوى الثقة.",
    sample: "عرض نتيجة تجريبية", demo: "بيانات تجريبية", editHint: "يمكنك تعديل أي قيمة قبل التصدير", confidence: "الثقة",
    warnings: "ملاحظات المراجعة", raw: "النص المقروء من اللوحة", export: "تصدير إلى Excel", copyData: "نسخ البيانات", copied: "تم النسخ",
    addRecord: "إضافة الأصل إلى السجل", saveChanges: "حفظ تعديلات الأصل", batchReady: "أصل محفوظ داخل السجل", batchReadyMany: "أصول محفوظة داخل السجل", downloadRegister: "تحميل سجل Excel",
    registerTitle: "سجل الأصول", registerLead: "السجلات محفوظة بأمان في Supabase ويمكن الوصول إليها من أي جهاز حسب صلاحياتك.", search: "ابحث بالنوع أو الشركة أو الموديل أو السيريال...", allTypes: "كل أنواع الأصول",
    assetNo: "رقم الأصل", assetType: "نوع الأصل", manufacturer: "الشركة المصنعة", model: "الموديل", serial: "الرقم التسلسلي", addedAt: "تاريخ الإضافة", actions: "الإجراءات", edit: "تعديل", delete: "حذف", noMatches: "لا توجد سجلات مطابقة للبحث.", sourceFile: "ملف الصورة",
    dataQuality: "جودة البيانات", totalAssets: "إجمالي الأصول", needsReview: "تحتاج مراجعة", duplicates: "سيريال مكرر", approved: "معتمدة", allStatuses: "كل الحالات", status: "الحالة", approveRecord: "اعتماد النتيجة", reviewBadge: "مراجعة", approvedBadge: "معتمد", duplicateBadge: "مكرر",
    settings: "الإعدادات", settingsTitle: "إعدادات التحليل", settingsLead: "أدخل مفتاح Gemini لتشغيل تحليل الصور الحقيقي.",
    apiKey: "Gemini API Key", apiPlaceholder: "AIza...", saveKey: "حفظ وتشغيل Gemini", clearKey: "حذف المفتاح",
    keyReady: "Gemini جاهز", keyMissing: "Gemini غير متصل", keySaved: "تم حفظ المفتاح داخل جلسة المتصفح.",
    keyPrivacy: "للحماية، يُحفظ المفتاح داخل هذا التبويب فقط، ولا يُحفظ في قاعدة البيانات أو ملفات الموقع. سيُحذف عند إغلاق جلسة المتصفح.",
    getKey: "إنشاء مفتاح من Google AI Studio", close: "إغلاق",
    reset: "تحليل أصل جديد", invalid: "اختر من صورة واحدة إلى 5 صور بصيغة JPG أو PNG أو WEBP، بحد أقصى 10 MB للصورة و25 MB إجماليًا.",
    failed: "تعذر تحليل الصورة حاليًا. تحقق من الإعدادات ثم حاول مرة أخرى.",
    online: "متصل", offline: "بدون إنترنت", installApp: "تثبيت التطبيق", syncNow: "مزامنة الآن", offlineSaved: "تم حفظ الأصل على الهاتف وسيُرفع تلقائيًا عند رجوع الإنترنت.", offlineQueue: "أصول محفوظة Offline", syncing: "جاري المزامنة", gps: "موقع GPS", captureGps: "التقاط الموقع", gpsReady: "تم التقاط الموقع", gpsRequired: "يجب التقاط GPS لهذا المشروع.", barcode: "QR / Barcode", scanBarcode: "مسح بالكاميرا", barcodePlaceholder: "امسح أو اكتب الكود", closeScanner: "إغلاق الكاميرا", scannerUnsupported: "المسح المباشر غير مدعوم في هذا المتصفح؛ اكتب الكود يدويًا.", removeOffline: "حذف النسخة المحلية",
  },
  en: {
    tagline: "AI-powered asset nameplate analysis", secure: "Secure processing", version: "Release R14",
    title: "Turn a nameplate photo into structured data",
    lead: "Upload a clear nameplate image and let the system extract technical information for review and export.",
    uploadTitle: "Capture or upload asset photos", uploadHint: "Add the nameplate and full asset views", formats: "Up to 5 images • automatically optimized before upload",
    choose: "Open camera or choose images", addMore: "Add more photos", photoTip: "Like Google Lens: capture the nameplate clearly, then add full asset views or other angles for a better result.", ready: "Images are ready for analysis",
    remove: "Remove all", removePhoto: "Remove photo", analyze: "Add to analysis queue", analyzing: "Analyzing in background", resultTitle: "Extracted data", emptyTitle: "Your data will appear here",
    bulkMode: "Bulk Zone", bulkModeLead: "Each image is saved as a separate asset under the same project, building, floor, and zone.", bulkFormats: "Up to 20 images • each image becomes one asset", bulkAnalyze: "Add every photo as a separate asset", bulkReport: "Download session CSV", bulkSession: "Bulk Zone session", bulkQueued: "Session photos were added to the queue", bulkInvalid: "Bulk mode allows up to 20 images, up to 10 MB each.",
    queueTitle: "Analysis queue", queueLead: "Upload the next asset immediately; assets are analyzed one by one in upload order.", queued: "Waiting", processing: "Analyzing", completed: "Completed and saved", failedStatus: "Analysis failed", retry: "Retry", cancel: "Cancel", keepOpen: "Continue uploading freely; every job is stored in the cloud and resumes automatically.",
    contextTitle: "Asset location", contextLead: "Choose the project and asset location before adding photos. Required fields are configured by the administrator.", project: "Project / Entity", building: "Building / Site", floor: "Floor", zone: "Zone", chooseValue: "Choose from list", yes: "Yes", no: "No", manualEntry: "Not listed — enter manually", enterManually: "Enter value manually", required: "Required", optional: "Optional", contextRequired: "Complete the required asset-location fields before adding it to the analysis queue.", noProjects: "No projects are available for your account. Ask an administrator to add a project or grant access.", adminPanel: "Administration", reports: "Reports", logout: "Sign out",
    emptyText: "After uploading and analyzing an image, every field will appear with its confidence level.", sample: "View sample result", demo: "Sample data",
    editHint: "You can edit any value before export", confidence: "Confidence", warnings: "Review notes", raw: "Raw nameplate text",
    export: "Export to Excel", copyData: "Copy data", copied: "Copied", reset: "Analyze another image",
    addRecord: "Add asset to register", saveChanges: "Save asset changes", batchReady: "asset saved in the register", batchReadyMany: "assets saved in the register", downloadRegister: "Download Excel register",
    registerTitle: "Asset register", registerLead: "Records are securely stored in Supabase and available from any authorized device.", search: "Search by type, manufacturer, model, or serial...", allTypes: "All asset types",
    assetNo: "Asset No.", assetType: "Asset type", manufacturer: "Manufacturer", model: "Model", serial: "Serial number", addedAt: "Added", actions: "Actions", edit: "Edit", delete: "Delete", noMatches: "No records match your search.", sourceFile: "Image file",
    dataQuality: "Data quality", totalAssets: "Total assets", needsReview: "Needs review", duplicates: "Duplicate serial", approved: "Approved", allStatuses: "All statuses", status: "Status", approveRecord: "Approve result", reviewBadge: "Review", approvedBadge: "Approved", duplicateBadge: "Duplicate",
    settings: "Settings", settingsTitle: "Analysis settings", settingsLead: "Enter a Gemini key to enable live image analysis.",
    apiKey: "Gemini API Key", apiPlaceholder: "AIza...", saveKey: "Save and enable Gemini", clearKey: "Remove key",
    keyReady: "Gemini ready", keyMissing: "Gemini not connected", keySaved: "Key saved for this browser session.",
    keyPrivacy: "For safety, the key stays in this browser tab only. It is not stored in the database or site files and is cleared when the browser session closes.",
    getKey: "Create a key in Google AI Studio", close: "Close",
    invalid: "Choose 1 to 5 JPG, PNG or WEBP images, up to 10 MB each and 25 MB total.", failed: "The images could not be analyzed. Check the configuration and try again.",
    online: "Online", offline: "Offline", installApp: "Install app", syncNow: "Sync now", offlineSaved: "Asset saved on this device and will upload automatically when connection returns.", offlineQueue: "Offline assets", syncing: "Syncing", gps: "GPS location", captureGps: "Capture location", gpsReady: "Location captured", gpsRequired: "GPS must be captured for this project.", barcode: "QR / Barcode", scanBarcode: "Scan with camera", barcodePlaceholder: "Scan or enter code", closeScanner: "Close camera", scannerUnsupported: "Live scanning is not supported in this browser; enter the code manually.", removeOffline: "Delete local copy",
  },
};

const sampleResult: Result = {
  assetType: "Centrifugal Pump", summary: "Horizontal centrifugal water pump with three-phase electric motor.", overallConfidence: 0.92,
  fields: [
    { key: "manufacturer", label: "Manufacturer", value: "Grundfos", confidence: 0.98 },
    { key: "modelNumber", label: "Model Number", value: "CR 15-4 A-F-A-E-HQQE", confidence: 0.96 },
    { key: "serialNumber", label: "Serial Number", value: "P12245871", confidence: 0.94 },
    { key: "ratedPower", label: "Rated Power", value: "5.5 kW", confidence: 0.93 },
    { key: "voltage", label: "Voltage", value: "380–415 V", confidence: 0.91 },
    { key: "frequency", label: "Frequency", value: "50 Hz", confidence: 0.97 },
    { key: "speed", label: "Speed", value: "2,900 rpm", confidence: 0.86 },
    { key: "ipRating", label: "IP Rating", value: "IP55", confidence: 0.91 },
  ],
  warnings: ["Verify the final digit of the serial number before saving."],
  rawText: "GRUNDFOS • CR 15-4 A-F-A-E-HQQE • 3~ 380-415V • 50Hz • 5.5kW • IP55",
};

function UploadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>; }
function ScanIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3M7 12h10" /></svg>; }

export default function Home() {
  const [language, setLanguage] = useState<Language>("ar");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(true);
  const [bulkSession, setBulkSession] = useState<BulkSession | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [masterError, setMasterError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [manualBuilding, setManualBuilding] = useState("");
  const [manualFloor, setManualFloor] = useState("");
  const [manualZone, setManualZone] = useState("");
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [records, setRecords] = useState<StoredRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<OfflineSubmission[]>([]);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [gps, setGps] = useState<GPSPosition | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerVideoRef = useRef<HTMLVideoElement>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const completedJobsRef = useRef<Set<string>>(new Set());
  const prefillAppliedRef = useRef(false);
  const queuePollInFlightRef = useRef(false);

  const compressImage = async (file: File, targetBytes: number): Promise<File> => {
    if (file.size <= targetBytes) return file;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذر تجهيز الصورة للرفع.")); };
      img.src = url;
    });
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxDimension = 2_200;
    if (Math.max(width, height) > maxDimension) {
      const ratio = maxDimension / Math.max(width, height);
      width = Math.round(width * ratio); height = Math.round(height * ratio);
    }
    let canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d", { alpha: false })?.drawImage(img, 0, 0, width, height);
    const encode = (source: HTMLCanvasElement, quality: number) => new Promise<Blob | null>(resolve => source.toBlob(resolve, "image/jpeg", quality));
    let blob: Blob | null = null;
    for (let scalePass = 0; scalePass < 5; scalePass += 1) {
      for (const quality of [.9, .82, .74, .66, .58]) {
        blob = await encode(canvas, quality);
        if (blob && blob.size <= targetBytes) return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
      }
      if (canvas.width <= 900 || canvas.height <= 600) break;
      const smaller = document.createElement("canvas");
      smaller.width = Math.max(720, Math.round(canvas.width * .82));
      smaller.height = Math.max(480, Math.round(canvas.height * .82));
      smaller.getContext("2d", { alpha: false })?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas = smaller;
    }
    if (!blob) throw new Error("تعذر ضغط الصورة. جرّب صورة أخرى.");
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  };
  const t = copy[language];
  const selectedProject = masterConfig?.projects.find(item => item.id === projectId);
  const selectedBuilding = selectedProject?.buildings.find(item => item.id === buildingId);
  const selectedFloor = selectedBuilding?.floors.find(item => item.id === floorId);
  const availableZones = selectedBuilding?.zones.filter(item => !item.floorId || !floorId || item.floorId === floorId) || [];
  const selectedZone = availableZones.find(item => item.id === zoneId);
  const buildingValue = buildingId === "__manual__" ? manualBuilding.trim() : selectedBuilding?.name || "";
  const floorValue = floorId === "__manual__" ? manualFloor.trim() : selectedFloor?.name || "";
  const zoneValue = zoneId === "__manual__" ? manualZone.trim() : selectedZone?.name || "";
  const gpsField = selectedProject?.customFields.find(field => ["gps", "gps_location", "coordinates"].includes(field.key));
  const barcodeField = selectedProject?.customFields.find(field => ["barcode", "qr_code", "asset_barcode"].includes(field.key));
  const editingRecord = records.find(record => record.id === editingRecordId);
  const shouldQueueAsBulk = bulkMode && files.length > 1;
  async function optimizeSelectedFiles() {
    const targetBytes = shouldQueueAsBulk ? 3_500_000 : Math.max(620_000, Math.floor(3_600_000 / Math.max(1, files.length)));
    const optimized = new Array<File>(files.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor;
        cursor += 1;
        optimized[index] = await compressImage(files[index], targetBytes);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, () => worker()));
    return optimized;
  }
  const bulkSessionAssetIds = useMemo(() => new Set(bulkSession?.assetIds || []), [bulkSession]);
  const bulkSessionRecords = useMemo(() => records.filter(record => bulkSessionAssetIds.has(record.id)), [records, bulkSessionAssetIds]);
  const bulkSessionCompleted = bulkSessionRecords.filter(record => record.status === "completed" || record.status === "review").length;

  const applyWorkspace = useCallback((payload: { records: StoredRecord[]; jobs: AnalysisJob[] }, announceCompletion = false) => {
    const newlyCompleted = announceCompletion ? payload.jobs.find(job => job.status === "completed" && !completedJobsRef.current.has(job.id)) : undefined;
    payload.jobs.filter(job => job.status === "completed").forEach(job => completedJobsRef.current.add(job.id));
    setRecords(payload.records); setJobs(payload.jobs);
    invalidateApiCache("/api/dashboard");
    invalidateApiCache("/api/reports");
    invalidateApiCache("/api/assets?view=list");
    invalidateApiCache("/api/assets?view=transfer");
    if (newlyCompleted) {
      const record = payload.records.find(item => item.id === newlyCompleted.assetId);
      if (record) {
        setResult({ assetType: record.assetType, summary: record.summary, fields: record.fields, warnings: record.warnings, rawText: record.rawText, overallConfidence: record.overallConfidence });
        setEditingRecordId(record.id); setDemo(false);
      }
    }
  }, []);
  const loadWorkspace = useCallback(async (announceCompletion = false) => {
    try {
      const payload = await apiGet<{ records: StoredRecord[]; jobs: AnalysisJob[]; error?: string }>("/api/assets?view=queue", { ttlMs: announceCompletion ? 0 : 5_000, force: announceCompletion });
      applyWorkspace(payload, announceCompletion);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      throw reason;
    }
  }, [applyWorkspace]);
  const refreshOfflineQueue = useCallback(async () => {
    await clearExpiredOfflineSubmissions(); setOfflineQueue(await listOfflineSubmissions());
  }, []);
  function setCapturedBarcode(value: string) {
    const clean = value.trim().slice(0, 200); setBarcode(clean);
    if (barcodeField?.key) setCustomValues(current => ({ ...current, [barcodeField.key]: clean }));
  }
  const handleScannedBarcode = useEffectEvent((value: string) => {
    const clean = value.trim().slice(0, 200); setBarcode(clean);
    if (barcodeField?.key) setCustomValues(current => ({ ...current, [barcodeField.key]: clean }));
  });
  async function captureGps() {
    if (!navigator.geolocation) { setError(t.gpsRequired); return null; }
    setGpsBusy(true); setError("");
    const position = await new Promise<GPSPosition | null>(resolve => navigator.geolocation.getCurrentPosition(result => resolve({ latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, capturedAt: new Date(result.timestamp).toISOString() }), () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }));
    setGpsBusy(false);
    if (!position) { setError(t.gpsRequired); return null; }
    setGps(position);
    if (gpsField?.key) setCustomValues(current => ({ ...current, [gpsField.key]: `${position.latitude.toFixed(7)},${position.longitude.toFixed(7)}` }));
    return position;
  }
  const syncOfflineQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncingOffline(true); setOfflineNotice("");
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const pending = await listOfflineSubmissions();
      for (const submission of pending) {
        try {
          const response = await fetch("/api/assets", { method: "POST", body: submissionFormData(submission), headers: { Authorization: `Bearer ${token}`, ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}) } });
          const responseText = await response.text(); const payload = responseText ? JSON.parse(responseText) as { records?: StoredRecord[]; jobs?: AnalysisJob[]; error?: string } : {};
          if (response.status === 401) { window.location.replace("/login"); return; }
          if (!response.ok || !payload.records || !payload.jobs) { await updateOfflineSubmission({ ...submission, attempts: submission.attempts + 1, lastError: payload.error || `Sync failed (${response.status}).` }); break; }
          applyWorkspace({ records: payload.records, jobs: payload.jobs }); await removeOfflineSubmission(submission.id);
        } catch { break; }
      }
      await refreshOfflineQueue();
    } finally { setSyncingOffline(false); }
  }, [applyWorkspace, geminiKey, refreshOfflineQueue]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedKey = window.sessionStorage.getItem("assetlens_gemini_key") || "";
      setGeminiKey(storedKey); setKeySaved(Boolean(storedKey));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { setIsOnline(navigator.onLine); void refreshOfflineQueue(); }, 0);
    const online = () => { setIsOnline(true); void syncOfflineQueue(); }; const offline = () => setIsOnline(false);
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("online", online); window.addEventListener("offline", offline); window.addEventListener("beforeinstallprompt", install); window.addEventListener("appinstalled", installed);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.removeEventListener("beforeinstallprompt", install); window.removeEventListener("appinstalled", installed); };
  }, [refreshOfflineQueue, syncOfflineQueue]);
  useEffect(() => {
    if (!scannerOpen) return;
    let active = true;
    void (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector || !navigator.mediaDevices?.getUserMedia) { setError(t.scannerUnsupported); setScannerOpen(false); return; }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); scannerStreamRef.current = stream;
        const video = scannerVideoRef.current; if (!video || !active) { stream.getTracks().forEach(track => track.stop()); return; }
        video.srcObject = stream; await video.play(); const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix"] });
        const scan = async () => { if (!active) return; try { const found = await detector.detect(video); if (found[0]?.rawValue) { handleScannedBarcode(found[0].rawValue); setScannerOpen(false); return; } } catch { /* keep scanning the next frame */ } scannerFrameRef.current = window.requestAnimationFrame(() => void scan()); };
        await scan();
      } catch { setError(t.scannerUnsupported); setScannerOpen(false); }
    })();
    return () => { active = false; if (scannerFrameRef.current) window.cancelAnimationFrame(scannerFrameRef.current); scannerStreamRef.current?.getTracks().forEach(track => track.stop()); scannerStreamRef.current = null; };
  }, [scannerOpen, t.scannerUnsupported]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await loadDeviceConfig<MasterConfig>().catch(() => null);
      if (active && !navigator.onLine && cached) { setMasterConfig(cached); setMasterError(""); return; }
      try {
        const fetchConfig = apiGet<MasterConfig & { error?: string }>("/api/config?scope=capture", { ttlMs: 5 * 60_000 });
        const fetchWorkspace = loadWorkspace();
        const [payload] = await Promise.all([fetchConfig, fetchWorkspace]);
        if (active) {
          setMasterConfig(payload);
          setMasterError("");
          await saveDeviceConfig(payload);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) { window.location.replace("/login"); return; }
        const message = err instanceof Error ? err.message : "Unable to load project configuration.";
        if (cached) { setMasterConfig(cached); setMasterError(""); }
        else setMasterError(message);
      }
    })();
    return () => { active = false; };
  }, [loadWorkspace]);
  useEffect(() => {
    if (!masterConfig || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedProject = params.get("project") || "";
    const requestedBuilding = params.get("building") || "";
    const requestedFloor = params.get("floor") || "";
    const requestedZone = params.get("zone") || "";
    const timer = window.setTimeout(() => {
      const project = masterConfig.projects.find(item => item.id === requestedProject);
      if (!project) return;
      setProjectId(project.id);
      const building = project.buildings.find(item => item.id === requestedBuilding);
      if (!building) return;
      setBuildingId(building.id);
      if (requestedFloor && building.floors.some(item => item.id === requestedFloor)) setFloorId(requestedFloor);
      if (requestedZone && building.zones.some(item => item.id === requestedZone)) setZoneId(requestedZone);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [masterConfig]);
  useEffect(() => () => { previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!jobs.some(job => job.status === "queued" || job.status === "processing")) return;
    const poll = async () => {
      if (queuePollInFlightRef.current) return;
      queuePollInFlightRef.current = true;
      try {
        const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
        if (jobs.some(job => job.status === "queued" || job.status === "processing")) {
          await fetch("/api/jobs", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}) }, body: JSON.stringify({ action: "wake" }) });
        }
        await loadWorkspace(true);
      } catch (err) { setError(err instanceof Error ? err.message : t.failed); }
      finally { queuePollInFlightRef.current = false; }
    };
    const timer = window.setInterval(() => void poll(), 6000);
    return () => window.clearInterval(timer);
  }, [jobs, geminiKey, t.failed, loadWorkspace]);

  function acceptFiles(nextFiles: File[]) {
    const fileLimit = bulkMode ? BULK_ZONE_LIMIT : SINGLE_ASSET_LIMIT;
    const totalLimit = bulkMode ? BULK_TOTAL_LIMIT_BYTES : SINGLE_TOTAL_LIMIT_BYTES;
    const nextTotal = [...files, ...nextFiles].reduce((total, next) => total + next.size, 0);
    if (nextFiles.length === 0 || files.length + nextFiles.length > fileLimit || nextFiles.some(next => !["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size > IMAGE_LIMIT_BYTES) || nextTotal > totalLimit) { setError(bulkMode ? t.bulkInvalid : t.invalid); return; }
    const nextPreviews = nextFiles.map(next => URL.createObjectURL(next));
    previewUrlsRef.current = [...previewUrlsRef.current, ...nextPreviews];
    setFiles(current => [...current, ...nextFiles]); setPreviews(current => [...current, ...nextPreviews]); setResult(null); setDemo(false); setError(""); setEditingRecordId(null);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); acceptFiles(Array.from(event.dataTransfer.files)); }
  function removeFile(index: number) {
    const url = previews[index]; if (url) URL.revokeObjectURL(url);
    previewUrlsRef.current = previewUrlsRef.current.filter(item => item !== url);
    setFiles(current => current.filter((_, itemIndex) => itemIndex !== index)); setPreviews(current => current.filter((_, itemIndex) => itemIndex !== index)); setResult(null); setError("");
  }
  function clear() {
    previews.forEach(url => URL.revokeObjectURL(url));
    previewUrlsRef.current = previewUrlsRef.current.filter(url => !previews.includes(url));
    setFiles([]); setPreviews([]); setResult(null); setDemo(false); setError(""); setEditingRecordId(null);
  }
  function mergeBulkSessionAssets(assetIds: string[]) {
    if (assetIds.length === 0) return;
    setBulkSession(current => current ? { ...current, assetIds: Array.from(new Set([...current.assetIds, ...assetIds])) } : current);
  }
  function csvSafe(value: unknown) {
    const textValue = String(value ?? "");
    const protectedValue = /^[=+\-@]/.test(textValue) ? `'${textValue}` : textValue;
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }
  function resultField(resultSource: Result | undefined, patterns: string[]) {
    const field = resultSource?.fields.find(item => patterns.some(pattern => `${item.key} ${item.label}`.toLowerCase().includes(pattern)));
    return field?.value || "";
  }
  function downloadBulkSessionCsv() {
    if (!bulkSession) return;
    const rows = bulkSession.assetIds.map((assetId, index) => {
      const job = jobs.find(item => item.assetId === assetId);
      const record = records.find(item => item.id === assetId);
      const resultSource = record || job?.result;
      const status = record?.status === "review" ? "Review" : record ? "Completed" : job?.status || "Queued";
      return {
        "No.": index + 1,
        "Status": status,
        "Asset No.": record?.assetNo || "",
        "Source File": record?.fileName || job?.fileName || bulkSession.fileNames[index] || "",
        "Project": record?.surveyContext?.project || job?.surveyContext.project || bulkSession.context.project,
        "Building / Site": record?.surveyContext?.building || job?.surveyContext.building || bulkSession.context.building,
        "Floor": record?.surveyContext?.floor || job?.surveyContext.floor || bulkSession.context.floor,
        "Zone": record?.surveyContext?.zone || job?.surveyContext.zone || bulkSession.context.zone,
        "Asset Type": resultSource?.assetType || "",
        "Manufacturer": resultField(resultSource, ["manufacturer", "make", "brand"]),
        "Model": resultField(resultSource, ["model"]),
        "Serial Number": resultField(resultSource, ["serial", "s/n"]),
        "Surveyor": bulkSession.context.surveyorEmail,
      };
    });
    const columns = Object.keys(rows[0] || { "No.": "", "Status": "", "Asset No.": "", "Source File": "", "Project": "", "Building / Site": "", "Floor": "", "Zone": "", "Asset Type": "", "Manufacturer": "", "Model": "", "Serial Number": "", "Surveyor": "" });
    const csv = [columns.map(csvSafe).join(","), ...rows.map(row => columns.map(column => csvSafe(row[column as keyof typeof row])).join(","))].join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `AssetLens_Bulk_Zone_${Date.now()}.csv`; link.click();
    URL.revokeObjectURL(url);
  }
  function currentSurveyContext(position: GPSPosition | null = gps, capturedOffline = false, offlineClientId = crypto.randomUUID()): SurveyContext | null {
    const submissionCustomValues = { ...customValues };
    if (position && gpsField?.key) submissionCustomValues[gpsField.key] = `${position.latitude.toFixed(7)},${position.longitude.toFixed(7)}`;
    if (barcode && barcodeField?.key) submissionCustomValues[barcodeField.key] = barcode;
    const submissionFieldsValid = selectedProject?.customFields.every(field => !field.required || Boolean(submissionCustomValues[field.key]?.trim())) ?? true;
    if (!selectedProject || !Boolean((!selectedProject.requireBuilding || buildingValue) && (!selectedProject.requireFloor || floorValue) && (!selectedProject.requireZone || zoneValue) && submissionFieldsValid)) return null;
    return {
      projectId: selectedProject.id, project: selectedProject.name,
      buildingId: buildingId === "__manual__" ? "" : buildingId, building: buildingValue,
      floorId: floorId === "__manual__" ? "" : floorId, floor: floorValue,
      zoneId: zoneId === "__manual__" ? "" : zoneId, zone: zoneValue,
      surveyorEmail: masterConfig?.currentUser.email || "", customValues: submissionCustomValues,
      mobile: { latitude: position?.latitude ?? null, longitude: position?.longitude ?? null, accuracy: position?.accuracy ?? null, capturedAt: position?.capturedAt || new Date().toISOString(), barcode, capturedOffline, offlineClientId },
    };
  }

  async function installApplication() {
    if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null);
  }

  async function queueAnalysis() {
    if (files.length === 0) return;
    let capturedPosition = gps;
    if (!capturedPosition && gpsField) capturedPosition = await captureGps();
    if (gpsField?.required && !capturedPosition) { setError(t.gpsRequired); return; }
    const clientId = crypto.randomUUID();
    const surveyContext = currentSurveyContext(capturedPosition, false, clientId);
    if (!surveyContext) { setError(t.contextRequired); return; }
    setUploading(true); setError("");
    const saveForSync = async () => {
      const compressedFiles = await optimizeSelectedFiles();
      if (shouldQueueAsBulk) {
        for (const file of compressedFiles) {
          const offlineContext = currentSurveyContext(capturedPosition, true, crypto.randomUUID());
          if (offlineContext) await saveOfflineSubmission([file], offlineContext as unknown as Record<string, unknown>);
        }
      } else {
        const offlineContext: SurveyContext = { ...surveyContext, mobile: { ...surveyContext.mobile!, capturedOffline: true } };
        await saveOfflineSubmission(compressedFiles, offlineContext as unknown as Record<string, unknown>);
      }
      await refreshOfflineQueue(); setOfflineNotice(shouldQueueAsBulk ? t.bulkQueued : t.offlineSaved);
      previews.forEach(url => URL.revokeObjectURL(url)); previewUrlsRef.current = previewUrlsRef.current.filter(url => !previews.includes(url));
      setFiles([]); setPreviews([]); setResult(null); setDemo(false); setEditingRecordId(null); setCustomValues({}); setGps(null); setBarcode("");
    };
    try {
      if (!navigator.onLine) { await saveForSync(); return; }
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const compressedFiles = await optimizeSelectedFiles();
      if (shouldQueueAsBulk) {
        const sessionId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        setBulkSession({ id: sessionId, startedAt, total: compressedFiles.length, assetIds: [], fileNames: compressedFiles.map(file => file.name), context: { project: surveyContext.project, building: surveyContext.building, floor: surveyContext.floor, zone: surveyContext.zone, surveyorEmail: surveyContext.surveyorEmail } });
        for (const image of compressedFiles) {
          const itemContext = currentSurveyContext(capturedPosition, false, crypto.randomUUID());
          if (!itemContext) throw new Error(t.contextRequired);
          const body = new FormData(); body.append("images", image); body.append("context", JSON.stringify(itemContext));
          let response: Response;
          try { response = await fetch("/api/assets?compact=1", { method: "POST", body, headers: { Authorization: `Bearer ${token}`, ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}) } }); }
          catch { await saveOfflineSubmission([image], { ...itemContext, mobile: { ...itemContext.mobile!, capturedOffline: true } } as unknown as Record<string, unknown>); continue; }
          const payload = await response.json() as { accepted?: boolean; assetId?: string; error?: string };
          if (!response.ok) throw new Error(payload.error || t.failed);
          if (!payload.assetId) throw new Error(t.failed);
          mergeBulkSessionAssets([payload.assetId]);
        }
        await loadWorkspace(true);
        await refreshOfflineQueue();
        setOfflineNotice(t.bulkQueued);
      } else {
        const body = new FormData(); compressedFiles.forEach(image => body.append("images", image)); body.append("context", JSON.stringify(surveyContext));
        let response: Response;
        try { response = await fetch("/api/assets", { method: "POST", body, headers: { Authorization: `Bearer ${token}`, ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}) } }); }
        catch { await saveForSync(); return; }
        const payload = await response.json() as { records: StoredRecord[]; jobs: AnalysisJob[]; error?: string };
        if (!response.ok) throw new Error(payload.error || t.failed);
        applyWorkspace(payload);
      }
      previews.forEach(url => URL.revokeObjectURL(url)); previewUrlsRef.current = previewUrlsRef.current.filter(url => !previews.includes(url));
      setFiles([]); setPreviews([]); setResult(null); setDemo(false); setEditingRecordId(null);
      setCustomValues({}); setGps(null); setBarcode(""); if (!shouldQueueAsBulk) setOfflineNotice("");
    } catch (err) { setError(err instanceof Error ? err.message : t.failed); }
    finally { setUploading(false); }
  }
  async function retryJob(id: string) {
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch("/api/jobs", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}) }, body: JSON.stringify({ action: "retry", jobId: id }) });
      const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || t.failed);
      setJobs(current => current.map(job => job.id === id ? { ...job, status: "queued", error: undefined } : job));
    } catch (err) { setError(err instanceof Error ? err.message : t.failed); }
  }
  async function removeJob(id: string) {
    const job = jobs.find(item => item.id === id);
    if (!job || job.status === "processing") return;
    await deleteRecord(job.assetId);
  }
  function updateField(index: number, value: string) { setResult(current => current ? { ...current, fields: current.fields.map((field, i) => i === index ? { ...field, value } : field) } : current); }
  async function exportExcel() {
    const exportRecords = records.map(record => editingRecordId === record.id && result ? { ...record, ...result } : record);
    if (exportRecords.length === 0) return;
    const fieldColumns = Array.from(new Set(exportRecords.flatMap(record => record.fields.map(field => field.label || field.key))));
    const customColumns = Array.from(new Set(exportRecords.flatMap(record => (record.customValues || []).map(field => `Survey: ${field.labelEn || field.labelAr || field.key}`))));
    const columns = ["Asset No.", "Status", "Captured At", "Surveyor", "Project", "Building / Site", "Floor", "Zone", ...customColumns, "Source File", "Asset Type", "Asset Summary", "Overall Confidence", ...fieldColumns];
    const assetRows = exportRecords.map((record, index) => {
      const row: Record<string, string | number> = {
        "Asset No.": record.assetNo || index + 1, "Status": record.isDuplicate ? "Duplicate — Review" : record.status === "review" ? "Review" : "Approved", "Captured At": record.createdAt, "Surveyor": record.surveyContext?.surveyorEmail || "", "Project": record.surveyContext?.project || "", "Building / Site": record.surveyContext?.building || "", "Floor": record.surveyContext?.floor || "", "Zone": record.surveyContext?.zone || "", "Source File": record.fileName, "Asset Type": record.assetType,
        "Asset Summary": record.summary, "Overall Confidence": record.overallConfidence,
      };
      for (const field of record.customValues || []) row[`Survey: ${field.labelEn || field.labelAr || field.key}`] = field.value;
      for (const field of record.fields) row[field.label || field.key] = field.value;
      return row;
    });
    const confidenceRows = exportRecords.map((record, index) => {
      const row: Record<string, string | number> = {
        "Asset No.": record.assetNo || index + 1, "Status": "", "Captured At": "", "Surveyor": "", "Project": "", "Building / Site": "", "Floor": "", "Zone": "", "Source File": "", "Asset Type": "", "Asset Summary": "", "Overall Confidence": record.overallConfidence,
      };
      for (const field of record.customValues || []) row[`Survey: ${field.labelEn || field.labelAr || field.key}`] = "";
      for (const field of record.fields) row[field.label || field.key] = field.confidence;
      return row;
    });
    const sourceRows = exportRecords.map((record, index) => ({
      "Asset No.": record.assetNo || index + 1, "Status": record.isDuplicate ? "Duplicate — Review" : record.status === "review" ? "Review" : "Approved", "Project": record.surveyContext?.project || "", "Building / Site": record.surveyContext?.building || "", "Floor": record.surveyContext?.floor || "", "Zone": record.surveyContext?.zone || "", "Asset Type": record.assetType, "Raw Nameplate Text": record.rawText, "Review Warnings": record.warnings.join(" | "),
    }));
    await exportWorkbook(`AssetLens_${Date.now()}.xlsx`, [
      { name: "Assets", rows: assetRows, columns },
      { name: "Confidence", rows: confidenceRows, columns },
      { name: "Source Review", rows: sourceRows },
    ]);
  }
  async function addToRegister(action: "save" | "approve" = "save") {
    if (!result || !editingRecordId) return;
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch("/api/assets", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: editingRecordId, result, action }) });
      const payload = await response.json() as { records: StoredRecord[]; jobs: AnalysisJob[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "The asset changes could not be saved.");
      applyWorkspace(payload); clear();
    } catch (err) { setError(err instanceof Error ? err.message : "The asset changes could not be saved."); }
  }
  async function deleteRecord(id: string) {
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch(`/api/assets?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json() as { records: StoredRecord[]; jobs: AnalysisJob[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "The asset could not be deleted.");
      applyWorkspace(payload); if (editingRecordId === id) clear();
    } catch (err) { setError(err instanceof Error ? err.message : "The asset could not be deleted."); }
  }
  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText([`Asset Type: ${result.assetType}`, ...result.fields.map(f => `${f.label}: ${f.value}`)].join("\n"));
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }
  function saveGeminiKey() {
    const nextKey = geminiKey.trim();
    if (!nextKey) return;
    window.sessionStorage.setItem("assetlens_gemini_key", nextKey);
    setGeminiKey(nextKey); setKeySaved(true); setSettingsOpen(false); setError("");
  }
  function clearGeminiKey() {
    window.sessionStorage.removeItem("assetlens_gemini_key");
    setGeminiKey(""); setKeySaved(false);
  }
  return (
    <main className="capture-page al-page" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="al-page-head capture-page-head">
        <div><span className="al-page-kicker">Mobile field capture</span><h2>{language === "ar" ? "التقط لوحة الأصل وحوّلها إلى بيانات" : "Capture a nameplate and turn it into data"}</h2><p>{language === "ar" ? "اختر الموقع، التقط صورة واضحة، ثم راجع البيانات المستخرجة قبل اعتمادها." : "Choose the location, capture a clear photo, then review the extracted data before approval."}</p></div>
        <div className="al-page-actions"><button className="al-secondary-button" onClick={() => setLanguage(language === "ar" ? "en" : "ar")}>{language === "ar" ? "English" : "العربية"}</button><button className="al-primary-button" onClick={() => setSettingsOpen(true)}>⚙ {t.settings}</button></div>
      </header>
      <section className={`mobile-status-bar ${isOnline ? "online" : "offline"}`} aria-live="polite">
        <div><i /> <strong>{isOnline ? t.online : t.offline}</strong>{offlineQueue.length > 0 && <span>{offlineQueue.length} {t.offlineQueue}</span>}</div>
        <div>{installPrompt && <button onClick={() => void installApplication()}>⇩ {t.installApp}</button>}{offlineQueue.length > 0 && <button disabled={!isOnline || syncingOffline} onClick={() => void syncOfflineQueue()}>{syncingOffline ? t.syncing : `↻ ${t.syncNow}`}</button>}</div>
      </section>
      {offlineNotice && <div className="offline-notice">✓ {offlineNotice}</div>}
      {offlineQueue.length > 0 && <details className="offline-queue-panel"><summary><span>☁</span><b>{t.offlineQueue}</b><em>{offlineQueue.length}</em></summary><div>{offlineQueue.map(item => <article key={item.id}><div><strong>{String(item.context.project || "Asset")}</strong><small>{new Date(item.createdAt).toLocaleString(language === "ar" ? "ar-AE" : "en-GB")} · {item.images.length} images</small>{item.lastError && <em>{item.lastError}</em>}</div><button onClick={() => void removeOfflineSubmission(item.id).then(refreshOfflineQueue)}>{t.removeOffline}</button></article>)}</div></details>}
      <section className="survey-context" aria-labelledby="context-title">
        <div className="context-heading"><span>00</span><div><h2 id="context-title">{t.contextTitle}</h2><p>{t.contextLead}</p></div>{masterConfig?.currentUser.role === "admin" && <Link href="/admin">{t.adminPanel} ↗</Link>}</div>
        {masterError ? <div className="context-message error">{masterError}</div> : !masterConfig ? <div className="context-message loading"><span className="loading-dots"><i /><i /><i /></span>{language === "ar" ? "جاري تحميل صلاحيات المشاريع…" : "Loading project permissions…"}</div> : masterConfig.projects.length === 0 ? <div className="context-message">لا توجد مشاريع مخصصة لهذا المستخدم. يرجى مراجعة المدير.</div> : <div className="context-grid">
          <label><span>{t.project}<em>{t.required}</em></span><select value={projectId} onChange={event => { setProjectId(event.target.value); setBuildingId(""); setFloorId(""); setZoneId(""); setManualBuilding(""); setManualFloor(""); setManualZone(""); setCustomValues({}); setGps(null); setBarcode(""); }}><option value="">{t.chooseValue}</option>{masterConfig.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {selectedProject && (selectedProject.requireBuilding || selectedProject.buildings.length > 0) && <label><span>{t.building}<em>{selectedProject.requireBuilding ? t.required : t.optional}</em></span><select value={buildingId} onChange={event => { setBuildingId(event.target.value); setFloorId(""); setZoneId(""); setManualBuilding(""); setManualFloor(""); setManualZone(""); }}><option value="">{t.chooseValue}</option>{selectedProject.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{selectedProject.allowManual && <option value="__manual__">{t.manualEntry}</option>}</select>{buildingId === "__manual__" && <input value={manualBuilding} onChange={event => setManualBuilding(event.target.value)} placeholder={t.enterManually} />}</label>}
          {selectedProject && buildingValue && (selectedProject.requireFloor || (selectedBuilding?.floors.length || 0) > 0) && <label><span>{t.floor}<em>{selectedProject.requireFloor ? t.required : t.optional}</em></span><select value={floorId} onChange={event => { setFloorId(event.target.value); setZoneId(""); setManualFloor(""); setManualZone(""); }}><option value="">{t.chooseValue}</option>{selectedBuilding?.floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{selectedProject.allowManual && <option value="__manual__">{t.manualEntry}</option>}</select>{floorId === "__manual__" && <input value={manualFloor} onChange={event => setManualFloor(event.target.value)} placeholder={t.enterManually} />}</label>}
          {selectedProject && buildingValue && (selectedProject.requireZone || availableZones.length > 0) && <label><span>{t.zone}<em>{selectedProject.requireZone ? t.required : t.optional}</em></span><select value={zoneId} onChange={event => { setZoneId(event.target.value); setManualZone(""); }}><option value="">{t.chooseValue}</option>{availableZones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{selectedProject.allowManual && <option value="__manual__">{t.manualEntry}</option>}</select>{zoneId === "__manual__" && <input value={manualZone} onChange={event => setManualZone(event.target.value)} placeholder={t.enterManually} />}</label>}
          {selectedProject?.customFields.filter(field => field.id !== gpsField?.id && field.id !== barcodeField?.id).map(field => <label className="custom-survey-field" key={field.id}><span>{language === "ar" ? field.labelAr : field.labelEn || field.labelAr}<em>{field.required ? t.required : t.optional}</em></span>
            {field.type === "select" ? <select value={customValues[field.key] || ""} onChange={event => setCustomValues(current => ({ ...current, [field.key]: event.target.value }))}><option value="">{t.chooseValue}</option>{field.options.map(option => <option key={option.code} value={option.code}>{language === "ar" ? option.labelAr : option.labelEn || option.labelAr}</option>)}</select> : field.type === "boolean" ? <select value={customValues[field.key] || ""} onChange={event => setCustomValues(current => ({ ...current, [field.key]: event.target.value }))}><option value="">{t.chooseValue}</option><option value="true">{t.yes}</option><option value="false">{t.no}</option></select> : field.type === "textarea" ? <textarea value={customValues[field.key] || ""} onChange={event => setCustomValues(current => ({ ...current, [field.key]: event.target.value }))} /> : <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={customValues[field.key] || ""} onChange={event => setCustomValues(current => ({ ...current, [field.key]: event.target.value }))} />}
            {(language === "ar" ? field.helpAr : field.helpEn) && <small>{language === "ar" ? field.helpAr : field.helpEn}</small>}
          </label>)}
        </div>}
        {selectedProject && <div className="mobile-capture-tools">
          <section className={gps ? "capture-tool ready" : "capture-tool"}><div><span>⌖</span><p><strong>{t.gps}</strong><small>{gps ? `${gps.latitude.toFixed(7)}, ${gps.longitude.toFixed(7)} · ±${Math.round(gps.accuracy)}m` : gpsField?.required ? t.required : t.optional}</small></p></div><button disabled={gpsBusy} onClick={() => void captureGps()}>{gpsBusy ? <span className="mini-spinner" /> : gps ? `✓ ${t.gpsReady}` : t.captureGps}</button></section>
          <section className={barcode ? "capture-tool ready" : "capture-tool"}><div><span>▦</span><label><strong>{t.barcode}</strong><input className="ltr-input" value={barcode} onChange={event => setCapturedBarcode(event.target.value)} placeholder={t.barcodePlaceholder} /></label></div><button onClick={() => setScannerOpen(true)}>⌁ {t.scanBarcode}</button></section>
        </div>}
        {selectedProject && <label className={bulkMode ? "bulk-toggle active" : "bulk-toggle"}><input type="checkbox" checked={bulkMode} onChange={event => { setBulkMode(event.target.checked); setError(""); }} /><span>▦</span><div><strong>{t.bulkMode}</strong><small>{bulkMode ? t.bulkFormats : t.bulkModeLead}</small></div></label>}
      </section>
      {records.length > 0 && <section className="batch-bar"><div><strong>{records.length}</strong><span>{records.length === 1 ? t.batchReady : t.batchReadyMany}</span></div><button onClick={exportExcel}>{t.downloadRegister}</button></section>}
      {bulkSession && <section className="bulk-session-bar"><div><strong>{t.bulkSession}</strong><span>{bulkSessionCompleted}/{bulkSession.total} {language === "ar" ? "أصول مكتملة" : "completed assets"} · {bulkSession.context.project} / {bulkSession.context.zone || bulkSession.context.building || "—"}</span></div><button disabled={bulkSessionAssetIds.size === 0} onClick={downloadBulkSessionCsv}>{t.bulkReport}</button></section>}
      {jobs.length > 0 && <section className="queue-section" aria-live="polite">
        <div className="queue-heading"><div><span className="queue-pulse" /><div><h2>{t.queueTitle}</h2><p>{t.queueLead}</p></div></div><small>{t.keepOpen}</small></div>
        <div className="queue-list">{jobs.map(job => <article className={`queue-job ${job.status}`} key={job.id}>
          <div className="queue-number">#{String(job.order).padStart(3, "0")}</div>
          <div className="queue-info"><strong>{job.result?.assetType || `${job.imageCount || 1} ${language === "ar" ? "صور" : "images"}`}</strong><small className="queue-location">{job.surveyContext.project} • {job.surveyContext.building || "—"} • {job.surveyContext.floor || "—"} • {job.surveyContext.zone || "—"}</small><small title={job.fileName}>{job.fileName}</small>{job.error && <em>{job.error}</em>}</div>
          <div className={`queue-status ${job.status}`}>{job.status === "processing" && <span className="mini-spinner" />}{job.status === "queued" ? t.queued : job.status === "processing" ? t.processing : job.status === "completed" ? t.completed : t.failedStatus}</div>
          <div className="queue-actions">{job.status === "failed" && <button onClick={() => retryJob(job.id)}>{t.retry}</button>}{job.status !== "processing" && <button className="queue-remove" onClick={() => removeJob(job.id)} aria-label={t.cancel}>×</button>}</div>
        </article>)}</div>
      </section>}
      <section className="workspace">
        <article className="panel upload-panel">
          <div className="panel-heading"><span>01</span><div><h2>{t.uploadTitle}</h2><p>{bulkMode ? t.bulkFormats : t.formats}</p></div></div>
          <input ref={inputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e: ChangeEvent<HTMLInputElement>) => { acceptFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
          {previews.length === 0 ? <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={onDrop} onClick={() => inputRef.current?.click()}>
            <div className="upload-icon"><UploadIcon /></div><h3>{t.uploadHint}</h3><p>{bulkMode ? t.bulkFormats : t.formats}</p><button type="button" className="secondary">{t.choose}</button>
          </div> : <div className="image-ready">
            <div className="image-gallery">{previews.map((preview, index) => <figure key={preview}><img src={preview} alt={`Selected asset view ${index + 1}`} /><span>{index + 1}</span><button type="button" onClick={() => removeFile(index)} aria-label={t.removePhoto}>×</button></figure>)}{files.length < (bulkMode ? BULK_ZONE_LIMIT : SINGLE_ASSET_LIMIT) && <button type="button" className="add-photo" onClick={() => inputRef.current?.click()}><b>＋</b><span>{t.addMore}</span></button>}</div>
            <div className="file-meta"><span className="check">✓</span><div><strong>{files.length} • {t.ready}</strong><small>{files.map(item => item.name).join(" • ")} • {(files.reduce((total, item) => total + item.size, 0) / 1024 / 1024).toFixed(2)} MB</small></div><button onClick={clear}>{t.remove}</button></div>
          </div>}
          <div className="tip"><span>◎</span><p>{t.photoTip}</p></div>{error && <div className="error" role="alert">{error}</div>}
          <button className="analyze" disabled={files.length === 0 || uploading} onClick={queueAnalysis}>{uploading ? <span className="mini-spinner" /> : <ScanIcon />}{uploading ? t.analyzing : shouldQueueAsBulk ? t.bulkAnalyze : t.analyze}</button>
        </article>
        <article className="panel result-panel">
          <div className="panel-heading"><span>02</span><div><h2>{t.resultTitle}</h2><p>{result ? t.editHint : t.emptyText}</p></div>{demo && <b className="demo-badge">{t.demo}</b>}</div>
          {!result ? <div className="empty"><div className="empty-scan"><span /><ScanIcon /><span /></div><h3>{t.emptyTitle}</h3><p>{t.emptyText}</p><button onClick={() => { setResult(sampleResult); setDemo(true); setError(""); }} className="sample">{t.sample}</button></div> :
          <div className="results">
            <div className="result-summary"><div><small>Asset Type</small><strong>{result.assetType || "—"}</strong><p>{result.summary}</p></div><div className="score" style={{ "--score": `${Math.round(result.overallConfidence * 100) * 3.6}deg` } as CSSProperties}><span>{Math.round(result.overallConfidence * 100)}%</span><small>{t.confidence}</small></div></div>
            <div className="field-list">{result.fields.map((field, index) => <label className="field" key={`${field.key}-${index}`}><span>{field.label}<em className={field.confidence >= .85 ? "high" : field.confidence >= .65 ? "medium" : "low"}>{Math.round(field.confidence * 100)}%</em></span><input value={field.value} onChange={e => updateField(index, e.target.value)} placeholder="—" /></label>)}</div>
            {result.warnings.length > 0 && <div className="warnings"><strong>⚠ {t.warnings}</strong>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
            {result.rawText && <details><summary>{t.raw}</summary><pre>{result.rawText}</pre></details>}
            {editingRecordId && !demo && <div className="review-actions"><button className="add-record" onClick={() => void addToRegister("save")}>✓ {t.saveChanges}</button>{editingRecord?.status === "review" && <button className="approve-record" onClick={() => void addToRegister("approve")}>✓✓ {t.approveRecord}</button>}</div>}<div className="result-actions"><button className="export" onClick={exportExcel}>{t.export}</button><button className="copy" onClick={copyResult}>{copied ? t.copied : t.copyData}</button></div><button className="reset" onClick={clear}>{t.reset}</button>
          </div>}
        </article>
      </section>
      {scannerOpen && <div className="scanner-overlay"><section role="dialog" aria-modal="true" aria-label={t.scanBarcode}><div className="scanner-head"><div><strong>{t.scanBarcode}</strong><small>{t.barcode}</small></div><button onClick={() => setScannerOpen(false)} aria-label={t.closeScanner}>×</button></div><div className="scanner-view"><video ref={scannerVideoRef} playsInline muted /><span /><p>{t.barcodePlaceholder}</p></div><button className="scanner-close" onClick={() => setScannerOpen(false)}>{t.closeScanner}</button></section></div>}
      {settingsOpen && <div className="settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="settings-head"><div className="settings-icon">⚙</div><div><h2 id="settings-title">{t.settingsTitle}</h2><p>{t.settingsLead}</p></div><button onClick={() => setSettingsOpen(false)} aria-label={t.close}>×</button></div>
          <div className={`connection-state ${keySaved ? "is-ready" : ""}`}><span>{keySaved ? "✓" : "!"}</span><div><strong>{keySaved ? t.keyReady : t.keyMissing}</strong><small>Gemini Flash · automatic fallback</small></div></div>
          <label className="key-field"><span>{t.apiKey}</span><input type="password" value={geminiKey} onChange={event => { setGeminiKey(event.target.value); setKeySaved(false); }} placeholder={t.apiPlaceholder} autoComplete="off" spellCheck={false} /></label>
          <p className="privacy-note">🔒 {t.keyPrivacy}</p>
          <a className="get-key" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">{t.getKey} ↗</a>
          <button className="save-key" disabled={!geminiKey.trim()} onClick={saveGeminiKey}>{t.saveKey}</button>
          {keySaved && <button className="clear-key" onClick={clearGeminiKey}>{t.clearKey}</button>}
        </section>
      </div>}
    </main>
  );
}
