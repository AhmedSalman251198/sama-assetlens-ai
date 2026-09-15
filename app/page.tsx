"use client";

import Link from "next/link";
import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError } from "./lib/api-client";
import { assetListHref, type AssetListFilters } from "./lib/asset-list-filters";
import { ASSET_CRITICALITY_LEVELS } from "./lib/asset-criticality";
import { languageText, useUiLanguage } from "./lib/use-ui-language";
import type { UiLanguage } from "./lib/ui-preferences";

type DashboardData = {
  currentUser: { name: string; email: string; role: "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer" };
  metrics: { totalAssets: number; approvedAssets: number; reviewAssets: number; activeQueue: number; failedAssets: number; projects: number; buildings: number; floors: number; zones: number };
  status: { approved: number; review: number; queued: number; processing: number; failed: number };
  health: { qualityScore: number; completionRate: number };
  activity: Array<{ date: string; label: string; count: number }>;
  projects: Array<{ id: string; name: string; count: number; percent: number }>;
  criticality: { weightedIssuePercent: number; problemWeight: number; totalWeight: number; problemAssets: number; totalAssets: number; distribution: Array<{ rating: number; weight: number; count: number }> };
  error?: string;
};
type DashboardStructure = { projects: Array<{ id: string; name: string; buildings: Array<{ id: string; name: string; floors: Array<{ id: string; name: string }>; zones: Array<{ id: string; name: string; floorId: string | null }> }> }> };

function SparkIcon({ name }: { name: "assets" | "approved" | "review" | "queue" | "critical" }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "assets") return <svg {...props}><path d="M5 7h14v13H5zM9 7V4h6v3M9 12h6M9 16h4"/></svg>;
  if (name === "approved") return <svg {...props}><path d="m5 13 4 4L19 7"/><circle cx="12" cy="12" r="9"/></svg>;
  if (name === "review") return <svg {...props}><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.8 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/></svg>;
  if (name === "critical") return <svg {...props}><path d="M12 3 3.5 7v5.5c0 4.7 3.5 7.5 8.5 8.5 5-1 8.5-3.8 8.5-8.5V7L12 3Z"/><path d="M12 8v5M12 16.5h.01"/></svg>;
  return <svg {...props}><path d="M4 12a8 8 0 1 0 8-8M4 4v5h5"/><path d="M12 8v5l3 2"/></svg>;
}

