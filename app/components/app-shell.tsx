"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, ApiClientError, invalidateApiCache, prefetchApi } from "../lib/api-client";
import { changePassword, signOut } from "../lib/supabase-auth";
import { canUseModule, ModuleKey, ModulePermission } from "../lib/module-permissions";

type UserRole = "admin" | "project_manager" | "reviewer" | "surveyor" | "viewer";
type Me = { name: string; email: string; role: UserRole; modules: ModuleKey[]; modulePermissions: ModulePermission[] };
type NavItem = { href: string; label: string; labelAr: string; icon: IconName; module: ModuleKey };
type IconName = "dashboard" | "capture" | "assets" | "organization" | "location" | "transfer" | "reports" | "admin" | "chevron" | "menu" | "close" | "logout" | "wifi";

const navigation: NavItem[] = [
  { href: "/", label: "Dashboard", labelAr: "لوحة التحكم", icon: "dashboard", module: "dashboard" },
  { href: "/capture", label: "Capture & Analyze", labelAr: "التقاط وتحليل", icon: "capture", module: "capture" },
  { href: "/organization", label: "Organization", labelAr: "المشاريع والهيكل", icon: "organization", module: "organization" },
  { href: "/locations", label: "Locations", labelAr: "المواقع", icon: "location", module: "locations" },
  { href: "/transfers", label: "Asset Transfer", labelAr: "نقل الأصول", icon: "transfer", module: "transfers" },
  { href: "/reports", label: "Reports", labelAr: "التقارير", icon: "reports", module: "reports" },
  { href: "/admin", label: "Administration", labelAr: "الإدارة", icon: "admin", module: "administration" },
];

const pageTitles: Record<string, { ar: string; en: string }> = {
  "/": { ar: "لوحة التحكم", en: "Dashboard" },
  "/capture": { ar: "التقاط وتحليل أصل", en: "Capture & Analyze" },
  "/organization": { ar: "المشاريع والهيكل", en: "Organization" },
  "/locations": { ar: "المواقع", en: "Locations" },
  "/transfers": { ar: "نقل الأصول", en: "Asset Transfer" },
  "/reports": { ar: "التقارير", en: "Reports" },
  "/admin": { ar: "إدارة النظام", en: "Administration" },
};

const SERVICE_WORKER_VERSION = "16.3.0";
const roleLabels: Record<UserRole, string> = { admin: "Administrator", project_manager: "Project Manager", reviewer: "Reviewer", surveyor: "Surveyor", viewer: "Viewer" };

