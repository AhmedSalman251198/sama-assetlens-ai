import { buildGeminiModelCandidates } from "../../../../lib/server/gemini-models.mjs";
import { hasModuleAccess } from "../../../../lib/server/module-access";
import { requestToken, supabaseRest, verifyAuthUser } from "../../../../lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type Field = { key: string; label: string; value: string };
type AssetRow = { id: string; asset_type: string; fields: Field[]; category_id: string | null; asset_categories: { label_en: string; technical_fields: string[] } | null };
type GeminiPayload = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }> };

function safeId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : ""; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function fieldValue(fields: Field[], names: string[]) { const wanted = names.map(normalize); return fields.find(field => wanted.some(name => normalize(field.key).includes(name) || normalize(field.label).includes(name)))?.value?.trim() || ""; }
function cleanJson(value: string) { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!await hasModuleAccess(token, user.id, "locations", "edit")) return Response.json({ error: "Asset management edit permission is required." }, { status: 403 });
    const id = safeId((await context.params).id);
    if (!id) return Response.json({ error: "Invalid Asset ID." }, { status: 400 });
    const rows = await supabaseRest<AssetRow[]>(`assets?select=id,asset_type,fields,category_id,asset_categories(label_en,technical_fields)&id=eq.${encodeURIComponent(id)}&limit=1`, token);
    const asset = rows[0];
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    const manufacturer = fieldValue(asset.fields || [], ["manufacturer", "brand", "make"]);
    const model = fieldValue(asset.fields || [], ["modelnumber", "modelno", "model"]);
    if (!manufacturer || !model) return Response.json({ error: "Manufacturer and exact model are required before online enrichment." }, { status: 400 });
    const apiKey = (request.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) return Response.json({ error: "GEMINI_API_KEY is required for online asset enrichment." }, { status: 503 });
    const requested = asset.asset_categories?.technical_fields || [];
    const prompt = `Research the exact industrial/building asset model below using web search. Use only values directly supported by manufacturer documentation or a credible product catalog. Never infer or guess. If the exact model cannot be verified, return empty specifications and confidence low.\nManufacturer: ${manufacturer}\nModel: ${model}\nAsset type: ${asset.asset_type}\nCategory: ${asset.asset_categories?.label_en || ""}\nRequested technical keys: ${requested.join(", ")}\nReturn only JSON: {"exactModelVerified":boolean,"specifications":object,"estimatedMarketPrice":number|null,"currency":"AED|USD|...","usefulLifeYears":number|null,"confidence":"high|medium|low","notes":"short"}. For HVAC include capacityTons and coolingCapacityBtu only when explicitly supported.`;
    const models = buildGeminiModelCandidates(process.env.GEMINI_MODEL || "gemini-3.7-flash");
    let lastError = "";
    for (const modelName of models.slice(0, 4)) {
      const modelPath = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(35_000), headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } }),
      });
      const gemini = await response.json() as GeminiPayload & { error?: { message?: string } };
      if (!response.ok) { lastError = gemini.error?.message || `Gemini error ${response.status}`; continue; }
      const candidate = gemini.candidates?.[0];
      const output = candidate?.content?.parts?.map(part => part.text || "").join("") || "";
      const sources = (candidate?.groundingMetadata?.groundingChunks || []).flatMap(chunk => chunk.web?.uri ? [{ url: chunk.web.uri, title: chunk.web.title || chunk.web.uri }] : []).slice(0, 8);
      if (!output || !sources.length) { lastError = "The search returned no cited source for this exact model."; continue; }
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(cleanJson(output)) as Record<string, unknown>; }
      catch { lastError = "The enrichment response was not valid JSON."; continue; }
      const exact = parsed.exactModelVerified === true;
      const specifications = exact && parsed.specifications && typeof parsed.specifications === "object" && !Array.isArray(parsed.specifications) ? parsed.specifications as Record<string, unknown> : {};
      const enrichmentData = { ...specifications, sourceCount: sources.length, sourceTitles: sources.map(source => source.title), note: typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : "" };
      const price = exact && Number.isFinite(Number(parsed.estimatedMarketPrice)) && Number(parsed.estimatedMarketPrice) >= 0 ? Number(parsed.estimatedMarketPrice) : null;
      const life = exact && Number.isFinite(Number(parsed.usefulLifeYears)) && Number(parsed.usefulLifeYears) > 0 && Number(parsed.usefulLifeYears) <= 100 ? Number(parsed.usefulLifeYears) : null;
      const confidence = ["high", "medium", "low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "low";
      await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        enrichment_data: enrichmentData, enrichment_source_url: sources[0].url, enrichment_fetched_at: new Date().toISOString(), estimate_confidence: confidence,
        ...(price == null ? {} : { estimated_price: price, price_currency: typeof parsed.currency === "string" ? parsed.currency.slice(0, 3).toUpperCase() : "AED", estimate_source: sources[0].url }),
        ...(life == null ? {} : { useful_life_years: life }),
      }) });
      return Response.json({ updated: true, exactModelVerified: exact, specifications: enrichmentData, sources, estimatedPrice: price, usefulLifeYears: life, confidence });
    }
    return Response.json({ error: lastError || "No verified web data was found for the exact model." }, { status: 422 });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Asset enrichment failed." }, { status: 500 });
  }
}
