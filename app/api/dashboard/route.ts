import { requestToken, supabaseRest, supabaseRestAll, supabaseRestWithCount, verifyAuthUser } from "../../lib/server/supabase";
import { hasModuleAccess } from "../../lib/server/module-access";

export const runtime = "nodejs";

type ProfileRow = { id: string; email: string; name: string; role: "admin" | "surveyor"; active: boolean };
type ProjectRow = { id: string; name: string };
type ActivityRow = { created_at: string };
type ProjectAssetRow = { project_id: string };
type CriticalitySnapshot = {
  weightedIssuePercent: number;
  problemWeight: number;
  totalWeight: number;
  problemAssets: number;
  totalAssets: number;
  distribution: Array<{ rating: number; weight: number; count: number }>;
};
type DashboardSnapshot = {
  currentUser?: { name: string; email: string; role: "admin" | "surveyor" } | null;
  metrics: { totalAssets: number; approvedAssets: number; reviewAssets: number; activeQueue: number; failedAssets: number; projects: number; buildings: number; floors: number; zones: number };
  status: { approved: number; review: number; queued: number; processing: number; failed: number };
  health: { qualityScore: number; completionRate: number };
  activity: Array<{ date: string; count: number }>;
  projects: Array<{ id: string; name: string; count: number; percent: number }>;
  criticality?: CriticalitySnapshot;
};

const EMPTY_CRITICALITY: CriticalitySnapshot = {
  weightedIssuePercent: 0, problemWeight: 0, totalWeight: 0, problemAssets: 0, totalAssets: 0,
  distribution: [5, 4, 3, 2, 1].map(rating => ({ rating, weight: rating, count: 0 })),
};

async function countRows(path: string, token: string) {
  return (await supabaseRestWithCount<Array<{ id: string }>>(path, token)).count;
}

function snapshotResponse(snapshot: DashboardSnapshot, currentUser: NonNullable<DashboardSnapshot["currentUser"]>, criticality: CriticalitySnapshot = EMPTY_CRITICALITY) {
  return Response.json({
    ...snapshot,
    currentUser,
    criticality,
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

    const params = new URL(request.url).searchParams;
    const uuid = (key: string) => {
      const value = params.get(key)?.trim() || "";
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
    };
    const filterBody = {
      target_project_id: uuid("project"), target_building_id: uuid("building"),
      target_floor_id: uuid("floor"), target_zone_id: uuid("zone"), date_from: null, date_to: null,
    };
    const hasFilters = Object.values(filterBody).some(Boolean);
    const criticalityPromise = supabaseRest<CriticalitySnapshot>("rpc/assetlens_criticality_snapshot", token, {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        target_project_id: filterBody.target_project_id,
        target_building_id: filterBody.target_building_id,
        target_floor_id: filterBody.target_floor_id,
        target_zone_id: filterBody.target_zone_id,
      }),
    }).catch(() => EMPTY_CRITICALITY);
    if (hasFilters) {
      const [filtered, criticality] = await Promise.all([
        supabaseRest<DashboardSnapshot>("rpc/assetlens_dashboard_filtered", token, {
          method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(filterBody),
        }).catch(error => { throw new Error(`Dashboard filters require migration 008_global_product_upgrade.sql. ${error instanceof Error ? error.message : ""}`.trim()); }),
        criticalityPromise,
      ]);
      if (filtered?.currentUser && filtered.metrics && Array.isArray(filtered.activity)) return snapshotResponse(filtered, filtered.currentUser, criticality);
    }

    // R14 migration returns the profile and all dashboard aggregates in one
    // RLS-aware database call. Keep the older path as a safe migration fallback.
    const [snapshot, criticality] = await Promise.all([
      supabaseRest<DashboardSnapshot>("rpc/assetlens_dashboard_snapshot", token, {
        method: "POST", headers: { Prefer: "return=representation" }, body: "{}",
      }).catch(() => null),
      criticalityPromise,
    ]);
    if (snapshot?.currentUser && snapshot.metrics && Array.isArray(snapshot.activity)) {
      return snapshotResponse(snapshot, snapshot.currentUser, criticality);
    }

    const user = await verifyAuthUser(token);
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (!await hasModuleAccess(token, user.id, "dashboard")) return Response.json({ error: "Dashboard access is not allowed for this account." }, { status: 403 });

    const profiles = await supabaseRest<ProfileRow[]>(
      `app_users?select=id,email,name,role,active&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
      token,
    );
    const profile = profiles[0];
    if (!profile) return Response.json({ error: "This account is disabled or unauthorized." }, { status: 403 });

    if (snapshot?.metrics && Array.isArray(snapshot.activity)) {
      return snapshotResponse(snapshot, { name: profile.name || profile.email.split("@")[0], email: profile.email, role: profile.role }, criticality);
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
      supabaseRestAll<ActivityRow>(`assets?select=created_at&created_at=gte.${encodeURIComponent(activityStart.toISOString())}&order=created_at.asc`, token),
      supabaseRestAll<ProjectAssetRow>("assets?select=project_id", token),
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
      criticality,
      activity,
      projects: projectCounts.sort((a, b) => b.count - a.count).map(project => ({ ...project, percent: Math.round((project.count / largestProjectCount) * 100) })),
    }, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the dashboard." }, { status: 500 });
  }
}
