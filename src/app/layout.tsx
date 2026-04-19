import type { Metadata } from "next";
import { Newsreader, Inter, Noto_Sans_SC } from "next/font/google";
import { LocaleProvider } from "@/lib/locale-client";
import { getServerLocale } from "@/lib/locale-server";
import "./globals.css";

const newsreader = Newsreader({
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const inter = Inter({
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

const notoSansSC = Noto_Sans_SC({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-cjk",
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
      className={`${newsreader.variable} ${inter.variable} ${notoSansSC.variable}`}
    >
      <body className="flex flex-col min-h-screen">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
