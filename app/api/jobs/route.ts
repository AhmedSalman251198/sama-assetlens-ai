import { drainAnalysisQueue } from "../../lib/server/asset-queue";
import { requestToken, supabaseRest, verifyAuthUser } from "../../lib/server/supabase";
import { hasModuleAccess } from "../../lib/server/module-access";
import { after } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type JobRow = { id: string; asset_id: string; status: string };

export async function POST(request: Request) {
  try {
    const token = requestToken(request); const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!await hasModuleAccess(token, user.id, "capture", "create")) return Response.json({ error: "Capture and analysis permission is required." }, { status: 403 });
    const body = await request.json().catch(() => ({})) as { action?: string; jobId?: string };
    if (body.action === "retry") {
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      if (!jobId) return Response.json({ error: "Job id is required." }, { status: 400 });
      const jobs = await supabaseRest<JobRow[]>(`analysis_jobs?select=id,asset_id,status&id=eq.${encodeURIComponent(jobId)}&limit=1`, token);
      const job = jobs[0];
      if (!job) return Response.json({ error: "Analysis job was not found." }, { status: 404 });
      if (job.status === "processing") return Response.json({ accepted: true }, { status: 202 });
      await Promise.all([
        supabaseRest(`analysis_jobs?id=eq.${encodeURIComponent(job.id)}`, token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "queued", error: null, started_at: null, completed_at: null }) }),
        supabaseRest(`assets?id=eq.${encodeURIComponent(job.asset_id)}`, token, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "queued", error: null }) }),
      ]);
    } else if (body.action !== "wake") {
      return Response.json({ error: "Unsupported queue action." }, { status: 400 });
    }
    const sessionGeminiKey = request.headers.get("x-gemini-api-key")?.trim() || "";
    after(async () => { await drainAnalysisQueue(token, sessionGeminiKey).catch(() => undefined); });
    return Response.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The analysis queue could not be started." }, { status: 500 });
  }
}
