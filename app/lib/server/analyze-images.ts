import {
  buildGeminiModelCandidates,
  isGeminiCredentialError,
  isGeminiModelUnavailable,
} from "./gemini-models.mjs";

export type EncodedImage = { mimeType: string; data: string };
export type AnalysisField = { key: string; label: string; value: string; confidence: number };
export type AnalysisResult = {
  assetType: string;
  summary: string;
  fields: AnalysisField[];
  warnings: string[];
  rawText: string;
  overallConfidence: number;
};

const analysisPrompt = `You are an industrial asset nameplate extraction specialist. Analyze all supplied images to extract technical data from nameplates, labels, or tables.

Rules:
- Focus ONLY on the visible nameplate/label/table text.
- Return a valid JSON object matching the required schema.
- Extract these specific fields: asset_type, asset_name, manufacturer, model_number, serial_number, rated_power, voltage, frequency, current, speed, ip_rating, year, notes.
- If a field is not visible, return an empty string. Never hallucinate values.
- Confidence is per field (0.0 to 1.0).
- rawText should be a full transcription of the plate text.`;

const analysisSchema = {
  type: "object",
  properties: {
    assetType: { type: "string", description: "The type of equipment (e.g., Pump, Motor, Chiller)" },
    assetName: { type: "string", description: "The specific name or model family" },
    manufacturer: { type: "string" },
    modelNumber: { type: "string" },
    serialNumber: { type: "string" },
    ratedPower: { type: "string" },
    voltage: { type: "string" },
    frequency: { type: "string" },
    current: { type: "string" },
    speed: { type: "string" },
    ipRating: { type: "string" },
    year: { type: "string" },
    notes: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["key", "label", "value", "confidence"]
      }
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    },
    rawText: { type: "string" },
    overallConfidence: { type: "number" },
  },
  required: ["assetType", "fields", "warnings", "rawText", "overallConfidence"],
} as const;

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer); let binary = ""; const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  return btoa(binary);
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) if (content && typeof content === "object" && "type" in content && content.type === "output_text" && "text" in content && typeof content.text === "string") return content.text;
  }
  return "";
}

function apiError(payload: Record<string, unknown>, fallback: string) {
  return payload.error && typeof payload.error === "object" && "message" in payload.error ? String(payload.error.message) : fallback;
}

function geminiOutputText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []; const first = candidates[0];
  if (!first || typeof first !== "object" || !("content" in first) || !first.content || typeof first.content !== "object") return "";
  const parts = Array.isArray((first.content as Record<string, unknown>).parts) ? (first.content as Record<string, unknown>).parts as unknown[] : [];
  return parts.map(part => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").join("");
}

async function discoverGeminiModels(apiKey: string, deadline: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.min(6_000, Math.max(1_000, deadline - Date.now())));
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      signal: controller.signal,
      cache: "no-store",
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) return [];
    const payload = await response.json() as { models?: unknown[] };
    if (!Array.isArray(payload.models)) return [];
    return payload.models.flatMap(model => {
      if (!model || typeof model !== "object") return [];
      const row = model as Record<string, unknown>;
      const methods = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : [];
      return typeof row.name === "string" && methods.includes("generateContent") ? [row.name] : [];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function analyzeWithGemini(apiKey: string, preferredModel: string, images: EncodedImage[]) {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = Date.now() + 45_000;
  let uniqueModels = buildGeminiModelCandidates(preferredModel);
  let discoveryAttempted = false;
  let lastError = "";
  const unavailableModels = new Set<string>();

  for (let modelIndex = 0; modelIndex < uniqueModels.length; modelIndex++) {
    const modelName = uniqueModels[modelIndex];
    const modelPath = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;
    const attempts = modelIndex === 0 ? 2 : 1;
    for (let attempt = 1; attempt <= attempts && Date.now() < deadline; attempt++) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        const remaining = Math.max(1_000, deadline - Date.now());
        timeoutId = setTimeout(() => controller.abort(), Math.min(18_000, remaining));

        const response = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: analysisPrompt },
                ...images.map(img => ({
                  inlineData: {
                    mimeType: img.mimeType,
                    data: img.data
                  }
                }))
              ]
            }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: analysisSchema
            }
          }),
        });

        clearTimeout(timeoutId);
        const payload = await response.json() as Record<string, unknown>;

        if (response.ok) {
          const text = geminiOutputText(payload);
          if (text) return text;
        }

        const errorMsg = apiError(payload, `Gemini API Error (${response.status})`);
        lastError = errorMsg;

        if (isGeminiCredentialError(response.status, errorMsg)) {
          throw new Error("مفتاح Gemini غير صالح أو تم إلغاؤه. أنشئ مفتاحًا صالحًا من Google AI Studio ثم أعد المحاولة.");
        }

        if (isGeminiModelUnavailable(response.status, errorMsg)) {
          unavailableModels.add(modelName);
          break;
        }

        const isTransient =
          response.status === 429 ||
          response.status === 503 ||
          errorMsg.toLowerCase().includes("high demand") ||
          errorMsg.toLowerCase().includes("overloaded") ||
          errorMsg.toLowerCase().includes("temporary capacity") ||
          errorMsg.toLowerCase().includes("timeout") ||
          errorMsg.toLowerCase().includes("rate limit");

        if (isTransient && attempt < attempts && Date.now() + 1_000 < deadline) {
          await sleep(1_000);
          continue;
        }
        break;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("مفتاح Gemini")) throw err;
        lastError = err instanceof Error && err.name === "AbortError"
          ? "Gemini request timed out."
          : err instanceof Error ? err.message : String(err);
        break;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    // Keep the common path fast. Query models.list only when every known
    // modern fallback failed, then append any future compatible model IDs.
    if (modelIndex === uniqueModels.length - 1 && !discoveryAttempted && Date.now() + 1_000 < deadline) {
      discoveryAttempted = true;
      const discoveredModels = await discoverGeminiModels(apiKey, deadline);
      uniqueModels = buildGeminiModelCandidates(preferredModel, discoveredModels);
    }
  }

  if (uniqueModels.length > 0 && unavailableModels.size === uniqueModels.length) {
    throw new Error("لا يوجد موديل Gemini حديث متاح لهذا المفتاح. يدعم النظام Gemini 3.7 Flash و3.6 Flash ويختار المتاح تلقائيًا.");
  }
  throw new Error(`خدمة التحليل مشغولة حاليًا. حاول مرة أخرى بعد قليل${lastError ? `: ${lastError}` : "."}`);
}

