"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { exportWorkbook } from "../lib/excel-client";
import { apiGet, ApiClientError, invalidateApiCache } from "../lib/api-client";
import { getAccessToken } from "../lib/supabase-auth";

type Asset = {
  id: string; assetNo: string; assetType: string; summary: string; manufacturer: string; model: string; serial: string;
  confidence: number; status: string; error: string; warnings: string[]; isDuplicate: boolean; canEdit: boolean; createdAt: string;
  surveyorEmail: string; projectId: string; project: string; building: string; floor: string; zone: string; sourceFiles: string[];
};
type Payload = { records: Asset[]; total: number; page: number; pageSize: number; error?: string };

const statusLabels: Record<string, string> = { queued: "في الانتظار", processing: "قيد التحليل", completed: "معتمد", review: "يحتاج مراجعة", failed: "فشل" };

export default function AssetsPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const params = new URLSearchParams({ view: "list", page: String(page), pageSize: "50" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      const result = await apiGet<Payload>(`/api/assets?${params}`, { ttlMs: 20_000, force });
      setPayload(result);
    } catch (reason) {
      if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) { window.location.replace("/login"); return; }
      setError(reason instanceof Error ? reason.message : "تعذر تحميل سجل الأصول.");
    }
  }, [page, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pages = Math.max(1, Math.ceil((payload?.total || 0) / (payload?.pageSize || 50)));
  const visibleRange = useMemo(() => {
    const total = payload?.total || 0; const size = payload?.pageSize || 50;
    return total ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} من ${total}` : "0 نتيجة";
  }, [page, payload]);

  async function removeAsset() {
    if (!deleteTarget) return;
    setBusy(true); setError("");
    try {
      const token = await getAccessToken(); if (!token) { window.location.replace("/login"); return; }
      const response = await fetch(`/api/assets?id=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "تعذر حذف الأصل.");
      invalidateApiCache("/api/assets"); invalidateApiCache("/api/dashboard"); invalidateApiCache("/api/reports");
      setDeleteTarget(null); await load(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر حذف الأصل."); }
    finally { setBusy(false); }
  }

  async function exportPage() {
    const rows = payload?.records || [];
    if (!rows.length) return;
    await exportWorkbook(`AssetLens_Assets_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Assets", rows: rows.map(asset => ({ "Asset No":asset.assetNo, Status:statusLabels[asset.status] || asset.status, Project:asset.project, Building:asset.building, Floor:asset.floor, Zone:asset.zone, "Asset Type":asset.assetType, Manufacturer:asset.manufacturer, Model:asset.model, "Serial Number":asset.serial, Confidence:`${Math.round(asset.confidence*100)}%`, Surveyor:asset.surveyorEmail, "Created At":asset.createdAt })) }]);
  }

  return <section className="al-page assets-page">
    <header className="al-page-head"><div><span className="al-page-kicker">Asset register</span><h2>سجل أصول سريع وواضح</h2><p>بحث وفلترة من الخادم مع عرض 50 أصلًا فقط في الصفحة، حتى يظل النظام سريعًا مهما كبر المشروع.</p></div><div className="al-page-actions"><button className="al-secondary-button" disabled={!payload?.records.length} onClick={() => void exportPage()}>تصدير الصفحة</button><Link className="al-primary-button" href="/capture">＋ أصل جديد</Link></div></header>
    {error && <div className="al-alert" role="alert">{error}</div>}
    <section className="al-card assets-toolbar"><label><span>بحث في السجل</span><div>⌕<input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="رقم الأصل، النوع، المشروع أو الموقع…" /></div></label><label><span>حالة الأصل</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">كل الحالات</option>{Object.entries(statusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="assets-result-count"><small>النتائج</small><strong>{visibleRange}</strong></div></section>
    {!payload && !error ? <div className="al-loading-grid assets-loading"><div className="al-skeleton"/><div className="al-skeleton"/><div className="al-skeleton"/></div> : payload && (payload.records.length ? <>
      <section className="al-card assets-table-card"><div className="assets-table-wrap"><table><thead><tr><th>الأصل</th><th>الحالة</th><th>المشروع والموقع</th><th>النوع</th><th>الشركة / الموديل</th><th>السيريال</th><th>الثقة</th><th>أضيف بواسطة</th><th>الإجراءات</th></tr></thead><tbody>{payload.records.map(asset => <tr key={asset.id}><td><strong>{asset.assetNo || "—"}</strong><small>{new Date(asset.createdAt).toLocaleDateString("ar-AE")}</small></td><td><span className={`asset-status ${asset.status}`}>{asset.isDuplicate ? "سيريال مكرر" : statusLabels[asset.status] || asset.status}</span>{asset.error && <small className="asset-error">{asset.error}</small>}</td><td><strong>{asset.project || "—"}</strong><small>{[asset.building,asset.floor,asset.zone].filter(Boolean).join(" · ") || "بدون موقع"}</small></td><td><strong>{asset.assetType || "جاري الاستخراج"}</strong><small>{asset.summary || "—"}</small></td><td>{asset.manufacturer || "—"}<small>{asset.model || "—"}</small></td><td className="ltr-cell">{asset.serial || "—"}</td><td><span className="asset-confidence"><i style={{ width:`${Math.round(asset.confidence*100)}%` }}/></span><small>{Math.round(asset.confidence*100)}%</small></td><td><span className="ltr-cell">{asset.surveyorEmail || "—"}</span></td><td><div className="asset-row-actions"><Link href={`/reports?asset=${encodeURIComponent(asset.id)}`}>عرض</Link><Link href={`/transfers?asset=${encodeURIComponent(asset.id)}`}>نقل</Link>{asset.canEdit && <button onClick={() => setDeleteTarget(asset)}>حذف</button>}</div></td></tr>)}</tbody></table></div></section>
      <nav className="assets-pagination" aria-label="صفحات سجل الأصول"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1,value-1))}>السابق</button><span>صفحة <b>{page}</b> من {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => Math.min(pages,value+1))}>التالي</button></nav>
    </> : <section className="al-card al-empty-state"><div><span>⌕</span><h3>لا توجد أصول مطابقة</h3><p>غيّر البحث أو الفلتر، أو التقط أصلًا جديدًا ليظهر في السجل.</p></div></section>)}
    {deleteTarget && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) setDeleteTarget(null); }}><section className="al-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><span className="al-dialog-icon danger">!</span><h3 id="delete-title">حذف الأصل {deleteTarget.assetNo}</h3><p>سيتم حذف سجل الأصل وصوره من التخزين. هذه العملية لا يمكن التراجع عنها.</p><div><button className="al-secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)}>إلغاء</button><button className="al-danger-button" disabled={busy} onClick={() => void removeAsset()}>{busy ? "جاري الحذف…" : "حذف نهائي"}</button></div></section></div>}
  </section>;
}
