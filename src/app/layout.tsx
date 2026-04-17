import type { Metadata } from "next";
import { Noto_Serif_SC, IBM_Plex_Sans } from "next/font/google";
import { LocaleProvider } from "@/lib/locale-client";
import { getServerLocale } from "@/lib/locale-server";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import "./globals.css";

const notoSerifSC = Noto_Serif_SC({
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "GMC · Glorious Melodies Consultancy",
    template: "%s · GMC",
  },
  description:
    "GMC 学员中心 — 从报名、审核到现场分组，一处专属的学员管理系统。GMC participant portal — bringing classical wisdom into contemporary practice.",
  applicationName: "GMC",
  authors: [{ name: "Glorious Melodies Consultancy" }],
  openGraph: {
    type: "website",
    siteName: "GMC",
    title: "GMC · Glorious Melodies Consultancy",
    description: "Classical wisdom in contemporary practice.",
    locale: "zh_SG",
    alternateLocale: "en_SG",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();

  return (
    <html
      lang={locale === "zh" ? "zh-Hans" : "en"}
      className={`${notoSerifSC.variable} ${plexSans.variable}`}
    >
      <body className="flex flex-col min-h-screen">
        <LocaleProvider locale={locale}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--ink)] focus:text-[var(--paper-warm)]"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </LocaleProvider>
      </body>
    </html>
  );
}
