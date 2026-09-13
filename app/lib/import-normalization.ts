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

export function importedCurrency(value: unknown) {
  if (typeof value !== "string") return null;
  const clean = value.trim().toUpperCase();
  const aliases: Record<string, string> = { "د.إ": "AED", "درهم": "AED", "RIYAL": "SAR", "ريال": "SAR", "$": "USD", "€": "EUR", "£": "GBP" };
  if (aliases[clean]) return aliases[clean];
  const code = clean.match(/\b[A-Z]{3}\b/)?.[0];
  return code || null;
}

export function importedMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const clean = String(value).replace(/[,\s]/g, "").replace(/[^0-9.+-]/g, "");
  if (!/\d/.test(clean)) return null;
  const numeric = Number(clean);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1_000_000_000 ? numeric : null;
}

export function importedYears(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const numeric = Number(raw.match(/[-+]?\d*\.?\d+/)?.[0]);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 5000) return null;
  const years = /month|months|شهر|أشهر/i.test(raw) ? numeric / 12 : numeric;
  return Math.round(years * 100) / 100;
}

export function importedIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : raw;
}

export function incompleteImportFields(row: { building?: unknown; floor?: unknown; zone?: unknown; office?: unknown; categoryId?: unknown; conditionRating?: unknown; criticalityRating?: unknown }, required: { building: boolean; floor: boolean; zone: boolean; office: boolean }) {
  const missing = ["building", "floor", "zone", "office"].filter(key => required[key as keyof typeof required] && !(typeof row[key as keyof typeof required] === "string" && (row[key as keyof typeof required] as string).trim()));
  if (!row.categoryId) missing.push("category");
  if (importedRating(row.conditionRating) === null) missing.push("condition");
  if (importedRating(row.criticalityRating) === null) missing.push("criticality");
  return missing;
}
