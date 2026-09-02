"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="al-page al-card route-error" role="alert">
      <span>!</span>
      <h2>تعذر فتح هذه الصفحة</h2>
      <p>حدث خطأ غير متوقع. أعد المحاولة، وإن استمرت المشكلة تحقق من الاتصال وإعدادات Supabase.</p>
      <button className="al-primary-button" onClick={reset}>إعادة المحاولة</button>
    </section>
  );
}
