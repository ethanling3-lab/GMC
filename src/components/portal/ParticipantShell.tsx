"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

// Mobile-first shell for the /me portal. Top bar + sidebar (desktop) /
// bottom-tab nav (mobile). Bilingual labels everywhere. Lighter paper
// chrome than admin since the audience is non-admin participants.

type NavItem = {
  href: string;
  label_en: string;
  label_cn: string;
  iconKey: "home" | "profile" | "enrollments" | "payments" | "flights" | "recordings" | "group" | "recruit";
};

const NAV: NavItem[] = [
  { href: "/me", label_en: "Home", label_cn: "首页", iconKey: "home" },
  { href: "/me/profile", label_en: "Profile", label_cn: "资料", iconKey: "profile" },
  { href: "/me/enrollments", label_en: "Enrollments", label_cn: "报名", iconKey: "enrollments" },
  { href: "/me/payments", label_en: "Payments", label_cn: "付款", iconKey: "payments" },
  { href: "/me/flights", label_en: "Flights", label_cn: "航班", iconKey: "flights" },
  { href: "/me/recordings", label_en: "Recordings", label_cn: "录像", iconKey: "recordings" },
  { href: "/me/group", label_en: "Group", label_cn: "小组", iconKey: "group" },
  { href: "/me/recruit", label_en: "Recruit", label_cn: "感召", iconKey: "recruit" },
];

function isActive(pathname: string, href: string) {
  if (href === "/me") return pathname === "/me";
  return pathname === href || pathname.startsWith(href + "/");
}

function Icon({ name }: { name: NavItem["iconKey"] }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "home":
      return (
        <svg {...props}>
          <path d="M3 8.5L9 3l6 5.5V15h-4v-4H7v4H3z" />
        </svg>
      );
    case "profile":
      return (
        <svg {...props}>
          <circle cx="9" cy="6.5" r="3" />
          <path d="M3 15c1-3 3-4.5 6-4.5s5 1.5 6 4.5" />
        </svg>
      );
    case "enrollments":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="12" height="11" rx="1.5" />
          <path d="M3 7h12M6 3v3M12 3v3" />
        </svg>
      );
    case "payments":
      return (
        <svg {...props}>
          <rect x="2.5" y="5" width="13" height="9" rx="1.5" />
          <path d="M2.5 8h13" />
          <circle cx="12" cy="11" r="1" />
        </svg>
      );
    case "flights":
      return (
        <svg {...props}>
          <path d="M3 13l5-1.5L11 4l2 1-2 7.5L13 15l-1.5 1-3-2-3 1-1.5-1z" />
        </svg>
      );
    case "recordings":
      return (
        <svg {...props}>
          <rect x="2.5" y="4" width="13" height="10" rx="1.5" />
          <path d="M7.5 7v4l4-2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "group":
      return (
        <svg {...props}>
          <circle cx="9" cy="9" r="6" />
          <circle cx="9" cy="9" r="2" />
          <path d="M9 3v2M9 13v2M3 9h2M13 9h2" />
        </svg>
      );
    case "recruit":
      return (
        <svg {...props}>
          <circle cx="6.5" cy="7" r="2.5" />
          <path d="M2 14c.5-2.5 2-4 4.5-4s4 1.5 4.5 4" />
          <path d="M13 6v4M11 8h4" />
        </svg>
      );
  }
}

export function ParticipantShell({
  participantName,
  regionId,
  children,
}: {
  participantName: string;
  regionId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/me";
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/participant/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="min-h-[calc(100dvh-160px)] bg-[var(--paper)]">
      {/* Top bar (always visible) */}
      <header className="sticky top-0 z-20 bg-[var(--paper-warm)]/95 backdrop-blur border-b border-[var(--paper-shadow)]">
        <div className="px-4 md:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/me"
              className="inline-flex items-center gap-2 text-[var(--ink)]"
              style={{ color: "var(--ink)" }}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[var(--paper-shadow)] font-display text-[12px]">
                G
              </span>
              <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                Portal · 学员中心
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden sm:flex flex-col items-end min-w-0">
              <span className="text-[12.5px] text-[var(--ink)] truncate max-w-[200px]">
                {participantName}
              </span>
              <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] tabular-nums">
                {regionId ?? "—"}
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="px-3 h-9 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11.5px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] disabled:opacity-50 transition-colors"
            >
              {loggingOut ? "…" : "Log out · 登出"}
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 md:px-8 max-w-[1100px] mx-auto md:flex md:gap-8 md:pt-8 pb-28 md:pb-12">
        {/* Sidebar (desktop only) */}
        <aside className="hidden md:block w-[200px] flex-none">
          <nav className="sticky top-20 space-y-0.5" aria-label="Portal navigation">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 px-3.5 py-2.5 rounded-[var(--radius-md)] text-[13px] tracking-[0.01em] transition-colors ${
                    active
                      ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
                  style={{ color: active ? "var(--cinnabar-deep)" : "var(--ink-soft)" }}
                >
                  <span
                    className={`w-5 h-5 inline-flex items-center justify-center ${
                      active ? "text-[var(--cinnabar)]" : "text-[var(--ink-mute)]"
                    }`}
                  >
                    <Icon name={item.iconKey} />
                  </span>
                  <span className="flex-1 truncate">{item.label_en}</span>
                  <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                    {item.label_cn}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-6 md:pt-0">{children}</div>
      </div>

      {/* Mobile bottom-tab nav */}
      <nav
        aria-label="Portal navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--paper-warm)] border-t border-[var(--paper-shadow)] shadow-[0_-2px_8px_rgba(11,41,84,0.06)]"
      >
        <ul className="flex justify-around px-2 py-1">
          {NAV.slice(0, 5).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex flex-col items-center gap-0.5 px-2 py-2 rounded-[var(--radius-md)] transition-colors ${
                    active ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-mute)]"
                  }`}
                  style={{ color: active ? "var(--cinnabar-deep)" : "var(--ink-mute)" }}
                >
                  <Icon name={item.iconKey} />
                  <span className="text-[9.5px] tracking-[0.12em] uppercase">
                    {item.label_en}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
