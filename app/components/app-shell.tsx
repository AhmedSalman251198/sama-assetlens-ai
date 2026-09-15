"use client";

import Image from "next/image";
import AssetLensAssistant from "./assetlens-assistant";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache, prefetchApi } from "../lib/api-client";
import { AUTH_SESSION_EVENT, changePassword, isStrongPassword, signOut } from "../lib/supabase-auth";
import { canUseModule, ModuleKey, ModulePermission } from "../lib/module-permissions";
import { applyUiPreferences, readUiLanguage, readUiTheme, saveUiLanguage, saveUiTheme, UI_LANGUAGE_EVENT, UI_THEME_EVENT, UiLanguage, UiTheme } from "../lib/ui-preferences";

type UserRole = "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
type Me = { name: string; email: string; role: UserRole; modules: ModuleKey[]; modulePermissions: ModulePermission[] };
type NavItem = { href: string; label: string; labelAr: string; icon: IconName; module: ModuleKey };
type IconName = "dashboard" | "capture" | "assets" | "organization" | "location" | "transfer" | "reports" | "intelligence" | "admin" | "chevron" | "menu" | "close" | "logout" | "wifi";

const navigation: NavItem[] = [
  { href: "/", label: "Dashboard", labelAr: "لوحة التحكم", icon: "dashboard", module: "dashboard" },
  { href: "/capture", label: "Capture & Analyze", labelAr: "التقاط وتحليل", icon: "capture", module: "capture" },
  { href: "/organization", label: "Organization", labelAr: "المشاريع والهيكل", icon: "organization", module: "organization" },
  { href: "/locations", label: "Asset Management", labelAr: "إدارة الأصول", icon: "assets", module: "locations" },
  { href: "/transfers", label: "Asset Transfer", labelAr: "نقل الأصول", icon: "transfer", module: "transfers" },
  { href: "/reports", label: "Reports", labelAr: "التقارير", icon: "reports", module: "reports" },
  { href: "/intelligence", label: "Asset Intelligence", labelAr: "ذكاء الأصول", icon: "intelligence", module: "intelligence" },
  { href: "/admin", label: "Administration", labelAr: "الإدارة", icon: "admin", module: "administration" },
];

const pageTitles: Record<string, { ar: string; en: string }> = {
  "/": { ar: "لوحة التحكم", en: "Dashboard" },
  "/capture": { ar: "التقاط وتحليل أصل", en: "Capture & Analyze" },
  "/organization": { ar: "المشاريع والهيكل", en: "Organization" },
  "/locations": { ar: "إدارة الأصول", en: "Asset Management" },
  "/transfers": { ar: "نقل الأصول", en: "Asset Transfer" },
  "/reports": { ar: "التقارير", en: "Reports" },
  "/intelligence": { ar: "ذكاء الأصول", en: "Asset Intelligence" },
  "/admin": { ar: "إدارة النظام", en: "Administration" },
};

const SERVICE_WORKER_VERSION = "22.2.1";
const roleLabels: Record<UserRole, { ar: string; en: string }> = {
  admin: { ar: "مسؤول", en: "Administrator" },
  project_manager: { ar: "مدير مشروع", en: "Project Manager" },
  reviewer: { ar: "مراجع", en: "Reviewer" },
  surveyor: { ar: "ماسح ميداني", en: "Surveyor" },
  viewer: { ar: "مشاهد", en: "Viewer" },
};

