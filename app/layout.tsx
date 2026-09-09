import type { Metadata } from "next";
import AppShell from "./components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://assetlens-ai.vercel.app"),
  title: "AssetLens AI",
  description: "Mobile asset survey, offline field capture and AI-powered nameplate analysis.",
  manifest: "/manifest.webmanifest",
  applicationName: "AssetLens AI",
  appleWebApp: { capable: true, title: "AssetLens", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: {
    title: "AssetLens AI",
    description: "AI-powered asset nameplate analysis and structured technical data extraction.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AssetLens AI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AssetLens AI",
    description: "AI-powered asset nameplate analysis and structured technical data extraction.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icon-192.png" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#092d3c" };

const developmentCacheReset = `
(() => {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;
  const marker = "assetlens_dev_cache_reset_16_3_0";
  Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()]).then(async ([registrations, keys]) => {
    const assetlensWorkers = registrations.filter(registration => {
      const worker = registration.active || registration.waiting || registration.installing;
      return worker && new URL(worker.scriptURL).pathname === "/sw.js";
    });
    const assetlensCaches = keys.filter(key => key.startsWith("assetlens-"));
    if (!assetlensWorkers.length && !assetlensCaches.length) return;
    await Promise.all([
      ...assetlensWorkers.map(registration => registration.unregister()),
      ...assetlensCaches.map(key => caches.delete(key)),
    ]);
    if (!sessionStorage.getItem(marker)) {
      sessionStorage.setItem(marker, "true");
      location.reload();
    }
  }).catch(() => undefined);
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl" data-scroll-behavior="smooth"><body>
    {process.env.NODE_ENV !== "production" && <script dangerouslySetInnerHTML={{ __html: developmentCacheReset }} />}
    <AppShell>{children}</AppShell>
  </body></html>;
}
