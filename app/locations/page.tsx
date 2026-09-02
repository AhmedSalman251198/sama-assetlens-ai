"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useStructure } from "../lib/use-structure";

function LocationsContent() {
  const params = useSearchParams();
  const { data, error } = useStructure();
  const [projectId, setProjectId] = useState(() => params.get("project") || "");
  const [buildingId, setBuildingId] = useState(() => params.get("building") || "");
  const [search, setSearch] = useState("");
  const projects = data?.projects || [];
  const selectedProjects = projectId ? projects.filter(project => project.id === projectId) : projects;
  const availableBuildings = selectedProjects.flatMap(project => project.buildings.map(building => ({ id: building.id, name: building.name, project: project.name })));
  const normalized = search.trim().toLowerCase();
  const locations = useMemo(() => selectedProjects.flatMap(project => project.buildings.map(building => ({ ...building, projectId: project.id, project: project.name }))).filter(building => (!buildingId || building.id === buildingId) && (!normalized || [building.name,building.project,...building.floors.map(item=>item.name),...building.zones.map(item=>item.name)].join(" ").toLowerCase().includes(normalized))), [selectedProjects, buildingId, normalized]);

  return <section className="al-page locations-page">
    <header className="al-page-head"><div><span className="al-page-kicker">Locations directory</span><h2>المباني والطوابق والزونات</h2><p>انتقل من المشروع إلى الموقع بسرعة، واعرف محتوى كل مبنى قبل بدء المسح أو نقل أصل.</p></div><div className="al-page-actions"><Link className="al-secondary-button" href="/organization">خريطة المشاريع</Link>{data?.currentUser.role === "admin" && <Link className="al-primary-button" href="/admin#locations">إضافة موقع</Link>}</div></header>
    {error && <div className="al-alert" role="alert">{error}</div>}
    <section className="al-card location-filters"><label className="location-project-filter"><span>المشروع</span><select value={projectId} onChange={event => { setProjectId(event.target.value); setBuildingId(""); }}><option value="">كل المشاريع</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="location-building-filter"><span>المبنى / الموقع</span><select value={buildingId} onChange={event => setBuildingId(event.target.value)}><option value="">كل المباني</option>{availableBuildings.map(building => <option key={building.id} value={building.id}>{building.name}{projectId ? "" : ` — ${building.project}`}</option>)}</select></label><label className="location-search-filter"><span>بحث في المواقع</span><div>⌕<input value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم المبنى، الطابق أو الزون…" /></div></label><div><small>المواقع المطابقة</small><strong>{locations.length}</strong></div></section>
    {!data && !error ? <div className="al-loading-grid locations-loading"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data && (locations.length ? <div className="location-grid">{locations.map(building => <article className="al-card location-card" key={building.id}><header><span>⌖</span><div><small>{building.project}</small><h3>{building.name}</h3></div><Link href={`/capture?project=${building.projectId}&building=${building.id}`}>بدء مسح</Link></header><div className="location-card-stats"><div><strong>{building.floors.length}</strong><span>طوابق</span></div><div><strong>{building.zones.length}</strong><span>زونات</span></div></div><section><h4>الطوابق</h4><div>{building.floors.length ? building.floors.map(floor => <span key={floor.id}>{floor.name}</span>) : <em>لا توجد طوابق</em>}</div></section><section><h4>الزونات</h4><div>{building.zones.length ? building.zones.map(zone => <span key={zone.id}>{zone.name}<small>{building.floors.find(floor => floor.id === zone.floorId)?.name || "كل المبنى"}</small></span>) : <em>لا توجد زونات</em>}</div></section><footer><Link href={`/transfers?project=${building.projectId}&building=${building.id}`}>نقل أصل إلى هذا الموقع</Link></footer></article>)}</div> : <section className="al-card al-empty-state"><div><span>⌖</span><h3>لا توجد مواقع مطابقة</h3><p>غيّر المشروع أو عبارة البحث، أو أضف موقعًا جديدًا من لوحة الإدارة.</p></div></section>)}
  </section>;
}

export default function LocationsPage() {
  return <Suspense fallback={<div className="al-page al-loading-grid"><div className="al-skeleton"/><div className="al-skeleton"/></div>}><LocationsContent/></Suspense>;
}
