"use client";

import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/lib/locale-client";

export function SiteFooter() {
  const { locale, t } = useLocale();
  const year = new Date().getFullYear();

  const colA = [
    { href: "/about", zh: "关于我们", en: "About" },
    { href: "/programs", zh: "课程项目", en: "Programs" },
    { href: "/events", zh: "活动", en: "Events" },
  ];
  const colB = [
    { href: "/global-collaboration", zh: "国际合作", en: "Collaboration" },
    { href: "/wuge-app", zh: "吴歌 APP", en: "Wuge App" },
    { href: "/news", zh: "动态", en: "News" },
  ];
  const colC = [
    { href: "/register", zh: "立即报名", en: "Register" },
    { href: "https://e-course.gmcglobal.com/", zh: "在线课程", en: "E-Course", external: true },
  ];

  return (
    <footer className="mt-24 md:mt-32 bg-[var(--paper-deep)] border-t border-[var(--paper-shadow)]">
      <div className="mx-auto max-w-[1280px] px-6 md:px-10 py-16 md:py-20 grid gap-14 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Image
            src="/gmc-logo.png"
            alt="GMC · Glorious Melodies Consultancy"
            width={600}
            height={346}
            className="h-12 w-auto"
          />
          <p className="mt-6 font-display text-[20px] text-[var(--ink)] leading-[1.35] max-w-[280px]">
            {locale === "zh"
              ? "以文化为种，让智慧为光。"
              : "Sow culture as the seed, let wisdom shine as the light."}
          </p>
          <p className="mt-4 text-[13px] leading-[1.7] text-[var(--ink-mute)] max-w-[300px]">
            {locale === "zh"
              ? "Glorious Melodies Consultancy · 新加坡"
              : "Glorious Melodies Consultancy · Singapore"}
          </p>
        </div>

        <FooterCol title={locale === "zh" ? "课程" : "Programs"} items={colA} locale={locale} />
        <FooterCol title={locale === "zh" ? "组织" : "Organisation"} items={colB} locale={locale} />
        <FooterCol title={locale === "zh" ? "参与" : "Take part"} items={colC} locale={locale} />
      </div>

      <div className="border-t border-[var(--paper-shadow)]">
        <div className="mx-auto max-w-[1280px] px-6 md:px-10 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-[12px] text-[var(--ink-mute)]">
          <div className="flex flex-col md:flex-row gap-2 md:gap-6">
            <span>10 Winstedt Road #01-12 Block B, Singapore 227977</span>
            <span>+65 8611 1315</span>
          </div>
          <div>© {year} Glorious Melodies Consultancy. {t("common.allRightsReserved", locale === "zh" ? "版权所有" : "All rights reserved.")}</div>
        </div>
      </div>
    </footer>
  );
}

type FooterItem = { href: string; zh: string; en: string; external?: boolean };

function FooterCol({ title, items, locale }: { title: string; items: FooterItem[]; locale: "zh" | "en" }) {
  return (
    <div>
      <h4 className="font-body text-[11px] font-semibold tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        {title}
      </h4>
      <ul className="mt-5 flex flex-col gap-3">
        {items.map((item) => {
          const label = locale === "zh" ? item.zh : item.en;
          const cls =
            "inline-flex items-center gap-2 text-[14px] text-[var(--ink-soft)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]";
          return (
            <li key={item.href}>
              {item.external ? (
                <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
                  {label}
                  <span aria-hidden="true" className="text-[var(--ink-faint)]">↗</span>
                </a>
              ) : (
                <Link href={item.href} className={cls}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
