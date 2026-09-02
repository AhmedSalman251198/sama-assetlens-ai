import { analyzeEncodedImages, arrayBufferToBase64 } from "./analyze-images";
import { downloadAssetImage, supabaseRest } from "./supabase";
import type { AnalysisField } from "./analyze-images";

type JobRow = { id: string; asset_id: string; created_by: string; status: "queued" | "processing" | "completed" | "failed"; started_at?: string | null };
type ImageRow = { storage_path: string; mime_type: string; sort_order: number };
type AssetQualityRow = { id: string; asset_no: string; project_id: string; fields: AnalysisField[] };

function serialValue(fields: AnalysisField[]) {
  const serial = fields.find(field => {
    const key = `${field.key} ${field.label}`.toLowerCase();
    return key.includes("serial") || key.includes("s/n") || key.includes("serial no");
  });
  return serial?.value.trim() || "";
}

function normalizedIdentifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function findDuplicateWarning(token: string, assetId: string, fields: AnalysisField[]) {
  const serial = serialValue(fields); const normalizedSerial = normalizedIdentifier(serial);
  if (normalizedSerial.length < 4) return "";
  const currentRows = await supabaseRest<AssetQualityRow[]>(`assets?select=id,asset_no,project_id,fields&id=eq.${encodeURIComponent(assetId)}&limit=1`, token);
  const current = currentRows[0]; if (!current) return "";
  const existingRows = await supabaseRest<AssetQualityRow[]>(`assets?select=id,asset_no,project_id,fields&project_id=eq.${encodeURIComponent(current.project_id)}&id=neq.${encodeURIComponent(assetId)}&status=in.(completed,review)&limit=5000`, token);
  const duplicate = existingRows.find(asset => normalizedIdentifier(serialValue(asset.fields || [])) === normalizedSerial);
  return duplicate ? `Duplicate serial detected: ${serial} matches asset ${duplicate.asset_no}. Review both records before approval.` : "";
}

async function patchJob(token: string, id: string, body: Record<string, unknown>) {
  await supabaseRest(`analysis_jobs?id=eq.${encodeURIComponent(id)}`, token, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
}

async function patchAsset(token: string, id: string, body: Record<string, unknown>) {
  await supabaseRest(`assets?id=eq.${encodeURIComponent(id)}`, token, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
}

export async function recoverStaleProcessingJobs(token: string, olderThanMs = 120_000) {
  const cutoff = encodeURIComponent(new Date(Date.now() - olderThanMs).toISOString());
  const staleJobs = await supabaseRest<JobRow[]>(
    `analysis_jobs?select=id,asset_id,created_by,status,started_at&status=eq.processing&started_at=lt.${cutoff}&order=started_at.asc&limit=10`,
    token,
  ).catch(() => []);

  if (staleJobs.length > 0) {
    console.info(`[Queue] Recovering ${staleJobs.length} stale jobs.`);
  }

  await Promise.allSettled(staleJobs.map(job => Promise.all([
    patchJob(token, job.id, {
      status: "queued",
      error: "Timeout: Job reset due to long processing time.",
      started_at: null,
      completed_at: null
    }),
    patchAsset(token, job.asset_id, { status: "queued", error: null }),
  ])));
  return staleJobs.length;
}

export async function processNextAnalysisJob(token: string, sessionGeminiKey = "") {
  let job: JobRow | undefined;
  try {
    const claimed = await supabaseRest<JobRow[]>("rpc/claim_next_analysis_job", token, {
      method: "POST", headers: { Prefer: "return=representation" }, body: "{}",
    });
    job = claimed[0];
    if (!job) return false;

    console.info(`[Queue] Processing job ${job.id} for asset ${job.asset_id}`);

    const images = await supabaseRest<ImageRow[]>(
      `asset_images?select=storage_path,mime_type,sort_order&asset_id=eq.${encodeURIComponent(job.asset_id)}&order=sort_order`,
      token,
    );

    if (images.length === 0) {
      throw new Error("No stored images found.");
    }

    const encodedImages = await Promise.all(images.map(async image => ({
      mimeType: image.mime_type,
      data: arrayBufferToBase64(await downloadAssetImage(image.storage_path, token)),
    })));

    const result = await analyzeEncodedImages(encodedImages, sessionGeminiKey);
    const completedAt = new Date().toISOString();
    const duplicate = await findDuplicateWarning(token, job.asset_id, result.fields);
    const warnings = Array.from(new Set([...result.warnings, ...(duplicate ? [duplicate] : [])]));

    // Determine if it needs review based on confidence or specific warnings
    const needsReview = warnings.length > 0 || result.overallConfidence < 0.75;

    await patchAsset(token, job.asset_id, {
      asset_type: result.assetType,
      summary: result.summary,
      fields: result.fields,
      warnings,
      raw_text: result.rawText,
      overall_confidence: result.overallConfidence,
      status: needsReview ? "review" : "completed",
      error: null,
      completed_at: completedAt,
    });

    await patchJob(token, job.id, { status: "completed", error: null, completed_at: completedAt });
    console.info(`[Queue] Job ${job.id} completed successfully.`);
    return true;
  } catch (error) {
    if (job) {
      const errorStr = error instanceof Error ? error.message : String(error);
      console.error(`[Queue] Job ${job.id} failed: ${errorStr}`);

      await Promise.allSettled([
        patchAsset(token, job.asset_id, { status: "failed", error: errorStr }),
        patchJob(token, job.id, {
          status: "failed",
          error: errorStr,
          completed_at: new Date().toISOString()
        }),
      ]);
    }
    return false;
  }
}

export async function drainAnalysisQueue(token: string, sessionGeminiKey = "") {
  await recoverStaleProcessingJobs(token);
  await processNextAnalysisJob(token, sessionGeminiKey);
}
