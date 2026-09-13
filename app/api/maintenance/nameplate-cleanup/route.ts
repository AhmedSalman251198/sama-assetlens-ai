import { deleteAssetImagesAdmin, supabaseAdminRest } from "../../../lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type ExpiredImage = { id: string; storage_path: string };

function authorized(request: Request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized maintenance request." }, { status: 401 });
  let deleted = 0;
  try {
    const cutoff = encodeURIComponent(new Date().toISOString());
    const started = Date.now();
    for (let batch = 0; batch < 20 && Date.now() - started < 40_000; batch += 1) {
      const rows = await supabaseAdminRest<ExpiredImage[]>(`asset_images?select=id,storage_path&image_role=eq.nameplate&deleted_at=is.null&delete_after=lte.${cutoff}&order=delete_after.asc&limit=100`);
      if (!rows.length) return Response.json({ deleted, backlog: false });
      await deleteAssetImagesAdmin(rows.map(row => row.storage_path));
      // Keep the extracted nameplate fields on the asset. Only the stored
      // image bytes are removed, and these image rows remain as audit records.
      await supabaseAdminRest(`asset_images?id=in.(${rows.map(row => encodeURIComponent(row.id)).join(",")})`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      deleted += rows.length;
      if (rows.length < 100) return Response.json({ deleted, backlog: false });
    }
    return Response.json({ deleted, backlog: true });
  } catch (reason) {
    return Response.json({ deleted, error: reason instanceof Error ? reason.message : "Nameplate cleanup failed." }, { status: 500 });
  }
}
