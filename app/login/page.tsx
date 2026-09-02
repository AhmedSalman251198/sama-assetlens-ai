"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getAccessToken, signIn, signUp } from "../lib/supabase-auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    void getAccessToken().then(token => { if (active && token) router.replace("/"); });
    return () => { active = false; };
  }, [mounted, router]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "signin") {
        await signIn(email, password);
        router.replace("/");
      } else {
        const session = await signUp(email, password, name);
        if (session.access_token) router.replace("/");
        else setMessage("تم إنشاء الحساب. راجع بريدك الإلكتروني لتأكيد الحساب، ثم سجل الدخول.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إكمال تسجيل الدخول.");
    } finally { setBusy(false); }
  }

  if (!mounted) return <main className="login-shell" dir="rtl">
    <section className="login-brand"><Image className="auth-logo" src="/assetlens-logo.png" alt="AssetLens AI" width={310} height={80} priority /><span>ASSETLENS AI PLATFORM</span><h1>AssetLens AI</h1><p>منصة ذكية وآمنة لتسجيل الأصول، وتنظيم بيانات المواقع، واستخراج معلومات لوحات البيانات بالذكاء الاصطناعي.</p><ul><li>صلاحيات مستقلة لكل مشروع</li><li>مبانٍ وطوابق وزونات يحددها المدير</li><li>تحليل مرتب في الخلفية وتصدير احترافي إلى Excel</li></ul></section>
    <section className="login-card login-card-loading" aria-live="polite"><div className="login-card-head"><small>مساحة عمل آمنة</small><h2>تجهيز تسجيل الدخول</h2><p>جاري تجهيز مساحة AssetLens AI الآمنة.</p></div><div className="login-skeleton"><span /><span /><span /></div></section>
  </main>;

  return <main className="login-shell" dir="rtl">
    <section className="login-brand"><Image className="auth-logo" src="/assetlens-logo.png" alt="AssetLens AI" width={310} height={80} priority /><span>ASSETLENS AI PLATFORM</span><h1>AssetLens AI</h1><p>منصة ذكية وآمنة لتسجيل الأصول، وتنظيم بيانات المواقع، واستخراج معلومات لوحات البيانات بالذكاء الاصطناعي.</p><ul><li>صلاحيات مستقلة لكل مشروع</li><li>مبانٍ وطوابق وزونات يحددها المدير</li><li>تحليل مرتب في الخلفية وتصدير احترافي إلى Excel</li></ul></section>
    <section className="login-card"><div className="login-card-head"><small>مساحة عمل آمنة</small><h2>{mode === "signin" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h2><p>{mode === "signin" ? "استخدم حساب AssetLens AI للمتابعة." : "يمكن للمستخدم المعتمد إنشاء حسابه من هنا."}</p></div>
      <div className="login-tabs"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>تسجيل الدخول</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setMessage(""); }}>إنشاء حساب</button></div>
      <form onSubmit={submit}>
        {mode === "signup" && <label>الاسم الكامل<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" placeholder="اكتب الاسم الكامل" required /></label>}
        <label>البريد الإلكتروني<input className="ltr-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.com" required /></label>
        <label>كلمة المرور<input className="ltr-input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="8 أحرف على الأقل" minLength={8} required /></label>
        {error && <div className="login-alert error">{error}</div>}{message && <div className="login-alert success">{message}</div>}
        <button className="login-submit" disabled={busy}>{busy ? "يرجى الانتظار…" : mode === "signin" ? "الدخول إلى المنصة" : "إنشاء الحساب"}</button>
      </form>
      <p className="login-note">🔒 تتم حماية كلمات المرور بواسطة Supabase Auth، ولا يتم حفظها داخل كود الموقع.</p>
    </section>
  </main>;
}
