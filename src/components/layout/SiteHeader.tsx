"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-client";
import { LanguageToggle } from "./LanguageToggle";

type MegaCol = {
  heading: { zh: string; en: string };
  items: Array<{ href: string; zh: string; en: string; hint?: { zh: string; en: string } }>;
};

type NavItem = {
  href: string;
  label: { zh: string; en: string };
  mega?: { cols: MegaCol[] };
};

const NAV: NavItem[] = [
  { href: "/about", label: { zh: "关于我们", en: "About" } },
  {
    href: "/programs",
    label: { zh: "项目", en: "Programs" },
    mega: {
      cols: [
        {
          heading: { zh: "旗舰课程", en: "Flagship programs" },
          items: [
            { href: "/programs/philosophy-of-humanities", zh: "人文哲学", en: "Philosophy of Humanities", hint: { zh: "哲学 · 人文 · 管理", en: "Philosophy · humanities · management" } },
            { href: "/programs/business-program", zh: "企业家班", en: "Business Program", hint: { zh: "东西方管理哲学的创造性整合", en: "East + West management, integrated" } },
          ],
        },
        {
          heading: { zh: "全年龄段", en: "Open access" },
          items: [
            { href: "/programs/culinary-wealth", zh: "食尚财富", en: "Culinary Wealth", hint: { zh: "营养 · 情绪 · 身心训练", en: "Nutrition · emotion · body-mind" } },
            { href: "/programs/bgm-youth", zh: "BGM 少年班", en: "BGM Youth Development", hint: { zh: "12–18 岁素养课程", en: "Ages 12–18" } },
          ],
        },
        {
          heading: { zh: "概览", en: "Overview" },
          items: [
            { href: "/programs", zh: "全部课程", en: "All programs" },
            { href: "/about", zh: "教育理念", en: "Educational philosophy" },
          ],
        },
      ],
    },
  },
  {
    href: "/global-collaboration",
    label: { zh: "国际合作", en: "Collaboration" },
    mega: {
      cols: [
        {
          heading: { zh: "战略伙伴", en: "Strategic partners" },
          items: [
            { href: "/global-collaboration#unesco", zh: "UNESCO ICHEI", en: "UNESCO ICHEI" },
            { href: "/global-collaboration#brest", zh: "Brest Business School", en: "Brest Business School" },
            { href: "/global-collaboration#sungkyunkwan", zh: "成均馆大学", en: "Sungkyunkwan University" },
            { href: "/global-collaboration#yonsei", zh: "延世大学", en: "Yonsei University" },
            { href: "/global-collaboration#smu", zh: "新加坡管理大学 (SMU)", en: "Singapore Management University" },
          ],
        },
        {
          heading: { zh: "合作方向", en: "Initiatives" },
          items: [
            { href: "/global-collaboration#joint-research", zh: "联合研究院", en: "Joint research institutes" },
            { href: "/global-collaboration#scholarship", zh: "GMC · SMU 奖学金", en: "GMC Scholarship at SMU" },
          ],
        },
      ],
    },
  },
  { href: "/wuge-app", label: { zh: "吴歌 APP", en: "Wuge App" } },
  { href: "/news", label: { zh: "动态", en: "News" } },
  { href: "/events", label: { zh: "课程", en: "Courses" } },
];

type AccountState = { href: string; isParticipant: boolean } | null;

