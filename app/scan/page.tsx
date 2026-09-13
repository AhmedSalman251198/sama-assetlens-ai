"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AssetQrPayload, parseAssetQrValue } from "../lib/asset-qr";
import { readUiLanguage, UI_LANGUAGE_EVENT, UiLanguage } from "../lib/ui-preferences";

function cacheKey(assetId: string) { return `assetlens_qr_cache_v1:${assetId}`; }

export default function OfflineAssetScanPage() {
  const [language, setLanguage] = useState<UiLanguage>("ar");
  const [identifier, setIdentifier] = useState<AssetQrPayload | null>(null);
  const [payload, setPayload] = useState<AssetQrPayload | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"server" | "cache" | "embedded" | "">("");

  const refreshCurrent = useCallback(async (assetId: string) => {
    if (!navigator.onLine) return;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/public/assets/${encodeURIComponent(assetId)}`, { cache: "no-store" });
      const result = await response.json() as { payload?: AssetQrPayload; error?: string };
      if (!response.ok || !result.payload) throw new Error(result.error || "Unable to refresh asset data.");
      window.localStorage.setItem(cacheKey(assetId), JSON.stringify(result.payload));
      setPayload(result.payload); setSource("server"); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تحديث بيانات الأصل.");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setLanguage(readUiLanguage()), 0);
    const onLanguage = (event: Event) => setLanguage((event as CustomEvent<UiLanguage>).detail || readUiLanguage());
    window.addEventListener(UI_LANGUAGE_EVENT, onLanguage);
    return () => { window.clearTimeout(timer); window.removeEventListener(UI_LANGUAGE_EVENT, onLanguage); };
  }, []);

  useEffect(() => {
    let active = true;
    const decode = async () => {
      setOnline(navigator.onLine); setError("");
      try {
        const decoded = await parseAssetQrValue(window.location.href);
        if (!decoded) throw new Error(language === "ar" ? "هذا الرمز ليس QR صالحًا من AssetLens." : "This is not a valid AssetLens QR.");
        if (!active) return;
        setIdentifier(decoded);
        const cachedText = window.localStorage.getItem(cacheKey(decoded.assetId));
        if (cachedText) {
          try { const cached = JSON.parse(cachedText) as AssetQrPayload; if (cached.assetId === decoded.assetId) { setPayload(cached); setSource("cache"); } }
          catch { window.localStorage.removeItem(cacheKey(decoded.assetId)); }
        } else if (decoded.fields.length > 1) { setPayload(decoded); setSource("embedded"); }
        if (navigator.onLine) await refreshCurrent(decoded.assetId);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "تعذر قراءة بيانات الأصل من QR."); }
    };
    void decode();
    const onOnline = () => { setOnline(true); void parseAssetQrValue(window.location.href).then(decoded => { if (decoded?.assetId) return refreshCurrent(decoded.assetId); }).catch(() => undefined); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); window.addEventListener("hashchange", decode);
    return () => { active = false; window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); window.removeEventListener("hashchange", decode); };
  }, [language, refreshCurrent]);

  return <main className="offline-scan-page" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="offline-scan-header">
      <Image src="/assetlens-logo.png" alt="AssetLens AI" width={190} height={62} priority />
      <span className={online ? "online" : "offline"}><i />{online ? (language === "ar" ? "متصل" : "Online") : (language === "ar" ? "عرض بدون إنترنت" : "Offline view")}</span>
    </header>
    <section className="offline-scan-card">
      {!payload && !error && <div className="offline-scan-loading"><span />{refreshing ? (language === "ar" ? "جاري جلب أحدث بيانات الأصل…" : "Fetching current asset data…") : (language === "ar" ? "جاري قراءة QR…" : "Reading QR…")}</div>}
      {error && !payload && <div className="offline-scan-error"><b>{language === "ar" ? "تعذر عرض الأصل" : "Unable to show asset"}</b><p>{error}</p>{identifier && !online && <p>{language === "ar" ? "اتصل بالإنترنت مرة واحدة على هذا الهاتف لحفظ بيانات الأصل للاستخدام Offline." : "Connect once on this phone to cache the asset for offline use."}</p>}<Link href="/capture">{language === "ar" ? "فتح ماسح AssetLens" : "Open AssetLens scanner"}</Link></div>}
      {payload && <>
        <div className="offline-scan-title"><span>QR</span><div><small>{source === "server" ? "LIVE SUPABASE DATA" : source === "cache" ? "OFFLINE CACHED DATA" : "EMBEDDED SNAPSHOT"}</small><h1>{payload.assetNo || (language === "ar" ? "أصل" : "Asset")}</h1><p>{source === "server" ? (language === "ar" ? "تم تحديث البيانات الآن من Supabase وحفظها للاستخدام Offline." : "Updated from Supabase and cached for offline use.") : (language === "ar" ? "هذه آخر بيانات محفوظة على هذا الهاتف، وستتحدث تلقائياً عند رجوع الإنترنت." : "This is the latest data cached on this phone and will refresh automatically when online.")}</p></div></div>
        {refreshing && <div className="offline-refreshing">↻ {language === "ar" ? "جاري التحقق من آخر تعديل…" : "Checking for the latest update…"}</div>}
        <dl className="offline-asset-fields">{payload.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
        <footer className="offline-scan-footer"><div><small>Asset ID</small><code>{payload.assetId}</code></div>{online && <button className="al-secondary-button" disabled={refreshing} onClick={() => void refreshCurrent(payload.assetId)}>↻ {language === "ar" ? "تحديث" : "Refresh"}</button>}</footer>
      </>}
    </section>
    <p className="offline-scan-note">{language === "ar" ? "QR ثابت ولا يتغير عند تعديل الأصل. افتح هذه الصفحة مرة واحدة Online على الهاتف ليتم حفظها وتشغيلها لاحقاً دون إنترنت." : "The QR stays unchanged after asset edits. Open it once online on this phone to cache it for future offline use."}</p>
  </main>;
}
