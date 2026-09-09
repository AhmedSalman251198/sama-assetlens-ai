"use client";

import Link from "next/link";
import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError } from "./lib/api-client";
import { ASSET_CRITICALITY_LEVELS } from "./lib/asset-criticality";

type DashboardData = {
  currentUser: { name: string; email: string; role: "admin" | "surveyor" };
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

function CriticalityRadialChart({ distribution }: { distribution: DashboardData["criticality"]["distribution"] }) {
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
  return <div className="dash-criticality-radial"><div className="radial-chart"><svg viewBox="0 0 180 180" role="img" aria-label="عدد الأصول في كل مستوى أهمية"><circle className="radial-track" cx="90" cy="90" r={radius}/>{segments.map(({ level, count, length, dashOffset }) => <circle className="radial-segment" key={level.rating} cx="90" cy="90" r={radius} stroke={colors[level.rating]} strokeDasharray={`${length} ${Math.max(0, circumference - length)}`} strokeDashoffset={dashOffset}><title>{level.labelAr}: {count} أصل</title></circle>)}</svg><div><strong>{total.toLocaleString("ar-AE")}</strong><span>إجمالي الأصول</span></div></div><div className="radial-legend">{[...ASSET_CRITICALITY_LEVELS].reverse().map(level => { const count = countByRating.get(level.rating) || 0; return <Link href={`/reports?criticality=${level.rating}`} className={`criticality-${level.rating}`} key={level.rating}><i style={{ background: colors[level.rating] }}/><span>{level.labelAr}<small>وزن {level.weight}</small></span><strong>{count.toLocaleString("ar-AE")}</strong></Link>; })}</div></div>;
}

export default function DashboardPage() {
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
  const criticality = data?.criticality || { weightedIssuePercent: 0, problemWeight: 0, totalWeight: 0, problemAssets: 0, totalAssets: 0, distribution: [] };
  const criticalityByRating = new Map(criticality.distribution.map(item => [item.rating, item.count]));

  return <section className="al-page dashboard-page">
    <header className="al-page-head">
      <div><span className="al-page-kicker">Asset intelligence</span><h2>{data ? `مرحبًا، ${data.currentUser.name}` : "لوحة متابعة الأصول"}</h2><p>صورة تشغيلية سريعة لجودة البيانات، نشاط التحليل، والمشاريع—بدون تحميل سجل الأصول كاملًا.</p></div>
      <div className="al-page-actions"><button className="al-secondary-button" disabled={refreshing} onClick={() => void loadDashboard(true)}>{refreshing ? "جاري التحديث…" : "تحديث البيانات"}</button><Link className="al-secondary-button" href="/reports">فتح التقارير</Link><Link className="al-primary-button" href="/capture">＋ التقاط أصل جديد</Link></div>
    </header>
    {data?.currentUser.role === "admin" && structure && <section className="dashboard-filters" aria-label="فلاتر لوحة التحكم">
      <div><strong>تصفية لوحة التحكم</strong><small>كل الأرقام والرسوم تتغير حسب الاختيار</small></div>
      <select aria-label="المشروع أو الفرع" value={filters.project} onChange={event => setFilters({ project: event.target.value, building: "", floor: "", zone: "" })}><option value="">كل المشاريع / الفروع</option>{structure.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label="المبنى" value={filters.building} disabled={!filterProject} onChange={event => setFilters(current => ({ ...current, building: event.target.value, floor: "", zone: "" }))}><option value="">كل المباني</option>{filterProject?.buildings.map(building => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
      <select aria-label="الطابق" value={filters.floor} disabled={!filterBuilding} onChange={event => setFilters(current => ({ ...current, floor: event.target.value, zone: "" }))}><option value="">كل الطوابق</option>{filterBuilding?.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select>
      <select aria-label="الزون" value={filters.zone} disabled={!filterBuilding} onChange={event => setFilters(current => ({ ...current, zone: event.target.value }))}><option value="">كل الزونات</option>{filterZones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select>
      {Object.values(filters).some(Boolean) && <button className="al-secondary-button" onClick={() => setFilters({ project: "", building: "", floor: "", zone: "" })}>مسح الفلاتر</button>}
    </section>}
    {error && <div className="al-alert" role="alert">{error} <button onClick={() => void loadDashboard(true)}>إعادة المحاولة</button></div>}
    {!data && !error ? <div className="al-loading-grid" aria-label="جاري تحميل لوحة التحكم"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data && <>
      <div className="dashboard-metrics">
        {[
          { label:"إجمالي الأصول", value:data.metrics.totalAssets, hint:`${data.metrics.projects} مشاريع متاحة`, icon:"assets" as const, tone:"navy" },
          { label:"الأصول المعتمدة", value:data.metrics.approvedAssets, hint:`${data.health.qualityScore}% جودة السجل`, icon:"approved" as const, tone:"green" },
          { label:"تحتاج مراجعة", value:data.metrics.reviewAssets, hint:data.metrics.failedAssets ? `${data.metrics.failedAssets} عمليات فاشلة` : "لا توجد أخطاء حرجة", icon:"review" as const, tone:"amber" },
          { label:"خط المعالجة", value:data.metrics.activeQueue, hint:data.status.processing ? `${data.status.processing} قيد التحليل الآن` : "الطابور مستقر", icon:"queue" as const, tone:"teal" },
          { label:"الأصول الحرجة", value:criticalityByRating.get(5) || 0, hint:`${criticalityByRating.get(4) || 0} أصول عالية الأهمية`, icon:"critical" as const, tone:"red" },
        ].map(metric => <article className={`dashboard-metric ${metric.tone}`} key={metric.label}><span><SparkIcon name={metric.icon}/></span><div><small>{metric.label}</small><strong>{metric.value.toLocaleString("ar-AE")}</strong><em>{metric.hint}</em></div></article>)}
      </div>
      <div className="dashboard-main-grid">
        <article className="al-card dash-activity-card"><div className="al-card-head"><div><h3>توزيع أهمية الأصول</h3><p>رسم شعاعي يوضح عدد الأصول في كل مستوى Criticality</p></div><span className="dash-live"><i/> بيانات مباشرة</span></div><CriticalityRadialChart distribution={criticality.distribution}/></article>
        <article className="al-card dash-quality-card"><div className="al-card-head"><div><h3>جودة السجل</h3><p>جاهزية البيانات للمراجعة والتسليم</p></div></div><div className="dash-quality-body"><div className="dash-quality-ring" style={{ "--quality": `${data.health.qualityScore * 3.6}deg` } as CSSProperties}><strong>{data.health.qualityScore}%</strong><span>جودة البيانات</span></div><div className="dash-status-list">
          {[{key:"approved",label:"معتمدة",value:data.status.approved},{key:"review",label:"مراجعة",value:data.status.review},{key:"queued",label:"انتظار",value:data.status.queued},{key:"failed",label:"فشل",value:data.status.failed}].map(item => <div key={item.key}><span><i className={item.key}/>{item.label}</span><strong>{item.value}</strong><em><b style={{ width:`${totalStatus ? Math.max(3,(item.value/totalStatus)*100) : 0}%` }}/></em></div>)}
        </div></div></article>
      </div>
      <div className="dashboard-lower-grid">
        <article className="al-card dash-criticality-card"><div className="al-card-head"><div><h3>تأثير حالة الأصول حسب الأهمية</h3><p>النسبة الموزونة تعطي الأصل الحرج تأثيراً أكبر من الأصل منخفض الأهمية</p></div></div><div className="weighted-summary"><div className="weighted-summary-score"><strong>{criticality.weightedIssuePercent}%</strong><span>تأثير الأعطال الموزون</span></div><dl><div><dt>أصول حالتها حرجة أو ضعيفة</dt><dd>{criticality.problemAssets.toLocaleString("ar-AE")}</dd></div><div><dt>وزن المشكلة</dt><dd>{criticality.problemWeight.toLocaleString("ar-AE")}</dd></div><div><dt>إجمالي وزن الأصول</dt><dd>{criticality.totalWeight.toLocaleString("ar-AE")}</dd></div></dl></div><footer className="weighted-impact-note">يتغير المؤشر تلقائياً عند اختيار مشروع أو مبنى أو طابق أو زون من الفلاتر.</footer></article>
        <article className="al-card dash-projects-card"><div className="al-card-head"><div><h3>توزيع الأصول على المشاريع</h3><p>مقارنة سريعة لحجم السجل في كل مشروع</p></div><Link href="/organization">عرض الهيكل</Link></div><div className="dash-project-bars">{data.projects.length ? data.projects.map(project => <div key={project.id}><div><span>{project.name}</span><strong>{project.count}</strong></div><i><b style={{ width:`${project.percent}%` }}/></i></div>) : <p>لا توجد أصول موزعة على مشاريع حتى الآن.</p>}</div></article>
        <article className="al-card dash-locations-card"><div className="al-card-head"><div><h3>تغطية المواقع</h3><p>الهيكل المتاح لحسابك الحالي</p></div><Link href="/locations">فتح المواقع</Link></div><div className="dash-location-stats"><div><strong>{data.metrics.projects}</strong><span>مشروع</span></div><div><strong>{data.metrics.buildings}</strong><span>مبنى</span></div><div><strong>{data.metrics.floors}</strong><span>طابق</span></div><div><strong>{data.metrics.zones}</strong><span>زون</span></div></div><div className="dash-completion"><span>اكتمال المعالجة <b>{data.health.completionRate}%</b></span><i><b style={{ width:`${data.health.completionRate}%` }}/></i></div></article>
      </div>
    </>}
  </section>;
}
