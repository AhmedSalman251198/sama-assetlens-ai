const TIMEOUT_PATTERN =
  /statement timeout|gateway timeout|timed? out|abort(?:ed|error)|57014/i;
const SCHEMA_PATTERN =
  /schema cache|column .* does not exist|relation .* does not exist|pgrst20[024]/i;

const SAFE_MESSAGE_PATTERN =
  /^(?:choose|enter|use|only|your account|this account|the selected|the project|asset |report |capture |dependency |scenario |administrator |authentication |at least|one or more|no approved|no assets|unable to open)/i;

export type PublicApiError = {
  code: "DATA_TIMEOUT" | "SCHEMA_MISMATCH" | "REQUEST_FAILED";
  message: string;
  retryable: boolean;
};

/**
 * Database/provider details belong in server logs, never in the interface.
 * Known validation messages remain useful; infrastructure failures receive a
 * stable code and an Arabic/English action the interface can safely display.
 */
export function publicApiError(
  error: unknown,
  fallback = "تعذر إكمال الطلب. حاول مرة أخرى.",
): PublicApiError {
  const raw = error instanceof Error ? error.message.trim() : "";
  if (TIMEOUT_PATTERN.test(raw))
    return {
      code: "DATA_TIMEOUT",
      message:
        "استغرق تحميل البيانات وقتًا أطول من المتوقع. أعد المحاولة، وإذا استمرت المشكلة تواصل مع مسؤول النظام.",
      retryable: true,
    };
  if (SCHEMA_PATTERN.test(raw))
    return {
      code: "SCHEMA_MISMATCH",
      message:
        "تحتاج قاعدة البيانات إلى تحديث متوافق مع هذا الإصدار. تواصل مع مسؤول النظام.",
      retryable: false,
    };
  if (raw && SAFE_MESSAGE_PATTERN.test(raw))
    return { code: "REQUEST_FAILED", message: raw, retryable: false };
  return {
    code: "REQUEST_FAILED",
    message: fallback,
    retryable: true,
  };
}

export function apiErrorResponse(
  error: unknown,
  fallback?: string,
  status?: number,
) {
  const safe = publicApiError(error, fallback);
  if (error) console.error(`[AssetLens ${safe.code}]`, error);
  return Response.json(
    { error: safe.message, code: safe.code, retryable: safe.retryable },
    {
      status:
        status ??
        (safe.code === "DATA_TIMEOUT"
          ? 504
          : safe.code === "SCHEMA_MISMATCH"
            ? 503
            : 500),
      headers: { "Cache-Control": "no-store" },
    },
  );
}
