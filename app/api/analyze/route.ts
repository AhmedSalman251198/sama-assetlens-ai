import { analyzeEncodedImages, arrayBufferToBase64 } from "../../lib/server/analyze-images";
import { requestToken, supabaseRest, verifyAuthUser } from "../../lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 5;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const token = requestToken(request);
    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const profiles = await supabaseRest<Array<{ id: string }>>(`app_users?select=id&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`, token);
    if (!profiles[0]) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });
    const form = await request.formData();
    const submittedImages = form.getAll("images").filter((item): item is File => item instanceof File);
    const legacyImage = form.get("image");
    const images = submittedImages.length > 0 ? submittedImages : legacyImage instanceof File ? [legacyImage] : [];
    if (images.length === 0) return Response.json({ error: "At least one asset image is required." }, { status: 400 });
    if (images.length > MAX_IMAGES) return Response.json({ error: `Upload no more than ${MAX_IMAGES} images for one asset.` }, { status: 400 });
    if (images.some(image => !ALLOWED_TYPES.has(image.type) || image.size > MAX_BYTES || image.size === 0)) return Response.json({ error: "Use JPG, PNG or WEBP images no larger than 4 MB after optimization." }, { status: 415 });
    if (images.reduce((total, image) => total + image.size, 0) > MAX_TOTAL_BYTES) return Response.json({ error: "The optimized image request must not exceed 4 MB." }, { status: 413 });

    const encodedImages = await Promise.all(images.map(async image => ({ mimeType: image.type, data: arrayBufferToBase64(await image.arrayBuffer()) })));
    const result = await analyzeEncodedImages(encodedImages, request.headers.get("x-gemini-api-key")?.trim() || "");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image could not be analyzed. Please try again.";
    return Response.json({ error: message }, { status: message.includes("not configured") ? 503 : 500 });
  }
}
