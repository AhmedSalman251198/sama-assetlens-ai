export type AssetQrField = { label: string; value: string };

export type AssetQrPayload = {
  kind: "assetlens-asset";
  version: 1 | 2;
  assetId: string;
  assetNo: string;
  snapshotAt: string;
  fields: AssetQrField[];
};

type QrSourceField = { key?: string; label?: string; value?: unknown };
type QrCustomValue = { key?: string; labelAr?: string; labelEn?: string; value?: unknown };
type QrLocationValue = { key?: string; labelAr?: string; labelEn?: string; value?: unknown };

export type AssetQrSource = {
  id: string;
  assetNo: string;
  projectId?: string;
  project?: string;
  building?: string;
  floor?: string;
  zone?: string;
  office?: string;
  assetType?: string;
  summary?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  barcode?: string;
  status?: string;
  conditionRating?: number | null;
  criticalityRating?: number | null;
  confidence?: number;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracy?: number | null;
  capturedOffline?: boolean;
  deviceCapturedAt?: string;
  createdAt?: string;
  fields?: QrSourceField[];
  customValues?: QrCustomValue[];
  additionalLocations?: QrLocationValue[];
};

const CURRENT_PREFIX = "alqr2";
const LEGACY_PREFIX = "alqr1";
const DIRECT_TEXT_PREFIX = "ASSETLENS-OFFLINE-V2";
const CRITICALITY_LABELS = ["", "Very Low", "Low", "Important", "High", "Critical"];
type CompactPayloadV2 = ["a", 2, string, string, string, Array<[string, string]>];

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function addField(target: AssetQrField[], seen: Set<string>, label: string, value: unknown) {
  const cleanLabel = text(label).slice(0, 60);
  const cleanValue = text(value).slice(0, 160);
  if (!cleanLabel || !cleanValue) return;
  const identity = `${cleanLabel.toLowerCase()}\u0000${cleanValue}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  target.push({ label: cleanLabel, value: cleanValue });
}

function normalizedFieldName(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function coreFieldValue(source: AssetQrSource, names: string[]) {
  const normalizedNames = names.map(normalizedFieldName);
  return (source.fields || []).find(field => {
    const key = normalizedFieldName(field.key);
    const label = normalizedFieldName(field.label);
    return normalizedNames.some(name => key === name || label === name || key.includes(name) || label.includes(name));
  })?.value;
}

function fieldCharacters(fields: AssetQrField[]) {
  return fields.reduce((total, field) => total + field.label.length + field.value.length + 3, 0);
}

export function buildAssetQrPayload(source: AssetQrSource): AssetQrPayload {
  const fields: AssetQrField[] = [];
  const seen = new Set<string>();
  addField(fields, seen, "Asset ID", source.id);
  addField(fields, seen, "Asset Number", source.assetNo);
  addField(fields, seen, "Asset Type", source.assetType || coreFieldValue(source, ["assetName", "assetType", "equipmentName"]));
  addField(fields, seen, "Manufacturer", source.manufacturer || coreFieldValue(source, ["manufacturer", "brand", "make"]));
  addField(fields, seen, "Model", source.model || coreFieldValue(source, ["modelNumber", "modelNo", "model"]));
  addField(fields, seen, "Serial Number", source.serial || coreFieldValue(source, ["serialNumber", "serialNo", "serial", "sn"]));
  addField(fields, seen, "Barcode", source.barcode);
  if (Number.isInteger(source.conditionRating) && Number(source.conditionRating) >= 1 && Number(source.conditionRating) <= 5) addField(fields, seen, "Asset Condition Rating", `${source.conditionRating}/5`);
  if (Number.isInteger(source.criticalityRating) && Number(source.criticalityRating) >= 1 && Number(source.criticalityRating) <= 5) {
    const criticality = Number(source.criticalityRating);
    addField(fields, seen, "Asset Criticality", `${CRITICALITY_LABELS[criticality]} (Weight ${criticality})`);
  }
  addField(fields, seen, "Project", source.project);
  addField(fields, seen, "Building / Site", source.building);
  addField(fields, seen, "Floor", source.floor);
  addField(fields, seen, "Zone", source.zone);
  addField(fields, seen, "Office / Room", source.office);
  for (const location of (source.additionalLocations || []).slice(0, 5)) addField(fields, seen, location.labelAr || location.labelEn || location.key || "Location", location.value);
  // Custom fields shown in QR are administrator-selected business data. Keep a
  // strict budget so long notes never turn the printed code into an unreadable matrix.
  for (const field of source.customValues || []) {
    if (fields.length >= 18 || fieldCharacters(fields) >= 850) break;
    addField(fields, seen, field.labelAr || field.labelEn || field.key || "Custom Field", field.value);
  }
  if (!text(source.id)) throw new Error("Asset ID is required before creating an offline QR.");
  if (fields.length <= 2) throw new Error("The database record does not contain enough asset data to create an offline QR.");
  return { kind: "assetlens-asset", version: 2, assetId: source.id, assetNo: source.assetNo, snapshotAt: "", fields };
}

function compactPayload(payload: AssetQrPayload): CompactPayloadV2 {
  return ["a", 2, payload.assetId, payload.assetNo, payload.snapshotAt, payload.fields.map(field => [field.label, field.value])];
}

function expandCompactPayload(value: unknown): AssetQrPayload | null {
  if (!Array.isArray(value) || value[0] !== "a" || value[1] !== 2 || typeof value[2] !== "string" || typeof value[3] !== "string" || typeof value[4] !== "string" || !Array.isArray(value[5])) return null;
  const fields = value[5].flatMap(item => Array.isArray(item) && typeof item[0] === "string" && typeof item[1] === "string" ? [{ label: item[0], value: item[1] }] : []);
  if (!value[2] || !fields.length) return null;
  return { kind: "assetlens-asset", version: 2, assetId: value[2], assetNo: value[3], snapshotAt: value[4], fields };
}

function oneLine(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Human-readable QR content for any ordinary phone QR reader. The asset data
 * itself is the QR value: no URL, deployment, browser, or network is needed.
 */
export function createAssetQrText(payload: AssetQrPayload) {
  const lines = [DIRECT_TEXT_PREFIX];
  for (const field of payload.fields) {
    const label = oneLine(field.label).replace(/:/g, " -");
    const value = oneLine(field.value);
    if (label && value) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

function parseDirectText(value: string): AssetQrPayload | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== DIRECT_TEXT_PREFIX) return null;
  const fields: AssetQrField[] = [];
  let snapshotAt = "";
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const label = line.slice(0, separator).trim();
    const fieldValue = line.slice(separator + 1).trim();
    if (!fieldValue) continue;
    if (label === "Snapshot At") snapshotAt = fieldValue;
    else fields.push({ label, value: fieldValue });
  }
  const assetId = fields.find(field => field.label === "Asset ID")?.value || "";
  const assetNo = fields.find(field => field.label === "Asset Number")?.value || "";
  if (!assetId || !fields.length) throw new Error("Invalid AssetLens direct offline QR payload.");
  return { kind: "assetlens-asset", version: 2, assetId, assetNo, snapshotAt, fields };
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function ownedArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") throw new Error("This device cannot unpack the offline QR payload.");
  const stream = new Blob([ownedArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function createAssetQrValue(origin: string, payload: AssetQrPayload) {
  const source = new TextEncoder().encode(JSON.stringify(compactPayload(payload)));
  const compressed = await gzip(source);
  const packed = `${CURRENT_PREFIX}.${compressed ? "g" : "j"}.${bytesToBase64Url(compressed || source)}`;
  return `${origin.replace(/\/$/, "")}/scan#${packed}`;
}

export async function parseAssetQrValue(rawValue: string): Promise<AssetQrPayload | null> {
  const clean = rawValue.trim();
  const direct = parseDirectText(clean);
  if (direct) return direct;
  let packed = clean;
  try {
    const url = new URL(clean);
    packed = url.hash.slice(1);
  } catch { /* The scanner may return the packed value without its URL. */ }
  const [prefix, mode, encoded] = packed.split(".", 3);
  if ((prefix !== CURRENT_PREFIX && prefix !== LEGACY_PREFIX) || !encoded || (mode !== "g" && mode !== "j")) return null;
  const source = base64UrlToBytes(encoded);
  const bytes = mode === "g" ? await gunzip(source) : source;
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (prefix === CURRENT_PREFIX) {
    const expanded = expandCompactPayload(parsed);
    if (!expanded) throw new Error("Invalid AssetLens QR payload.");
    return expanded;
  }
  const legacy = parsed as Partial<AssetQrPayload>;
  if (legacy.kind !== "assetlens-asset" || legacy.version !== 1 || !legacy.assetId || !Array.isArray(legacy.fields)) throw new Error("Invalid AssetLens QR payload.");
  return legacy as AssetQrPayload;
}
