"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";
import { exportWorkbook } from "../lib/excel-client";
import {
  clearExpiredOfflineSubmissions,
  listOfflineSubmissions,
  loadDeviceConfig,
  OfflineSubmission,
  removeOfflineSubmission,
  saveDeviceConfig,
  saveOfflineSubmission,
  submissionFormData,
  updateOfflineSubmission,
} from "../lib/offline-queue";
import { AssetQrPayload, parseAssetQrValue } from "../lib/asset-qr";
import {
  ASSET_CONDITION_LEVELS,
  assetConditionLabel,
} from "../lib/asset-condition";
import {
  ASSET_CRITICALITY_LEVELS,
  assetCriticalityLabel,
  assetCriticalityWeight,
} from "../lib/asset-criticality";
import {
  ASSET_OPERATIONAL_STATUSES,
  AssetOperationalStatus,
} from "../lib/asset-operational-status";
import { AssetCategory } from "../lib/asset-categories";
import { canUseModule, ModulePermission } from "../lib/module-permissions";
import { readUiLanguage, UI_LANGUAGE_EVENT } from "../lib/ui-preferences";

type Language = "ar" | "en";
type Field = { key: string; label: string; value: string; confidence: number };
type Result = {
  assetType: string;
  summary: string;
  fields: Field[];
  warnings: string[];
  rawText: string;
  overallConfidence: number;
  conditionRating?: number | null;
  conditionJustification?: string;
  criticalityRating?: number | null;
  categoryId?: string;
  operationalStatus?: AssetOperationalStatus;
  estimatedPrice?: number | null;
  replacementCost?: number | null;
  priceCurrency?: string;
  usefulLifeYears?: number | null;
  installationDate?: string;
  remainingLifeYears?: number | null;
  estimateSource?: string;
  estimateConfidence?: string;
  enrichmentData?: Record<string, string>;
  enrichmentSourceUrl?: string;
};
type CustomValue = {
  key: string;
  labelAr: string;
  labelEn: string;
  value: string;
  unit?: string;
};
type GPSPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};
type DynamicLocationValue = {
  levelId: string;
  key: string;
  labelAr: string;
  labelEn: string;
  valueId: string;
  value: string;
};
type SurveyContext = {
  projectId: string;
  project: string;
  buildingId: string;
  building: string;
  floorId: string;
  floor: string;
  zoneId: string;
  zone: string;
  officeId: string;
  office: string;
  additionalLocations?: DynamicLocationValue[];
  categoryId: string;
  conditionRating: number;
  conditionJustification: string;
  criticalityRating: number;
  operationalStatus: AssetOperationalStatus;
  estimatedPrice: number | null;
  replacementCost: number | null;
  priceCurrency: string;
  usefulLifeYears: number | null;
  installationDate: string;
  estimateSource: string;
  surveyorEmail: string;
  customValues?: Record<string, string>;
  relationship?: {
    enabled: boolean;
    relatedAssetId: string;
    currentAssetRole: "parent" | "child";
  };
  mobile?: {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    capturedAt: string;
    barcode: string;
    capturedOffline: boolean;
    offlineClientId: string;
  };
};
type RelationshipOption = {
  id: string;
  assetNo: string;
  assetType: string;
  building: string;
  floor: string;
  zone: string;
  office: string;
};
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;
type RecordStatus = "completed" | "review";
type BulkAssetRating = {
  conditionRating: number | null;
  conditionJustification: string;
  criticalityRating: number | null;
};
type StoredRecord = Result & {
  id: string;
  assetNo: string;
  createdAt: string;
  fileName: string;
  status: RecordStatus;
  customValues?: CustomValue[];
  isDuplicate?: boolean;
  canEdit?: boolean;
  surveyContext?: SurveyContext;
};
type JobStatus = "queued" | "processing" | "completed" | "failed";
type AnalysisJob = {
  id: string;
  assetId: string;
  order: number;
  imageCount: number;
  fileName: string;
  createdAt: string;
  status: JobStatus;
  surveyContext: SurveyContext;
  result?: Result;
  error?: string;
};
type BulkSession = {
  id: string;
  startedAt: string;
  total: number;
  assetIds: string[];
  fileNames: string[];
  context: Pick<
    SurveyContext,
    | "project"
    | "building"
    | "floor"
    | "zone"
    | "office"
    | "additionalLocations"
    | "surveyorEmail"
  >;
};
type MasterFloor = { id: string; name: string; sortOrder: number };
type MasterZone = { id: string; floorId: string | null; name: string };
type MasterOffice = {
  id: string;
  floorId: string | null;
  zoneId: string | null;
  name: string;
};
type MasterBuilding = {
  id: string;
  name: string;
  floors: MasterFloor[];
  zones: MasterZone[];
  offices: MasterOffice[];
};
type MasterLocationOption = {
  id: string;
  buildingId: string | null;
  floorId: string | null;
  zoneId: string | null;
  officeId: string | null;
  parentOptionId: string | null;
  name: string;
};
type MasterLocationLevel = {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string;
  required: boolean;
  sortOrder: number;
  parentLevelId: string;
  options: MasterLocationOption[];
};
type CustomOption = { code: string; labelAr: string; labelEn: string };
type CustomSurveyField = {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "boolean";
  required: boolean;
  options: CustomOption[];
  sortOrder: number;
  helpAr: string;
  helpEn: string;
  assetTypes: string[];
  unit: string;
  aiExtract: boolean;
  showInReports: boolean;
  showInQr: boolean;
};
type MasterProject = {
  id: string;
  name: string;
  requireBuilding: boolean;
  requireFloor: boolean;
  requireZone: boolean;
  requireOffice: boolean;
  allowManual: boolean;
  categoryIds: string[];
  buildings: MasterBuilding[];
  locationLevels: MasterLocationLevel[];
  customFields: CustomSurveyField[];
};
type MasterConfig = {
  currentUser: {
    email: string;
    name: string;
    role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
    modulePermissions: ModulePermission[];
  };
  projects: MasterProject[];
  categories: AssetCategory[];
};

const SINGLE_ASSET_LIMIT = 5;
const BULK_ZONE_LIMIT = 20;
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const SINGLE_TOTAL_LIMIT_BYTES = 25 * 1024 * 1024;
const BULK_TOTAL_LIMIT_BYTES = BULK_ZONE_LIMIT * IMAGE_LIMIT_BYTES;

const copy = {
  ar: {
    tagline: "تحليل لوحات بيانات الأصول بالذكاء الاصطناعي",
    secure: "معالجة آمنة",
    version: "الإصدار R18",
    title: "حوّل صورة الـ Nameplate إلى بيانات منظمة",
    lead: "ارفع صورة واضحة للوحة البيانات، وسيستخرج النظام المعلومات الفنية تلقائيًا لتتمكن من مراجعتها وتصديرها.",
    uploadTitle: "التقط أو ارفع صور الأصل",
    uploadHint: "أرفق الـNameplate وصور الأصل من زوايا مختلفة",
    formats: "حتى 5 صور • تحسين تلقائي سريع قبل الرفع",
    choose: "اختيار من المعرض",
    camera: "التقاط بالكاميرا",
    addMore: "إضافة صور أخرى",
    photoTip:
      "مثل Google Lens: صوّر الـNameplate بوضوح، ويمكنك إضافة صور كاملة للأصل أو زوايا أخرى لتحسين النتيجة.",
    ready: "الصور جاهزة للتحليل",
    remove: "إزالة الكل",
    removePhoto: "إزالة الصورة",
    analyze: "إضافة إلى طابور التحليل",
    analyzing: "جاري التحليل في الخلفية",
    bulkMode: "Bulk Zone",
    bulkModeLead:
      "كل صورة تتحفظ كأصل منفصل تحت نفس المشروع والمبنى والطابق والزون.",
    bulkFormats: "حتى 20 صورة • كل صورة أصل مستقل",
    bulkAnalyze: "إضافة كل الصور كأصول منفصلة",
    bulkReport: "تحميل تقرير جلسة CSV",
    bulkSession: "جلسة Bulk Zone",
    bulkQueued: "تمت إضافة صور الجلسة إلى الطابور",
    bulkInvalid: "وضع Bulk يسمح حتى 20 صورة، بحد أقصى 10 MB للصورة.",
    queueTitle: "طابور التحليل",
    queueLead:
      "ارفع الأصل التالي فورًا؛ النظام يحلل الأصول واحدًا بعد الآخر حسب ترتيب الإضافة.",
    queued: "في الانتظار",
    processing: "جاري التحليل",
    completed: "تم التحليل",
    failedStatus: "فشل التحليل",
    retry: "إعادة المحاولة",
    cancel: "إلغاء",
    keepOpen:
      "يمكنك متابعة رفع الصور؛ كل المهام محفوظة في السحابة وتُستأنف تلقائيًا.",
    contextTitle: "بيانات موقع الأصل",
    contextLead:
      "اختر المشروع وموقع الأصل قبل إرفاق الصور. الحقول الإلزامية يحددها الـAdmin.",
    project: "المشروع / الجهة",
    building: "المبنى / الموقع",
    floor: "الطابق",
    zone: "الزون",
    office: "المكتب / الغرفة",
    chooseValue: "اختر من القائمة",
    yes: "نعم",
    no: "لا",
    manualEntry: "غير موجود — إدخال يدوي",
    enterManually: "اكتب القيمة يدويًا",
    required: "إلزامي",
    optional: "اختياري",
    contextRequired:
      "أكمل بيانات موقع الأصل الإلزامية قبل إضافته إلى طابور التحليل.",
    noProjects:
      "لا توجد مشاريع متاحة لحسابك. اطلب من الـAdmin إضافة المشروع أو منحك الصلاحية.",
    adminPanel: "لوحة الإدارة",
    reports: "التقارير",
    logout: "تسجيل الخروج",
    resultTitle: "البيانات المستخرجة",
    emptyTitle: "ستظهر البيانات هنا",
    emptyText:
      "بعد رفع الصورة وتشغيل التحليل، ستظهر الحقول وقيمة كل منها مع مستوى الثقة.",
    sample: "عرض نتيجة تجريبية",
    demo: "بيانات تجريبية",
    editHint: "يمكنك تعديل أي قيمة قبل التصدير",
    confidence: "الثقة",
    warnings: "ملاحظات المراجعة",
    raw: "النص المقروء من اللوحة",
    export: "تصدير إلى Excel",
    copyData: "نسخ البيانات",
    copied: "تم النسخ",
    addRecord: "إضافة الأصل إلى السجل",
    saveChanges: "حفظ تعديلات الأصل",
    batchReady: "أصل محفوظ داخل السجل",
    batchReadyMany: "أصول محفوظة داخل السجل",
    downloadRegister: "تحميل سجل Excel",
    registerTitle: "سجل الأصول",
    registerLead:
      "السجلات محفوظة بأمان في Supabase ويمكن الوصول إليها من أي جهاز حسب صلاحياتك.",
    search: "ابحث بالنوع أو الشركة أو الموديل أو السيريال...",
    allTypes: "كل أنواع الأصول",
    assetNo: "رقم الأصل",
    assetType: "نوع الأصل",
    manufacturer: "الشركة المصنعة",
    model: "الموديل",
    serial: "الرقم التسلسلي",
    addedAt: "تاريخ الإضافة",
    actions: "الإجراءات",
    edit: "تعديل",
    delete: "حذف",
    noMatches: "لا توجد سجلات مطابقة للبحث.",
    sourceFile: "ملف الصورة",
    dataQuality: "جودة البيانات",
    totalAssets: "إجمالي الأصول",
    needsReview: "تحتاج مراجعة",
    duplicates: "سيريال مكرر",
    approved: "معتمدة",
    allStatuses: "كل الحالات",
    status: "الحالة",
    approveRecord: "اعتماد النتيجة",
    reviewBadge: "مراجعة",
    approvedBadge: "معتمد",
    duplicateBadge: "مكرر",
    settings: "الإعدادات",
    settingsTitle: "إعدادات التحليل",
    settingsLead: "أدخل مفتاح Gemini لتشغيل تحليل الصور الحقيقي.",
    apiKey: "Gemini API Key",
    apiPlaceholder: "AIza...",
    saveKey: "حفظ وتشغيل Gemini",
    clearKey: "حذف المفتاح",
    keyReady: "Gemini جاهز",
    keyMissing: "Gemini غير متصل",
    keySaved: "تم حفظ المفتاح داخل جلسة المتصفح.",
    keyPrivacy:
      "للحماية، يُحفظ المفتاح داخل هذا التبويب فقط، ولا يُحفظ في قاعدة البيانات أو ملفات الموقع. سيُحذف عند إغلاق جلسة المتصفح.",
    getKey: "إنشاء مفتاح من Google AI Studio",
    close: "إغلاق",
    reset: "تحليل أصل جديد",
    invalid:
      "اختر من صورة واحدة إلى 5 صور بصيغة JPG أو PNG أو WEBP، بحد أقصى 10 MB للصورة و25 MB إجماليًا.",
    failed: "تعذر تحليل الصورة حاليًا. تحقق من الإعدادات ثم حاول مرة أخرى.",
    online: "متصل",
    offline: "بدون إنترنت",
    installApp: "تثبيت التطبيق",
    syncNow: "مزامنة الآن",
    offlineSaved: "تم حفظ الأصل على الهاتف وسيُرفع تلقائيًا عند رجوع الإنترنت.",
    offlineQueue: "أصول محفوظة Offline",
    syncing: "جاري المزامنة",
    gps: "موقع GPS",
    captureGps: "التقاط الموقع",
    gpsReady: "تم التقاط الموقع",
    gpsRequired: "يجب التقاط GPS لهذا المشروع.",
    barcode: "QR / Barcode",
    scanBarcode: "مسح بالكاميرا",
    barcodePlaceholder: "امسح أو اكتب الكود",
    closeScanner: "إغلاق الكاميرا",
    scannerUnsupported:
      "المسح المباشر غير مدعوم في هذا المتصفح؛ اكتب الكود يدويًا.",
    removeOffline: "حذف النسخة المحلية",
  },
  en: {
    tagline: "AI-powered asset nameplate analysis",
    secure: "Secure processing",
    version: "Release R18",
    title: "Turn a nameplate photo into structured data",
    lead: "Upload a clear nameplate image and let the system extract technical information for review and export.",
    uploadTitle: "Capture or upload asset photos",
    uploadHint: "Add the nameplate and full asset views",
    formats: "Up to 5 images • automatically optimized before upload",
    choose: "Choose from gallery",
    camera: "Take a photo",
    addMore: "Add more photos",
    photoTip:
      "Like Google Lens: capture the nameplate clearly, then add full asset views or other angles for a better result.",
    ready: "Images are ready for analysis",
    remove: "Remove all",
    removePhoto: "Remove photo",
    analyze: "Add to analysis queue",
    analyzing: "Analyzing in background",
    resultTitle: "Extracted data",
    emptyTitle: "Your data will appear here",
    bulkMode: "Bulk Zone",
    bulkModeLead:
      "Each image is saved as a separate asset under the same project, building, floor, and zone.",
    bulkFormats: "Up to 20 images • each image becomes one asset",
    bulkAnalyze: "Add every photo as a separate asset",
    bulkReport: "Download session CSV",
    bulkSession: "Bulk Zone session",
    bulkQueued: "Session photos were added to the queue",
    bulkInvalid: "Bulk mode allows up to 20 images, up to 10 MB each.",
    queueTitle: "Analysis queue",
    queueLead:
      "Upload the next asset immediately; assets are analyzed one by one in upload order.",
    queued: "Waiting",
    processing: "Analyzing",
    completed: "Completed and saved",
    failedStatus: "Analysis failed",
    retry: "Retry",
    cancel: "Cancel",
    keepOpen:
      "Continue uploading freely; every job is stored in the cloud and resumes automatically.",
    contextTitle: "Asset location",
    contextLead:
      "Choose the project and asset location before adding photos. Required fields are configured by the administrator.",
    project: "Project / Entity",
    building: "Building / Site",
    floor: "Floor",
    zone: "Zone",
    office: "Office / Room",
    chooseValue: "Choose from list",
    yes: "Yes",
    no: "No",
    manualEntry: "Not listed — enter manually",
    enterManually: "Enter value manually",
    required: "Required",
    optional: "Optional",
    contextRequired:
      "Complete the required asset-location fields before adding it to the analysis queue.",
    noProjects:
      "No projects are available for your account. Ask an administrator to add a project or grant access.",
    adminPanel: "Administration",
    reports: "Reports",
    logout: "Sign out",
    emptyText:
      "After uploading and analyzing an image, every field will appear with its confidence level.",
    sample: "View sample result",
    demo: "Sample data",
    editHint: "You can edit any value before export",
    confidence: "Confidence",
    warnings: "Review notes",
    raw: "Raw nameplate text",
    export: "Export to Excel",
    copyData: "Copy data",
    copied: "Copied",
    reset: "Analyze another image",
    addRecord: "Add asset to register",
    saveChanges: "Save asset changes",
    batchReady: "asset saved in the register",
    batchReadyMany: "assets saved in the register",
    downloadRegister: "Download Excel register",
    registerTitle: "Asset register",
    registerLead:
      "Records are securely stored in Supabase and available from any authorized device.",
    search: "Search by type, manufacturer, model, or serial...",
    allTypes: "All asset types",
    assetNo: "Asset No.",
    assetType: "Asset type",
    manufacturer: "Manufacturer",
    model: "Model",
    serial: "Serial number",
    addedAt: "Added",
    actions: "Actions",
    edit: "Edit",
    delete: "Delete",
    noMatches: "No records match your search.",
    sourceFile: "Image file",
    dataQuality: "Data quality",
    totalAssets: "Total assets",
    needsReview: "Needs review",
    duplicates: "Duplicate serial",
    approved: "Approved",
    allStatuses: "All statuses",
    status: "Status",
    approveRecord: "Approve result",
    reviewBadge: "Review",
    approvedBadge: "Approved",
    duplicateBadge: "Duplicate",
    settings: "Settings",
    settingsTitle: "Analysis settings",
    settingsLead: "Enter a Gemini key to enable live image analysis.",
    apiKey: "Gemini API Key",
    apiPlaceholder: "AIza...",
    saveKey: "Save and enable Gemini",
    clearKey: "Remove key",
    keyReady: "Gemini ready",
    keyMissing: "Gemini not connected",
    keySaved: "Key saved for this browser session.",
    keyPrivacy:
      "For safety, the key stays in this browser tab only. It is not stored in the database or site files and is cleared when the browser session closes.",
    getKey: "Create a key in Google AI Studio",
    close: "Close",
    invalid:
      "Choose 1 to 5 JPG, PNG or WEBP images, up to 10 MB each and 25 MB total.",
    failed:
      "The images could not be analyzed. Check the configuration and try again.",
    online: "Online",
    offline: "Offline",
    installApp: "Install app",
    syncNow: "Sync now",
    offlineSaved:
      "Asset saved on this device and will upload automatically when connection returns.",
    offlineQueue: "Offline assets",
    syncing: "Syncing",
    gps: "GPS location",
    captureGps: "Capture location",
    gpsReady: "Location captured",
    gpsRequired: "GPS must be captured for this project.",
    barcode: "QR / Barcode",
    scanBarcode: "Scan with camera",
    barcodePlaceholder: "Scan or enter code",
    closeScanner: "Close camera",
    scannerUnsupported:
      "Live scanning is not supported in this browser; enter the code manually.",
    removeOffline: "Delete local copy",
  },
};

