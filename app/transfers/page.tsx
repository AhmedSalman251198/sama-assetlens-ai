"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";
import { useStructure } from "../lib/use-structure";

type Asset = { id:string; assetNo:string; assetType:string; projectId:string; project:string; building:string; floor:string; zone:string; canEdit:boolean; status:string };
type AssetPayload = { records:Asset[]; total:number; error?:string };

function TransfersContent() {
  const params = useSearchParams();
  const { data: structure, error: structureError } = useStructure();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300); return () => window.clearTimeout(timer); }, [searchInput]);

  const loadAssets = useCallback(async (force = false) => {
    try {
      const query = new URLSearchParams({ view:"transfer",page:"1",pageSize:"100" });
      const requestedAsset = params.get("asset") || "";
      if (requestedAsset && !search) query.set("asset",requestedAsset); else if (search) query.set("search",search);
      const payload = await apiGet<AssetPayload>(`/api/assets?${query}`, { ttlMs:20_000, force });
      const editable = payload.records.filter(asset => asset.canEdit);
      setAssets(editable);
      if (requestedAsset && editable.some(asset => asset.id === requestedAsset)) setAssetId(requestedAsset);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      setError(reason instanceof Error ? reason.message : "تعذر تحميل الأصول.");
    }
  },[params,search]);

  useEffect(()=>{const timer=window.setTimeout(()=>void loadAssets(),0);return()=>window.clearTimeout(timer);},[loadAssets]);
  const selectedAsset = assets.find(asset => asset.id === assetId);
  const project = structure?.projects.find(item => item.id === selectedAsset?.projectId);
  const building = project?.buildings.find(item => item.id === buildingId);
  const zones = useMemo(()=>building?.zones.filter(zone => !zone.floorId || !floorId || zone.floorId === floorId) || [],[building,floorId]);

  useEffect(() => {
    if (!project || buildingId) return;
    const requestedBuilding = params.get("building") || "";
    if (!requestedBuilding || !project.buildings.some(item=>item.id===requestedBuilding)) return;
    const timer=window.setTimeout(()=>setBuildingId(requestedBuilding),0);
    return()=>window.clearTimeout(timer);
  },[project,buildingId,params]);

  async function transfer() {
    if (!selectedAsset || !project) return;
    if (project.requireBuilding && !buildingId) { setError("اختر المبنى المستهدف قبل حفظ النقل."); return; }
    if (project.requireFloor && !floorId) { setError("اختر الطابق المستهدف قبل حفظ النقل."); return; }
    if (project.requireZone && !zoneId) { setError("اختر الزون المستهدف قبل حفظ النقل."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch("/api/assets",{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({action:"transfer",id:selectedAsset.id,projectId:selectedAsset.projectId,buildingId,floorId,zoneId})});
      const payload = await response.json() as {error?:string};
      if (!response.ok) throw new Error(payload.error || "تعذر نقل الأصل.");
      invalidateApiCache("/api/assets"); invalidateApiCache("/api/dashboard"); invalidateApiCache("/api/reports");
      setNotice(`تم نقل الأصل ${selectedAsset.assetNo} بنجاح إلى ${building?.name || project.name}.`);
      await loadAssets(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر نقل الأصل."); }
    finally { setBusy(false); }
  }

  return <section className="al-page transfers-page">
    <header className="al-page-head"><div><span className="al-page-kicker">Controlled movement</span><h2>نقل أصل داخل المشروع بأمان</h2><p>اختر الأصل ثم الموقع الجديد. يمنع النظام النقل بين مشروعين مختلفين ويحفظ العملية في سجل التدقيق.</p></div></header>
    {(error || structureError) && <div className="al-alert" role="alert">{error || structureError}</div>}{notice && <div className="transfer-notice" role="status">✓ {notice}</div>}
    <div className="transfer-layout">
      <article className="al-card transfer-select-card"><div className="al-card-head"><div><h3>1. اختر الأصل</h3><p>ابحث برقم الأصل أو النوع أو الموقع</p></div></div><div className="transfer-select-body"><label><span>بحث سريع</span><div>⌕<input value={searchInput} onChange={event=>setSearchInput(event.target.value)} placeholder="مثال: AST-001 أو Chiller"/></div></label><label><span>الأصل القابل للنقل</span><select value={assetId} onChange={event=>{setAssetId(event.target.value);setBuildingId("");setFloorId("");setZoneId("");setNotice("");}}><option value="">اختر الأصل</option>{assets.map(asset=><option key={asset.id} value={asset.id}>{asset.assetNo || asset.id.slice(0,8)} — {asset.assetType || "Asset"} — {asset.project}</option>)}</select></label>{selectedAsset ? <div className="selected-asset-card"><span>ASSET</span><strong>{selectedAsset.assetNo}</strong><h4>{selectedAsset.assetType || "أصل بدون تصنيف"}</h4><p>{selectedAsset.project}</p><small>{[selectedAsset.building,selectedAsset.floor,selectedAsset.zone].filter(Boolean).join(" · ") || "لا يوجد موقع حالي"}</small></div> : <div className="transfer-placeholder">اختر أصلًا لعرض موقعه الحالي.</div>}</div></article>
      <article className="al-card transfer-target-card"><div className="al-card-head"><div><h3>2. حدد الموقع الجديد</h3><p>الخيارات مرتبطة بمشروع الأصل فقط</p></div></div><div className="transfer-target-body"><label><span>المشروع</span><input value={selectedAsset?.project || ""} readOnly placeholder="اختر الأصل أولًا"/></label><label><span>المبنى / الموقع {project?.requireBuilding && <em>إلزامي</em>}</span><select value={buildingId} disabled={!project} onChange={event=>{setBuildingId(event.target.value);setFloorId("");setZoneId("");}}><option value="">اختر المبنى</option>{project?.buildings.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>الطابق {project?.requireFloor && <em>إلزامي</em>}</span><select value={floorId} disabled={!building} onChange={event=>{setFloorId(event.target.value);setZoneId("");}}><option value="">اختر الطابق</option>{building?.floors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>الزون {project?.requireZone && <em>إلزامي</em>}</span><select value={zoneId} disabled={!building} onChange={event=>setZoneId(event.target.value)}><option value="">اختر الزون</option>{zones.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="transfer-preview"><div><span>من</span><strong>{[selectedAsset?.building,selectedAsset?.floor,selectedAsset?.zone].filter(Boolean).join(" / ") || "غير محدد"}</strong></div><i>←</i><div><span>إلى</span><strong>{[building?.name,building?.floors.find(item=>item.id===floorId)?.name,zones.find(item=>item.id===zoneId)?.name].filter(Boolean).join(" / ") || "اختر الموقع"}</strong></div></div><button className="transfer-submit" disabled={!selectedAsset || busy} onClick={()=>void transfer()}>{busy ? "جاري حفظ النقل…" : "تأكيد نقل الأصل"}</button></div></article>
    </div>
  </section>;
}

export default function TransfersPage(){return <Suspense fallback={<section className="al-page al-loading-grid"><div className="al-skeleton"/><div className="al-skeleton"/></section>}><TransfersContent/></Suspense>}
