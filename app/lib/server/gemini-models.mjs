export const DEFAULT_GEMINI_MODELS = Object.freeze([
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
]);

/** @param {unknown} value */
export function normalizeGeminiModel(value) {
  return typeof value === "string" ? value.trim().replace(/^models\//, "") : "";
}

/** @param {string} model */
export function isLegacyGeminiModel(model) {
  return /^gemini-(?:1|2)(?:\.|-)/i.test(normalizeGeminiModel(model));
}

/** @param {string} model */
export function isUsableGeminiVisionModel(model) {
  const clean = normalizeGeminiModel(model).toLowerCase();
  if (!clean.startsWith("gemini-") || isLegacyGeminiModel(clean)) return false;
  if (!/(?:flash|pro)/.test(clean)) return false;
  return !/(?:image|live|tts|transcribe|audio|embedding|robotics|omni)/.test(clean);
}

/**
 * A stale environment value must never pin the application to a retired model.
 * Modern stable defaults are attempted first, then compatible models returned
 * by models.list for the caller's own API key.
 *
 * @param {unknown} preferredModel
 * @param {unknown[]} discoveredModels
 */
export function buildGeminiModelCandidates(preferredModel, discoveredModels = []) {
  const preferred = normalizeGeminiModel(preferredModel);
  const models = [
    ...(preferred && !isLegacyGeminiModel(preferred) ? [preferred] : []),
    ...DEFAULT_GEMINI_MODELS,
    ...discoveredModels.map(normalizeGeminiModel),
  ];
  return Array.from(new Set(models)).filter(isUsableGeminiVisionModel);
}

/** @param {number} status @param {string} message */
export function isGeminiModelUnavailable(status, message) {
  const value = message.toLowerCase();
  return status === 404 ||
    value.includes("no longer available") ||
    value.includes("model is not available") ||
    value.includes("model not found") ||
    value.includes("is not found") ||
    value.includes("does not exist") ||
    value.includes("deprecated") ||
    value.includes("not supported for generatecontent");
}

/** @param {number} status @param {string} message */
export function isGeminiCredentialError(status, message) {
  const value = message.toLowerCase();
  return status === 401 ||
    value.includes("api key not valid") ||
    value.includes("invalid api key") ||
    value.includes("api_key_invalid");
}
