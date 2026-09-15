"use client";
import Link from "next/link";
import { useMemo } from "react";
import { assetListHref } from "../lib/asset-list-filters";
import { useStructure } from "../lib/use-structure";
import { languageText, useUiLanguage } from "../lib/use-ui-language";
export default function OrganizationPage() {
    const language = useUiLanguage();
    const l = (ar: string, en: string) => languageText(language, ar, en);
    const { data, error } = useStructure();
    const totals = useMemo(() => ({
        projects: data?.projects.length || 0,
        buildings: data?.projects.reduce((sum, project) => sum + project.buildings.length, 0) || 0,
        floors: data?.projects.reduce((sum, project) => sum + project.buildings.reduce((count, building) => count + building.floors.length, 0), 0) || 0,
        zones: data?.projects.reduce((sum, project) => sum + project.buildings.reduce((count, building) => count + building.zones.length, 0), 0) || 0,
        levels: data?.projects.reduce((sum, project) => sum + (project.locationLevels || []).length, 0) || 0,
    }), [data]);
    return <section className="al-page organization-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="al-page-head"><div><span className="al-page-kicker">Organization map</span><h2>{l("هيكل واضح لكل مشروع وموقع", "A clear structure for every project and location")}</h2><p>{l("اعرض العلاقة بين المشروع، المبنى، الطابق، الزون والمكتب في صفحة مستقلة سهلة القراءة.", "View the relationship between project, building, floor, zone and room in one clear page.")}</p></div><div className="al-page-actions"><Link className="al-secondary-button" href="/locations">{l("إدارة الأصول", "Manage assets")}</Link>{data?.currentUser.role === "admin" && <Link className="al-primary-button" href="/admin#projects">{l("إدارة الهيكل", "Manage structure")}</Link>}</div></header>
    {error && <div className="al-alert" role="alert">{error}</div>}
    {!data && !error ? <div className="al-loading-grid"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : data && <>
      <div className="organization-summary">{[[totals.projects, l("المشاريع", "Projects"), "01"], [totals.buildings, l("المباني والمواقع", "Buildings & sites"), "02"], [totals.floors, l("الطوابق", "Floors"), "03"], [totals.zones, l("الزونات", "Zones"), "04"], [totals.levels, l("المستويات الإضافية", "Custom levels"), "05"]].map(([value, label, index]) => <article className="al-card" key={String(label)}><span>{index}</span><div><strong>{value}</strong><small>{label}</small></div></article>)}</div>
      {data.projects.length ? <div className="organization-projects">{data.projects.map((project, index) => {
                    const floorCount = project.buildings.reduce((sum, building) => sum + building.floors.length, 0);
                    const zoneCount = project.buildings.reduce((sum, building) => sum + building.zones.length, 0);
                    const locationLevelCount = (project.locationLevels || []).length;
                    return <article className="al-card organization-project-card" key={project.id}><header><div><span>PROJECT {String(index + 1).padStart(2, "0")}</span><h3>{project.name}</h3></div><b>{project.buildings.length} مواقع</b></header><div className="organization-project-stats"><div><strong>{project.buildings.length}</strong><span>مبنى</span></div><div><strong>{floorCount}</strong><span>طابق</span></div><div><strong>{zoneCount}</strong><span>زون</span></div><div><strong>{locationLevelCount}</strong><span>مستوى إضافي</span></div></div><div className="organization-rules"><span className={project.requireBuilding ? "required" : ""}>المبنى {project.requireBuilding ? "إلزامي" : "اختياري"}</span><span className={project.requireFloor ? "required" : ""}>الطابق {project.requireFloor ? "إلزامي" : "اختياري"}</span><span className={project.requireZone ? "required" : ""}>الزون {project.requireZone ? "إلزامي" : "اختياري"}</span>{(project.locationLevels || []).map(level => <span key={level.id} className={level.required ? "required" : ""}>{level.labelAr} {level.required ? "إلزامي" : "اختياري"}</span>)}</div><div className="organization-building-list">{project.buildings.length ? project.buildings.map(building => <div key={building.id}><span className="organization-node-icon">⌂</span><div><strong>{building.name}</strong><small>{building.floors.length} طوابق · {building.zones.length} زونات · {(project.locationLevels || []).reduce((sum, level) => sum + level.options.filter(option => !option.buildingId || option.buildingId === building.id).length, 0)} قيم إضافية</small></div><Link href={assetListHref({ project: project.id, building: building.id })}>عرض</Link></div>) : <p>لم تتم إضافة مواقع لهذا المشروع بعد.</p>}</div></article>;
                })}</div> : <section className="al-card al-empty-state"><div><span>⌘</span><h3>لا توجد مشاريع متاحة</h3><p>اطلب من مدير النظام إنشاء مشروع أو منح حسابك صلاحية الوصول.</p></div></section>}
    </>}
  </section>;
}