function Icon({ name }: { name: IconName }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "dashboard") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
  if (name === "capture") return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="4"/><path d="m17.5 17.5 2 2"/></svg>;
  if (name === "assets") return <svg {...common}><path d="M6 7.5h12v12H6z"/><path d="M9 7.5V5h6v2.5M9 12h6M9 16h4"/></svg>;
  if (name === "organization") return <svg {...common}><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></svg>;
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
  if (name === "transfer") return <svg {...common}><path d="M7 7h12l-3-3M17 17H5l3 3M19 7l-3 3M5 17l3-3"/></svg>;
  if (name === "reports") return <svg {...common}><path d="M5 3h14v18H5z"/><path d="M9 17v-4M12 17V8M15 17v-6"/></svg>;
  if (name === "intelligence") return <svg {...common}><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m7 7.5 3 2.8m4 0 3-2.8m-10 9 3-2.8m4 0 3 2.8"/></svg>;
  if (name === "admin") return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0M19 5v4M17 7h4"/></svg>;
  if (name === "chevron") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  if (name === "logout") return <svg {...common}><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></svg>;
  return <svg {...common}><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/></svg>;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [language, setLanguage] = useState<UiLanguage>("ar");
  const [theme, setTheme] = useState<UiTheme>("light");
  const [me, setMe] = useState<Me | null>(null);
  const [navigatingTo, setNavigatingTo] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const selector = '[role="alert"], [data-scroll-alert="true"]';
    const seen = new WeakSet<Element>();
    root.querySelectorAll(selector).forEach(element => seen.add(element));
    const reveal = (element: Element) => {
      if (seen.has(element) || !(element instanceof HTMLElement) || !element.getClientRects().length) return;
      seen.add(element);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
      element.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target.closest(selector) : null;
        if (target) reveal(target);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selector)) reveal(node);
          node.querySelectorAll(selector).forEach(reveal);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const resetAccountState = () => { invalidateApiCache(); setMe(null); };
    window.addEventListener(AUTH_SESSION_EVENT, resetAccountState);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, resetAccountState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDrawerOpen(false); setProfileOpen(false); setNavigatingTo(""); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const nextLanguage = readUiLanguage(); const nextTheme = readUiTheme();
    applyUiPreferences(nextLanguage, nextTheme);
    const timer = window.setTimeout(() => { setLanguage(nextLanguage); setTheme(nextTheme); }, 0);
    const onLanguage = (event: Event) => { const value = (event as CustomEvent<UiLanguage>).detail || readUiLanguage(); setLanguage(value); applyUiPreferences(value, readUiTheme()); };
    const onTheme = (event: Event) => { const value = (event as CustomEvent<UiTheme>).detail || readUiTheme(); setTheme(value); applyUiPreferences(readUiLanguage(), value); };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => { if (readUiTheme() === "system") applyUiPreferences(readUiLanguage(), "system"); };
    window.addEventListener(UI_LANGUAGE_EVENT, onLanguage); window.addEventListener(UI_THEME_EVENT, onTheme); media.addEventListener("change", onMedia);
    return () => { window.clearTimeout(timer); window.removeEventListener(UI_LANGUAGE_EVENT, onLanguage); window.removeEventListener(UI_THEME_EVENT, onTheme); media.removeEventListener("change", onMedia); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("assetlens_sidebar_collapsed");
      setCollapsed(stored === "true");
      setOnline(window.navigator.onLine);
    }, 0);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A development service worker can serve an old route bundle under the
    // same webpack URL, which makes the client navigation differ from SSR.
    // The root layout clears an existing development cache once; never create
    // a new one while running `npm run dev`.
    if (process.env.NODE_ENV !== "production") return;
    let active = true;
    const hadController = Boolean(navigator.serviceWorker.controller);
    const reloadMarker = `assetlens_sw_reloaded_${SERVICE_WORKER_VERSION}`;
    const onControllerChange = () => {
      if (!active || !hadController || window.sessionStorage.getItem(reloadMarker)) return;
      window.sessionStorage.setItem(reloadMarker, "true");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register(`/sw.js?v=${SERVICE_WORKER_VERSION}`, { updateViaCache: "none" })
      .then(registration => {
        if (!active) return;
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        void registration.update();
      })
      .catch(() => { /* The web application remains usable when PWA registration is unavailable. */ });
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/scan") return;
    if (me) return;
    let active = true;
    void (async () => {
      try {
        const payload = await apiGet<Me>("/api/me", { ttlMs: 5 * 60_000 });
        if (active) setMe(payload);
      } catch (reason) {
        if (reason instanceof ApiClientError && (reason.status === 401 || reason.status === 403)) router.replace("/login");
        /* Individual pages show actionable connection errors. */
      }
    })();
    return () => { active = false; };
  }, [pathname, router, me]);

  useEffect(() => {
    if (!me || !online || pathname === "/login" || pathname === "/scan") return;
    const timer = window.setTimeout(() => {
      void prefetchApi("/api/config?scope=structure", 5 * 60_000);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [me, online, pathname]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", closeOutside); window.removeEventListener("keydown", closeOnEscape); };
  }, [profileOpen]);

  useEffect(() => {
    if (!navigatingTo) return;
    const timer = window.setTimeout(() => setNavigatingTo(""), 10_000);
    return () => window.clearTimeout(timer);
  }, [navigatingTo]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [drawerOpen]);

  const visibleNavigation = useMemo(() => navigation.filter(item => me && canUseModule(me.modulePermissions, item.module)), [me]);
  const title = Object.entries(pageTitles).find(([route]) => isActive(pathname, route))?.[1] || { ar: "AssetLens AI", en: "Workspace" };
  const initials = (me?.name || me?.email || "AL").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const currentModule = navigation.find(item => isActive(pathname, item.href))?.module;
  const deniedCurrentRoute = Boolean(me && currentModule && !canUseModule(me.modulePermissions, currentModule));

  useEffect(() => {
    if (!deniedCurrentRoute) return;
    const firstAllowed = visibleNavigation[0]?.href;
    if (firstAllowed && firstAllowed !== pathname) router.replace(firstAllowed);
  }, [deniedCurrentRoute, pathname, router, visibleNavigation]);

  if (pathname === "/login" || pathname === "/scan") return <>{children}</>;

  if (deniedCurrentRoute) {
    return <div className="al-navigation-loader is-static" role="status"><div><Image src="/assetlens-logo.png" alt="" width={170} height={55} /><span>{language === "ar" ? "جاري فتح أول صفحة مسموحة…" : "Opening your first allowed page…"}</span><i /></div></div>;
  }

  async function logout() {
    await signOut();
    invalidateApiCache();
    setMe(null);
    window.location.replace("/login");
  }

  async function submitPassword() {
    setPasswordMessage("");
    if (newPassword !== confirmPassword) { setPasswordMessage(language === "ar" ? "كلمتا المرور غير متطابقتين." : "Passwords do not match."); return; }
    if (!isStrongPassword(newPassword)) { setPasswordMessage(language === "ar" ? "استخدم 10 أحرف على الأقل تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا." : "Use at least 10 characters including uppercase, lowercase, a number and a symbol."); return; }
    setPasswordBusy(true);
    try {
      await changePassword(newPassword);
      setPasswordMessage(language === "ar" ? "تم تغيير كلمة المرور بنجاح." : "Password changed successfully.");
      setNewPassword(""); setConfirmPassword("");
    } catch (reason) { setPasswordMessage(reason instanceof Error ? reason.message : (language === "ar" ? "تعذر تغيير كلمة المرور." : "Password could not be changed.")); }
    finally { setPasswordBusy(false); }
  }

  function warmNavigation(href: string) {
    router.prefetch(href);
    if (href === "/") void prefetchApi("/api/dashboard", 20_000);
    else if (["/organization", "/locations", "/transfers"].includes(href)) void prefetchApi("/api/config?scope=structure", 5 * 60_000);
    else if (href === "/reports") void prefetchApi("/api/reports", 30_000);
    else if (href === "/intelligence") void prefetchApi("/api/intelligence", 30_000);
    else if (href === "/capture") void prefetchApi("/api/config?scope=capture", 5 * 60_000);
  }

  function beginNavigation(href: string) {
    if (!isActive(pathname, href)) setNavigatingTo(href);
  }

  function toggleCollapsed() {
    setCollapsed(value => {
      const next = !value;
      window.localStorage.setItem("assetlens_sidebar_collapsed", String(next));
      return next;
    });
  }

  function toggleLanguage() {
    const next = language === "ar" ? "en" : "ar";
    saveUiLanguage(next); applyUiPreferences(next, theme);
  }

  function cycleTheme() {
    const next: UiTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    saveUiTheme(next); applyUiPreferences(language, next);
  }

  return (
    <div className={`al-frame ${collapsed ? "is-collapsed" : ""}`} dir={language === "ar" ? "rtl" : "ltr"} aria-busy={Boolean(navigatingTo)}>
      <button className={`al-drawer-backdrop ${drawerOpen ? "is-open" : ""}`} onClick={() => setDrawerOpen(false)} aria-label={language === "ar" ? "إغلاق القائمة" : "Close navigation"} tabIndex={drawerOpen ? 0 : -1} />
      <aside id="assetlens-navigation" className={`al-sidebar ${drawerOpen ? "is-open" : ""}`} aria-label={language === "ar" ? "التنقل الرئيسي" : "Primary navigation"}>
        <div className="al-sidebar-brand">
          <Image src="/assetlens-logo.png" alt="AssetLens AI" width={180} height={58} priority />
          <button className="al-mobile-close" onClick={() => setDrawerOpen(false)} aria-label={language === "ar" ? "إغلاق القائمة" : "Close navigation"}><Icon name="close" /></button>
        </div>
        <nav className="al-nav">
          {visibleNavigation.map(item => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined} title={collapsed ? item.label : undefined} onPointerEnter={() => warmNavigation(item.href)} onFocus={() => warmNavigation(item.href)} onClick={() => beginNavigation(item.href)}>
              <span className="al-nav-icon"><Icon name={item.icon} /></span>
              <span className="al-nav-copy"><strong>{language === "ar" ? item.labelAr : item.label}</strong><small>{language === "ar" ? item.label : item.labelAr}</small></span>
              <span className="al-nav-arrow"><Icon name="chevron" /></span>
            </Link>
          ))}
        </nav>
        <div className="al-sidebar-foot">
          <div className="al-user-summary"><span>{initials || "AL"}</span><div><strong>{me?.name || "AssetLens User"}</strong><small>{me ? roleLabels[me.role][language] : language === "ar" ? "مستخدم" : "User"}</small></div></div>
          <button className="al-collapse" onClick={toggleCollapsed} aria-label={collapsed ? (language === "ar" ? "توسيع القائمة" : "Expand navigation") : (language === "ar" ? "تصغير القائمة" : "Collapse navigation")}><Icon name="chevron" /><span>{collapsed ? (language === "ar" ? "توسيع" : "Expand") : (language === "ar" ? "تصغير القائمة" : "Collapse menu")}</span></button>
        </div>
      </aside>
      <div className="al-stage">
        <div className={`al-route-progress ${navigatingTo ? "is-active" : ""}`} aria-hidden="true"><span /></div>
        {navigatingTo && <div className="al-navigation-loader" role="status" aria-live="polite"><div><Image src="/assetlens-logo.png" alt="" width={170} height={55} /><span>{online ? (language === "ar" ? "جاري فتح الصفحة…" : "Opening page…") : (language === "ar" ? "جاري فتح النسخة المحفوظة…" : "Opening cached page…")}</span><i /></div></div>}
        <header className="al-topbar">
          <div className="al-topbar-title">
            <button className="al-menu-button" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} aria-controls="assetlens-navigation" aria-label={language === "ar" ? "فتح القائمة" : "Open navigation"}><Icon name="menu" /></button>
            <div><small>{language === "ar" ? title.en : title.ar}</small><h1>{language === "ar" ? title.ar : title.en}</h1></div>
          </div>
          <div className="al-topbar-actions">
            <button className="al-language-toggle" onClick={toggleLanguage} aria-label={language === "ar" ? "Switch to English" : "التبديل إلى العربية"}>{language === "ar" ? "EN" : "ع"}</button>
            <button className="al-theme-toggle" onClick={cycleTheme} title={theme === "light" ? (language === "ar" ? "الوضع النهاري" : "Light mode") : theme === "dark" ? (language === "ar" ? "الوضع الليلي" : "Dark mode") : (language === "ar" ? "حسب النظام" : "System theme")} aria-label={language === "ar" ? "تغيير مظهر الموقع" : "Change site theme"}>{theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐"}</button>
            <span className={`al-network ${online ? "online" : "offline"}`}><i /><span>{online ? (language === "ar" ? "متصل" : "Online") : (language === "ar" ? "بدون إنترنت" : "Offline")}</span></span>
            {me && canUseModule(me.modulePermissions, "capture", "create") && <Link className="al-quick-capture" href="/capture" onPointerEnter={() => warmNavigation("/capture")} onClick={() => beginNavigation("/capture")}><Icon name="capture" /><span>{language === "ar" ? "التقاط أصل" : "Capture asset"}</span></Link>}
            <div className="al-profile-menu" ref={profileRef}>
              <button onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen} aria-label={language === "ar" ? "خيارات الحساب" : "Account options"}><span>{initials || "AL"}</span><div><strong>{me?.name || "AssetLens User"}</strong><small>{me?.email || (language === "ar" ? "جاري التحقق…" : "Verifying…")}</small></div></button>
              {profileOpen && <div className="al-profile-popover"><div><strong>{me?.name || "AssetLens User"}</strong><small>{me?.email || ""}</small></div><button onClick={() => { setProfileOpen(false); setPasswordOpen(true); setPasswordMessage(""); }}>🔐 {language === "ar" ? "تغيير كلمة المرور" : "Change password"}</button><button onClick={() => void logout()}><Icon name="logout" /> {language === "ar" ? "تسجيل الخروج" : "Sign out"}</button></div>}
            </div>
          </div>
        </header>
        <main className="al-content" ref={contentRef}>{children}</main>
        <nav className="al-mobile-nav" aria-label={language === "ar" ? "التنقل السريع" : "Quick navigation"}>
          {visibleNavigation.filter(item => ["/", "/capture", "/locations", "/reports"].includes(item.href)).map(item => <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined} onTouchStart={() => warmNavigation(item.href)} onClick={() => beginNavigation(item.href)}><Icon name={item.icon} /><span>{language === "ar" ? item.labelAr.split(" ")[0] : item.label === "Capture & Analyze" ? "Capture" : item.label.split(" ")[0]}</span></Link>)}
        </nav>
      </div>
      {me && canUseModule(me.modulePermissions, "assistant") && <AssetLensAssistant key={me.email} language={language} />}
      {passwordOpen && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !passwordBusy) setPasswordOpen(false); }}><section className="al-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><span className="al-dialog-icon">🔐</span><h3 id="password-dialog-title">{language === "ar" ? "تغيير كلمة المرور" : "Change password"}</h3><p>{language === "ar" ? "استخدم 10 أحرف على الأقل تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا." : "Use at least 10 characters including uppercase, lowercase, a number and a symbol."}</p><label><span>{language === "ar" ? "كلمة المرور الجديدة" : "New password"}</span><input className="ltr-input" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label><span>{language === "ar" ? "تأكيد كلمة المرور" : "Confirm password"}</span><input className="ltr-input" type="password" autoComplete="new-password" minLength={10} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>{passwordMessage && <p role="status">{passwordMessage}</p>}<div><button className="al-secondary-button" disabled={passwordBusy} onClick={() => setPasswordOpen(false)}>{language === "ar" ? "إغلاق" : "Close"}</button><button className="al-primary-button" disabled={passwordBusy || !isStrongPassword(newPassword) || newPassword !== confirmPassword} onClick={() => void submitPassword()}>{passwordBusy ? (language === "ar" ? "جاري الحفظ…" : "Saving…") : (language === "ar" ? "حفظ كلمة المرور" : "Save password")}</button></div></section></div>}
    </div>
  );
}
