import { supabaseSettings } from "../../lib/server/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { url, key } = supabaseSettings();
    return Response.json({ url, publishableKey: key }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "إعدادات Supabase غير مكتملة." }, { status: 503 });
  }
}
