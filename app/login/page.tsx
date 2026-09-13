"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { signIn } from "../lib/supabase-auth";
import { useUiLanguage } from "../lib/use-ui-language";
import { applyUiPreferences, readUiTheme, saveUiLanguage } from "../lib/ui-preferences";

export default function LoginPage() {
  const language = useUiLanguage();
  const ar = language === "ar";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await signIn(email, password);
      // A document navigation guarantees that no profile, permission or API
      // state from the previous account survives the account switch.
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : (ar ? "تعذر إكمال تسجيل الدخول." : "Unable to complete sign in."));
    } finally { setBusy(false); }
  }

  if (!mounted) return <main className="login-shell" dir={ar ? "rtl" : "ltr"}>
    <section className="login-brand"><Image className="auth-logo" src="/assetlens-logo.png" alt="AssetLens AI" width={310} height={80} priority /><span>ASSETLENS AI PLATFORM</span><h1>AssetLens AI</h1><p>{ar ? "منصة ذكية وآمنة لتسجيل الأصول، وتنظيم بيانات المواقع، واستخراج معلومات لوحات البيانات بالذكاء الاصطناعي." : "A secure intelligent platform for asset registration, location data and AI-assisted nameplate extraction."}</p></section>
    <section className="login-card login-card-loading" aria-live="polite"><div className="login-card-head"><small>{ar ? "مساحة عمل آمنة" : "Secure workspace"}</small><h2>{ar ? "تجهيز تسجيل الدخول" : "Preparing sign in"}</h2><p>{ar ? "جاري تجهيز مساحة AssetLens AI الآمنة." : "Preparing your secure AssetLens AI workspace."}</p></div><div className="login-skeleton"><span /><span /><span /></div></section>
  </main>;

  return <main className="login-shell" dir={ar ? "rtl" : "ltr"}>
    <button className="login-language" type="button" onClick={() => { const next = ar ? "en" : "ar"; saveUiLanguage(next); applyUiPreferences(next, readUiTheme()); }}>{ar ? "EN" : "ع"}</button>
    <section className="login-brand"><Image className="auth-logo" src="/assetlens-logo.png" alt="AssetLens AI" width={310} height={80} priority /><span>ASSETLENS AI PLATFORM</span><h1>AssetLens AI</h1><p>{ar ? "منصة ذكية وآمنة لتسجيل الأصول، وتنظيم بيانات المواقع، واستخراج معلومات لوحات البيانات بالذكاء الاصطناعي." : "A secure intelligent platform for asset registration, location data and AI-assisted nameplate extraction."}</p><ul><li>{ar ? "صلاحيات مستقلة لكل مشروع" : "Project-scoped permissions"}</li><li>{ar ? "هيكل مواقع مرن يحدده المدير" : "Administrator-defined location structure"}</li><li>{ar ? "تحليل في الخلفية وتصدير احترافي" : "Background analysis and professional exports"}</li></ul></section>
    <section className="login-card"><div className="login-card-head"><small>{ar ? "مساحة عمل آمنة" : "Secure workspace"}</small><h2>{ar ? "تسجيل الدخول" : "Sign in"}</h2><p>{ar ? "استخدم حساب AssetLens AI الذي أنشأه مسؤول النظام." : "Use the AssetLens AI account created by your administrator."}</p></div>
      <form onSubmit={submit}>
        <label>{ar ? "البريد الإلكتروني" : "Email"}<input className="ltr-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.com" required /></label>
        <label>{ar ? "كلمة المرور" : "Password"}<input className="ltr-input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder={ar ? "كلمة مرور الحساب" : "Account password"} required /></label>
        {error && <div className="login-alert error">{error}</div>}
        <button className="login-submit" disabled={busy}>{busy ? (ar ? "يرجى الانتظار…" : "Please wait…") : (ar ? "الدخول إلى المنصة" : "Sign in")}</button>
      </form>
      <p className="login-note">🔒 {ar ? "إنشاء الحسابات متاح فقط للسوبر أدمن. كلمات المرور محمية بواسطة Supabase Auth ولا تُحفظ داخل كود الموقع." : "Only the super administrator can create accounts. Passwords are protected by Supabase Auth and never stored in site code."}</p>
    </section>
  </main>;
}
