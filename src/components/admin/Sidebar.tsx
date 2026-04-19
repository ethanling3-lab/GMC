"use client";

import Image from "next/image";
import Link from "next/link";
import { AdminNav } from "./AdminNav";
import { LogoutButton } from "./LogoutButton";
import type { AdminContext } from "@/lib/admin-guard";

const ROLE_LABEL: Record<AdminContext["role"], string> = {
  super_admin: "Super Admin",
  regional_lead: "Regional Lead",
  customer_service: "Customer Service",
  finance: "Finance",
  instructor: "Instructor",
};

function initials(name: string | null, email: string): string {
  const src = (name ?? email ?? "").trim();
  if (!src) return "·";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

type SidebarProps = {
  admin: AdminContext;
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ admin, collapsed, onToggle }: SidebarProps) {
  const displayName = admin.name_en ?? admin.name_cn ?? admin.email;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className="relative border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 flex flex-col h-[100dvh] sticky top-0
                 transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out)]"
      style={{ width: collapsed ? 76 : 260 }}
    >
      {/* Brand header */}
      <div
        className={`relative border-b border-[var(--paper-shadow)] ${
          collapsed ? "px-3 py-5" : "px-5 py-6"
        }`}
        style={{
          backgroundImage:
            "radial-gradient(420px 180px at 0% 0%, rgba(37,99,235,0.06), transparent 70%)",
        }}
      >
        <Link
          href="/admin"
          aria-label="GMC Administration home"
          className="relative flex items-start gap-3 min-w-0 focus-visible:shadow-[var(--shadow-focus)] rounded-[var(--radius-md)]"
        >
          {collapsed ? (
            <span
              className="inline-flex items-center justify-center w-12 h-12 flex-none overflow-hidden rounded-[var(--radius-md)] mx-auto"
              aria-hidden="true"
            >
              <Image
                src="/gmc-logo.png"
                alt=""
                width={96}
                height={54}
                priority
                sizes="96px"
                style={{
                  width: 96,
                  height: 54,
                  objectFit: "contain",
                  objectPosition: "left center",
                  transform: "scale(1.15)",
                  transformOrigin: "left center",
                  marginLeft: -3,
                }}
              />
            </span>
          ) : (
            <span className="flex flex-col min-w-0">
              <Image
                src="/gmc-logo.png"
                alt="GMC · Glorious Melodies Consultancy"
                width={360}
                height={203}
                priority
                sizes="180px"
                style={{
                  width: "auto",
                  height: 38,
                  objectFit: "contain",
                  marginLeft: -2,
                }}
              />
              <span className="mt-3 inline-flex items-center gap-2 text-[9px] tracking-[0.3em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Administration
              </span>
            </span>
          )}
        </Link>

        {/* Collapse toggle — hugs the right edge */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="absolute -right-3 top-7 z-10 w-6 h-6 rounded-full
                     bg-[var(--paper-warm)] border border-[var(--paper-shadow)]
                     flex items-center justify-center
                     text-[var(--ink-mute)] hover:text-[var(--cinnabar)]
                     shadow-[var(--shadow-paper-1)]
                     hover:shadow-[var(--shadow-paper-2)]
                     focus-visible:shadow-[var(--shadow-focus)]
                     transition-[color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]
                     active:scale-[0.92]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform var(--dur-base) var(--ease-spring)",
            }}
          >
            <path d="M6 2L3 5l3 3" />
          </svg>
        </button>
      </div>

      {/* Nav fills */}
      <AdminNav collapsed={collapsed} />

      {/* Profile card */}
      <div className="px-3 pb-4">
        {collapsed ? (
          <div className="flex justify-center">
            <div
              className="w-10 h-10 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]
                         flex items-center justify-center text-[11px] tracking-[0.06em] font-medium
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_10px_rgba(11,41,84,0.18)]"
              title={`${displayName} · ${ROLE_LABEL[admin.role]}`}
              aria-label={`${displayName} · ${ROLE_LABEL[admin.role]}`}
            >
              {initials(displayName, admin.email)}
            </div>
          </div>
        ) : (
          <div
            className="relative rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                       px-3.5 py-3 flex items-center gap-3
                       shadow-[var(--shadow-paper-1)]"
          >
            <div
              className="w-9 h-9 rounded-full bg-[var(--ink)] text-[var(--paper-warm)]
                         flex items-center justify-center text-[11px] tracking-[0.06em] font-medium
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] flex-none"
              aria-hidden="true"
            >
              {initials(displayName, admin.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-[var(--ink)] truncate leading-[1.25]">
                {displayName}
              </div>
              <div className="text-[9px] tracking-[0.18em] uppercase text-[var(--cinnabar)] mt-0.5">
                {ROLE_LABEL[admin.role]}
              </div>
            </div>
            <LogoutButton />
          </div>
        )}
      </div>
    </aside>
  );
}