const sampleResult: Result = {
  assetType: "Centrifugal Pump",
  summary: "Horizontal centrifugal water pump with three-phase electric motor.",
  overallConfidence: 0.92,
  conditionRating: null,
  criticalityRating: null,
  fields: [
    {
      key: "manufacturer",
      label: "Manufacturer",
      value: "Grundfos",
      confidence: 0.98,
    },
    {
      key: "modelNumber",
      label: "Model Number",
      value: "CR 15-4 A-F-A-E-HQQE",
      confidence: 0.96,
    },
    {
      key: "serialNumber",
      label: "Serial Number",
      value: "P12245871",
      confidence: 0.94,
    },
    {
      key: "ratedPower",
      label: "Rated Power",
      value: "5.5 kW",
      confidence: 0.93,
    },
    { key: "voltage", label: "Voltage", value: "380–415 V", confidence: 0.91 },
    { key: "frequency", label: "Frequency", value: "50 Hz", confidence: 0.97 },
    { key: "speed", label: "Speed", value: "2,900 rpm", confidence: 0.86 },
    { key: "ipRating", label: "IP Rating", value: "IP55", confidence: 0.91 },
  ],
  warnings: ["Verify the final digit of the serial number before saving."],
  rawText:
    "GRUNDFOS • CR 15-4 A-F-A-E-HQQE • 3~ 380-415V • 50Hz • 5.5kW • IP55",
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
    </svg>
  );
}
function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3M7 12h10" />
    </svg>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("ar");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkRatings, setBulkRatings] = useState<BulkAssetRating[]>([]);
  const [bulkSession, setBulkSession] = useState<BulkSession | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [masterError, setMasterError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [manualBuilding, setManualBuilding] = useState("");
  const [manualFloor, setManualFloor] = useState("");
  const [manualZone, setManualZone] = useState("");
  const [manualOffice, setManualOffice] = useState("");
  const [locationSelections, setLocationSelections] = useState<
    Record<string, string>
  >({});
  const [manualLocationValues, setManualLocationValues] = useState<
    Record<string, string>
  >({});
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
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [gps, setGps] = useState<GPSPosition | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [conditionRating, setConditionRating] = useState<number | null>(null);
  const [conditionJustification, setConditionJustification] = useState("");
  const [criticalityRating, setCriticalityRating] = useState<number | null>(
    null,
  );
  const [categoryId, setCategoryId] = useState("");
  const [operationalStatus, setOperationalStatus] =
    useState<AssetOperationalStatus>("active");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [replacementCost, setReplacementCost] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("AED");
  const [usefulLifeYears, setUsefulLifeYears] = useState("");
  const [installationDate, setInstallationDate] = useState("");
  const [hasRelatedAsset, setHasRelatedAsset] = useState(false);
  const [relatedAssetId, setRelatedAssetId] = useState("");
  const [currentAssetRole, setCurrentAssetRole] = useState<"parent" | "child">(
    "child",
  );
  const [relationshipOptions, setRelationshipOptions] = useState<
    RelationshipOption[]
  >([]);
  const [relationshipSearch, setRelationshipSearch] = useState("");
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipError, setRelationshipError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedAsset, setScannedAsset] = useState<AssetQrPayload | null>(null);
  const [captureStep, setCaptureStep] = useState<1 | 2 | 3>(1);
  const [entryMode, setEntryMode] = useState<"images" | "manual">("images");
  const [manualAsset, setManualAsset] = useState({
    assetType: "",
    summary: "",
    manufacturer: "",
    model: "",
    serial: "",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const scannerVideoRef = useRef<HTMLVideoElement>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const completedJobsRef = useRef<Set<string>>(new Set());
  const prefillAppliedRef = useRef(false);
  const queuePollInFlightRef = useRef(false);
  const manualSubmissionIdRef = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => setLanguage(readUiLanguage()), 0);
    const onLanguage = (event: Event) =>
      setLanguage((event as CustomEvent<Language>).detail || readUiLanguage());
    window.addEventListener(UI_LANGUAGE_EVENT, onLanguage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(UI_LANGUAGE_EVENT, onLanguage);
    };
  }, []);

  useEffect(() => {
    if (
      !hasRelatedAsset ||
      !projectId ||
      !buildingId ||
      buildingId === "__manual__"
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setRelationshipLoading(true);
      setRelationshipError("");
      void apiGet<{ assets: RelationshipOption[]; error?: string }>(
        `/api/assets?view=relationship-options&project=${encodeURIComponent(projectId)}&building=${encodeURIComponent(buildingId)}`,
        { ttlMs: 0, force: true },
      )
        .then((payload) => {
          if (!cancelled) setRelationshipOptions(payload.assets || []);
        })
        .catch((reason) => {
          if (!cancelled)
            setRelationshipError(
              reason instanceof Error
                ? reason.message
                : language === "ar"
                  ? "تعذر تحميل أصول المبنى."
                  : "Unable to load building assets.",
            );
        })
        .finally(() => {
          if (!cancelled) setRelationshipLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasRelatedAsset, projectId, buildingId, language]);

  const compressImage = async (
    file: File,
    targetBytes: number,
  ): Promise<File> => {
    if (file.size <= targetBytes) return file;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("تعذر تجهيز الصورة للرفع."));
      };
      img.src = url;
    });
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxDimension = 2_200;
    if (Math.max(width, height) > maxDimension) {
      const ratio = maxDimension / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    let canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas
      .getContext("2d", { alpha: false })
      ?.drawImage(img, 0, 0, width, height);
    const encode = (source: HTMLCanvasElement, quality: number) =>
      new Promise<Blob | null>((resolve) =>
        source.toBlob(resolve, "image/jpeg", quality),
      );
    let blob: Blob | null = null;
    for (let scalePass = 0; scalePass < 5; scalePass += 1) {
      for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
        blob = await encode(canvas, quality);
        if (blob && blob.size <= targetBytes)
          return new File([blob], file.name, {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
      }
      if (canvas.width <= 900 || canvas.height <= 600) break;
      const smaller = document.createElement("canvas");
      smaller.width = Math.max(720, Math.round(canvas.width * 0.82));
      smaller.height = Math.max(480, Math.round(canvas.height * 0.82));
      smaller
        .getContext("2d", { alpha: false })
        ?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas = smaller;
    }
    if (!blob) throw new Error("تعذر ضغط الصورة. جرّب صورة أخرى.");
    return new File([blob], file.name, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  };
  const t = copy[language];
  const selectedProject = masterConfig?.projects.find(
    (item) => item.id === projectId,
  );
  const canApproveAssets = canUseModule(
    masterConfig?.currentUser.modulePermissions,
    "reports",
    "approve",
  );
  const projectCategories = (masterConfig?.categories || []).filter(
    (category) =>
      category.active !== false &&
      selectedProject?.categoryIds.includes(category.id),
  );
  const selectedCategory = projectCategories.find(
    (category) => category.id === categoryId,
  );
  const selectedBuilding = selectedProject?.buildings.find(
    (item) => item.id === buildingId,
  );
  const selectedFloor = selectedBuilding?.floors.find(
    (item) => item.id === floorId,
  );
  const availableZones =
    selectedBuilding?.zones.filter(
      (item) => !item.floorId || !floorId || item.floorId === floorId,
    ) || [];
  const selectedZone = availableZones.find((item) => item.id === zoneId);
  const availableOffices =
    selectedBuilding?.offices.filter(
      (item) =>
        (!item.floorId || !floorId || item.floorId === floorId) &&
        (!item.zoneId || !zoneId || item.zoneId === zoneId),
    ) || [];
  const selectedOffice = availableOffices.find((item) => item.id === officeId);
  const filteredRelationshipOptions = relationshipOptions.filter((asset) => {
    const query = relationshipSearch.trim().toLocaleLowerCase(language);
    if (!query) return true;
    return [
      asset.assetNo,
      asset.assetType,
      asset.building,
      asset.floor,
      asset.zone,
      asset.office,
    ]
      .join(" ")
      .toLocaleLowerCase(language)
      .includes(query);
  });
  const buildingValue =
    buildingId === "__manual__"
      ? manualBuilding.trim()
      : selectedBuilding?.name || "";
  const floorValue =
    floorId === "__manual__" ? manualFloor.trim() : selectedFloor?.name || "";
  const zoneValue =
    zoneId === "__manual__" ? manualZone.trim() : selectedZone?.name || "";
  const officeValue =
    officeId === "__manual__"
      ? manualOffice.trim()
      : selectedOffice?.name || "";
  const dynamicOptionsFor = (level: MasterLocationLevel) =>
    level.options.filter(
      (option) =>
        (!option.buildingId || option.buildingId === buildingId) &&
        (!option.floorId || option.floorId === floorId) &&
        (!option.zoneId || option.zoneId === zoneId) &&
        (!option.officeId || option.officeId === officeId) &&
        (!level.parentLevelId ||
          (locationSelections[level.parentLevelId] &&
            option.parentOptionId === locationSelections[level.parentLevelId])),
    );
  const additionalLocations: DynamicLocationValue[] = (
    selectedProject?.locationLevels || []
  ).map((level) => {
    if (level.key === "office")
      return {
        levelId: level.id,
        key: level.key,
        labelAr: level.labelAr,
        labelEn: level.labelEn,
        valueId: "",
        value: officeValue,
      };
    const selectedId = locationSelections[level.id] || "";
    const option = dynamicOptionsFor(level).find(
      (item) => item.id === selectedId,
    );
    return {
      levelId: level.id,
      key: level.key,
      labelAr: level.labelAr,
      labelEn: level.labelEn,
      valueId: option?.id || "",
      value:
        selectedId === "__manual__"
          ? (manualLocationValues[level.id] || "").trim()
          : option?.name || "",
    };
  });
  const gpsField = selectedProject?.customFields.find((field) =>
    ["gps", "gps_location", "coordinates"].includes(field.key),
  );
  const barcodeField = selectedProject?.customFields.find((field) =>
    ["barcode", "qr_code", "asset_barcode"].includes(field.key),
  );
  const locationFields =
    selectedProject?.customFields.filter(
      (field) =>
        (field.assetTypes || []).length === 0 &&
        field.id !== gpsField?.id &&
        field.id !== barcodeField?.id,
    ) || [];
  const activeAssetType = (result?.assetType || manualAsset.assetType)
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
  const assetFields =
    selectedProject?.customFields.filter((field) =>
      (field.assetTypes || []).some(
        (type) =>
          type.trim().toLocaleLowerCase("en").replace(/\s+/g, " ") ===
          activeAssetType,
      ),
    ) || [];
  const reviewCustomFields =
    selectedProject?.customFields.filter(
      (field) =>
        field.id !== gpsField?.id &&
        field.id !== barcodeField?.id &&
        ((field.assetTypes || []).length === 0 ||
          (activeAssetType &&
            (field.assetTypes || []).some(
              (type) =>
                type.trim().toLocaleLowerCase("en").replace(/\s+/g, " ") ===
                activeAssetType,
            ))),
    ) || [];
  const editingRecord = records.find((record) => record.id === editingRecordId);
  const visibleJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.status !== "completed" ||
          records.some(
            (record) => record.id === job.assetId && record.status === "review",
          ),
      ),
    [jobs, records],
  );
  const shouldQueueAsBulk = bulkMode && files.length > 0;
  const bulkRatingsComplete =
    !bulkMode ||
    files.every((_, index) => {
      const rating = bulkRatings[index];
      return Boolean(
        rating &&
        Number.isInteger(rating.conditionRating) &&
        Number(rating.conditionRating) >= 1 &&
        Number(rating.conditionRating) <= 5 &&
        (Number(rating.conditionRating) > 2 ||
          rating.conditionJustification.trim().length >= 3) &&
        Number.isInteger(rating.criticalityRating) &&
        Number(rating.criticalityRating) >= 1 &&
        Number(rating.criticalityRating) <= 5,
      );
    });
  async function optimizeSelectedFiles() {
    const targetBytes = shouldQueueAsBulk
      ? 3_500_000
      : Math.max(620_000, Math.floor(3_600_000 / Math.max(1, files.length)));
    const optimized = new Array<File>(files.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor;
        cursor += 1;
        optimized[index] = await compressImage(files[index], targetBytes);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, files.length) }, () => worker()),
    );
    return optimized;
  }
  const bulkSessionAssetIds = useMemo(
    () => new Set(bulkSession?.assetIds || []),
    [bulkSession],
  );
  const bulkSessionRecords = useMemo(
    () => records.filter((record) => bulkSessionAssetIds.has(record.id)),
    [records, bulkSessionAssetIds],
  );
  const bulkSessionCompleted = bulkSessionRecords.filter(
    (record) => record.status === "completed" || record.status === "review",
  ).length;

  const openRecordForReview = useCallback(
    (record: StoredRecord) => {
      setResult({
        assetType: record.assetType,
        summary: record.summary,
        fields: record.fields,
        warnings: record.warnings,
        rawText: record.rawText,
        overallConfidence: record.overallConfidence,
        conditionRating: record.conditionRating,
        conditionJustification: record.conditionJustification,
        criticalityRating: record.criticalityRating,
        categoryId: record.surveyContext?.categoryId,
        operationalStatus: record.surveyContext?.operationalStatus,
        estimatedPrice: record.surveyContext?.estimatedPrice,
        replacementCost: record.surveyContext?.replacementCost,
        priceCurrency: record.surveyContext?.priceCurrency,
        usefulLifeYears: record.surveyContext?.usefulLifeYears,
        installationDate: record.surveyContext?.installationDate,
      });
      const values = Object.fromEntries(
        (record.customValues || []).map((field) => [field.key, field.value]),
      );
      const project = masterConfig?.projects.find(
        (item) => item.id === record.surveyContext?.projectId,
      );
      const normalize = (value: string) =>
        value.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const field of project?.customFields || []) {
        if (!field.aiExtract || values[field.key]) continue;
        const extracted = record.fields.find(
          (item) =>
            normalize(item.key) === normalize(field.key) ||
            normalize(item.label) === normalize(field.labelEn || field.labelAr),
        );
        if (extracted?.value) values[field.key] = extracted.value;
      }
      setCustomValues(values);
      setEditingRecordId(record.id);
      setDemo(false);
      setCaptureStep(3);
      setError("");
      window.setTimeout(
        () =>
          document
            .querySelector(".result-panel")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    },
    [masterConfig],
  );

  const applyWorkspace = useCallback(
    (
      payload: { records: StoredRecord[]; jobs: AnalysisJob[] },
      announceCompletion = false,
    ) => {
      const newlyCompleted = announceCompletion
        ? payload.jobs.find(
            (job) =>
              job.status === "completed" &&
              !completedJobsRef.current.has(job.id),
          )
        : undefined;
      payload.jobs
        .filter((job) => job.status === "completed")
        .forEach((job) => completedJobsRef.current.add(job.id));
      setRecords(payload.records);
      setJobs(payload.jobs);
      invalidateApiCache("/api/dashboard");
      invalidateApiCache("/api/reports");
      invalidateApiCache("/api/assets?view=list");
      invalidateApiCache("/api/assets?view=transfer");
      if (newlyCompleted) {
        const record = payload.records.find(
          (item) => item.id === newlyCompleted.assetId,
        );
        if (record) openRecordForReview(record);
      }
    },
    [openRecordForReview],
  );
  const loadWorkspace = useCallback(
    async (announceCompletion = false) => {
      try {
        const payload = await apiGet<{
          records: StoredRecord[];
          jobs: AnalysisJob[];
          error?: string;
        }>("/api/assets?view=queue", {
          ttlMs: announceCompletion ? 0 : 5_000,
          force: announceCompletion,
        });
        applyWorkspace(payload, announceCompletion);
      } catch (reason) {
        if (
          reason instanceof ApiClientError &&
          (reason.status === 401 || reason.status === 403)
        ) {
          window.location.replace("/login");
          return;
        }
        throw reason;
      }
    },
    [applyWorkspace],
  );
  const refreshOfflineQueue = useCallback(async () => {
    await clearExpiredOfflineSubmissions();
    setOfflineQueue(await listOfflineSubmissions());
  }, []);
  function setCapturedBarcode(value: string) {
    const clean = value.trim().slice(0, 200);
    setBarcode(clean);
    if (barcodeField?.key)
      setCustomValues((current) => ({ ...current, [barcodeField.key]: clean }));
  }
  const handleScannedBarcode = useEffectEvent(async (value: string) => {
    try {
      const asset = await parseAssetQrValue(value);
      if (asset) {
        let currentAsset = asset;
        if (navigator.onLine) {
          try {
            const response = await fetch(
              `/api/public/assets/${encodeURIComponent(asset.assetId)}`,
              { cache: "no-store" },
            );
            const latest = (await response.json()) as {
              payload?: typeof asset;
            };
            if (response.ok && latest.payload?.assetId === asset.assetId)
              currentAsset = latest.payload;
          } catch {
            /* The embedded snapshot remains a complete offline fallback. */
          }
        }
        setScannedAsset(currentAsset);
        setBarcode(asset.assetId);
        if (barcodeField?.key)
          setCustomValues((current) => ({
            ...current,
            [barcodeField.key]: asset.assetId,
          }));
        return;
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : language === "ar"
            ? "تعذر قراءة بيانات QR."
            : "QR data could not be read.",
      );
      return;
    }
    const clean = value.trim().slice(0, 200);
    setBarcode(clean);
    if (barcodeField?.key)
      setCustomValues((current) => ({ ...current, [barcodeField.key]: clean }));
  });
  async function captureGps() {
    if (!navigator.geolocation) {
      setError(t.gpsRequired);
      return null;
    }
    setGpsBusy(true);
    setError("");
    const position = await new Promise<GPSPosition | null>((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (result) =>
          resolve({
            latitude: result.coords.latitude,
            longitude: result.coords.longitude,
            accuracy: result.coords.accuracy,
            capturedAt: new Date(result.timestamp).toISOString(),
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      ),
    );
    setGpsBusy(false);
    if (!position) {
      setError(t.gpsRequired);
      return null;
    }
    setGps(position);
    if (gpsField?.key)
      setCustomValues((current) => ({
        ...current,
        [gpsField.key]: `${position.latitude.toFixed(7)},${position.longitude.toFixed(7)}`,
      }));
    return position;
  }
  const syncOfflineQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncingOffline(true);
    setOfflineNotice("");
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const pending = await listOfflineSubmissions();
      for (const submission of pending) {
        try {
          const response = await fetch("/api/assets", {
            method: "POST",
            body: submissionFormData(submission),
            headers: {
              Authorization: `Bearer ${token}`,
              ...(geminiKey.trim()
                ? { "x-gemini-api-key": geminiKey.trim() }
                : {}),
            },
          });
          const responseText = await response.text();
          const payload = responseText
            ? (JSON.parse(responseText) as {
                records?: StoredRecord[];
                jobs?: AnalysisJob[];
                error?: string;
              })
            : {};
          if (response.status === 401) {
            window.location.replace("/login");
            return;
          }
          if (!response.ok || !payload.records || !payload.jobs) {
            await updateOfflineSubmission({
              ...submission,
              attempts: submission.attempts + 1,
              lastError: payload.error || `Sync failed (${response.status}).`,
            });
            break;
          }
          applyWorkspace({ records: payload.records, jobs: payload.jobs });
          await removeOfflineSubmission(submission.id);
        } catch {
          break;
        }
      }
      await refreshOfflineQueue();
    } finally {
      setSyncingOffline(false);
    }
  }, [applyWorkspace, geminiKey, refreshOfflineQueue]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedKey =
        window.sessionStorage.getItem("assetlens_gemini_key") || "";
      setGeminiKey(storedKey);
      setKeySaved(Boolean(storedKey));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsOnline(navigator.onLine);
      void refreshOfflineQueue();
    }, 0);
    const online = () => {
      setIsOnline(true);
      void syncOfflineQueue();
    };
    const offline = () => setIsOnline(false);
    const install = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installed);
    };
  }, [refreshOfflineQueue, syncOfflineQueue]);
  useEffect(() => {
    if (!scannerOpen) return;
    let active = true;
    void (async () => {
      try {
        const Detector = (
          window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
        ).BarcodeDetector;
        if (!Detector || !navigator.mediaDevices?.getUserMedia) {
          setError(t.scannerUnsupported);
          setScannerOpen(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        scannerStreamRef.current = stream;
        const video = scannerVideoRef.current;
        if (!video || !active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({
          formats: [
            "qr_code",
            "code_128",
            "code_39",
            "ean_13",
            "ean_8",
            "data_matrix",
          ],
        });
        const scan = async () => {
          if (!active) return;
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) {
              active = false;
              await handleScannedBarcode(found[0].rawValue);
              setScannerOpen(false);
              return;
            }
          } catch {
            /* keep scanning the next frame */
          }
          scannerFrameRef.current = window.requestAnimationFrame(
            () => void scan(),
          );
        };
        await scan();
      } catch {
        setError(t.scannerUnsupported);
        setScannerOpen(false);
      }
    })();
    return () => {
      active = false;
      if (scannerFrameRef.current)
        window.cancelAnimationFrame(scannerFrameRef.current);
      scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    };
  }, [scannerOpen, t.scannerUnsupported]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await loadDeviceConfig<MasterConfig>().catch(() => null);
      if (active && !navigator.onLine && cached) {
        setMasterConfig(cached);
        setMasterError("");
        return;
      }
      try {
        const fetchConfig = apiGet<MasterConfig & { error?: string }>(
          "/api/config?scope=capture",
          { ttlMs: 5 * 60_000 },
        );
        const fetchWorkspace = loadWorkspace();
        const [payload] = await Promise.all([fetchConfig, fetchWorkspace]);
        if (active) {
          setMasterConfig(payload);
          setMasterError("");
          await saveDeviceConfig(payload);
        }
      } catch (err) {
        if (!active) return;
        if (
          err instanceof ApiClientError &&
          (err.status === 401 || err.status === 403)
        ) {
          window.location.replace("/login");
          return;
        }
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load project configuration.";
        if (cached) {
          setMasterConfig(cached);
          setMasterError("");
        } else setMasterError(message);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadWorkspace]);
  useEffect(() => {
    if (!masterConfig || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedProject = params.get("project") || "";
    const requestedBuilding = params.get("building") || "";
    const requestedFloor = params.get("floor") || "";
    const requestedZone = params.get("zone") || "";
    const requestedOffice = params.get("office") || "";
    const timer = window.setTimeout(() => {
      const project = masterConfig.projects.find(
        (item) => item.id === requestedProject,
      );
      if (!project) return;
      setProjectId(project.id);
      const building = project.buildings.find(
        (item) => item.id === requestedBuilding,
      );
      if (!building) return;
      setBuildingId(building.id);
      if (
        requestedFloor &&
        building.floors.some((item) => item.id === requestedFloor)
      )
        setFloorId(requestedFloor);
      if (
        requestedZone &&
        building.zones.some((item) => item.id === requestedZone)
      )
        setZoneId(requestedZone);
      if (
        requestedOffice &&
        building.offices.some((item) => item.id === requestedOffice)
      )
        setOfficeId(requestedOffice);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [masterConfig]);
  useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    if (
      !jobs.some(
        (job) => job.status === "queued" || job.status === "processing",
      )
    )
      return;
    const poll = async () => {
      if (queuePollInFlightRef.current) return;
      queuePollInFlightRef.current = true;
      try {
        const token = await getAccessToken();
        if (!token) {
          window.location.replace("/login");
          return;
        }
        if (
          jobs.some(
            (job) => job.status === "queued" || job.status === "processing",
          )
        ) {
          await fetch("/api/jobs", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...(geminiKey.trim()
                ? { "x-gemini-api-key": geminiKey.trim() }
                : {}),
            },
            body: JSON.stringify({ action: "wake" }),
          });
        }
        await loadWorkspace(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.failed);
      } finally {
        queuePollInFlightRef.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 6000);
    return () => window.clearInterval(timer);
  }, [jobs, geminiKey, t.failed, loadWorkspace]);

  function acceptFiles(nextFiles: File[]) {
    const fileLimit = bulkMode ? BULK_ZONE_LIMIT : SINGLE_ASSET_LIMIT;
    const totalLimit = bulkMode
      ? BULK_TOTAL_LIMIT_BYTES
      : SINGLE_TOTAL_LIMIT_BYTES;
    const nextTotal = [...files, ...nextFiles].reduce(
      (total, next) => total + next.size,
      0,
    );
    if (
      nextFiles.length === 0 ||
      files.length + nextFiles.length > fileLimit ||
      nextFiles.some(
        (next) =>
          !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
          next.size > IMAGE_LIMIT_BYTES,
      ) ||
      nextTotal > totalLimit
    ) {
      setError(bulkMode ? t.bulkInvalid : t.invalid);
      return;
    }
    const nextPreviews = nextFiles.map((next) => URL.createObjectURL(next));
    previewUrlsRef.current = [...previewUrlsRef.current, ...nextPreviews];
    setFiles((current) => [...current, ...nextFiles]);
    setPreviews((current) => [...current, ...nextPreviews]);
    setBulkRatings((current) => [
      ...current,
      ...nextFiles.map(() => ({
        conditionRating,
        conditionJustification,
        criticalityRating,
      })),
    ]);
    setResult(null);
    setDemo(false);
    setError("");
    setEditingRecordId(null);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    acceptFiles(Array.from(event.dataTransfer.files));
  }
  function removeFile(index: number) {
    const url = previews[index];
    if (url) URL.revokeObjectURL(url);
    previewUrlsRef.current = previewUrlsRef.current.filter(
      (item) => item !== url,
    );
    setFiles((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setPreviews((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setBulkRatings((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setResult(null);
    setError("");
  }
  function clear() {
    previews.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = previewUrlsRef.current.filter(
      (url) => !previews.includes(url),
    );
    setFiles([]);
    setPreviews([]);
    setBulkRatings([]);
    setResult(null);
    setDemo(false);
    setError("");
    setEditingRecordId(null);
    setManualAsset({
      assetType: "",
      summary: "",
      manufacturer: "",
      model: "",
      serial: "",
    });
    setCustomValues({});
    setGps(null);
    setBarcode("");
    setCategoryId("");
    setOperationalStatus("active");
    setEstimatedPrice("");
    setReplacementCost("");
    setPriceCurrency("AED");
    setUsefulLifeYears("");
    setInstallationDate("");
    setHasRelatedAsset(false);
    setRelatedAssetId("");
    setCurrentAssetRole("child");
    setRelationshipOptions([]);
    setRelationshipSearch("");
    setRelationshipError("");
    setConditionRating(null);
    setConditionJustification("");
    setCriticalityRating(null);
    setCaptureStep(1);
    manualSubmissionIdRef.current = "";
  }
  function resetCaptureForm() {
    clear();
    setProjectId("");
    setBuildingId("");
    setFloorId("");
    setZoneId("");
    setOfficeId("");
    setManualBuilding("");
    setManualFloor("");
    setManualZone("");
    setManualOffice("");
    setLocationSelections({});
    setManualLocationValues({});
    setEntryMode("images");
    setBulkMode(false);
    setBulkSession(null);
  }
  function mergeBulkSessionAssets(assetIds: string[]) {
    if (assetIds.length === 0) return;
    setBulkSession((current) =>
      current
        ? {
            ...current,
            assetIds: Array.from(new Set([...current.assetIds, ...assetIds])),
          }
        : current,
    );
  }
  function csvSafe(value: unknown) {
    const textValue = String(value ?? "");
    const protectedValue = /^[=+\-@]/.test(textValue)
      ? `'${textValue}`
      : textValue;
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }
  function resultField(resultSource: Result | undefined, patterns: string[]) {
    const field = resultSource?.fields.find((item) =>
      patterns.some((pattern) =>
        `${item.key} ${item.label}`.toLowerCase().includes(pattern),
      ),
    );
    return field?.value || "";
  }
  function downloadBulkSessionCsv() {
    if (!bulkSession) return;
    const rows = bulkSession.assetIds.map((assetId, index) => {
      const job = jobs.find((item) => item.assetId === assetId);
      const record = records.find((item) => item.id === assetId);
      const resultSource = record || job?.result;
      const locationContext =
        record?.surveyContext || job?.surveyContext || bulkSession.context;
      const status =
        record?.status === "review"
          ? "Review"
          : record
            ? "Completed"
            : job?.status || "Queued";
      const row: Record<string, string | number> = {
        "No.": index + 1,
        Status: status,
        "Asset No.": record?.assetNo || "",
        "Source File":
          record?.fileName ||
          job?.fileName ||
          bulkSession.fileNames[index] ||
          "",
        Project: locationContext.project,
        "Building / Site": locationContext.building,
        Floor: locationContext.floor,
        Zone: locationContext.zone,
        "Asset Type": resultSource?.assetType || "",
        "Condition Rating": resultSource?.conditionRating || "",
        Condition: assetConditionLabel(resultSource?.conditionRating, "en"),
        "Condition Justification": resultSource?.conditionJustification || "",
        Criticality: assetCriticalityLabel(
          resultSource?.criticalityRating,
          "en",
        ),
        "Asset Weight":
          assetCriticalityWeight(resultSource?.criticalityRating) || "",
        Manufacturer: resultField(resultSource, [
          "manufacturer",
          "make",
          "brand",
        ]),
        Model: resultField(resultSource, ["model"]),
        "Serial Number": resultField(resultSource, ["serial", "s/n"]),
        Surveyor: bulkSession.context.surveyorEmail,
      };
      for (const location of locationContext.additionalLocations || [])
        row[location.labelEn || location.labelAr || location.key] =
          location.value;
      return row;
    });
    const columns = Object.keys(
      rows[0] || {
        "No.": "",
        Status: "",
        "Asset No.": "",
        "Source File": "",
        Project: "",
        "Building / Site": "",
        Floor: "",
        Zone: "",
        "Office / Room": "",
        "Asset Type": "",
        Manufacturer: "",
        Model: "",
        "Serial Number": "",
        Surveyor: "",
      },
    );
    const csv = [
      columns.map(csvSafe).join(","),
      ...rows.map((row) =>
        columns
          .map((column) => csvSafe(row[column as keyof typeof row]))
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AssetLens_Bulk_Zone_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function currentSurveyContext(
    position: GPSPosition | null = gps,
    capturedOffline = false,
    offlineClientId = crypto.randomUUID(),
    ratingOverride?: BulkAssetRating,
  ): SurveyContext | null {
    const effectiveCondition =
      ratingOverride?.conditionRating ?? conditionRating;
    const effectiveJustification = (
      ratingOverride?.conditionJustification ?? conditionJustification
    ).trim();
    const effectiveCriticality =
      ratingOverride?.criticalityRating ?? criticalityRating;
    const submissionCustomValues = { ...customValues };
    if (position && gpsField?.key)
      submissionCustomValues[gpsField.key] =
        `${position.latitude.toFixed(7)},${position.longitude.toFixed(7)}`;
    if (barcode && barcodeField?.key)
      submissionCustomValues[barcodeField.key] = barcode;
    const requiredFields =
      selectedProject?.customFields.filter(
        (field) =>
          (field.assetTypes || []).length === 0 ||
          (activeAssetType &&
            (field.assetTypes || []).some(
              (type) =>
                type.trim().toLocaleLowerCase("en").replace(/\s+/g, " ") ===
                activeAssetType,
            )),
      ) || [];
    const submissionFieldsValid = requiredFields.every(
      (field) =>
        !field.required || Boolean(submissionCustomValues[field.key]?.trim()),
    );
    const dynamicLocationsValid = (selectedProject?.locationLevels || []).every(
      (level) =>
        !level.required ||
        Boolean(
          additionalLocations.find((item) => item.levelId === level.id)?.value,
        ),
    );
    if (
      !selectedProject ||
      !categoryId ||
      !projectCategories.some((category) => category.id === categoryId) ||
      !Number.isInteger(effectiveCondition) ||
      Number(effectiveCondition) < 1 ||
      Number(effectiveCondition) > 5 ||
      (Number(effectiveCondition) <= 2 && effectiveJustification.length < 3) ||
      !Number.isInteger(effectiveCriticality) ||
      Number(effectiveCriticality) < 1 ||
      Number(effectiveCriticality) > 5 ||
      !Boolean(
        (!selectedProject.requireBuilding || buildingValue) &&
        (!selectedProject.requireFloor || floorValue) &&
        (!selectedProject.requireZone || zoneValue) &&
        (!selectedProject.requireOffice || officeValue) &&
        dynamicLocationsValid &&
        submissionFieldsValid,
      )
    )
      return null;
    return {
      projectId: selectedProject.id,
      project: selectedProject.name,
      buildingId: buildingId === "__manual__" ? "" : buildingId,
      building: buildingValue,
      floorId: floorId === "__manual__" ? "" : floorId,
      floor: floorValue,
      zoneId: zoneId === "__manual__" ? "" : zoneId,
      zone: zoneValue,
      officeId: officeId === "__manual__" ? "" : officeId,
      office: officeValue,
      additionalLocations: additionalLocations.filter((item) => item.value),
      categoryId,
      conditionRating: Number(effectiveCondition),
      conditionJustification: effectiveJustification,
      criticalityRating: Number(effectiveCriticality),
      operationalStatus,
      estimatedPrice: estimatedPrice ? Number(estimatedPrice) : null,
      replacementCost: replacementCost ? Number(replacementCost) : null,
      priceCurrency: priceCurrency || "AED",
      usefulLifeYears: usefulLifeYears ? Number(usefulLifeYears) : null,
      installationDate,
      estimateSource: selectedCategory
        ? `Category default: ${selectedCategory.labelEn}`
        : "",
      surveyorEmail: masterConfig?.currentUser.email || "",
      customValues: submissionCustomValues,
      relationship: {
        enabled: hasRelatedAsset,
        relatedAssetId: hasRelatedAsset ? relatedAssetId : "",
        currentAssetRole,
      },
      mobile: {
        latitude: position?.latitude ?? null,
        longitude: position?.longitude ?? null,
        accuracy: position?.accuracy ?? null,
        capturedAt: position?.capturedAt || new Date().toISOString(),
        barcode,
        capturedOffline,
        offlineClientId,
      },
    };
  }

  async function installApplication() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  async function queueAnalysis() {
    if (files.length === 0) return;
    if (
      !Number.isInteger(conditionRating) ||
      Number(conditionRating) < 1 ||
      Number(conditionRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر تقييم حالة الأصل قبل إرفاق الصور للتحليل."
          : "Choose the asset condition before attaching images for analysis.",
      );
      setCaptureStep(1);
      return;
    }
    if (
      Number(conditionRating) <= 2 &&
      conditionJustification.trim().length < 3
    ) {
      setError(
        language === "ar"
          ? "اكتب سبب تقييم الأصل كحالة حرجة أو ضعيفة قبل المتابعة."
          : "Explain why the asset is Critical or Poor before continuing.",
      );
      setCaptureStep(1);
      return;
    }
    if (
      !Number.isInteger(criticalityRating) ||
      Number(criticalityRating) < 1 ||
      Number(criticalityRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر درجة أهمية الأصل قبل إرفاق الصور للتحليل."
          : "Choose the asset criticality before attaching images for analysis.",
      );
      setCaptureStep(1);
      return;
    }
    if (shouldQueueAsBulk && !bulkRatingsComplete) {
      setError(
        language === "ar"
          ? "أكمل تقييم الحالة والأهمية وسبب الحالة الضعيفة لكل صورة في جلسة Bulk."
          : "Complete condition, criticality and any required poor-condition reason for every Bulk image.",
      );
      return;
    }
    let capturedPosition = gps;
    if (!capturedPosition && gpsField) capturedPosition = await captureGps();
    if (gpsField?.required && !capturedPosition) {
      setError(t.gpsRequired);
      return;
    }
    const clientId = crypto.randomUUID();
    const surveyContext = currentSurveyContext(
      capturedPosition,
      false,
      clientId,
    );
    if (!surveyContext) {
      setError(t.contextRequired);
      return;
    }
    setUploading(true);
    setError("");
    setCaptureStep(2);
    const saveForSync = async () => {
      const compressedFiles = await optimizeSelectedFiles();
      if (shouldQueueAsBulk) {
        for (const [index, file] of compressedFiles.entries()) {
          const offlineContext = currentSurveyContext(
            capturedPosition,
            true,
            crypto.randomUUID(),
            bulkRatings[index],
          );
          if (offlineContext)
            await saveOfflineSubmission(
              [file],
              offlineContext as unknown as Record<string, unknown>,
            );
        }
      } else {
        const offlineContext: SurveyContext = {
          ...surveyContext,
          mobile: { ...surveyContext.mobile!, capturedOffline: true },
        };
        await saveOfflineSubmission(
          compressedFiles,
          offlineContext as unknown as Record<string, unknown>,
        );
      }
      await refreshOfflineQueue();
      setOfflineNotice(shouldQueueAsBulk ? t.bulkQueued : t.offlineSaved);
      previews.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = previewUrlsRef.current.filter(
        (url) => !previews.includes(url),
      );
      setFiles([]);
      setPreviews([]);
      setBulkRatings([]);
      setResult(null);
      setDemo(false);
      setEditingRecordId(null);
      setCustomValues({});
      setGps(null);
      setBarcode("");
      setCategoryId("");
      setOperationalStatus("active");
      setEstimatedPrice("");
      setReplacementCost("");
      setPriceCurrency("AED");
      setUsefulLifeYears("");
      setInstallationDate("");
      setHasRelatedAsset(false);
      setRelatedAssetId("");
      setRelationshipOptions([]);
      setRelationshipSearch("");
      setConditionRating(null);
      setConditionJustification("");
      setCriticalityRating(null);
      setCaptureStep(1);
    };
    try {
      if (!navigator.onLine) {
        await saveForSync();
        return;
      }
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const compressedFiles = await optimizeSelectedFiles();
      if (shouldQueueAsBulk) {
        const sessionId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        setBulkSession({
          id: sessionId,
          startedAt,
          total: compressedFiles.length,
          assetIds: [],
          fileNames: compressedFiles.map((file) => file.name),
          context: {
            project: surveyContext.project,
            building: surveyContext.building,
            floor: surveyContext.floor,
            zone: surveyContext.zone,
            office: surveyContext.office,
            additionalLocations: surveyContext.additionalLocations,
            surveyorEmail: surveyContext.surveyorEmail,
          },
        });
        for (const [index, image] of compressedFiles.entries()) {
          const itemContext = currentSurveyContext(
            capturedPosition,
            false,
            crypto.randomUUID(),
            bulkRatings[index],
          );
          if (!itemContext) throw new Error(t.contextRequired);
          const body = new FormData();
          body.append("images", image);
          body.append("context", JSON.stringify(itemContext));
          let response: Response;
          try {
            response = await fetch("/api/assets?compact=1", {
              method: "POST",
              body,
              headers: {
                Authorization: `Bearer ${token}`,
                ...(geminiKey.trim()
                  ? { "x-gemini-api-key": geminiKey.trim() }
                  : {}),
              },
            });
          } catch {
            await saveOfflineSubmission([image], {
              ...itemContext,
              mobile: { ...itemContext.mobile!, capturedOffline: true },
            } as unknown as Record<string, unknown>);
            continue;
          }
          const payload = (await response.json()) as {
            accepted?: boolean;
            assetId?: string;
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error || t.failed);
          if (!payload.assetId) throw new Error(t.failed);
          mergeBulkSessionAssets([payload.assetId]);
        }
        await loadWorkspace(true);
        await refreshOfflineQueue();
        setOfflineNotice(t.bulkQueued);
      } else {
        const body = new FormData();
        compressedFiles.forEach((image) => body.append("images", image));
        body.append("context", JSON.stringify(surveyContext));
        let response: Response;
        try {
          response = await fetch("/api/assets", {
            method: "POST",
            body,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(geminiKey.trim()
                ? { "x-gemini-api-key": geminiKey.trim() }
                : {}),
            },
          });
        } catch {
          await saveForSync();
          return;
        }
        const payload = (await response.json()) as {
          records: StoredRecord[];
          jobs: AnalysisJob[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || t.failed);
        applyWorkspace(payload);
      }
      previews.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = previewUrlsRef.current.filter(
        (url) => !previews.includes(url),
      );
      setFiles([]);
      setPreviews([]);
      setBulkRatings([]);
      setResult(null);
      setDemo(false);
      setEditingRecordId(null);
      setCustomValues({});
      setGps(null);
      setBarcode("");
      setCategoryId("");
      setOperationalStatus("active");
      setEstimatedPrice("");
      setReplacementCost("");
      setPriceCurrency("AED");
      setUsefulLifeYears("");
      setInstallationDate("");
      setHasRelatedAsset(false);
      setRelatedAssetId("");
      setRelationshipOptions([]);
      setRelationshipSearch("");
      setConditionRating(null);
      setConditionJustification("");
      setCriticalityRating(null);
      setCaptureStep(1);
      if (!shouldQueueAsBulk) setOfflineNotice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setUploading(false);
    }
  }
  async function createManualAsset() {
    if (uploading) return;
    if (!manualAsset.assetType.trim()) {
      setError(
        language === "ar"
          ? "اكتب نوع الأصل أولاً."
          : "Enter the asset type first.",
      );
      return;
    }
    const missing = assetFields.find(
      (field) => field.required && !customValues[field.key]?.trim(),
    );
    if (missing) {
      setError(
        `${language === "ar" ? missing.labelAr : missing.labelEn || missing.labelAr} ${t.required}`,
      );
      return;
    }
    if (!manualSubmissionIdRef.current)
      manualSubmissionIdRef.current = crypto.randomUUID();
    const surveyContext = currentSurveyContext(
      gps,
      false,
      manualSubmissionIdRef.current,
    );
    if (!surveyContext) {
      setError(t.contextRequired);
      setCaptureStep(1);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const response = await fetch("/api/assets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "createManual",
          context: surveyContext,
          ...manualAsset,
        }),
      });
      const payload = (await response.json()) as {
        assetId?: string;
        assetNo?: string;
        created?: boolean;
        duplicate?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.assetId)
        throw new Error(payload.error || "تعذر إنشاء الأصل اليدوي.");
      invalidateApiCache("/api/dashboard");
      invalidateApiCache("/api/reports");
      invalidateApiCache("/api/assets?view=list");
      resetCaptureForm();
      setOfflineNotice(
        language === "ar"
          ? `تم إنشاء الأصل${payload.assetNo ? ` ${payload.assetNo}` : ""} بنجاح، وتم تصفير النموذج للبدء من جديد.`
          : `Asset${payload.assetNo ? ` ${payload.assetNo}` : ""} was created successfully. The form is ready for a new asset.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "تعذر إنشاء الأصل اليدوي.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function retryJob(id: string) {
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(geminiKey.trim() ? { "x-gemini-api-key": geminiKey.trim() } : {}),
        },
        body: JSON.stringify({ action: "retry", jobId: id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || t.failed);
      setJobs((current) =>
        current.map((job) =>
          job.id === id ? { ...job, status: "queued", error: undefined } : job,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    }
  }
  async function removeJob(id: string) {
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status === "processing") return;
    await deleteRecord(job.assetId);
  }
  function updateField(index: number, value: string) {
    setResult((current) =>
      current
        ? {
            ...current,
            fields: current.fields.map((field, i) =>
              i === index ? { ...field, value } : field,
            ),
          }
        : current,
    );
  }
  async function exportExcel() {
    const exportRecords = records.map((record) =>
      editingRecordId === record.id && result
        ? { ...record, ...result }
        : record,
    );
    if (exportRecords.length === 0) return;
    const fieldColumns = Array.from(
      new Set(
        exportRecords.flatMap((record) =>
          record.fields.map((field) => field.label || field.key),
        ),
      ),
    );
    const customColumns = Array.from(
      new Set(
        exportRecords.flatMap((record) =>
          (record.customValues || []).map(
            (field) => `Survey: ${field.labelEn || field.labelAr || field.key}`,
          ),
        ),
      ),
    );
    const locationColumns = Array.from(
      new Set(
        exportRecords.flatMap((record) =>
          (record.surveyContext?.additionalLocations || []).map(
            (location) => location.labelEn || location.labelAr || location.key,
          ),
        ),
      ),
    );
    const columns = [
      "Asset No.",
      "Status",
      "Captured At",
      "Surveyor",
      "Project",
      "Building / Site",
      "Floor",
      "Zone",
      ...locationColumns,
      ...customColumns,
      "Source File",
      "Asset Type",
      "Asset Summary",
      "Condition Rating",
      "Condition",
      "Condition Justification",
      "Criticality Rating",
      "Criticality",
      "Asset Weight",
      "Overall Confidence",
      ...fieldColumns,
    ];
    const assetRows = exportRecords.map((record, index) => {
      const row: Record<string, string | number> = {
        "Asset No.": record.assetNo || index + 1,
        Status: record.isDuplicate
          ? "Duplicate — Review"
          : record.status === "review"
            ? "Review"
            : "Approved",
        "Captured At": record.createdAt,
        Surveyor: record.surveyContext?.surveyorEmail || "",
        Project: record.surveyContext?.project || "",
        "Building / Site": record.surveyContext?.building || "",
        Floor: record.surveyContext?.floor || "",
        Zone: record.surveyContext?.zone || "",
        "Source File": record.fileName,
        "Asset Type": record.assetType,
        "Asset Summary": record.summary,
        "Condition Rating": record.conditionRating || "",
        Condition: assetConditionLabel(record.conditionRating, "en"),
        "Condition Justification": record.conditionJustification || "",
        "Criticality Rating": record.criticalityRating || "",
        Criticality: assetCriticalityLabel(record.criticalityRating, "en"),
        "Asset Weight": assetCriticalityWeight(record.criticalityRating) || "",
        "Overall Confidence": record.overallConfidence,
      };
      for (const location of record.surveyContext?.additionalLocations || [])
        row[location.labelEn || location.labelAr || location.key] =
          location.value;
      for (const field of record.customValues || [])
        row[`Survey: ${field.labelEn || field.labelAr || field.key}`] =
          field.value;
      for (const field of record.fields)
        row[field.label || field.key] = field.value;
      return row;
    });
    const confidenceRows = exportRecords.map((record, index) => {
      const row: Record<string, string | number> = {
        "Asset No.": record.assetNo || index + 1,
        Status: "",
        "Captured At": "",
        Surveyor: "",
        Project: "",
        "Building / Site": "",
        Floor: "",
        Zone: "",
        "Source File": "",
        "Asset Type": "",
        "Asset Summary": "",
        "Condition Rating": "",
        Condition: "",
        "Condition Justification": "",
        "Criticality Rating": "",
        Criticality: "",
        "Asset Weight": "",
        "Overall Confidence": record.overallConfidence,
      };
      for (const location of locationColumns) row[location] = "";
      for (const field of record.customValues || [])
        row[`Survey: ${field.labelEn || field.labelAr || field.key}`] = "";
      for (const field of record.fields)
        row[field.label || field.key] = field.confidence;
      return row;
    });
    const sourceRows = exportRecords.map((record, index) => {
      const row: Record<string, string | number> = {
        "Asset No.": record.assetNo || index + 1,
        Status: record.isDuplicate
          ? "Duplicate — Review"
          : record.status === "review"
            ? "Review"
            : "Approved",
        Project: record.surveyContext?.project || "",
        "Building / Site": record.surveyContext?.building || "",
        Floor: record.surveyContext?.floor || "",
        Zone: record.surveyContext?.zone || "",
        "Asset Type": record.assetType,
        "Raw Nameplate Text": record.rawText,
        "Review Warnings": record.warnings.join(" | "),
      };
      for (const location of record.surveyContext?.additionalLocations || [])
        row[location.labelEn || location.labelAr || location.key] =
          location.value;
      return row;
    });
    await exportWorkbook(`AssetLens_${Date.now()}.xlsx`, [
      { name: "Assets", rows: assetRows, columns },
      { name: "Confidence", rows: confidenceRows, columns },
      { name: "Source Review", rows: sourceRows },
    ]);
  }
  async function addToRegister(action: "save" | "approve" = "save") {
    if (!result || !editingRecordId) return;
    if (
      !Number.isInteger(result.conditionRating) ||
      Number(result.conditionRating) < 1 ||
      Number(result.conditionRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر حالة الأصل من مستويات التقييم الخمسة قبل الحفظ."
          : "Choose one of the five asset-condition levels before saving.",
      );
      return;
    }
    if (
      Number(result.conditionRating) <= 2 &&
      (result.conditionJustification || "").trim().length < 3
    ) {
      setError(
        language === "ar"
          ? "اكتب سبب تقييم الأصل كحالة حرجة أو ضعيفة قبل الحفظ."
          : "Explain why the asset is Critical or Poor before saving.",
      );
      return;
    }
    if (
      !Number.isInteger(result.criticalityRating) ||
      Number(result.criticalityRating) < 1 ||
      Number(result.criticalityRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر درجة أهمية الأصل قبل الحفظ."
          : "Choose the asset criticality before saving.",
      );
      return;
    }
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const response = await fetch("/api/assets", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingRecordId,
          result,
          customValues,
          action,
        }),
      });
      const payload = (await response.json()) as {
        records: StoredRecord[];
        jobs: AnalysisJob[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error || "The asset changes could not be saved.",
        );
      applyWorkspace(payload);
      clear();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The asset changes could not be saved.",
      );
    }
  }
  async function deleteRecord(id: string) {
    try {
      const token = await getAccessToken();
      if (!token) {
        window.location.replace("/login");
        return;
      }
      const response = await fetch(`/api/assets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        records: StoredRecord[];
        jobs: AnalysisJob[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "The asset could not be deleted.");
      applyWorkspace(payload);
      if (editingRecordId === id) clear();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The asset could not be deleted.",
      );
    }
  }
  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(
      [
        `Asset Type: ${result.assetType}`,
        `Condition: ${result.conditionRating || "—"}/5 — ${assetConditionLabel(result.conditionRating, "en") || "Not rated"}`,
        result.conditionJustification
          ? `Condition Justification: ${result.conditionJustification}`
          : "",
        `Criticality: ${assetCriticalityLabel(result.criticalityRating, "en") || "Not selected"} — Weight ${assetCriticalityWeight(result.criticalityRating) || "—"}`,
        ...result.fields.map((f) => `${f.label}: ${f.value}`),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  function saveGeminiKey() {
    const nextKey = geminiKey.trim();
    if (!nextKey) return;
    window.sessionStorage.setItem("assetlens_gemini_key", nextKey);
    setGeminiKey(nextKey);
    setKeySaved(true);
    setSettingsOpen(false);
    setError("");
  }
  function clearGeminiKey() {
    window.sessionStorage.removeItem("assetlens_gemini_key");
    setGeminiKey("");
    setKeySaved(false);
  }
  function renderCustomField(field: CustomSurveyField) {
    const label =
      language === "ar" ? field.labelAr : field.labelEn || field.labelAr;
    return (
      <label className="custom-survey-field" key={field.id}>
        <span>
          {label}
          {field.unit ? ` (${field.unit})` : ""}
          <em>{field.required ? t.required : t.optional}</em>
        </span>
        {field.type === "select" ? (
          <select
            value={customValues[field.key] || ""}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
          >
            <option value="">{t.chooseValue}</option>
            {field.options.map((option) => (
              <option key={option.code} value={option.code}>
                {language === "ar"
                  ? option.labelAr
                  : option.labelEn || option.labelAr}
              </option>
            ))}
          </select>
        ) : field.type === "boolean" ? (
          <select
            value={customValues[field.key] || ""}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
          >
            <option value="">{t.chooseValue}</option>
            <option value="true">{t.yes}</option>
            <option value="false">{t.no}</option>
          </select>
        ) : field.type === "textarea" ? (
          <textarea
            value={customValues[field.key] || ""}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
          />
        ) : (
          <input
            type={
              field.type === "number"
                ? "number"
                : field.type === "date"
                  ? "date"
                  : "text"
            }
            value={customValues[field.key] || ""}
            onChange={(event) =>
              setCustomValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              }))
            }
          />
        )}
        {(language === "ar" ? field.helpAr : field.helpEn) && (
          <small>{language === "ar" ? field.helpAr : field.helpEn}</small>
        )}
      </label>
    );
  }
  function startEntry(mode: "images" | "manual") {
    const dynamicLocationsValid = (selectedProject?.locationLevels || []).every(
      (level) =>
        !level.required ||
        Boolean(
          additionalLocations.find((item) => item.levelId === level.id)?.value,
        ),
    );
    const locationReady = Boolean(
      selectedProject &&
      (!selectedProject.requireBuilding || buildingValue) &&
      (!selectedProject.requireFloor || floorValue) &&
      (!selectedProject.requireZone || zoneValue) &&
      (!selectedProject.requireOffice || officeValue) &&
      dynamicLocationsValid &&
      locationFields.every(
        (field) => !field.required || Boolean(customValues[field.key]?.trim()),
      ),
    );
    if (!locationReady) {
      setError(t.contextRequired);
      return;
    }
    if (
      !categoryId ||
      !projectCategories.some((category) => category.id === categoryId)
    ) {
      setError(
        language === "ar"
          ? "اختر تصنيف الأصل قبل المتابعة."
          : "Choose the asset category before continuing.",
      );
      return;
    }
    if (
      !Number.isInteger(conditionRating) ||
      Number(conditionRating) < 1 ||
      Number(conditionRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر تقييم حالة الأصل من المستويات الخمسة قبل المتابعة."
          : "Choose one of the five asset-condition levels before continuing.",
      );
      return;
    }
    if (
      Number(conditionRating) <= 2 &&
      conditionJustification.trim().length < 3
    ) {
      setError(
        language === "ar"
          ? "اكتب سبب تقييم الأصل كحالة حرجة أو ضعيفة."
          : "Explain why the asset is Critical or Poor.",
      );
      return;
    }
    if (
      !Number.isInteger(criticalityRating) ||
      Number(criticalityRating) < 1 ||
      Number(criticalityRating) > 5
    ) {
      setError(
        language === "ar"
          ? "اختر درجة أهمية الأصل؛ وسيحدد النظام الوزن تلقائياً."
          : "Choose the asset criticality; its weight is assigned automatically.",
      );
      return;
    }
    if (
      hasRelatedAsset &&
      (!buildingId || buildingId === "__manual__" || !relatedAssetId)
    ) {
      setError(
        language === "ar"
          ? "اختر مبنى مسجلاً وأصلاً مرتبطًا من المبنى نفسه قبل المتابعة."
          : "Choose a registered building and a related asset in that building before continuing.",
      );
      return;
    }
    if (mode === "manual") manualSubmissionIdRef.current = crypto.randomUUID();
    setEntryMode(mode);
    setCaptureStep(2);
    setError("");
    setOfflineNotice("");
    setResult(null);
    setEditingRecordId(null);
  }
  return (
    <main
      className="capture-page al-page"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      <header className="al-page-head capture-page-head">
        <div>
          <span className="al-page-kicker">Mobile field capture</span>
          <h2>
            {language === "ar"
              ? "التقط لوحة الأصل وحوّلها إلى بيانات"
              : "Capture a nameplate and turn it into data"}
          </h2>
          <p>
            {language === "ar"
              ? "اختر الموقع، التقط صورة واضحة، ثم راجع البيانات المستخرجة قبل اعتمادها."
              : "Choose the location, capture a clear photo, then review the extracted data before approval."}
          </p>
        </div>
        <div className="al-page-actions">
          <button
            className="al-primary-button"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ {t.settings}
          </button>
        </div>
      </header>
      <section
        className={`mobile-status-bar ${isOnline ? "online" : "offline"}`}
        aria-live="polite"
      >
        <div>
          <i /> <strong>{isOnline ? t.online : t.offline}</strong>
          {offlineQueue.length > 0 && (
            <span>
              {offlineQueue.length} {t.offlineQueue}
            </span>
          )}
        </div>
        <div>
          {installPrompt && (
            <button onClick={() => void installApplication()}>
              ⇩ {t.installApp}
            </button>
          )}
          {offlineQueue.length > 0 && (
            <button
              disabled={!isOnline || syncingOffline}
              onClick={() => void syncOfflineQueue()}
            >
              {syncingOffline ? t.syncing : `↻ ${t.syncNow}`}
            </button>
          )}
        </div>
      </section>
      {offlineNotice && <div className="offline-notice">✓ {offlineNotice}</div>}
      {offlineQueue.length > 0 && (
        <details className="offline-queue-panel">
          <summary>
            <span>☁</span>
            <b>{t.offlineQueue}</b>
            <em>{offlineQueue.length}</em>
          </summary>
          <div>
            {offlineQueue.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{String(item.context.project || "Asset")}</strong>
                  <small>
                    {new Date(item.createdAt).toLocaleString(
                      language === "ar" ? "ar-AE" : "en-GB",
                    )}{" "}
                    · {item.images.length} images
                  </small>
                  {item.lastError && <em>{item.lastError}</em>}
                </div>
                <button
                  onClick={() =>
                    void removeOfflineSubmission(item.id).then(
                      refreshOfflineQueue,
                    )
                  }
                >
                  {t.removeOffline}
                </button>
              </article>
            ))}
          </div>
        </details>
      )}
      <nav
        className="capture-stepper"
        aria-label={
          language === "ar" ? "خطوات إضافة الأصل" : "Asset capture steps"
        }
      >
        {[
          language === "ar" ? "الموقع" : "Location",
          language === "ar" ? "الإضافة" : "Capture",
          language === "ar" ? "المراجعة" : "Review",
        ].map((label, index) => (
          <span
            key={label}
            className={captureStep >= index + 1 ? "active" : ""}
          >
            <b>{index + 1}</b>
            {label}
          </span>
        ))}
      </nav>
      {captureStep === 1 && (
        <section className="survey-context" aria-labelledby="context-title">
          <div className="context-heading">
            <span>00</span>
            <div>
              <h2 id="context-title">{t.contextTitle}</h2>
              <p>{t.contextLead}</p>
            </div>
            {masterConfig?.currentUser.role === "admin" && (
              <Link href="/admin">{t.adminPanel} ↗</Link>
            )}
          </div>
          {masterError ? (
            <div className="context-message error">{masterError}</div>
          ) : !masterConfig ? (
            <div className="context-message loading">
              <span className="loading-dots">
                <i />
                <i />
                <i />
              </span>
              {language === "ar"
                ? "جاري تحميل صلاحيات المشاريع…"
                : "Loading project permissions…"}
            </div>
          ) : masterConfig.projects.length === 0 ? (
            <div className="context-message">
              {language === "ar"
                ? "لا توجد مشاريع مخصصة لهذا المستخدم. يرجى مراجعة المدير."
                : "No projects are assigned to this user. Contact an administrator."}
            </div>
          ) : (
            <div className="context-grid">
              <label>
                <span>
                  {t.project}
                  <em>{t.required}</em>
                </span>
                <select
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setBuildingId("");
                    setFloorId("");
                    setZoneId("");
                    setOfficeId("");
                    setManualBuilding("");
                    setManualFloor("");
                    setManualZone("");
                    setManualOffice("");
                    setLocationSelections({});
                    setManualLocationValues({});
                    setCustomValues({});
                    setGps(null);
                    setBarcode("");
                    setCategoryId("");
                    setEstimatedPrice("");
                    setReplacementCost("");
                    setUsefulLifeYears("");
                    setInstallationDate("");
                    setConditionRating(null);
                    setConditionJustification("");
                    setCriticalityRating(null);
                    setBulkRatings([]);
                    setHasRelatedAsset(false);
                    setRelatedAssetId("");
                    setRelationshipOptions([]);
                    setRelationshipSearch("");
                  }}
                >
                  <option value="">{t.chooseValue}</option>
                  {masterConfig.projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedProject &&
                (selectedProject.requireBuilding ||
                  selectedProject.buildings.length > 0) && (
                  <label>
                    <span>
                      {t.building}
                      <em>
                        {selectedProject.requireBuilding
                          ? t.required
                          : t.optional}
                      </em>
                    </span>
                    <select
                      value={buildingId}
                      onChange={(event) => {
                        setBuildingId(event.target.value);
                        setFloorId("");
                        setZoneId("");
                        setOfficeId("");
                        setManualBuilding("");
                        setManualFloor("");
                        setManualZone("");
                        setManualOffice("");
                        setLocationSelections({});
                        setManualLocationValues({});
                        setHasRelatedAsset(false);
                        setRelatedAssetId("");
                        setRelationshipOptions([]);
                        setRelationshipSearch("");
                      }}
                    >
                      <option value="">{t.chooseValue}</option>
                      {selectedProject.buildings.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      {selectedProject.allowManual && (
                        <option value="__manual__">{t.manualEntry}</option>
                      )}
                    </select>
                    {buildingId === "__manual__" && (
                      <input
                        value={manualBuilding}
                        onChange={(event) =>
                          setManualBuilding(event.target.value)
                        }
                        placeholder={t.enterManually}
                      />
                    )}
                  </label>
                )}
              {selectedProject &&
                buildingValue &&
                (selectedProject.requireFloor ||
                  (selectedBuilding?.floors.length || 0) > 0) && (
                  <label>
                    <span>
                      {t.floor}
                      <em>
                        {selectedProject.requireFloor ? t.required : t.optional}
                      </em>
                    </span>
                    <select
                      value={floorId}
                      onChange={(event) => {
                        setFloorId(event.target.value);
                        setZoneId("");
                        setOfficeId("");
                        setManualFloor("");
                        setManualZone("");
                        setManualOffice("");
                        setLocationSelections({});
                        setManualLocationValues({});
                      }}
                    >
                      <option value="">{t.chooseValue}</option>
                      {selectedBuilding?.floors.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      {selectedProject.allowManual && (
                        <option value="__manual__">{t.manualEntry}</option>
                      )}
                    </select>
                    {floorId === "__manual__" && (
                      <input
                        value={manualFloor}
                        onChange={(event) => setManualFloor(event.target.value)}
                        placeholder={t.enterManually}
                      />
                    )}
                  </label>
                )}
              {selectedProject &&
                buildingValue &&
                (selectedProject.requireZone || availableZones.length > 0) && (
                  <label>
                    <span>
                      {t.zone}
                      <em>
                        {selectedProject.requireZone ? t.required : t.optional}
                      </em>
                    </span>
                    <select
                      value={zoneId}
                      onChange={(event) => {
                        setZoneId(event.target.value);
                        setOfficeId("");
                        setManualZone("");
                        setManualOffice("");
                        setLocationSelections({});
                        setManualLocationValues({});
                      }}
                    >
                      <option value="">{t.chooseValue}</option>
                      {availableZones.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      {selectedProject.allowManual && (
                        <option value="__manual__">{t.manualEntry}</option>
                      )}
                    </select>
                    {zoneId === "__manual__" && (
                      <input
                        value={manualZone}
                        onChange={(event) => setManualZone(event.target.value)}
                        placeholder={t.enterManually}
                      />
                    )}
                  </label>
                )}
              {selectedProject &&
                buildingValue &&
                (selectedProject.requireOffice ||
                  availableOffices.length > 0) && (
                  <label>
                    <span>
                      {t.office}
                      <em>
                        {selectedProject.requireOffice
                          ? t.required
                          : t.optional}
                      </em>
                    </span>
                    <select
                      value={officeId}
                      onChange={(event) => {
                        setOfficeId(event.target.value);
                        setManualOffice("");
                        setLocationSelections({});
                        setManualLocationValues({});
                      }}
                    >
                      <option value="">{t.chooseValue}</option>
                      {availableOffices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                      {selectedProject.allowManual && (
                        <option value="__manual__">{t.manualEntry}</option>
                      )}
                    </select>
                    {officeId === "__manual__" && (
                      <input
                        value={manualOffice}
                        onChange={(event) =>
                          setManualOffice(event.target.value)
                        }
                        placeholder={t.enterManually}
                      />
                    )}
                  </label>
                )}
              {selectedProject &&
                buildingValue &&
                (selectedProject.locationLevels || [])
                  .filter((level) => level.key !== "office")
                  .map((level) => {
                    const options = dynamicOptionsFor(level);
                    const selected = locationSelections[level.id] || "";
                    return (
                      <label key={level.id}>
                        <span>
                          {language === "ar"
                            ? level.labelAr
                            : level.labelEn || level.labelAr}
                          <em>{level.required ? t.required : t.optional}</em>
                        </span>
                        <select
                          value={selected}
                          onChange={(event) => {
                            const descendants = selectedProject.locationLevels
                              .filter(
                                (child) => child.sortOrder > level.sortOrder,
                              )
                              .map((child) => child.id);
                            setLocationSelections((current) => {
                              const next = {
                                ...current,
                                [level.id]: event.target.value,
                              };
                              for (const id of descendants) delete next[id];
                              return next;
                            });
                            setManualLocationValues((current) => {
                              const next = { ...current, [level.id]: "" };
                              for (const id of descendants) delete next[id];
                              return next;
                            });
                          }}
                        >
                          <option value="">{t.chooseValue}</option>
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                          {selectedProject.allowManual && (
                            <option value="__manual__">{t.manualEntry}</option>
                          )}
                        </select>
                        {selected === "__manual__" && (
                          <input
                            value={manualLocationValues[level.id] || ""}
                            onChange={(event) =>
                              setManualLocationValues((current) => ({
                                ...current,
                                [level.id]: event.target.value,
                              }))
                            }
                            placeholder={t.enterManually}
                          />
                        )}
                      </label>
                    );
                  })}
              {locationFields.map(renderCustomField)}
            </div>
          )}
          {selectedProject && (
            <div className="mobile-capture-tools">
              <section className={gps ? "capture-tool ready" : "capture-tool"}>
                <div>
                  <span>⌖</span>
                  <p>
                    <strong>{t.gps}</strong>
                    <small>
                      {gps
                        ? `${gps.latitude.toFixed(7)}, ${gps.longitude.toFixed(7)} · ±${Math.round(gps.accuracy)}m`
                        : gpsField?.required
                          ? t.required
                          : t.optional}
                    </small>
                  </p>
                </div>
                <button disabled={gpsBusy} onClick={() => void captureGps()}>
                  {gpsBusy ? (
                    <span className="mini-spinner" />
                  ) : gps ? (
                    `✓ ${t.gpsReady}`
                  ) : (
                    t.captureGps
                  )}
                </button>
              </section>
              <section
                className={barcode ? "capture-tool ready" : "capture-tool"}
              >
                <div>
                  <span>▦</span>
                  <label>
                    <strong>{t.barcode}</strong>
                    <input
                      className="ltr-input"
                      value={barcode}
                      onChange={(event) =>
                        setCapturedBarcode(event.target.value)
                      }
                      placeholder={t.barcodePlaceholder}
                    />
                  </label>
                </div>
                <button onClick={() => setScannerOpen(true)}>
                  ⌁ {t.scanBarcode}
                </button>
              </section>
            </div>
          )}
          {selectedProject && (
            <section className="asset-classification-card">
              <header>
                <div>
                  <span>01</span>
                  <h3>
                    {language === "ar"
                      ? "تصنيف الأصل وبيانات دورة حياته"
                      : "Asset category and lifecycle data"}
                  </h3>
                </div>
                <small>
                  {language === "ar"
                    ? "التصنيف إلزامي، وباقي البيانات اختيارية ويمكن تحديثها لاحقاً."
                    : "Category is required; the remaining values are optional and can be updated later."}
                </small>
              </header>
              <div
                className="asset-category-picker"
                role="radiogroup"
                aria-label={
                  language === "ar" ? "تصنيف الأصل" : "Asset category"
                }
              >
                {projectCategories.map((category) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={categoryId === category.id}
                    className={categoryId === category.id ? "selected" : ""}
                    key={category.id}
                    style={
                      { "--category-color": category.color } as CSSProperties
                    }
                    onClick={() => {
                      setCategoryId(category.id);
                      setPriceCurrency(category.currency || "AED");
                      setEstimatedPrice(
                        category.defaultEstimatedPrice == null
                          ? ""
                          : String(category.defaultEstimatedPrice),
                      );
                      setUsefulLifeYears(
                        category.defaultUsefulLifeYears == null
                          ? ""
                          : String(category.defaultUsefulLifeYears),
                      );
                      setError("");
                    }}
                  >
                    <b>{category.icon || "◇"}</b>
                    <span>
                      {language === "ar" ? category.labelAr : category.labelEn}
                    </span>
                  </button>
                ))}
              </div>
              {projectCategories.length === 0 && (
                <p className="context-message error">
                  {language === "ar"
                    ? "لا توجد تصنيفات أصول مفعلة لهذا المشروع. راجع مدير النظام."
                    : "No asset categories are enabled for this project. Contact an administrator."}
                </p>
              )}
              <div className="asset-lifecycle-grid">
                <label>
                  <span>
                    {language === "ar"
                      ? "حالة تشغيل الأصل"
                      : "Operational status"}
                    <em>{t.required}</em>
                  </span>
                  <select
                    value={operationalStatus}
                    onChange={(event) =>
                      setOperationalStatus(
                        event.target.value as AssetOperationalStatus,
                      )
                    }
                  >
                    {ASSET_OPERATIONAL_STATUSES.map((status) => (
                      <option key={status.code} value={status.code}>
                        {language === "ar" ? status.labelAr : status.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>
                    {language === "ar"
                      ? "سعر الأصل التقريبي"
                      : "Estimated asset price"}
                    <em>{t.optional}</em>
                  </span>
                  <div className="money-input">
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={estimatedPrice}
                      onChange={(event) =>
                        setEstimatedPrice(event.target.value)
                      }
                    />
                    <input
                      maxLength={3}
                      value={priceCurrency}
                      onChange={(event) =>
                        setPriceCurrency(
                          event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z]/g, "")
                            .slice(0, 3),
                        )
                      }
                      aria-label={language === "ar" ? "العملة" : "Currency"}
                    />
                  </div>
                </label>
                <label>
                  <span>
                    {language === "ar"
                      ? "تكلفة الاستبدال الحالية"
                      : "Current replacement cost"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.01"
                    value={replacementCost}
                    onChange={(event) => setReplacementCost(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {language === "ar"
                      ? "العمر الاستهلاكي (سنوات)"
                      : "Useful life (years)"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max="100"
                    value={usefulLifeYears}
                    onChange={(event) => setUsefulLifeYears(event.target.value)}
                  />
                </label>
                <label>
                  <span>
                    {language === "ar" ? "تاريخ التركيب" : "Installation date"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    type="date"
                    value={installationDate}
                    onChange={(event) =>
                      setInstallationDate(event.target.value)
                    }
                  />
                </label>
              </div>
            </section>
          )}
          {selectedProject && (
            <fieldset className="asset-condition-rating pre-capture-condition">
              <legend>
                {language === "ar"
                  ? "تقييم حالة الأصل قبل التصوير"
                  : "Asset condition before capture"}
                <em>{t.required}</em>
              </legend>
              <p>
                {language === "ar"
                  ? "اختر الحالة الحالية للأصل قبل إرفاق أي صورة للتحليل."
                  : "Choose the asset's current condition before attaching any image for analysis."}
              </p>
              <div
                role="radiogroup"
                aria-label={
                  language === "ar"
                    ? "تقييم حالة الأصل من خمسة مستويات"
                    : "Five-level asset condition rating"
                }
              >
                {ASSET_CONDITION_LEVELS.map((level) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={conditionRating === level.rating}
                    className={
                      conditionRating === level.rating
                        ? `selected rating-${level.rating}`
                        : `rating-${level.rating}`
                    }
                    key={level.rating}
                    onClick={() => {
                      setConditionRating(level.rating);
                      if (level.rating > 3) setConditionJustification("");
                      setError("");
                    }}
                  >
                    <b>{level.rating}</b>
                    <span>
                      {"★".repeat(level.rating)}
                      {"☆".repeat(5 - level.rating)}
                    </span>
                    <small>
                      {language === "ar" ? level.labelAr : level.labelEn}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {selectedProject &&
            conditionRating !== null &&
            conditionRating <= 3 && (
              <label className="condition-justification">
                <span>
                  {language === "ar"
                    ? "سبب تقييم الحالة"
                    : "Condition justification"}
                  <em>{conditionRating <= 2 ? t.required : t.optional}</em>
                </span>
                <textarea
                  maxLength={1000}
                  value={conditionJustification}
                  onChange={(event) => {
                    setConditionJustification(event.target.value);
                    setError("");
                  }}
                  placeholder={
                    language === "ar"
                      ? "مثال: Compressor defective ويحتاج فصلاً واستبدالاً."
                      : "Example: Compressor defective; disconnect and replace."
                  }
                />
                <small>
                  {language === "ar"
                    ? conditionRating <= 2
                      ? "إلزامي للحالة الحرجة أو الضعيفة، وسيظهر في التقارير."
                      : "اختياري للحالة المتوسطة، وسيظهر في التقارير عند إدخاله."
                    : conditionRating <= 2
                      ? "Required for Critical or Poor condition and included in reports."
                      : "Optional for Fair condition and included in reports when provided."}
                </small>
              </label>
            )}
          {selectedProject && (
            <fieldset className="asset-condition-rating asset-criticality-rating">
              <legend>
                {language === "ar"
                  ? "أهمية الأصل (Criticality)"
                  : "Asset criticality"}
                <em>{t.required}</em>
              </legend>
              <p>
                {language === "ar"
                  ? "اختر أهمية هذا الأصل حسب موقعه وتأثير تعطله؛ يُحسب الوزن تلقائياً ولا توجد خانة وزن منفصلة."
                  : "Choose this asset's importance by location and failure impact; weight is calculated automatically."}
              </p>
              <div
                role="radiogroup"
                aria-label={
                  language === "ar"
                    ? "أهمية الأصل من خمسة مستويات"
                    : "Five-level asset criticality"
                }
              >
                {ASSET_CRITICALITY_LEVELS.map((level) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={criticalityRating === level.rating}
                    className={
                      criticalityRating === level.rating
                        ? `selected criticality-${level.rating}`
                        : `criticality-${level.rating}`
                    }
                    key={level.rating}
                    onClick={() => {
                      setCriticalityRating(level.rating);
                      setError("");
                    }}
                  >
                    <b>{level.rating}</b>
                    <span>
                      {language === "ar"
                        ? `وزن ${level.weight}`
                        : `Weight ${level.weight}`}
                    </span>
                    <small>
                      {language === "ar" ? level.labelAr : level.labelEn}
                    </small>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {selectedProject && !bulkMode && (
            <fieldset className="asset-relationship-card">
              <legend>
                {language === "ar"
                  ? "هل هذا الأصل مرتبط بأصل آخر؟"
                  : "Is this asset linked to another asset?"}
                <em>{t.optional}</em>
              </legend>
              <p>
                {language === "ar"
                  ? "استخدم الربط الأب/الابن للأصول التابعة لبعضها، مثل وحدة تكييف داخلية مرتبطة بالوحدة الخارجية أو أصل تغذيه لوحة كهرباء."
                  : "Use a parent/child link for connected assets, such as an indoor AC unit linked to its outdoor unit or an asset fed by an electrical panel."}
              </p>
              <div
                className="relationship-choice"
                role="radiogroup"
                aria-label={
                  language === "ar"
                    ? "وجود أصل مرتبط"
                    : "Related asset availability"
                }
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!hasRelatedAsset}
                  className={!hasRelatedAsset ? "selected" : ""}
                  onClick={() => {
                    setHasRelatedAsset(false);
                    setRelatedAssetId("");
                    setRelationshipOptions([]);
                    setRelationshipError("");
                    setRelationshipSearch("");
                    setError("");
                  }}
                >
                  {language === "ar" ? "لا" : "No"}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={hasRelatedAsset}
                  className={hasRelatedAsset ? "selected" : ""}
                  onClick={() => {
                    setHasRelatedAsset(true);
                    setError("");
                  }}
                >
                  {language === "ar" ? "نعم" : "Yes"}
                </button>
              </div>
              {hasRelatedAsset && (
                <div className="relationship-editor">
                  {!buildingId || buildingId === "__manual__" ? (
                    <div className="context-message warning" role="status">
                      {language === "ar"
                        ? "يلزم اختيار مبنى مسجل من القائمة لإظهار أصوله ومنع الربط بين مبنيين مختلفين."
                        : "Choose a registered building to list its assets and prevent cross-building links."}
                    </div>
                  ) : (
                    <>
                      <div
                        className="relationship-role-choice"
                        role="radiogroup"
                        aria-label={
                          language === "ar"
                            ? "دور الأصل الجديد"
                            : "New asset role"
                        }
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={currentAssetRole === "parent"}
                          className={
                            currentAssetRole === "parent" ? "selected" : ""
                          }
                          onClick={() => setCurrentAssetRole("parent")}
                        >
                          <b>
                            {language === "ar" ? "أب / رئيسي" : "Parent / main"}
                          </b>
                          <small>
                            {language === "ar"
                              ? "الأصل الجديد يغذّي أو يحتوي الأصل المختار"
                              : "The new asset contains or supports the selected asset"}
                          </small>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={currentAssetRole === "child"}
                          className={
                            currentAssetRole === "child" ? "selected" : ""
                          }
                          onClick={() => setCurrentAssetRole("child")}
                        >
                          <b>
                            {language === "ar"
                              ? "ابن / تابع"
                              : "Child / dependent"}
                          </b>
                          <small>
                            {language === "ar"
                              ? "الأصل الجديد تابع للأصل المختار"
                              : "The new asset depends on the selected asset"}
                          </small>
                        </button>
                      </div>
                      <label>
                        <span>
                          {language === "ar"
                            ? "ابحث في أصول المبنى"
                            : "Search this building's assets"}
                        </span>
                        <input
                          value={relationshipSearch}
                          onChange={(event) =>
                            setRelationshipSearch(event.target.value)
                          }
                          placeholder={
                            language === "ar"
                              ? "رقم الأصل أو النوع أو الموقع"
                              : "Asset number, type or location"
                          }
                        />
                      </label>
                      <label>
                        <span>
                          {language === "ar"
                            ? "الأصل المرتبط"
                            : "Related asset"}
                          <em>{t.required}</em>
                        </span>
                        <select
                          value={relatedAssetId}
                          disabled={relationshipLoading}
                          onChange={(event) => {
                            setRelatedAssetId(event.target.value);
                            setError("");
                          }}
                        >
                          <option value="">
                            {relationshipLoading
                              ? language === "ar"
                                ? "جاري تحميل أصول المبنى…"
                                : "Loading building assets…"
                              : language === "ar"
                                ? "اختر الأصل"
                                : "Choose asset"}
                          </option>
                          {filteredRelationshipOptions.map((asset) => (
                            <option key={asset.id} value={asset.id}>
                              {asset.assetNo} — {asset.assetType || "Asset"} —{" "}
                              {[asset.floor, asset.zone, asset.office]
                                .filter(Boolean)
                                .join(" / ") || asset.building}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!relationshipLoading &&
                        relationshipOptions.length === 0 &&
                        !relationshipError && (
                          <div className="context-message" role="status">
                            {language === "ar"
                              ? "لا توجد أصول أخرى مسجلة في هذا المبنى حتى الآن."
                              : "No other assets are registered in this building yet."}
                          </div>
                        )}
                      {relationshipError && (
                        <div className="context-message error" role="alert">
                          {relationshipError}
                        </div>
                      )}
                      <small className="relationship-assurance">
                        {language === "ar"
                          ? "سيُحفظ الربط مبدئيًا: نوع العلاقة غير متحقق وتأثيرها غير مقيّم، حتى تتم المراجعة الهندسية."
                          : "The link is saved as preliminary: relationship type unverified and impact unassessed until engineering review."}
                      </small>
                    </>
                  )}
                </div>
              )}
            </fieldset>
          )}
          {selectedProject && (
            <label className={bulkMode ? "bulk-toggle active" : "bulk-toggle"}>
              <input
                type="checkbox"
                checked={bulkMode}
                onChange={(event) => {
                  setBulkMode(event.target.checked);
                  if (event.target.checked) {
                    setHasRelatedAsset(false);
                    setRelatedAssetId("");
                    setRelationshipSearch("");
                  }
                  setError("");
                }}
              />
              <span>▦</span>
              <div>
                <strong>{t.bulkMode}</strong>
                <small>{bulkMode ? t.bulkFormats : t.bulkModeLead}</small>
              </div>
            </label>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {selectedProject && (
            <div className="capture-mode-actions">
              <button
                className="al-primary-button"
                onClick={() => startEntry("images")}
              >
                ⌾{" "}
                {language === "ar"
                  ? "متابعة للتصوير أو رفع الصور"
                  : "Continue to photo or upload"}
              </button>
              <button
                className="al-secondary-button"
                onClick={() => startEntry("manual")}
              >
                ＋{" "}
                {language === "ar" ? "إضافة أصل يدويًا" : "Add asset manually"}
              </button>
            </div>
          )}
        </section>
      )}
      {records.length > 0 && (
        <section className="batch-bar">
          <div>
            <strong>{records.length}</strong>
            <span>
              {records.length === 1 ? t.batchReady : t.batchReadyMany}
            </span>
          </div>
          <button onClick={exportExcel}>{t.downloadRegister}</button>
        </section>
      )}
      {bulkSession && (
        <section className="bulk-session-bar">
          <div>
            <strong>{t.bulkSession}</strong>
            <span>
              {bulkSessionCompleted}/{bulkSession.total}{" "}
              {language === "ar" ? "أصول مكتملة" : "completed assets"} ·{" "}
              {bulkSession.context.project} /{" "}
              {bulkSession.context.zone || bulkSession.context.building || "—"}
            </span>
          </div>
          <button
            disabled={bulkSessionAssetIds.size === 0}
            onClick={downloadBulkSessionCsv}
          >
            {t.bulkReport}
          </button>
        </section>
      )}
      {captureStep > 1 && (
        <section className="workspace capture-workspace">
          <div className="capture-workspace-nav">
            <button
              className="al-secondary-button"
              onClick={() => {
                setCaptureStep(1);
                setError("");
              }}
            >
              ↩ {language === "ar" ? "تعديل الموقع" : "Edit location"}
            </button>
          </div>
          {captureStep === 2 && entryMode === "images" && (
            <article className="panel upload-panel">
              <div className="panel-heading">
                <span>01</span>
                <div>
                  <h2>{t.uploadTitle}</h2>
                  <p>{bulkMode ? t.bulkFormats : t.formats}</p>
                </div>
              </div>
              <input
                ref={inputRef}
                hidden
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  acceptFiles(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
              <input
                ref={cameraInputRef}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  acceptFiles(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
              {previews.length === 0 ? (
                <div
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                >
                  <div className="upload-icon">
                    <UploadIcon />
                  </div>
                  <h3>{t.uploadHint}</h3>
                  <p>{bulkMode ? t.bulkFormats : t.formats}</p>
                  <div className="image-source-actions">
                    <button
                      type="button"
                      className="camera-source"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      ⌾ {t.camera}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => inputRef.current?.click()}
                    >
                      ▧ {t.choose}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="image-ready">
                  <div className="image-gallery">
                    {previews.map((preview, index) => (
                      <figure key={preview}>
                        <img
                          src={preview}
                          alt={`Selected asset view ${index + 1}`}
                        />
                        <span>{index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          aria-label={t.removePhoto}
                        >
                          ×
                        </button>
                      </figure>
                    ))}
                    {files.length <
                      (bulkMode ? BULK_ZONE_LIMIT : SINGLE_ASSET_LIMIT) && (
                      <>
                        <button
                          type="button"
                          className="add-photo"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <b>⌾</b>
                          <span>{t.camera}</span>
                        </button>
                        <button
                          type="button"
                          className="add-photo"
                          onClick={() => inputRef.current?.click()}
                        >
                          <b>＋</b>
                          <span>{t.choose}</span>
                        </button>
                      </>
                    )}
                  </div>
                  <div className="file-meta">
                    <span className="check">✓</span>
                    <div>
                      <strong>
                        {files.length} • {t.ready}
                      </strong>
                      <small>
                        {files.map((item) => item.name).join(" • ")} •{" "}
                        {(
                          files.reduce((total, item) => total + item.size, 0) /
                          1024 /
                          1024
                        ).toFixed(2)}{" "}
                        MB
                      </small>
                    </div>
                    <button onClick={clear}>{t.remove}</button>
                  </div>
                  {bulkMode && (
                    <section className="bulk-rating-list">
                      <header>
                        <strong>
                          {language === "ar"
                            ? "تقييم كل أصل في جلسة Bulk"
                            : "Rate every Bulk asset"}
                        </strong>
                        <small>
                          {language === "ar"
                            ? "التقييم الموجود بالأعلى هو القيمة الابتدائية، ويمكن تعديل كل صورة منفردة."
                            : "The rating above is the initial value; each image can be changed independently."}
                        </small>
                      </header>
                      {files.map((file, index) => {
                        const rating = bulkRatings[index] || {
                          conditionRating: null,
                          conditionJustification: "",
                          criticalityRating: null,
                        };
                        return (
                          <article
                            key={`${file.name}-${file.lastModified}-${index}`}
                          >
                            <div className="bulk-rating-file">
                              <b>{index + 1}</b>
                              <span title={file.name}>{file.name}</span>
                            </div>
                            <label>
                              <span>
                                {language === "ar" ? "الحالة" : "Condition"}
                              </span>
                              <select
                                value={rating.conditionRating || ""}
                                onChange={(event) =>
                                  setBulkRatings((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            conditionRating:
                                              Number(event.target.value) ||
                                              null,
                                            conditionJustification:
                                              Number(event.target.value) > 3
                                                ? ""
                                                : item.conditionJustification,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                <option value="">—</option>
                                {ASSET_CONDITION_LEVELS.map((level) => (
                                  <option
                                    value={level.rating}
                                    key={level.rating}
                                  >
                                    {level.rating} —{" "}
                                    {language === "ar"
                                      ? level.labelAr
                                      : level.labelEn}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>
                                {language === "ar" ? "الأهمية" : "Criticality"}
                              </span>
                              <select
                                value={rating.criticalityRating || ""}
                                onChange={(event) =>
                                  setBulkRatings((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? {
                                            ...item,
                                            criticalityRating:
                                              Number(event.target.value) ||
                                              null,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                <option value="">—</option>
                                {ASSET_CRITICALITY_LEVELS.map((level) => (
                                  <option
                                    value={level.rating}
                                    key={level.rating}
                                  >
                                    {level.rating} —{" "}
                                    {language === "ar"
                                      ? level.labelAr
                                      : level.labelEn}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {rating.conditionRating !== null &&
                              rating.conditionRating <= 3 && (
                                <label className="bulk-rating-reason">
                                  <span>
                                    {language === "ar"
                                      ? "سبب الحالة"
                                      : "Condition reason"}
                                    {rating.conditionRating <= 2 && (
                                      <em>{t.required}</em>
                                    )}
                                  </span>
                                  <input
                                    maxLength={1000}
                                    value={rating.conditionJustification}
                                    onChange={(event) =>
                                      setBulkRatings((current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                conditionJustification:
                                                  event.target.value,
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                    placeholder={
                                      language === "ar"
                                        ? "سبب مختصر وواضح"
                                        : "Short clear reason"
                                    }
                                  />
                                </label>
                              )}
                          </article>
                        );
                      })}
                    </section>
                  )}
                </div>
              )}
              <div className="tip">
                <span>◎</span>
                <p>{t.photoTip}</p>
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="analyze"
                disabled={
                  files.length === 0 ||
                  uploading ||
                  (bulkMode && !bulkRatingsComplete)
                }
                onClick={queueAnalysis}
              >
                {uploading ? <span className="mini-spinner" /> : <ScanIcon />}
                {uploading
                  ? t.analyzing
                  : shouldQueueAsBulk
                    ? t.bulkAnalyze
                    : t.analyze}
              </button>
            </article>
          )}
          {captureStep === 2 && entryMode === "manual" && (
            <article className="panel manual-asset-panel">
              <div className="panel-heading">
                <span>02</span>
                <div>
                  <h2>
                    {language === "ar"
                      ? "إضافة بيانات الأصل يدويًا"
                      : "Add asset details manually"}
                  </h2>
                  <p>
                    {language === "ar"
                      ? "أدخل نوع الأصل ثم أكمل الحقول التي حددها مدير النظام."
                      : "Enter the asset type, then complete the administrator-defined fields."}
                  </p>
                </div>
              </div>
              <div className="manual-rating-summary">
                <div>
                  <span>{language === "ar" ? "حالة الأصل" : "Condition"}</span>
                  <b>
                    {conditionRating}/5 —{" "}
                    {assetConditionLabel(conditionRating, language)}
                  </b>
                </div>
                <div>
                  <span>
                    {language === "ar" ? "أهمية الأصل" : "Criticality"}
                  </span>
                  <b>
                    {assetCriticalityLabel(criticalityRating, language)} —{" "}
                    {language === "ar" ? "الوزن" : "Weight"}{" "}
                    {assetCriticalityWeight(criticalityRating)}
                  </b>
                </div>
                {conditionJustification && (
                  <p>
                    <span>
                      {language === "ar" ? "سبب الحالة" : "Condition reason"}
                    </span>
                    {conditionJustification}
                  </p>
                )}
              </div>
              <div className="manual-asset-grid">
                <label>
                  <span>
                    {language === "ar" ? "نوع الأصل" : "Asset type"}
                    <em>{t.required}</em>
                  </span>
                  <input
                    value={manualAsset.assetType}
                    onChange={(event) =>
                      setManualAsset((current) => ({
                        ...current,
                        assetType: event.target.value,
                      }))
                    }
                    placeholder="Air Conditioner"
                  />
                </label>
                <label>
                  <span>
                    {language === "ar" ? "الشركة المصنعة" : "Manufacturer"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    value={manualAsset.manufacturer}
                    onChange={(event) =>
                      setManualAsset((current) => ({
                        ...current,
                        manufacturer: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>
                    {language === "ar" ? "الموديل" : "Model"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    value={manualAsset.model}
                    onChange={(event) =>
                      setManualAsset((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>
                    {language === "ar" ? "السيريال" : "Serial number"}
                    <em>{t.optional}</em>
                  </span>
                  <input
                    value={manualAsset.serial}
                    onChange={(event) =>
                      setManualAsset((current) => ({
                        ...current,
                        serial: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="manual-summary">
                  <span>
                    {language === "ar" ? "وصف مختصر" : "Summary"}
                    <em>{t.optional}</em>
                  </span>
                  <textarea
                    value={manualAsset.summary}
                    onChange={(event) =>
                      setManualAsset((current) => ({
                        ...current,
                        summary: event.target.value,
                      }))
                    }
                  />
                </label>
                {assetFields.map(renderCustomField)}
              </div>
              {manualAsset.assetType.trim() && assetFields.length === 0 && (
                <p className="manual-field-note">
                  {language === "ar"
                    ? "لا توجد حقول إضافية مخصصة لهذا النوع. يمكنك إضافتها من إدارة النظام."
                    : "No additional fields are configured for this asset type."}
                </p>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="analyze"
                disabled={!manualAsset.assetType.trim() || uploading}
                onClick={() => void createManualAsset()}
              >
                {uploading ? <span className="mini-spinner" /> : "✓"}
                {language === "ar" ? "إنشاء الأصل" : "Create asset"}
              </button>
            </article>
          )}
          {captureStep === 3 && (
            <article className="panel result-panel">
              <div className="panel-heading">
                <span>02</span>
                <div>
                  <h2>{t.resultTitle}</h2>
                  <p>{result ? t.editHint : t.emptyText}</p>
                </div>
                {demo && <b className="demo-badge">{t.demo}</b>}
              </div>
              {!result ? (
                <div className="empty">
                  <div className="empty-scan">
                    <span />
                    <ScanIcon />
                    <span />
                  </div>
                  <h3>{t.emptyTitle}</h3>
                  <p>{t.emptyText}</p>
                  <button
                    onClick={() => {
                      setResult(sampleResult);
                      setDemo(true);
                      setError("");
                    }}
                    className="sample"
                  >
                    {t.sample}
                  </button>
                </div>
              ) : (
                <div className="results">
                  <div className="result-summary">
                    <div>
                      <small>Asset Type</small>
                      <input
                        className="result-asset-type"
                        value={result.assetType}
                        onChange={(event) =>
                          setResult((current) =>
                            current
                              ? { ...current, assetType: event.target.value }
                              : current,
                          )
                        }
                        placeholder="Asset type"
                      />
                      <p>{result.summary}</p>
                    </div>
                    <div
                      className="score"
                      style={
                        {
                          "--score": `${Math.round(result.overallConfidence * 100) * 3.6}deg`,
                        } as CSSProperties
                      }
                    >
                      <span>{Math.round(result.overallConfidence * 100)}%</span>
                      <small>{t.confidence}</small>
                    </div>
                  </div>
                  <div className="review-condition-summary">
                    <strong>
                      {language === "ar" ? "حالة الأصل" : "Asset condition"}
                    </strong>
                    <span>
                      {result.conditionRating || "—"}/5 —{" "}
                      {assetConditionLabel(result.conditionRating, language) ||
                        (language === "ar" ? "غير محددة" : "Not selected")}
                    </span>
                  </div>
                  {result.conditionRating !== null &&
                    result.conditionRating !== undefined &&
                    result.conditionRating <= 3 && (
                      <label className="condition-justification review-justification">
                        <span>
                          {language === "ar"
                            ? "سبب تقييم الحالة"
                            : "Condition justification"}
                          <em>
                            {result.conditionRating <= 2
                              ? t.required
                              : t.optional}
                          </em>
                        </span>
                        <textarea
                          maxLength={1000}
                          value={result.conditionJustification || ""}
                          onChange={(event) =>
                            setResult((current) =>
                              current
                                ? {
                                    ...current,
                                    conditionJustification: event.target.value,
                                  }
                                : current,
                            )
                          }
                          placeholder={
                            language === "ar"
                              ? "اكتب سبب الحالة والإجراء المقترح."
                              : "Explain the condition and suggested action."
                          }
                        />
                      </label>
                    )}
                  <div className="review-condition-summary criticality">
                    <strong>
                      {language === "ar" ? "أهمية الأصل" : "Asset criticality"}
                    </strong>
                    <span>
                      {assetCriticalityLabel(
                        result.criticalityRating,
                        language,
                      ) ||
                        (language === "ar" ? "غير محددة" : "Not selected")}{" "}
                      —{" "}
                      {language === "ar"
                        ? "الوزن التلقائي"
                        : "Automatic weight"}{" "}
                      {assetCriticalityWeight(result.criticalityRating) || "—"}
                    </span>
                  </div>
                  <div className="field-list">
                    {result.fields.map((field, index) => (
                      <label className="field" key={`${field.key}-${index}`}>
                        <span>
                          {field.label}
                          <em
                            className={
                              field.confidence >= 0.85
                                ? "high"
                                : field.confidence >= 0.65
                                  ? "medium"
                                  : "low"
                            }
                          >
                            {Math.round(field.confidence * 100)}%
                          </em>
                        </span>
                        <input
                          value={field.value}
                          onChange={(e) => updateField(index, e.target.value)}
                          placeholder="—"
                        />
                      </label>
                    ))}
                  </div>
                  {reviewCustomFields.length > 0 && (
                    <section className="asset-custom-review">
                      <h3>
                        {language === "ar"
                          ? "البيانات الإضافية التي حددها الأدمن"
                          : "Administrator-defined asset details"}
                      </h3>
                      <div className="context-grid">
                        {reviewCustomFields.map(renderCustomField)}
                      </div>
                    </section>
                  )}
                  {result.warnings.length > 0 && (
                    <div className="warnings">
                      <strong>⚠ {t.warnings}</strong>
                      {result.warnings.map((warning, index) => (
                        <p key={index}>{warning}</p>
                      ))}
                    </div>
                  )}
                  {result.rawText && (
                    <details>
                      <summary>{t.raw}</summary>
                      <pre>{result.rawText}</pre>
                    </details>
                  )}
                  {editingRecordId && !demo && (
                    <div className="review-actions">
                      <button
                        className="add-record"
                        onClick={() => void addToRegister("save")}
                      >
                        ✓ {t.saveChanges}
                      </button>
                      {editingRecord?.status === "review" &&
                        canApproveAssets && (
                          <button
                            className="approve-record"
                            onClick={() => void addToRegister("approve")}
                          >
                            ✓✓ {t.approveRecord}
                          </button>
                        )}
                    </div>
                  )}
                  <div className="result-actions">
                    <button className="export" onClick={exportExcel}>
                      {t.export}
                    </button>
                    <button className="copy" onClick={copyResult}>
                      {copied ? t.copied : t.copyData}
                    </button>
                  </div>
                  <button className="reset" onClick={clear}>
                    {t.reset}
                  </button>
                </div>
              )}
            </article>
          )}
        </section>
      )}
      {visibleJobs.length > 0 && (
        <section
          className="queue-section queue-section-at-end"
          aria-live="polite"
        >
          <div className="queue-heading">
            <div>
              <span className="queue-pulse" />
              <div>
                <h2>{t.queueTitle}</h2>
                <p>{t.queueLead}</p>
              </div>
            </div>
            <small>{t.keepOpen}</small>
          </div>
          <div className="queue-list">
            {visibleJobs.map((job) => {
              const reviewRecord = records.find(
                (record) =>
                  record.id === job.assetId && record.status === "review",
              );
              return (
                <article className={`queue-job ${job.status}`} key={job.id}>
                  <div className="queue-number">
                    #{String(job.order).padStart(3, "0")}
                  </div>
                  <div className="queue-info">
                    <strong>
                      {job.result?.assetType ||
                        `${job.imageCount || 1} ${language === "ar" ? "صور" : "images"}`}
                    </strong>
                    <small className="queue-location">
                      {[
                        job.surveyContext.project,
                        job.surveyContext.building,
                        job.surveyContext.floor,
                        job.surveyContext.zone,
                        job.surveyContext.office,
                        ...(job.surveyContext.additionalLocations || []).map(
                          (item) => item.value,
                        ),
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </small>
                    <small title={job.fileName}>{job.fileName}</small>
                    {job.error && <em>{job.error}</em>}
                  </div>
                  <div className={`queue-status ${job.status}`}>
                    {job.status === "processing" && (
                      <span className="mini-spinner" />
                    )}
                    {job.status === "queued"
                      ? t.queued
                      : job.status === "processing"
                        ? t.processing
                        : job.status === "completed"
                          ? language === "ar"
                            ? "بانتظار الاعتماد"
                            : "Awaiting approval"
                          : t.failedStatus}
                  </div>
                  <div className="queue-actions">
                    {reviewRecord && (
                      <button
                        className="queue-review"
                        onClick={() => openRecordForReview(reviewRecord)}
                      >
                        {canApproveAssets
                          ? language === "ar"
                            ? "مراجعة واعتماد"
                            : "Review & approve"
                          : language === "ar"
                            ? "عرض ومراجعة"
                            : "Open review"}
                      </button>
                    )}
                    {job.status === "failed" && (
                      <button onClick={() => retryJob(job.id)}>
                        {t.retry}
                      </button>
                    )}
                    {job.status !== "processing" &&
                      job.status !== "completed" && (
                        <button
                          className="queue-remove"
                          onClick={() => removeJob(job.id)}
                          aria-label={t.cancel}
                        >
                          ×
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {scannerOpen && (
        <div className="scanner-overlay">
          <section role="dialog" aria-modal="true" aria-label={t.scanBarcode}>
            <div className="scanner-head">
              <div>
                <strong>{t.scanBarcode}</strong>
                <small>{t.barcode}</small>
              </div>
              <button
                onClick={() => setScannerOpen(false)}
                aria-label={t.closeScanner}
              >
                ×
              </button>
            </div>
            <div className="scanner-view">
              <video ref={scannerVideoRef} playsInline muted />
              <span />
              <p>{t.barcodePlaceholder}</p>
            </div>
            <button
              className="scanner-close"
              onClick={() => setScannerOpen(false)}
            >
              {t.closeScanner}
            </button>
          </section>
        </div>
      )}
      {scannedAsset && (
        <div
          className="asset-qr-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setScannedAsset(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-qr-title"
          >
            <header>
              <div>
                <small>ASSET OFFLINE QR</small>
                <h2 id="asset-qr-title">{scannedAsset.assetNo}</h2>
                <p>
                  {language === "ar"
                    ? "البيانات الرئيسية مقروءة مباشرة دون إنترنت، وأحدث نسخة جُلبت من النظام عند توفر الاتصال."
                    : "Core data is readable offline; the latest version is fetched from the system whenever online."}
                </p>
              </div>
              <button onClick={() => setScannedAsset(null)}>×</button>
            </header>
            <dl>
              {scannedAsset.fields.map((field, index) => (
                <div key={`${field.label}-${index}`}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            <footer>
              <code>{scannedAsset.assetId}</code>
              <button onClick={() => setScannedAsset(null)}>
                {language === "ar" ? "إغلاق" : "Close"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div
          className="settings-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="settings-head">
              <div className="settings-icon">⚙</div>
              <div>
                <h2 id="settings-title">{t.settingsTitle}</h2>
                <p>{t.settingsLead}</p>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label={t.close}
              >
                ×
              </button>
            </div>
            <div className={`connection-state ${keySaved ? "is-ready" : ""}`}>
              <span>{keySaved ? "✓" : "!"}</span>
              <div>
                <strong>{keySaved ? t.keyReady : t.keyMissing}</strong>
                <small>Gemini Flash · automatic fallback</small>
              </div>
            </div>
            <label className="key-field">
              <span>{t.apiKey}</span>
              <input
                type="password"
                value={geminiKey}
                onChange={(event) => {
                  setGeminiKey(event.target.value);
                  setKeySaved(false);
                }}
                placeholder={t.apiPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="privacy-note">🔒 {t.keyPrivacy}</p>
            <a
              className="get-key"
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
            >
              {t.getKey} ↗
            </a>
            <button
              className="save-key"
              disabled={!geminiKey.trim()}
              onClick={saveGeminiKey}
            >
              {t.saveKey}
            </button>
            {keySaved && (
              <button className="clear-key" onClick={clearGeminiKey}>
                {t.clearKey}
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