function Icon({ name }: { name: IconName }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "dashboard") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
  if (name === "capture") return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="4"/><path d="m17.5 17.5 2 2"/></svg>;
  if (name === "assets") return <svg {...common}><path d="M6 7.5h12v12H6z"/><path d="M9 7.5V5h6v2.5M9 12h6M9 16h4"/></svg>;
  if (name === "organization") return <svg {...common}><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></svg>;
  if (name === "location") return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
  if (name === "transfer") return <svg {...common}><path d="M7 7h12l-3-3M17 17H5l3 3M19 7l-3 3M5 17l3-3"/></svg>;
  if (name === "reports") return <svg {...common}><path d="M5 3h14v18H5z"/><path d="M9 17v-4M12 17V8M15 17v-6"/></svg>;
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
  const [me, setMe] = useState<Me | null>(null);
  const [navigatingTo, setNavigatingTo] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDrawerOpen(false); setProfileOpen(false); setNavigatingTo(""); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

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
  const title = pageTitles[pathname] || { ar: "AssetLens AI", en: "Workspace" };
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
    return <div className="al-navigation-loader is-static" role="status"><div><Image src="/assetlens-logo.png" alt="" width={170} height={55} /><span>جاري فتح أول صفحة مسموحة…</span><i /></div></div>;
  }

  async function logout() {
    await signOut();
    invalidateApiCache();
    router.replace("/login");
  }

  async function submitPassword() {
    setPasswordMessage("");
    if (newPassword !== confirmPassword) { setPasswordMessage("كلمتا المرور غير متطابقتين."); return; }
    setPasswordBusy(true);
    try {
      await changePassword(newPassword);
      setPasswordMessage("تم تغيير كلمة المرور بنجاح.");
      setNewPassword(""); setConfirmPassword("");
    } catch (reason) { setPasswordMessage(reason instanceof Error ? reason.message : "تعذر تغيير كلمة المرور."); }
    finally { setPasswordBusy(false); }
  }

  function warmNavigation(href: string) {
    router.prefetch(href);
    if (href === "/") void prefetchApi("/api/dashboard", 20_000);
    else if (["/organization", "/locations", "/transfers"].includes(href)) void prefetchApi("/api/config?scope=structure", 5 * 60_000);
    else if (href === "/reports") void prefetchApi("/api/reports", 30_000);
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

  return (
    <div className={`al-frame ${collapsed ? "is-collapsed" : ""}`} dir="rtl" aria-busy={Boolean(navigatingTo)}>
      <button className={`al-drawer-backdrop ${drawerOpen ? "is-open" : ""}`} onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة" tabIndex={drawerOpen ? 0 : -1} />
      <aside id="assetlens-navigation" className={`al-sidebar ${drawerOpen ? "is-open" : ""}`} aria-label="التنقل الرئيسي">
        <div className="al-sidebar-brand">
          <Image src="/assetlens-logo.png" alt="AssetLens AI" width={180} height={58} priority />
          <button className="al-mobile-close" onClick={() => setDrawerOpen(false)} aria-label="إغلاق القائمة"><Icon name="close" /></button>
        </div>
        <nav className="al-nav">
          {visibleNavigation.map(item => (
            <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined} title={collapsed ? item.label : undefined} onPointerEnter={() => warmNavigation(item.href)} onFocus={() => warmNavigation(item.href)} onClick={() => beginNavigation(item.href)}>
              <span className="al-nav-icon"><Icon name={item.icon} /></span>
              <span className="al-nav-copy"><strong>{item.label}</strong><small>{item.labelAr}</small></span>
              <span className="al-nav-arrow"><Icon name="chevron" /></span>
            </Link>
          ))}
        </nav>
        <div className="al-sidebar-foot">
          <div className="al-user-summary"><span>{initials || "AL"}</span><div><strong>{me?.name || "AssetLens User"}</strong><small>{me ? roleLabels[me.role] : "User"}</small></div></div>
          <button className="al-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}><Icon name="chevron" /><span>{collapsed ? "Expand" : "Collapse menu"}</span></button>
        </div>
      </aside>
      <div className="al-stage">
        <div className={`al-route-progress ${navigatingTo ? "is-active" : ""}`} aria-hidden="true"><span /></div>
        {navigatingTo && <div className="al-navigation-loader" role="status" aria-live="polite"><div><Image src="/assetlens-logo.png" alt="" width={170} height={55} /><span>{online ? "جاري فتح الصفحة…" : "جاري فتح النسخة المحفوظة…"}</span><i /></div></div>}
        <header className="al-topbar">
          <div className="al-topbar-title">
            <button className="al-menu-button" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} aria-controls="assetlens-navigation" aria-label="فتح القائمة"><Icon name="menu" /></button>
            <div><small>{title.en}</small><h1>{title.ar}</h1></div>
          </div>
          <div className="al-topbar-actions">
            <span className={`al-network ${online ? "online" : "offline"}`}><i /><span>{online ? "متصل" : "بدون إنترنت"}</span></span>
            {me && canUseModule(me.modulePermissions, "capture", "create") && <Link className="al-quick-capture" href="/capture" onPointerEnter={() => warmNavigation("/capture")} onClick={() => beginNavigation("/capture")}><Icon name="capture" /><span>التقاط أصل</span></Link>}
            <div className="al-profile-menu" ref={profileRef}>
              <button onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen} aria-label="خيارات الحساب"><span>{initials || "AL"}</span><div><strong>{me?.name || "AssetLens User"}</strong><small>{me?.email || "جاري التحقق…"}</small></div></button>
              {profileOpen && <div className="al-profile-popover"><div><strong>{me?.name || "AssetLens User"}</strong><small>{me?.email || ""}</small></div><button onClick={() => { setProfileOpen(false); setPasswordOpen(true); setPasswordMessage(""); }}>🔐 تغيير كلمة المرور</button><button onClick={() => void logout()}><Icon name="logout" /> تسجيل الخروج</button></div>}
            </div>
          </div>
        </header>
        <main className="al-content">{children}</main>
        <nav className="al-mobile-nav" aria-label="التنقل السريع">
          {visibleNavigation.filter(item => ["/", "/capture", "/locations", "/reports"].includes(item.href)).map(item => <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} aria-current={isActive(pathname, item.href) ? "page" : undefined} onTouchStart={() => warmNavigation(item.href)} onClick={() => beginNavigation(item.href)}><Icon name={item.icon} /><span>{item.label === "Capture & Analyze" ? "Capture" : item.label.split(" ")[0]}</span></Link>)}
        </nav>
      </div>
      {passwordOpen && <div className="al-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !passwordBusy) setPasswordOpen(false); }}><section className="al-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><span className="al-dialog-icon">🔐</span><h3 id="password-dialog-title">تغيير كلمة المرور</h3><p>استخدم كلمة مرور قوية من 10 أحرف على الأقل.</p><label><span>كلمة المرور الجديدة</span><input className="ltr-input" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label><span>تأكيد كلمة المرور</span><input className="ltr-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>{passwordMessage && <p role="status">{passwordMessage}</p>}<div><button className="al-secondary-button" disabled={passwordBusy} onClick={() => setPasswordOpen(false)}>إغلاق</button><button className="al-primary-button" disabled={passwordBusy || newPassword.length < 10} onClick={() => void submitPassword()}>{passwordBusy ? "جاري الحفظ…" : "حفظ كلمة المرور"}</button></div></section></div>}
    </div>
  );
}
