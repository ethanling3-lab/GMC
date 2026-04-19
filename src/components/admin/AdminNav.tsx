"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  labelZh: string;
  icon: IconName;
  soon?: boolean;
};

type IconName =
  | "overview"
  | "participants"
  | "events"
  | "travel"
  | "finance"
  | "bell";

const PRIMARY: NavItem[] = [
  { href: "/admin", label: "Overview", labelZh: "概览", icon: "overview" },
  { href: "/admin/participants", label: "Participants", labelZh: "学员", icon: "participants" },
];

const UPCOMING: NavItem[] = [
  { href: "/admin/events", label: "Events", labelZh: "活动", icon: "events", soon: true },
  { href: "/admin/travel", label: "Travel", labelZh: "出行", icon: "travel", soon: true },
  { href: "/admin/finance", label: "Finance", labelZh: "财务", icon: "finance", soon: true },
  { href: "/admin/notifications", label: "Notifications", labelZh: "通知", icon: "bell", soon: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="2" y="2.5" width="5" height="5" rx="1" />
          <rect x="9" y="2.5" width="5" height="3" rx="1" />
          <rect x="2" y="9.5" width="5" height="4" rx="1" />
          <rect x="9" y="7.5" width="5" height="6" rx="1" />
        </svg>
      );
    case "participants":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.4" />
          <path d="M2 13.2c.4-2 2-3 4-3s3.6 1 4 3" />
          <circle cx="11.5" cy="5" r="1.8" />
          <path d="M10 10.2c1.2 0 3 .6 3.5 2.4" />
        </svg>
      );
    case "events":
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
          <path d="M2.5 6.5h11" />
          <path d="M5.5 2v3M10.5 2v3" />
        </svg>
      );
    case "travel":
      return (
        <svg {...common}>
          <path d="M2 9l5-5 1.5 1.5L5 9l3 0.2 1-1 1 1-1.5 1.5-0.2-3L5 11l-1.5-1.5z" transform="translate(1 -1) rotate(10 8 8)" />
          <path d="M2 13h12" />
        </svg>
      );
    case "finance":
      return (
        <svg {...common}>
          <path d="M4 3.5h8M4 12.5h8" />
          <path d="M5 3.5v9M11 3.5v9" />
          <path d="M8 5.5v5M6.5 7h3M6.5 9h3" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M4 11V8a4 4 0 1 1 8 0v3l1 1.5H3L4 11z" />
          <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
        </svg>
      );
  }
}

function Item({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full
                    transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                    ${
                      active
                        ? "bg-[var(--cinnabar)] opacity-100"
                        : "bg-[var(--cinnabar)] opacity-0 group-hover:opacity-40"
                    }`}
      />
      <span
        className={`flex-none w-4 h-4 inline-flex items-center justify-center transition-colors
                    ${active ? "text-[var(--cinnabar)]" : "text-[var(--ink-mute)] group-hover:text-[var(--ink)]"}`}
      >
        <NavIcon name={item.icon} />
      </span>
      {!collapsed ? (
        <>
          <span className="flex-1 min-w-0 truncate">{item.label}</span>
          <span
            className={`text-[10px] tracking-[0.18em] uppercase transition-colors
                        ${active ? "text-[var(--cinnabar)]/70" : "text-[var(--ink-faint)]"}`}
            aria-hidden="true"
          >
            {item.labelZh}
          </span>
        </>
      ) : null}
    </>
  );

  const baseClasses = `group relative flex items-center gap-3 rounded-[var(--radius-md)]
                       text-[13px] tracking-[0.01em]
                       transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       ${collapsed ? "justify-center px-0 py-2.5 mx-auto w-11 h-11" : "px-3.5 py-2.5 pl-5"}`;

  if (item.soon) {
    return (
      <span
        aria-disabled="true"
        title={collapsed ? `${item.label} · ${item.labelZh} — Soon` : undefined}
        className={`${baseClasses} text-[var(--ink-faint)] cursor-not-allowed select-none`}
      >
        <span
          className="flex-none w-4 h-4 inline-flex items-center justify-center text-[var(--ink-faint)]/70"
        >
          <NavIcon name={item.icon} />
        </span>
        {!collapsed ? (
          <>
            <span className="flex-1 min-w-0 truncate">{item.label}</span>
            <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)]/70 px-1.5 py-0.5 rounded-full border border-[var(--paper-shadow)]">
              Soon
            </span>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? `${item.label} · ${item.labelZh}` : undefined}
      className={`${baseClasses} ${
        active
          ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          : "text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
      }`}
    >
      {content}
    </Link>
  );
}

export function AdminNav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      className={`flex-1 py-5 flex flex-col gap-6 overflow-y-auto ${
        collapsed ? "px-2" : "px-3"
      }`}
    >
      <div>
        {!collapsed ? (
          <div className="px-4 pb-2 text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Workspace
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="mx-auto mb-2 w-5 h-px bg-[var(--paper-shadow)]"
          />
        )}
        <ul className="space-y-0.5">
          {PRIMARY.map((item) => (
            <li key={item.href}>
              <Item
                item={item}
                active={isActive(pathname, item.href)}
                collapsed={collapsed}
              />
            </li>
          ))}
        </ul>
      </div>

      <div>
        {!collapsed ? (
          <div className="px-4 pb-2 text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Roadmap
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="mx-auto mb-2 w-5 h-px bg-[var(--paper-shadow)]"
          />
        )}
        <ul className="space-y-0.5">
          {UPCOMING.map((item) => (
            <li key={item.href}>
              <Item item={item} active={false} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
