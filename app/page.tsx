"use client";

import Link from "next/link";
import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError } from "./lib/api-client";

type DashboardData = {
  currentUser: { name: string; email: string; role: "admin" | "surveyor" };
  metrics: { totalAssets: number; approvedAssets: number; reviewAssets: number; activeQueue: number; failedAssets: number; projects: number; buildings: number; floors: number; zones: number };
  status: { approved: number; review: number; queued: number; processing: number; failed: number };
  health: { qualityScore: number; completionRate: number };
  activity: Array<{ date: string; label: string; count: number }>;
  projects: Array<{ id: string; name: string; count: number; percent: number }>;
  error?: string;
};

function SparkIcon({ name }: { name: "assets" | "approved" | "review" | "queue" }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "assets") return <svg {...props}><path d="M5 7h14v13H5zM9 7V4h6v3M9 12h6M9 16h4"/></svg>;
  if (name === "approved") return <svg {...props}><path d="m5 13 4 4L19 7"/><circle cx="12" cy="12" r="9"/></svg>;
  if (name === "review") return <svg {...props}><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.8 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/></svg>;
  return <svg {...props}><path d="M4 12a8 8 0 1 0 8-8M4 4v5h5"/><path d="M12 8v5l3 2"/></svg>;
}

function ActivityChart({ points }: { points: DashboardData["activity"] }) {
  const max = Math.max(1, ...points.map(point => point.count));
  const coordinates = points.map((point, index) => ({ x: 34 + index * 91, y: 176 - (point.count / max) * 128 }));
  const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const area = `${line} L${coordinates.at(-1)?.x || 580} 194 L34 194 Z`;
  return <div className="dash-chart-wrap">
    <svg viewBox="0 0 620 220" role="img" aria-label="نشاط إضافة الأصول خلال آخر سبعة أيام">
      <defs><linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b8aa" stopOpacity=".28"/><stop offset="1" stopColor="#10b8aa" stopOpacity=".02"/></linearGradient></defs>
      {[48,91,134,177].map(y => <path key={y} className="dash-grid-line" d={`M24 ${y}H600`}/>) }
      <path className="dash-area" d={area}/><path className="dash-line" d={line}/>
      {coordinates.map((point, index) => <g key={points[index].date}><circle cx={point.x} cy={point.y} r="5"/><text x={point.x} y="213" textAnchor="middle">{points[index].label}</text><title>{points[index].count} أصل</title></g>)}
    </svg>
  </div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = useCallback(async (force = false) => {
    setError("");
    if (force) setRefreshing(true);
    try {
      const payload = await apiGet<DashboardData>("/api/dashboard", { ttlMs: 20_000, force });
      setData(payload);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      setError(reason instanceof Error ? reason.message : "تعذر تحميل لوحة التحكم.");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const totalStatus = useMemo(() => data ? Object.values(data.status).reduce((sum, value) => sum + value, 0) : 0, [data]);

  return <section className="al-page dashboard-page">
    <header className="al-page-head">
      <div><span className="al-page-kicker">Asset intelligence</span><h2>{data ? `مرحبًا، ${data.currentUser.name}` : "لوحة متابعة الأصول"}</h2><p>صورة تشغيلية سريعة لجودة البيانات، نشاط التحليل، والمشاريع—بدون تحميل سجل الأصول كاملًا.</p></div>
      <div className="al-page-actions"><button className="al-secondary-button" disabled={refreshing} onClick={() => void loadDashboard(true)}>{refreshing ? "جاري التحديث…" : "تحديث البيانات"}</button><Link className="al-secondary-button" href="/reports">فتح التقارير</Link><Link className="al-primary-button" href="/capture">＋ التقاط أصل جديد</Link></div>
    </header>
    {error && <div className="al-alert" role="alert">{error} <button onClick={() => void loadDashboard(true)}>إعادة المحاولة</button></div>}
    {!data && !error ? <div className="al-loading-grid" aria-label="جاري تحميل لوحة التحكم"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data && <>
      <div className="dashboard-metrics">
        {[
          { label:"إجمالي الأصول", value:data.metrics.totalAssets, hint:`${data.metrics.projects} مشاريع متاحة`, icon:"assets" as const, tone:"navy" },
          { label:"الأصول المعتمدة", value:data.metrics.approvedAssets, hint:`${data.health.qualityScore}% جودة السجل`, icon:"approved" as const, tone:"green" },
          { label:"تحتاج مراجعة", value:data.metrics.reviewAssets, hint:data.metrics.failedAssets ? `${data.metrics.failedAssets} عمليات فاشلة` : "لا توجد أخطاء حرجة", icon:"review" as const, tone:"amber" },
          { label:"خط المعالجة", value:data.metrics.activeQueue, hint:data.status.processing ? `${data.status.processing} قيد التحليل الآن` : "الطابور مستقر", icon:"queue" as const, tone:"teal" },
        ].map(metric => <article className={`dashboard-metric ${metric.tone}`} key={metric.label}><span><SparkIcon name={metric.icon}/></span><div><small>{metric.label}</small><strong>{metric.value.toLocaleString("ar-AE")}</strong><em>{metric.hint}</em></div></article>)}
      </div>
      <div className="dashboard-main-grid">
        <article className="al-card dash-activity-card"><div className="al-card-head"><div><h3>نشاط الالتقاط والتحليل</h3><p>عدد الأصول المضافة خلال آخر سبعة أيام</p></div><span className="dash-live"><i/> بيانات مباشرة</span></div><ActivityChart points={data.activity}/></article>
        <article className="al-card dash-quality-card"><div className="al-card-head"><div><h3>جودة السجل</h3><p>جاهزية البيانات للمراجعة والتسليم</p></div></div><div className="dash-quality-body"><div className="dash-quality-ring" style={{ "--quality": `${data.health.qualityScore * 3.6}deg` } as CSSProperties}><strong>{data.health.qualityScore}%</strong><span>جودة البيانات</span></div><div className="dash-status-list">
          {[{key:"approved",label:"معتمدة",value:data.status.approved},{key:"review",label:"مراجعة",value:data.status.review},{key:"queued",label:"انتظار",value:data.status.queued},{key:"failed",label:"فشل",value:data.status.failed}].map(item => <div key={item.key}><span><i className={item.key}/>{item.label}</span><strong>{item.value}</strong><em><b style={{ width:`${totalStatus ? Math.max(3,(item.value/totalStatus)*100) : 0}%` }}/></em></div>)}
        </div></div></article>
      </div>
      <div className="dashboard-lower-grid">
        <article className="al-card dash-projects-card"><div className="al-card-head"><div><h3>توزيع الأصول على المشاريع</h3><p>مقارنة سريعة لحجم السجل في كل مشروع</p></div><Link href="/organization">عرض الهيكل</Link></div><div className="dash-project-bars">{data.projects.length ? data.projects.map(project => <div key={project.id}><div><span>{project.name}</span><strong>{project.count}</strong></div><i><b style={{ width:`${project.percent}%` }}/></i></div>) : <p>لا توجد أصول موزعة على مشاريع حتى الآن.</p>}</div></article>
        <article className="al-card dash-locations-card"><div className="al-card-head"><div><h3>تغطية المواقع</h3><p>الهيكل المتاح لحسابك الحالي</p></div><Link href="/locations">فتح المواقع</Link></div><div className="dash-location-stats"><div><strong>{data.metrics.projects}</strong><span>مشروع</span></div><div><strong>{data.metrics.buildings}</strong><span>مبنى</span></div><div><strong>{data.metrics.floors}</strong><span>طابق</span></div><div><strong>{data.metrics.zones}</strong><span>زون</span></div></div><div className="dash-completion"><span>اكتمال المعالجة <b>{data.health.completionRate}%</b></span><i><b style={{ width:`${data.health.completionRate}%` }}/></i></div></article>
      </div>
    </>}
  </section>;
}
