"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const CRUMB_LABELS: Record<string, string> = {
  admin: "Workspace",
  participants: "Participants",
  events: "Events",
  inbox: "Inbox",
  travel: "Travel",
  finance: "Finance",
  "transfer-lists": "Transfer lists",
  imports: "Imports",
  notifications: "Notifications",
  enrollments: "Enrolments",
  new: "New",
  edit: "Edit",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function humanize(seg: string): string {
  if (CRUMB_LABELS[seg]) return CRUMB_LABELS[seg];
  // Short region-ID shape (MY001, SG42) → uppercase as-is.
  if (/^[a-z]{2,3}-?\d+$/i.test(seg)) return seg.toUpperCase();
  // Full UUID → keep the first 8 chars; admins get a handle without the noise.
  if (UUID_RE.test(seg)) return seg.slice(0, 8);
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isUuid(seg: string): boolean {
  return UUID_RE.test(seg);
}

function useCrumbs(
  pathname: string,
): { href: string; label: string; mono?: boolean }[] {
  return useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const crumbs: { href: string; label: string; mono?: boolean }[] = [];
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      crumbs.push({
        href: acc,
        label: humanize(p),
        mono: isUuid(p),
      });
    }
    return crumbs;
  }, [pathname]);
}

export function TopBar() {
  const pathname = usePathname() ?? "/admin";
  const crumbs = useCrumbs(pathname);
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("gmc-admin-lang")) as
      | "en"
      | "zh"
      | null;
    if (saved === "en" || saved === "zh") setLang(saved);
    setNow(new Date());
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Placeholder — command palette arrives in a later milestone.
        const input = document.getElementById("gmc-topbar-search") as HTMLInputElement | null;
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function toggleLang() {
    const next = lang === "en" ? "zh" : "en";
    setLang(next);
    try {
      localStorage.setItem("gmc-admin-lang", next);
    } catch {
      /* ignore */
    }
  }

  const dateLabel =
    now?.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }) ?? "—";

  return (
    <header
      className="sticky top-0 z-30 h-16 border-b border-[var(--paper-shadow)]
                 bg-[color-mix(in_srgb,var(--paper-warm)_86%,transparent)]
                 backdrop-blur-md
                 flex items-center gap-4 px-6 md:px-8"
    >
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-2 text-[12px] text-[var(--ink-mute)] min-w-0">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            if (i === 0 && c.label === "Workspace") {
              return (
                <li key={c.href} className="flex items-center gap-2 flex-none">
                  <Link
                    href="/admin"
                    className="inline-flex items-center gap-1.5 text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]"
                      aria-hidden="true"
                    />
                    <span className="text-[11px] tracking-[0.22em] uppercase">GMC</span>
                  </Link>
                  {crumbs.length > 1 ? <Divider /> : null}
                </li>
              );
            }
            return (
              <li key={c.href} className="flex items-center gap-2 min-w-0">
                {isLast ? (
                  <span
                    className={`leading-[1.2] text-[var(--ink)] truncate ${
                      c.mono
                        ? "font-mono text-[12px] text-[var(--ink-soft)]"
                        : "font-display text-[15px]"
                    }`}
                    title={c.mono ? c.href : undefined}
                  >
                    {c.label}
                  </span>
                ) : (
                  <>
                    <Link
                      href={c.href}
                      className={`text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)] truncate ${
                        c.mono ? "font-mono text-[11.5px]" : ""
                      }`}
                    >
                      {c.label}
                    </Link>
                    <Divider />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Search (⌘K placeholder) */}
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="hidden md:flex items-center gap-2.5 rounded-[var(--radius-pill)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   px-3.5 h-9 min-w-[260px] max-w-[340px]
                   text-[12.5px] text-[var(--ink-mute)]
                   focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)]
                   transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          className="text-[var(--ink-faint)] flex-none"
        >
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          id="gmc-topbar-search"
          type="search"
          placeholder="Search participants, events…"
          aria-label="Search"
          className="flex-1 bg-transparent outline-none text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        <kbd
          className="flex-none text-[10px] tracking-[0.06em] text-[var(--ink-faint)]
                     border border-[var(--paper-shadow)] rounded-[var(--radius-sm)] px-1.5 py-[1px] leading-none
                     font-mono"
          aria-hidden="true"
        >
          ⌘K
        </kbd>
      </form>

      <Separator />

      {/* Language toggle */}
      <button
        type="button"
        onClick={toggleLang}
        aria-label={`Switch to ${lang === "en" ? "Chinese" : "English"}`}
        className="group inline-flex items-center gap-1 h-8 px-2.5 rounded-[var(--radius-pill)]
                   text-[11px] tracking-[0.18em] uppercase
                   text-[var(--ink-mute)] hover:text-[var(--ink)]
                   hover:bg-[var(--paper-deep)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color] duration-[var(--dur-fast)]"
      >
        <span
          className={`px-1 ${lang === "en" ? "text-[var(--cinnabar)]" : ""}`}
          aria-pressed={lang === "en"}
        >
          EN
        </span>
        <span className="text-[var(--ink-faint)]" aria-hidden="true">
          ·
        </span>
        <span
          className={`px-1 ${lang === "zh" ? "text-[var(--cinnabar)]" : ""}`}
          aria-pressed={lang === "zh"}
        >
          中
        </span>
      </button>

      {/* Notifications */}
      <button
        type="button"
        aria-label="Notifications"
        title="Notifications (coming in M7)"
        className="relative inline-flex items-center justify-center w-8 h-8 rounded-full
                   text-[var(--ink-mute)] hover:text-[var(--cinnabar)]
                   hover:bg-[var(--cinnabar-wash)]
                   focus-visible:shadow-[var(--shadow-focus)]
                   transition-[background-color,color] duration-[var(--dur-fast)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 10V7a3.5 3.5 0 1 1 7 0v3l1 1.3H2.5L3.5 10z" />
          <path d="M5.7 11.8a1.3 1.3 0 0 0 2.6 0" />
        </svg>
        <span
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]
                     shadow-[0_0_0_2px_var(--paper-warm)]"
          aria-hidden="true"
        />
      </button>

      <Separator />

      {/* Date + env */}
      <div className="hidden lg:flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
        <span>{dateLabel}</span>
        <span className="text-[var(--ink-faint)]">·</span>
        <span className="inline-flex items-center gap-1 text-[var(--cinnabar-deep)]">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]"
            aria-hidden="true"
          />
          Live
        </span>
      </div>
    </header>
  );
}

function Divider() {
  return (
    <span aria-hidden="true" className="text-[var(--ink-faint)] text-[11px] select-none">
      /
    </span>
  );
}

function Separator() {
  return (
    <span
      aria-hidden="true"
      className="hidden md:block h-5 w-px bg-[var(--paper-shadow)]"
    />
  );
}
