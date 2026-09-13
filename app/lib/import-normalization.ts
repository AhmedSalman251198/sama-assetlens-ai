export const LEGACY_OPERATIONAL_STATUS = ["unknown", "active", "maintenance", "out_of_service", "transferred", "disposed"] as const;

export function importedOperationalStatus(value: unknown) {
  if (typeof value !== "string") return "unknown";
  const clean = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["active", "operational", "working", "running", "يعمل", "فعال", "شغال", "نشط"].includes(clean)) return "active";
  if (["maintenance", "under_maintenance", "repair", "صيانة", "تحت_الصيانة"].includes(clean)) return "maintenance";
  if (["out_of_service", "out_of_order", "failed", "broken", "معطل", "خارج_الخدمة"].includes(clean)) return "out_of_service";
  if (["transferred", "moved", "منقول"].includes(clean)) return "transferred";
  if (["disposed", "retired", "scrapped", "مستبعد"].includes(clean)) return "disposed";
  return "unknown";
}

export function importedRating(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5 ? numeric : null;
}

export function incompleteImportFields(row: { building?: unknown; floor?: unknown; zone?: unknown; office?: unknown; categoryId?: unknown; conditionRating?: unknown; criticalityRating?: unknown }, required: { building: boolean; floor: boolean; zone: boolean; office: boolean }) {
  const missing = ["building", "floor", "zone", "office"].filter(key => required[key as keyof typeof required] && !(typeof row[key as keyof typeof required] === "string" && (row[key as keyof typeof required] as string).trim()));
  if (!row.categoryId) missing.push("category");
  if (importedRating(row.conditionRating) === null) missing.push("condition");
  if (importedRating(row.criticalityRating) === null) missing.push("criticality");
  return missing;
}
