import { requestToken, supabaseRest, verifyAuthUser } from "../../lib/server/supabase";

export const runtime = "nodejs";

type ProfileRow = {
  email: string;
  name: string;
  role: "admin" | "surveyor";
  active: boolean;
};

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });
    const snapshot = await supabaseRest<ProfileRow>("rpc/assetlens_current_actor", token, {
      method: "POST", headers: { Prefer: "return=representation" }, body: "{}",
    }).catch(() => null);
    if (snapshot?.active) {
      return Response.json(
        { name: snapshot.name || snapshot.email.split("@")[0] || "AssetLens User", email: snapshot.email, role: snapshot.role },
        { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } },
      );
    }
    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const rows = await supabaseRest<ProfileRow[]>(
      `app_users?select=email,name,role,active&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
      token,
    );
    const profile = rows[0];
    if (!profile) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });
    return Response.json(
      { name: profile.name || profile.email.split("@")[0] || "AssetLens User", email: profile.email || user.email, role: profile.role },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the signed-in account." }, { status: 500 });
  }
}
