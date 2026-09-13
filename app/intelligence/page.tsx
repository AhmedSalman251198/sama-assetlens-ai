"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, invalidateApiCache } from "../lib/api-client";
import { assetRiskScore, type AssetDependency, type IntelligenceAsset } from "../lib/asset-intelligence";
import { getAccessToken } from "../lib/supabase-auth";
import { languageText, useUiLanguage } from "../lib/use-ui-language";

type Permission = { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
type Twin = { building: string; assetCount: number; riskScore: number; locations: Array<{ location: string; assetCount: number; riskScore: number; assets: IntelligenceAsset[] }> };
type IntelligencePayload = { projects: Array<{ id: string; name: string }>; projectId: string; assets: IntelligenceAsset[]; dependencies: AssetDependency[]; scenarios: Array<{ id: string; name: string; annual_budget: number; horizon_years: number }>; twin: Twin[]; permissions?: Permission };
type Simulation = { years: Array<{ year: number; budget: number; spend: number; remaining: number; assets: Array<IntelligenceAsset & { riskScore: number; cost: number }> }>; deferred: Array<IntelligenceAsset & { riskScore: number; cost: number }>; totalBudget: number; plannedSpend: number; addressedRisk: number };
type Answer = { summary: string; matches: IntelligenceAsset[]; totalMatches: number; totalRisk: number; mode: "ai" | "register_search"; citations: string[]; limitation: string };

export default function AssetIntelligencePage() {
  const language = useUiLanguage(); const l = (ar: string, en: string) => languageText(language, ar, en);
  const [data, setData] = useState<IntelligencePayload | null>(null); const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<"twin" | "graph" | "capital" | "ask">("twin"); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [upstream, setUpstream] = useState(""); const [downstream, setDownstream] = useState(""); const [dependencyType, setDependencyType] = useState("supplies"); const [impact, setImpact] = useState("high"); const [impactRows, setImpactRows] = useState<Array<{ assetId: string; depth: number; impact: string; via: string }>>([]);
  const [budget, setBudget] = useState("500000"); const [horizon, setHorizon] = useState("5"); const [scenarioName, setScenarioName] = useState(""); const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<Answer | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const loadRequestRef = useRef(0);

  async function load(nextProject = "") {
    const requestId = ++loadRequestRef.current;
    if (nextProject) setProjectId(nextProject);
    setProjectLoading(true);
    try {
      const payload = await apiGet<IntelligencePayload>(`/api/intelligence${nextProject ? `?project=${encodeURIComponent(nextProject)}` : ""}`, { force: true, timeoutMs: 120_000 });
      if (requestId !== loadRequestRef.current) return;
      if (nextProject && payload.projectId !== nextProject) throw new Error(l("تعذر تأكيد المشروع المحدد.", "The selected project could not be confirmed."));
      setData(payload); setProjectId(payload.projectId); setError(""); setImpactRows([]); setSimulation(null); setAnswer(null);
    } catch (reason) { if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : l("تعذر تحميل ذكاء الأصول.", "Asset Intelligence could not be loaded.")); }
    finally { if (requestId === loadRequestRef.current) setProjectLoading(false); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function action<T>(body: Record<string, unknown>) {
    if (projectLoading || !data || data.projectId !== projectId) throw new Error(l("انتظر حتى يكتمل تحميل المشروع المحدد.", "Wait for the selected project to finish loading."));
    const token = await getAccessToken(); if (!token) { window.location.replace("/login"); throw new Error("Authentication required."); }
    const response = await fetch("/api/intelligence", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, projectId }) });
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || l("تعذر تنفيذ العملية.", "The action could not be completed."));
    return payload;
  }
  async function saveDependency() {
    setBusy(true); setError(""); setNotice("");
    try { await action({ action: "saveDependency", upstreamAssetId: upstream, downstreamAssetId: downstream, dependencyType, impact }); invalidateApiCache("/api/intelligence"); await load(projectId); setNotice(l("تم حفظ علاقة الاعتماد.", "Dependency saved.")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر الحفظ.", "Save failed.")); } finally { setBusy(false); }
  }
  async function analyzeImpact(assetId: string) {
    setBusy(true); setError(""); try { const result = await action<{ impacted: typeof impactRows }>({ action: "impact", assetId }); setImpactRows(result.impacted); }
    catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر تحليل الأثر.", "Impact analysis failed.")); } finally { setBusy(false); }
  }
  async function runSimulation(save = false) {
    setBusy(true); setError(""); try {
      const result = await action<Simulation & { simulation?: Simulation }>({ action: save ? "saveScenario" : "simulate", annualBudget: Number(budget), horizonYears: Number(horizon), name: scenarioName || l("سيناريو رأسمالي", "Capital scenario") });
      setSimulation(result.simulation || result); setNotice(save ? l("تم حفظ السيناريو.", "Scenario saved.") : ""); if (save) { invalidateApiCache("/api/intelligence"); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر تشغيل المحاكاة.", "Simulation failed.")); } finally { setBusy(false); }
  }
  async function ask() {
    setBusy(true); setError(""); try { setAnswer(await action<Answer>({ action: "ask", question, language })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : l("تعذر تحليل السؤال.", "Question analysis failed.")); } finally { setBusy(false); }
  }

  const assetById = useMemo(() => new Map((data?.assets || []).map(asset => [asset.id, asset])), [data]);
  const highRisk = (data?.assets || []).filter(asset => assetRiskScore(asset) >= 16).length;
  const tabs = ([['twin',l("التوأم الرقمي الخفيف", "Digital Twin Lite")],['graph',l("اعتماد الأصول", "Dependency Graph")],['capital',l("تخطيط رأس المال", "Capital Planning")]] as const);
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? (language === "ar" ? -1 : 1) : (language === "ar" ? 1 : -1);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
    setTab(tabs[next][0]);
    document.getElementById(`intel-tab-${tabs[next][0]}`)?.focus();
  }
  if (!data) return <main className="al-page intelligence-page"><div className="route-brand-loader"><span>{error || l("جاري بناء نموذج ذكاء الأصول…", "Building the Asset Intelligence model…")}</span><i /></div></main>;
  return <main className="al-page intelligence-page">
    <header className="al-page-head"><div><span className="al-page-kicker">ASSET INTELLIGENCE</span><h2>{l("مركز القرار للأصول", "Asset decision center")}</h2><p>{l("اربط تأثير الأصول، اختبر ميزانيات الاستبدال، واسأل سجل المشروع من مصدر بيانات واحد.", "Map asset impact, test replacement budgets and query the project register from one governed source.")}</p></div><label>{l("المشروع", "Project")}<select value={projectId} disabled={projectLoading || busy} aria-busy={projectLoading} onChange={event => void load(event.target.value)}>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></header>
    {error && <div className="al-alert" role="alert">{error}</div>}{notice && <div className="al-alert success">{notice}</div>}
    <section className="intel-kpis"><article><span>{l("الأصول في النموذج", "Modeled assets")}</span><strong>{data.assets.length}</strong></article><article><span>{l("علاقات الاعتماد", "Dependencies")}</span><strong>{data.dependencies.length}</strong></article><article><span>{l("مخاطر عالية", "High risk")}</span><strong>{highRisk}</strong></article><article><span>{l("سيناريوهات محفوظة", "Saved scenarios")}</span><strong>{data.scenarios.length}</strong></article></section>
    <nav className="intel-tabs" role="tablist" aria-label={l("أقسام ذكاء الأصول", "Asset Intelligence sections")}>{tabs.map((item, index) => <button type="button" role="tab" id={`intel-tab-${item[0]}`} aria-controls={`intel-panel-${item[0]}`} aria-selected={tab === item[0]} tabIndex={tab === item[0] ? 0 : -1} key={item[0]} className={tab === item[0] ? "active" : ""} onKeyDown={event => moveTab(event, index)} onClick={() => setTab(item[0])}>{item[1]}</button>)}</nav>

    {tab === "twin" && <section className="intel-panel"><header><div><h3>{l("النموذج التشغيلي للموقع", "Operational site model")}</h3><p>{l("تم إنشاؤه من المبنى والموقع والأصول الحالية دون تكلفة نموذج BIM.", "Generated from current building, location and asset records without a costly BIM model.")}</p></div></header><div className="twin-grid">{data.twin.map(building => <article key={building.building}><header><span>BUILDING</span><h4>{building.building}</h4><b>{building.assetCount} {l("أصل", "assets")}</b></header>{building.locations.slice(0, 12).map(location => <details key={location.location}><summary><span>{location.location}</span><b>{location.assetCount}</b><em>{l("مخاطر", "risk")} {location.riskScore}</em></summary>{location.assets.slice(0, 20).map(asset => <p key={asset.id}><strong>{asset.assetNo}</strong><span>{asset.assetType}</span><i data-risk={assetRiskScore(asset) >= 16 ? "high" : "normal"}>{assetRiskScore(asset)}</i></p>)}</details>)}</article>)}</div></section>}

    {tab === "graph" && <section className="intel-panel"><header><div><h3>Asset Dependency Graph</h3><p>{l("حدد الأصل المغذي والأصل المتأثر، ثم اختبر أثر تعطل أي أصل على ما بعده.", "Connect an upstream asset to the affected asset, then trace the downstream impact of failure.")}</p></div></header>{data.permissions?.create && <div className="dependency-form"><label>{l("الأصل المغذي", "Upstream asset")}<select value={upstream} onChange={event => setUpstream(event.target.value)}><option value="">—</option>{data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.assetNo} · {asset.assetType}</option>)}</select></label><label>{l("الأصل المتأثر", "Downstream asset")}<select value={downstream} onChange={event => setDownstream(event.target.value)}><option value="">—</option>{data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.assetNo} · {asset.assetType}</option>)}</select></label><label>{l("نوع العلاقة", "Relationship")}<select value={dependencyType} onChange={event => setDependencyType(event.target.value)}><option value="supplies">Supplies</option><option value="feeds">Feeds</option><option value="controls">Controls</option><option value="protects">Protects</option><option value="serves">Serves</option><option value="depends_on">Depends on</option></select></label><label>{l("حجم الأثر", "Impact")}<select value={impact} onChange={event => setImpact(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><button disabled={busy || !upstream || !downstream || upstream === downstream} onClick={() => void saveDependency()}>{l("حفظ العلاقة", "Save dependency")}</button></div>}<div className="dependency-list">{data.dependencies.map(edge => <article key={edge.id}><div><strong>{assetById.get(edge.upstreamAssetId)?.assetNo || edge.upstreamAssetId}</strong><span>→ {edge.dependencyType} →</span><strong>{assetById.get(edge.downstreamAssetId)?.assetNo || edge.downstreamAssetId}</strong></div><em data-impact={edge.impact}>{edge.impact}</em><button disabled={busy} onClick={() => void analyzeImpact(edge.upstreamAssetId)}>{l("تحليل الأثر", "Trace impact")}</button></article>)}</div>{impactRows.length > 0 && <div className="impact-results"><h4>{l("سلسلة الأثر المتوقعة", "Projected impact chain")}</h4>{impactRows.map(row => <p key={row.assetId}><b>{assetById.get(row.assetId)?.assetNo || row.assetId}</b><span>{assetById.get(row.assetId)?.assetType}</span><em>{l("المستوى", "depth")} {row.depth} · {row.impact}</em></p>)}</div>}</section>}

    {tab === "capital" && <section className="intel-panel"><header><div><h3>Capital Planning Simulator</h3><p>{l("يوزع الأولوية حسب الحالة × الأهمية ثم العمر المتبقي، ولا يتجاوز الميزانية السنوية.", "Prioritizes condition × criticality, then remaining life, without exceeding the annual budget.")}</p></div></header><div className="capital-form"><label>{l("اسم السيناريو", "Scenario name")}<input value={scenarioName} onChange={event => setScenarioName(event.target.value)} /></label><label>{l("الميزانية السنوية AED", "Annual budget AED")}<input type="number" min="0" value={budget} onChange={event => setBudget(event.target.value)} /></label><label>{l("عدد السنوات", "Years")}<input type="number" min="1" max="20" value={horizon} onChange={event => setHorizon(event.target.value)} /></label><button disabled={busy} onClick={() => void runSimulation(false)}>{l("تشغيل المحاكاة", "Run simulation")}</button>{data.permissions?.create && <button className="secondary" disabled={busy || !scenarioName} onClick={() => void runSimulation(true)}>{l("حفظ السيناريو", "Save scenario")}</button>}</div>{simulation && <><div className="capital-summary"><span>{l("إجمالي الميزانية", "Total budget")}<b>{simulation.totalBudget.toLocaleString()} AED</b></span><span>{l("الإنفاق المخطط", "Planned spend")}<b>{simulation.plannedSpend.toLocaleString()} AED</b></span><span>{l("المؤشر المعالج", "Risk addressed")}<b>{simulation.addressedRisk}</b></span><span>{l("أصول مؤجلة", "Deferred assets")}<b>{simulation.deferred.length}</b></span></div><div className="capital-years">{simulation.years.map(year => <article key={year.year}><header><strong>{l("السنة", "Year")} {year.year}</strong><span>{year.spend.toLocaleString()} / {year.budget.toLocaleString()} AED</span></header>{year.assets.slice(0, 12).map(asset => <p key={asset.id}><b>{asset.assetNo}</b><span>{asset.assetType}</span><em>{asset.cost.toLocaleString()} AED · R{asset.riskScore}</em></p>)}</article>)}</div></>}</section>}

    {tab === "ask" && <section className="intel-panel ask-panel"><header><div><h3>Ask AssetLens</h3><p>{l("اسأل عن أصول المشروع؛ نميّز التحليل المدعوم بالذكاء الاصطناعي من نتائج البحث الاحتياطي، ونوضح مصدر كل إجابة.", "Ask about the project's assets. AI analysis and fallback register search are clearly labeled with their evidence.")}</p></div></header><div className="ask-suggestions">{[l("كم أصلًا حرجًا حالته ضعيفة؟", "How many critical assets are in poor condition?"),l("ما أولويات الاستبدال حسب المخاطر؟", "What are the replacement priorities by risk?"),l("لخص حالة الأصول حسب المبنى", "Summarize asset condition by building")].map(example => <button type="button" key={example} onClick={() => setQuestion(example)}>{example}</button>)}</div><div className="ask-box"><textarea aria-label={l("سؤالك عن أصول المشروع", "Question about project assets")} value={question} onChange={event => setQuestion(event.target.value)} placeholder={l("مثال: اعرض الأصول الحرجة بحالة ضعيفة", "Example: show critical assets in poor condition")} /><button disabled={busy || question.trim().length < 3} onClick={() => void ask()}>{busy ? l("جاري التحليل…", "Analyzing…") : l("اسأل AssetLens", "Ask AssetLens")}</button></div>{answer && <div className="answer-box" aria-live="polite"><span className="ask-mode" data-mode={answer.mode}>{answer.mode === "ai" ? l("تحليل AI مبني على السجل", "AI analysis grounded in the register") : l("بحث في السجل — ليس تحليل AI", "Register search — not AI analysis")}</span><h4>{answer.summary}</h4><small>{l(`عدد الأصول المطابقة: ${answer.totalMatches} · مجموع درجات المخاطر: ${answer.totalRisk}`, `Matching assets: ${answer.totalMatches} · Combined risk score: ${answer.totalRisk}`)}</small>{answer.limitation && <p className="ask-limitation">{answer.limitation}</p>}{answer.matches.filter(asset => answer.citations.includes(asset.id)).slice(0, 12).map(asset => <p key={asset.id}><b>{asset.assetNo}</b><span>{asset.assetType} · {asset.location}</span><em>R{assetRiskScore(asset)}</em></p>)}{answer.mode !== "ai" && answer.matches.slice(0, 12).map(asset => <p key={asset.id}><b>{asset.assetNo}</b><span>{asset.assetType} · {asset.location}</span><em>R{assetRiskScore(asset)}</em></p>)}</div>}</section>}
  </main>;
}