export function SiteHeader({ account = null }: { account?: AccountState }) {
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeMega, setActiveMega] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setMobileOpen(false);
    setActiveMega(null);
  }, [pathname]);

  // Escape key closes any open mega menu
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveMega(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openMega(href: string) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setActiveMega(href);
  }
  function closeMegaSoon() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setActiveMega(null), 120);
  }

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)]
                  ${scrolled || activeMega
                    ? "bg-[var(--paper-warm)]/95 backdrop-blur-sm border-[var(--paper-shadow)] shadow-[var(--shadow-paper-1)]"
                    : "bg-transparent border-transparent"}`}
      onMouseLeave={closeMegaSoon}
    >
      <div className="mx-auto max-w-[1280px] px-6 md:px-10 h-[72px] flex items-center justify-between">
        {/* Brand */}
        <Link
          href="/"
          className="group flex items-center gap-3 transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] active:translate-y-[1px]"
          aria-label={t("common.siteName", "GMC")}
          onMouseEnter={() => setActiveMega(null)}
        >
          <Image
            src="/gmc-logo.png"
            alt="GMC · Glorious Melodies Consultancy"
            width={600}
            height={346}
            priority
            className="h-10 md:h-11 w-auto transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-[1.02]"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-8" aria-label="Primary">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            const label = item.label[locale];
            const hasMega = Boolean(item.mega);
            const isOpen = activeMega === item.href;
            return (
              <div
                key={item.href}
                className="relative"
                onMouseEnter={() => hasMega && openMega(item.href)}
                onMouseLeave={closeMegaSoon}
              >
                <Link
                  href={item.href}
                  aria-haspopup={hasMega ? "menu" : undefined}
                  aria-expanded={hasMega ? isOpen : undefined}
                  className={`relative inline-flex items-center gap-1.5 text-[13px] tracking-[0.06em] uppercase transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]
                              ${active || isOpen ? "text-[var(--cinnabar)]" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}
                  onFocus={() => hasMega && openMega(item.href)}
                >
                  {label}
                  {hasMega ? (
                    <svg
                      aria-hidden="true"
                      className={`w-2.5 h-2.5 transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] ${isOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 10 10"
                      fill="none"
                    >
                      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 -bottom-[6px] h-px bg-[var(--cinnabar)] transition-[width] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                                ${active ? "w-full" : "w-0"}`}
                  />
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-3 md:gap-5">
          <LanguageToggle className="hidden sm:inline-flex" />
          {account?.isParticipant ? (
            <Link
              href={account.href}
              className="hidden md:inline-flex items-center gap-2 h-10 px-5 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12px] font-medium tracking-[0.02em]
                         shadow-[0_3px_12px_rgba(37,99,235,0.28)]
                         transition-[transform,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                         hover:-translate-y-[1px] hover:bg-[var(--cinnabar-deep)] hover:shadow-[0_6px_18px_rgba(37,99,235,0.38)]
                         active:translate-y-0"
              style={{ color: "var(--paper-warm)" }}
            >
              {locale === "zh" ? "学员中心" : "My portal"}
              <span aria-hidden="true" className="w-3 h-px bg-current" />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden md:inline-flex items-center text-[12px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
                style={{ color: "var(--ink-soft)" }}
              >
                {locale === "zh" ? "登录" : "Sign in"}
              </Link>
            </>
          )}

          {/* Mobile menu trigger */}
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden w-10 h-10 flex flex-col items-center justify-center gap-[5px] text-[var(--ink)]
                       transition-transform duration-[var(--dur-fast)] active:scale-95"
          >
            <span className={`block w-5 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] ${mobileOpen ? "translate-y-[6px] rotate-45" : ""}`} />
            <span className={`block w-5 h-px bg-current transition-opacity duration-[var(--dur-fast)] ${mobileOpen ? "opacity-0" : "opacity-100"}`} />
            <span className={`block w-5 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] ${mobileOpen ? "-translate-y-[6px] -rotate-45" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mega-menu drawer (desktop) */}
      <div
        className={`hidden lg:block absolute left-0 right-0 top-[72px] overflow-hidden transition-[max-height,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]
                    ${activeMega ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"}`}
        onMouseEnter={() => activeMega && openMega(activeMega)}
        onMouseLeave={closeMegaSoon}
      >
        <div className="bg-[var(--paper-warm)] border-b border-[var(--paper-shadow)] shadow-[var(--shadow-paper-2)]">
          <div className="mx-auto max-w-[1280px] px-6 md:px-10 py-10">
            {NAV.map((item) =>
              item.mega && activeMega === item.href ? (
                <div key={item.href} className="grid grid-cols-[220px_1fr] gap-10">
                  <div>
                    <span className="eyebrow">{item.label[locale]}</span>
                    <p className="mt-4 text-[13px] leading-[1.7] text-[var(--ink-mute)] max-w-[200px]">
                      {locale === "zh" ? "选择一个方向，深入了解。" : "Choose a direction to go deeper."}
                    </p>
                  </div>
                  <div className={`grid gap-10 ${item.mega.cols.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                    {item.mega.cols.map((col) => (
                      <div key={col.heading.en}>
                        <h4 className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                          {col.heading[locale]}
                        </h4>
                        <ul className="mt-5 flex flex-col gap-4">
                          {col.items.map((link) => (
                            <li key={link.href}>
                              <Link
                                href={link.href}
                                className="group inline-flex flex-col gap-1 hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
                              >
                                <span className="font-display text-[16px] leading-[1.3] text-[var(--ink)] group-hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]">
                                  {link[locale]}
                                </span>
                                {link.hint ? (
                                  <span className="text-[12px] leading-[1.5] text-[var(--ink-mute)]">{link.hint[locale]}</span>
                                ) : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={`lg:hidden overflow-hidden transition-[max-height,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]
                    ${mobileOpen ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="border-t border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-6 py-6 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between h-12 border-b border-[var(--paper-shadow)]/60 text-[15px]
                            transition-colors duration-[var(--dur-fast)] ${active ? "text-[var(--cinnabar)]" : "text-[var(--ink)]"}`}
              >
                <span className="font-display">{item.label[locale]}</span>
                <span
                  aria-hidden="true"
                  className="w-5 h-px bg-current transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-x-[1.6] origin-right"
                />
              </Link>
            );
          })}
          <div className="flex items-center justify-between mt-4">
            <LanguageToggle />
            {account?.isParticipant ? (
              <Link
                href={account.href}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12px] font-medium tracking-[0.02em] shadow-[0_3px_12px_rgba(37,99,235,0.28)]"
                style={{ color: "var(--paper-warm)" }}
              >
                {locale === "zh" ? "学员中心" : "My portal"}
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/login"
                  className="text-[12px] tracking-[0.06em] uppercase text-[var(--ink-soft)]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  {locale === "zh" ? "登录" : "Sign in"}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
