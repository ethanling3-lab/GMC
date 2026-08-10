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
  segment: string | null;
  collapsed: boolean;
  onToggle: () => void;
  /** Below `md` the sidebar is an off-canvas drawer rather than a column. */
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({
  admin,
  segment,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const displayName = admin.name_en ?? admin.name_cn ?? admin.email;

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      data-mobile-open={mobileOpen ? "true" : "false"}
      // Two layouts in one element. Below `md` it's a fixed drawer that
      // slides over the content at a full 260px — the 76px rail is a
      // desktop affordance and unusable as a touch target. From `md` up it
      // returns to the sticky column whose width follows the collapse pref.
      className={`fixed inset-y-0 left-0 z-50 w-[260px] h-[100dvh]
                 shadow-[var(--shadow-paper-2)]
                 md:sticky md:top-0 md:z-auto md:w-[var(--gmc-sidebar-w)] md:shadow-none
                 border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 flex flex-col
                 transition-[transform,width] duration-[var(--dur-base)] ease-[var(--ease-out)]
                 motion-reduce:transition-none
                 md:translate-x-0 ${
                   mobileOpen ? "translate-x-0" : "-translate-x-full"
                 }`}
      style={
        { "--gmc-sidebar-w": collapsed ? "76px" : "260px" } as React.CSSProperties
      }
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

        {/* Close drawer — mobile only, where the collapse rail doesn't apply */}
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close navigation"
          className="md:hidden absolute right-4 top-6 z-10 w-8 h-8 rounded-full
                     inline-flex items-center justify-center
                     text-[var(--ink-mute)] hover:text-[var(--cinnabar)]
                     hover:bg-[var(--cinnabar-wash)]
                     focus-visible:shadow-[var(--shadow-focus)]
                     transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>

        {/* Collapse toggle — hugs the right edge. Desktop only. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className="hidden md:flex absolute -right-3 top-7 z-10 w-6 h-6 rounded-full
                     bg-[var(--paper-warm)] border border-[var(--paper-shadow)]
                     items-center justify-center
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
      <AdminNav segment={segment} collapsed={collapsed} />

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
