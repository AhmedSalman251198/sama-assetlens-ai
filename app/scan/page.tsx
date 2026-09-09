"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AssetQrPayload, parseAssetQrValue } from "../lib/asset-qr";

export default function OfflineAssetScanPage() {
  const [payload, setPayload] = useState<AssetQrPayload | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    const decode = async () => {
      setOnline(navigator.onLine);
      try {
        const result = await parseAssetQrValue(window.location.href);
        if (!result) throw new Error("هذا الرمز لا يحتوي على بيانات AssetLens Offline.");
        if (active) { setPayload(result); setError(""); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "تعذر قراءة بيانات الأصل من QR.");
      }
    };
    void decode();
    const onConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    window.addEventListener("hashchange", decode);
    return () => { active = false; window.removeEventListener("online", onConnection); window.removeEventListener("offline", onConnection); window.removeEventListener("hashchange", decode); };
  }, []);

  return <main className="offline-scan-page" dir="rtl">
    <header className="offline-scan-header">
      <Image src="/assetlens-logo.png" alt="AssetLens AI" width={190} height={62} priority />
      <span className={online ? "online" : "offline"}><i />{online ? "متصل" : "عرض بدون إنترنت"}</span>
    </header>
    <section className="offline-scan-card">
      {!payload && !error && <div className="offline-scan-loading"><span />جاري قراءة بيانات الأصل من QR…</div>}
      {error && <div className="offline-scan-error"><b>تعذر عرض الأصل</b><p>{error}</p><Link href="/capture">فتح ماسح AssetLens</Link></div>}
      {payload && <>
        <div className="offline-scan-title"><span>QR</span><div><small>ASSET OFFLINE SNAPSHOT</small><h1>{payload.assetNo || "Asset"}</h1><p>هذه البيانات محفوظة داخل رمز QR نفسه ولا تحتاج اتصالًا بالخادم.</p></div></div>
        <dl className="offline-asset-fields">{payload.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
        <footer className="offline-scan-footer"><div><small>Asset ID</small><code>{payload.assetId}</code></div></footer>
      </>}
    </section>
    <p className="offline-scan-note">لضمان الفتح بدون إنترنت، افتح الموقع أو ثبّت نسخة الويب PWA على الهاتف مرة واحدة أثناء الاتصال.</p>
  </main>;
}
