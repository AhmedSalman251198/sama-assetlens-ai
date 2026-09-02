import { requestToken, supabaseRest, supabaseRestWithCount, verifyAuthUser } from "../../lib/server/supabase";

export const runtime = "nodejs";

type ProfileRow = { id: string; email: string; name: string; role: "admin" | "surveyor"; active: boolean };
type ProjectRow = { id: string; name: string };
type ActivityRow = { created_at: string };
type ProjectAssetRow = { project_id: string };
type DashboardSnapshot = {
  currentUser?: { name: string; email: string; role: "admin" | "surveyor" } | null;
  metrics: { totalAssets: number; approvedAssets: number; reviewAssets: number; activeQueue: number; failedAssets: number; projects: number; buildings: number; floors: number; zones: number };
  status: { approved: number; review: number; queued: number; processing: number; failed: number };
  health: { qualityScore: number; completionRate: number };
  activity: Array<{ date: string; count: number }>;
  projects: Array<{ id: string; name: string; count: number; percent: number }>;
};

async function countRows(path: string, token: string) {
  return (await supabaseRestWithCount<Array<{ id: string }>>(path, token)).count;
}

function snapshotResponse(snapshot: DashboardSnapshot, currentUser: NonNullable<DashboardSnapshot["currentUser"]>) {
  return Response.json({
    ...snapshot,
    currentUser,
    activity: snapshot.activity.map(item => ({
      ...item,
      label: new Intl.DateTimeFormat("ar-AE", { weekday: "short", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`)),
    })),
  }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
}

export async function GET(request: Request) {
  try {
    const token = requestToken(request);
    if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });

    // R14 migration returns the profile and all dashboard aggregates in one
    // RLS-aware database call. Keep the older path as a safe migration fallback.
    const snapshot = await supabaseRest<DashboardSnapshot>("rpc/assetlens_dashboard_snapshot", token, {
      method: "POST", headers: { Prefer: "return=representation" }, body: "{}",
    }).catch(() => null);
    if (snapshot?.currentUser && snapshot.metrics && Array.isArray(snapshot.activity)) {
      return snapshotResponse(snapshot, snapshot.currentUser);
    }

    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

    const profiles = await supabaseRest<ProfileRow[]>(
      `app_users?select=id,email,name,role,active&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
      token,
    );
    const profile = profiles[0];
    if (!profile) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });

    if (snapshot?.metrics && Array.isArray(snapshot.activity)) {
      return snapshotResponse(snapshot, { name: profile.name || profile.email.split("@")[0], email: profile.email, role: profile.role });
    }

    const activityStart = new Date();
    activityStart.setUTCHours(0, 0, 0, 0);
    activityStart.setUTCDate(activityStart.getUTCDate() - 6);

    const [
      projects, totalAssets, approvedAssets, reviewAssets, queuedAssets, processingAssets, failedAssets,
      buildingCount, floorCount, zoneCount, activityRows, projectAssetRows,
    ] = await Promise.all([
      supabaseRest<ProjectRow[]>("projects?select=id,name&active=eq.true&order=name&limit=100", token),
      countRows("assets?select=id", token),
      countRows("assets?select=id&status=eq.completed", token),
      countRows("assets?select=id&status=eq.review", token),
      countRows("assets?select=id&status=eq.queued", token),
      countRows("assets?select=id&status=eq.processing", token),
      countRows("assets?select=id&status=eq.failed", token),
      countRows("buildings?select=id&active=eq.true", token),
      countRows("floors?select=id", token),
      countRows("zones?select=id", token),
      supabaseRest<ActivityRow[]>(`assets?select=created_at&created_at=gte.${encodeURIComponent(activityStart.toISOString())}&order=created_at.asc&limit=5000`, token),
      supabaseRest<ProjectAssetRow[]>("assets?select=project_id&limit=10000", token),
    ]);

    const countsByProject = new Map<string, number>();
    for (const asset of projectAssetRows) countsByProject.set(asset.project_id, (countsByProject.get(asset.project_id) || 0) + 1);
    const projectCounts = projects.slice(0, 12).map(project => ({ id: project.id, name: project.name, count: countsByProject.get(project.id) || 0 }));
    const largestProjectCount = Math.max(1, ...projectCounts.map(project => project.count));

    const countsByDay = new Map<string, number>();
    for (const asset of activityRows) { const day = asset.created_at.slice(0, 10); countsByDay.set(day, (countsByDay.get(day) || 0) + 1); }
    const activity = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(activityStart);
      day.setUTCDate(day.getUTCDate() + index);
      const date = day.toISOString().slice(0, 10);
      return {
        date,
        label: new Intl.DateTimeFormat("ar-AE", { weekday: "short", timeZone: "UTC" }).format(day),
        count: countsByDay.get(date) || 0,
      };
    });

    const activeQueue = queuedAssets + processingAssets;
    const qualityScore = totalAssets > 0 ? Math.round((approvedAssets / totalAssets) * 100) : 100;
    const completionRate = totalAssets > 0 ? Math.round(((approvedAssets + reviewAssets) / totalAssets) * 100) : 0;

    return Response.json({
      currentUser: { name: profile.name || profile.email.split("@")[0], email: profile.email, role: profile.role },
      metrics: {
        totalAssets,
        approvedAssets,
        reviewAssets,
        activeQueue,
        failedAssets,
        projects: projects.length,
        buildings: buildingCount,
        floors: floorCount,
        zones: zoneCount,
      },
      status: { approved: approvedAssets, review: reviewAssets, queued: queuedAssets, processing: processingAssets, failed: failedAssets },
      health: { qualityScore, completionRate },
      activity,
      projects: projectCounts.sort((a, b) => b.count - a.count).map(project => ({ ...project, percent: Math.round((project.count / largestProjectCount) * 100) })),
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the dashboard." }, { status: 500 });
  }
}
