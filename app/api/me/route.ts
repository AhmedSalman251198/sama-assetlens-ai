import { requestToken, verifyAuthUser } from "../../lib/server/supabase";
import { moduleAccessFor } from "../../lib/server/module-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });
    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const access = await moduleAccessFor(token, user.id);
    if (!access) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });
    const { actor, permissions } = access;
    return Response.json(
      { name: actor.name || actor.email.split("@")[0] || "AssetLens User", email: actor.email || user.email, role: actor.role, modulePermissions: permissions, modules: permissions.filter(permission => permission.view).map(permission => permission.module) },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the signed-in account." }, { status: 500 });
  }
}