function CriticalityRadialChart({ distribution, language, scope }: { distribution: DashboardData["criticality"]["distribution"]; language: UiLanguage; scope: Partial<AssetListFilters> }) {
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const countByRating = new Map(distribution.map(item => [item.rating, item.count]));
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  const colors: Record<number, string> = { 5: "#c93636", 4: "#ec7d23", 3: "#e0b225", 2: "#2d9f83", 1: "#7998a6" };
  const segments = [...ASSET_CRITICALITY_LEVELS].reverse().map(level => {
    const count = countByRating.get(level.rating) || 0;
    const length = total ? (count / total) * circumference : 0;
    const precedingCount = [...ASSET_CRITICALITY_LEVELS].reverse().slice(0, 5 - level.rating).reduce((sum, previous) => sum + (countByRating.get(previous.rating) || 0), 0);
    return { level, count, length, dashOffset: total ? -(precedingCount / total) * circumference : 0 };
  });
  return <div className="dash-criticality-radial"><div className="radial-chart"><svg viewBox="0 0 180 180" role="img" aria-label={language === "ar" ? "عدد الأصول في كل مستوى أهمية" : "Asset count by criticality level"}><circle className="radial-track" cx="90" cy="90" r={radius}/>{segments.map(({ level, count, length, dashOffset }) => <circle className="radial-segment" key={level.rating} cx="90" cy="90" r={radius} stroke={colors[level.rating]} strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={dashOffset}><title>{language === "ar" ? level.labelAr : level.labelEn}: {count}</title></circle>)}</svg><div><strong>{total.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</strong><span>{language === "ar" ? "إجمالي الأصول" : "Total assets"}</span></div></div><div className="radial-legend">{[...ASSET_CRITICALITY_LEVELS].reverse().map(level => { const count = countByRating.get(level.rating) || 0; return <Link href={assetListHref(scope, { criticality: String(level.rating) })} className={`criticality-${level.rating}`} key={level.rating}><i style={{ background: colors[level.rating] }}/><span>{language === "ar" ? level.labelAr : level.labelEn}<small>{language === "ar" ? "وزن" : "Weight"} {level.weight}</small></span><strong>{count.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</strong></Link>; })}</div></div>;
}

export default function DashboardPage() {
  const language = useUiLanguage();
  const l = (ar: string, en: string) => languageText(language, ar, en);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [structure, setStructure] = useState<DashboardStructure | null>(null);
  const [filters, setFilters] = useState({ project: "", building: "", floor: "", zone: "" });

  const loadDashboard = useCallback(async (force = false) => {
    setError("");
    if (force) setRefreshing(true);
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const payload = await apiGet<DashboardData>(`/api/dashboard${params.size ? `?${params}` : ""}`, { ttlMs: 20_000, force });
      setData(payload);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      setError(reason instanceof Error ? reason.message : "تعذر تحميل لوحة التحكم.");
    } finally { setRefreshing(false); }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 120);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    let active = true;
    apiGet<DashboardStructure>("/api/config?scope=structure", { ttlMs: 60_000 }).then(payload => { if (active) setStructure(payload); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const totalStatus = useMemo(() => data ? Object.values(data.status).reduce((sum, value) => sum + value, 0) : 0, [data]);
  const filterProject = structure?.projects.find(project => project.id === filters.project);
  const filterBuilding = filterProject?.buildings.find(building => building.id === filters.building);
  const filterZones = filterBuilding?.zones.filter(zone => !filters.floor || !zone.floorId || zone.floorId === filters.floor) || [];
  const assetListScope = { project: filters.project, building: filters.building, floor: filters.floor, zone: filters.zone };
  const criticality = data?.criticality || { weightedIssuePercent: 0, problemWeight: 0, totalWeight: 0, problemAssets: 0, totalAssets: 0, distribution: [] };
  const criticalityByRating = new Map(criticality.distribution.map(item => [item.rating, item.count]));

  return <section className="al-page dashboard-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="al-page-head">
      <div><span className="al-page-kicker">Asset intelligence</span><h2>{data ? l(`مرحبًا، ${data.currentUser.name}`, `Welcome, ${data.currentUser.name}`) : l("لوحة متابعة الأصول", "Asset intelligence dashboard")}</h2><p>{l("صورة تشغيلية سريعة لجودة البيانات، نشاط التحليل، والمشاريع—بدون تحميل سجل الأصول كاملًا.", "A fast operational view of data quality, analysis activity and projects without loading the full register.")}</p></div>
      <div className="al-page-actions"><button className="al-secondary-button" disabled={refreshing} onClick={() => void loadDashboard(true)}>{refreshing ? l("جاري التحديث…", "Refreshing…") : l("تحديث البيانات", "Refresh")}</button><Link className="al-secondary-button" href="/reports">{l("فتح التقارير", "Open reports")}</Link><Link className="al-primary-button" href="/capture">＋ {l("التقاط أصل جديد", "Capture asset")}</Link></div>
    </header>
    {data && structure && <section className="dashboard-filters" aria-label={l("فلاتر لوحة التحكم", "Dashboard filters")}>
      <div><strong>{l("تصفية لوحة التحكم", "Dashboard filters")}</strong><small>{l("كل الأرقام والرسوم تتغير حسب الاختيار", "All metrics and charts respond to the selection")}</small></div>
      <select aria-label={l("المشروع أو الفرع", "Project or branch")} value={filters.project} onChange={event => setFilters({ project: event.target.value, building: "", floor: "", zone: "" })}><option value="">{l("كل المشاريع / الفروع", "All projects / branches")}</option>{structure.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label={l("المبنى", "Building")} value={filters.building} disabled={!filterProject} onChange={event => setFilters(current => ({ ...current, building: event.target.value, floor: "", zone: "" }))}><option value="">{l("كل المباني", "All buildings")}</option>{filterProject?.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
      <select aria-label={l("الطابق", "Floor")} value={filters.floor} disabled={!filterBuilding} onChange={event => setFilters(current => ({ ...current, floor: event.target.value, zone: "" }))}><option value="">{l("كل الطوابق", "All floors")}</option>{filterBuilding?.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select>
      <select aria-label={l("الزون", "Zone")} value={filters.zone} disabled={!filterBuilding} onChange={event => setFilters(current => ({ ...current, zone: event.target.value }))}><option value="">{l("كل الزونات", "All zones")}</option>{filterZones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select>
      {Object.values(filters).some(Boolean) && <button className="al-secondary-button" onClick={() => setFilters({ project: "", building: "", floor: "", zone: "" })}>{l("مسح الفلاتر", "Clear filters")}</button>}
    </section>}
    {error && <div className="al-alert" role="alert">{error} <button onClick={() => void loadDashboard(true)}>إعادة المحاولة</button></div>}
    {!data && !error ? <div className="al-loading-grid" aria-label={l("جاري تحميل لوحة التحكم", "Loading dashboard")}><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data && <>
      <div className="dashboard-metrics">
        {[
          { label:l("إجمالي الأصول", "Total assets"), value:data.metrics.totalAssets, hint:l(`${data.metrics.projects} مشاريع متاحة`, `${data.metrics.projects} available projects`), icon:"assets" as const, tone:"navy", href: assetListHref(assetListScope) },
          { label:l("الأصول المعتمدة", "Approved assets"), value:data.metrics.approvedAssets, hint:l(`${data.health.qualityScore}% جودة السجل`, `${data.health.qualityScore}% register quality`), icon:"approved" as const, tone:"green", href: assetListHref(assetListScope, { status: "completed" }) },
          { label:l("تحتاج مراجعة", "Needs review"), value:data.metrics.reviewAssets, hint:data.metrics.failedAssets ? l(`${data.metrics.failedAssets} عمليات فاشلة`, `${data.metrics.failedAssets} failed operations`) : l("لا توجد أخطاء حرجة", "No critical errors"), icon:"review" as const, tone:"amber", href: assetListHref(assetListScope, { status: "review" }) },
          { label:l("خط المعالجة", "Processing queue"), value:data.metrics.activeQueue, hint:data.status.processing ? l(`${data.status.processing} قيد التحليل الآن`, `${data.status.processing} processing now`) : l("الطابور مستقر", "Queue is stable"), icon:"queue" as const, tone:"teal", href: assetListHref(assetListScope, { workflow: "active" }) },
          { label:l("الأصول الحرجة", "Critical assets"), value:criticalityByRating.get(5) || 0, hint:l(`${criticalityByRating.get(4) || 0} أصول عالية الأهمية`, `${criticalityByRating.get(4) || 0} high-criticality assets`), icon:"critical" as const, tone:"red", href: assetListHref(assetListScope, { criticality: "5" }) },
        ].map(metric => <Link className={`dashboard-metric ${metric.tone}`} href={metric.href} key={metric.label} aria-label={`${metric.label}: ${metric.value}`}><span><SparkIcon name={metric.icon}/></span><div><small>{metric.label}</small><strong>{metric.value.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</strong><em>{metric.hint}</em></div></Link>)}
      </div>
      <div className="dashboard-main-grid">
        <article className="al-card dash-activity-card"><div className="al-card-head"><div><h3>{l("توزيع أهمية الأصول", "Asset criticality distribution")}</h3><p>{l("رسم شعاعي يوضح عدد الأصول في كل مستوى", "Radial chart showing the number of assets at every criticality level")}</p></div><span className="dash-live"><i/> {l("بيانات مباشرة", "Live data")}</span></div><CriticalityRadialChart distribution={criticality.distribution} language={language} scope={assetListScope}/></article>
        <article className="al-card dash-quality-card"><div className="al-card-head"><div><h3>{l("جودة السجل", "Register quality")}</h3><p>{l("جاهزية البيانات للمراجعة والتسليم", "Data readiness for review and handover")}</p></div></div><div className="dash-quality-body"><div className="dash-quality-ring" style={{ "--quality": `${data.health.qualityScore * 3.6}deg` } as CSSProperties}><strong>{data.health.qualityScore}%</strong><span>{l("جودة البيانات", "Data quality")}</span></div><div className="dash-status-list">
          {[{key:"completed",tone:"approved",label:l("معتمدة", "Approved"),value:data.status.approved},{key:"review",tone:"review",label:l("مراجعة", "Review"),value:data.status.review},{key:"queued",tone:"queued",label:l("انتظار", "Queued"),value:data.status.queued},{key:"failed",tone:"failed",label:l("فشل", "Failed"),value:data.status.failed}].map(item => <Link href={assetListHref(assetListScope, { status: item.key })} key={item.key}><span><i className={item.tone}/>{item.label}</span><strong>{item.value}</strong><em><b style={{ width:`${totalStatus ? Math.max(3,(item.value/totalStatus)*100) : 0}%` }}/></em></Link>)}
        </div></div></article>
      </div>
      <div className="dashboard-lower-grid">
        <article className="al-card dash-criticality-card"><div className="al-card-head"><div><h3>{l("تأثير حالة الأصول حسب الأهمية", "Condition impact weighted by criticality")}</h3><p>{l("النسبة الموزونة تعطي الأصل الحرج تأثيراً أكبر من الأصل منخفض الأهمية", "The weighted ratio gives critical assets more influence than low-criticality assets")}</p></div></div><div className="weighted-summary"><div className="weighted-summary-score"><strong>{criticality.weightedIssuePercent}%</strong><span>{l("تأثير الأعطال الموزون", "Weighted issue impact")}</span></div><dl><div><dt>{l("أصول حالتها حرجة أو ضعيفة", "Assets in critical or poor condition")}</dt><dd>{criticality.problemAssets.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</dd></div><div><dt>{l("وزن المشكلة", "Problem weight")}</dt><dd>{criticality.problemWeight.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</dd></div><div><dt>{l("إجمالي وزن الأصول", "Total asset weight")}</dt><dd>{criticality.totalWeight.toLocaleString(language === "ar" ? "ar-AE" : "en-GB")}</dd></div></dl></div><footer className="weighted-impact-note">{l("يتغير المؤشر تلقائياً عند اختيار مشروع أو مبنى أو طابق أو زون من الفلاتر.", "The index updates automatically when project, building, floor or zone filters change.")}</footer></article>
        <article className="al-card dash-projects-card"><div className="al-card-head"><div><h3>{l("توزيع الأصول على المشاريع", "Assets by project")}</h3><p>{l("مقارنة سريعة لحجم السجل في كل مشروع", "A quick comparison of register size by project")}</p></div><Link href="/organization">{l("عرض الهيكل", "View structure")}</Link></div><div className="dash-project-bars">{data.projects.length ? data.projects.map(project => <div key={project.id}><div><span>{project.name}</span><strong>{project.count}</strong></div><i><b style={{ width:`${project.percent}%` }}/></i></div>) : <p>{l("لا توجد أصول موزعة على مشاريع حتى الآن.", "No assets have been assigned to projects yet.")}</p>}</div></article>
        <article className="al-card dash-locations-card"><div className="al-card-head"><div><h3>{l("تغطية المواقع", "Location coverage")}</h3><p>{l("الهيكل المتاح لحسابك الحالي", "Structure available to your account")}</p></div><Link href="/locations">{l("إدارة الأصول", "Manage assets")}</Link></div><div className="dash-location-stats"><div><strong>{data.metrics.projects}</strong><span>{l("مشروع", "Projects")}</span></div><div><strong>{data.metrics.buildings}</strong><span>{l("مبنى", "Buildings")}</span></div><div><strong>{data.metrics.floors}</strong><span>{l("طابق", "Floors")}</span></div><div><strong>{data.metrics.zones}</strong><span>{l("زون", "Zones")}</span></div></div><div className="dash-completion"><span>{l("اكتمال المعالجة", "Processing completion")} <b>{data.health.completionRate}%</b></span><i><b style={{ width:`${data.health.completionRate}%` }}/></i></div></article>
      </div>
    </>}
  </section>;
}
