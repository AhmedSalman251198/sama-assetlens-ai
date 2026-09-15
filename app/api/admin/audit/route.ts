import { canUseModule } from "../../../lib/module-permissions";
import { moduleAccessFor } from "../../../lib/server/module-access";
import {
  requestToken,
  supabaseRest,
  verifyAuthUser,
} from "../../../lib/server/supabase";

export const runtime = "nodejs";

type AuditRow = {
  id: number;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    if (!token)
      return Response.json({ error: "Authentication required." }, { status: 401 });
    const user = await verifyAuthUser(token);
    if (!user)
      return Response.json({ error: "Authentication required." }, { status: 401 });
    const access = await moduleAccessFor(token, user.id);
    if (
      !access ||
      access.actor.role !== "admin" ||
      !canUseModule(access.permissions, "administration")
    )
      return Response.json(
        { error: "Administrator permission is required." },
        { status: 403 },
      );

    const auditLogs = await supabaseRest<AuditRow[]>(
      "audit_logs?select=id,actor_email,action,entity_type,entity_id,project_id,details,created_at&order=created_at.desc,id.desc&limit=100",
      token,
    );
    return Response.json(
      { auditLogs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const timeout = /gateway timeout|statement timeout|timed?\s*out|aborted/i.test(
      message,
    );
    return Response.json(
      {
        error: timeout
          ? "The activity log took too long to load. Please retry."
          : message || "Unable to load the activity log.",
      },
      { status: timeout ? 504 : 500 },
    );
  }
}
