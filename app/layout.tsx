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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body><AppShell>{children}</AppShell></body></html>;
}
