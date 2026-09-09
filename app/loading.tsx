import Image from "next/image";

export default function Loading() {
  return (
    <section className="al-page route-loading" aria-busy="true" aria-label="جاري تحميل الصفحة">
      <div className="route-brand-loader"><Image src="/assetlens-logo.png" alt="AssetLens AI" width={170} height={55} /><span>جاري تجهيز الصفحة…</span><i /></div>
      <div className="route-loading-head"><span className="al-skeleton"/><div><span className="al-skeleton"/><span className="al-skeleton"/></div></div>
      <div className="route-loading-grid"><span className="al-skeleton"/><span className="al-skeleton"/><span className="al-skeleton"/></div>
      <span className="al-skeleton route-loading-main"/>
    </section>
  );
}