async function analyzeWithOpenAI(apiKey: string, model: string, images: EncodedImage[]) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, input: [{ role: "user", content: [{ type: "input_text", text: analysisPrompt }, ...images.map(image => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}`, detail: "high" }))] }], text: { format: { type: "json_schema", name: "asset_nameplate_analysis", strict: true, schema: analysisSchema } } }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(apiError(payload, "OpenAI rejected the analysis request."));
    const text = outputText(payload);
    if (!text) throw new Error("OpenAI returned no structured result.");
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("OpenAI analysis timed out. Please retry.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanString(value: unknown, max = 5_000) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
}

function confidence(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0;
}

function parseAnalysis(text: string): AnalysisResult {
  const cleanJson = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const result = JSON.parse(cleanJson) as Record<string, unknown>;
  const fields = Array.isArray(result.fields) ? result.fields.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const key = cleanString(row.key, 80);
    if (!key) return [];
    return [{ key, label: cleanString(row.label, 120) || key, value: cleanString(row.value, 2_000), confidence: confidence(row.confidence) }];
  }) : [];

  const canonical = [
    ["assetName", "Asset Name"], ["manufacturer", "Manufacturer"], ["modelNumber", "Model Number"],
    ["serialNumber", "Serial Number"], ["ratedPower", "Rated Power"], ["voltage", "Voltage"],
    ["frequency", "Frequency"], ["current", "Current"], ["speed", "Speed"],
    ["ipRating", "IP Rating"], ["year", "Year"], ["notes", "Notes"],
  ] as const;
  const normalizedKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [key, label] of canonical) {
    const value = cleanString(result[key], 2_000);
    if (value && !fields.some(field => normalizedKey(field.key) === normalizedKey(key))) fields.push({ key, label, value, confidence: confidence(result.overallConfidence) });
  }
  if (!fields.length) throw new Error("AI analysis returned no usable fields.");
  return {
    assetType: cleanString(result.assetType, 200),
    summary: cleanString(result.summary, 2_000),
    fields,
    warnings: Array.isArray(result.warnings) ? result.warnings.map(item => cleanString(item, 500)).filter(Boolean).slice(0, 20) : [],
    rawText: cleanString(result.rawText, 12_000),
    overallConfidence: confidence(result.overallConfidence),
  };
}

export async function analyzeEncodedImages(images: EncodedImage[], sessionGeminiKey = "") {
  const runtimeEnv = process.env as Record<string, string | undefined>;
  const envGeminiKey = runtimeEnv.GEMINI_API_KEY;
  const geminiKey = (sessionGeminiKey && sessionGeminiKey.length <= 512)
    ? sessionGeminiKey
    : (envGeminiKey && envGeminiKey !== "your_gemini_api_key" ? envGeminiKey : "");

  const openaiKey = runtimeEnv.OPENAI_API_KEY;
  if (!geminiKey && !openaiKey) throw new Error("Gemini API is not configured yet. Add GEMINI_API_KEY to enable image analysis.");
  const preferredProvider = runtimeEnv.AI_PROVIDER || "gemini";
  const text = preferredProvider === "gemini" && geminiKey
    ? await analyzeWithGemini(geminiKey, runtimeEnv.GEMINI_MODEL || "gemini-3.7-flash", images)
    : openaiKey
      ? await analyzeWithOpenAI(openaiKey, runtimeEnv.OPENAI_VISION_MODEL || "gpt-4o", images)
      : geminiKey
        ? await analyzeWithGemini(geminiKey, runtimeEnv.GEMINI_MODEL || "gemini-3.7-flash", images)
        : "";
  if (!text) throw new Error("The selected AI provider is not configured.");
  try { return parseAnalysis(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("AI analysis returned malformed JSON. Please retry with a clearer image.");
    throw error;
  }
}
