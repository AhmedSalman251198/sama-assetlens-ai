export const ASSET_OPERATIONAL_STATUSES = [
  { code: "unknown", labelAr: "غير محددة · تحتاج مراجعة", labelEn: "Unknown · needs review", tone: "slate" },
  { code: "active", labelAr: "يعمل", labelEn: "Active", tone: "green" },
  { code: "maintenance", labelAr: "تحت الصيانة", labelEn: "Under Maintenance", tone: "amber" },
  { code: "out_of_service", labelAr: "خارج الخدمة", labelEn: "Out of Service", tone: "red" },
  { code: "transferred", labelAr: "منقول", labelEn: "Transferred", tone: "blue" },
  { code: "disposed", labelAr: "مستبعد", labelEn: "Disposed", tone: "slate" },
] as const;

export type AssetOperationalStatus = (typeof ASSET_OPERATIONAL_STATUSES)[number]["code"];

export function isAssetOperationalStatus(value: unknown): value is AssetOperationalStatus {
  return typeof value === "string" && ASSET_OPERATIONAL_STATUSES.some(status => status.code === value);
}

export function assetOperationalStatusLabel(value: unknown, language: "ar" | "en" = "ar") {
  const match = ASSET_OPERATIONAL_STATUSES.find(status => status.code === value);
  return match ? (language === "ar" ? match.labelAr : match.labelEn) : "";
}
