"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getAccessToken, signIn } from "../lib/supabase-auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    event.preventDefault(); setBusy(true); setError("");
    try {
      await signIn(email, password);
      router.replace("/");
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
    <section className="login-card"><div className="login-card-head"><small>مساحة عمل آمنة</small><h2>تسجيل الدخول</h2><p>استخدم حساب AssetLens AI الذي أنشأه مسؤول النظام.</p></div>
      <form onSubmit={submit}>
        <label>البريد الإلكتروني<input className="ltr-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.com" required /></label>
        <label>كلمة المرور<input className="ltr-input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="8 أحرف على الأقل" minLength={8} required /></label>
        {error && <div className="login-alert error">{error}</div>}
        <button className="login-submit" disabled={busy}>{busy ? "يرجى الانتظار…" : "الدخول إلى المنصة"}</button>
      </form>
      <p className="login-note">🔒 إنشاء الحسابات والدعوات متاح فقط للسوبر أدمن. كلمات المرور محمية بواسطة Supabase Auth ولا تُحفظ داخل كود الموقع.</p>
    </section>
  </main>;
}
