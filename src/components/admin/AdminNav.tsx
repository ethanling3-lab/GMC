"use client";

import Link from "next/link";

type NavItem = {
  href: string;
  label: string;
  labelZh: string;
  icon: IconName;
  soon?: boolean;
  superAdminOnly?: boolean;
};

type IconName =
  | "whatsapp"
  | "ai"
  | "overview"
  | "participants"
  | "events"
  | "inbox"
  | "finance"
  | "programmes"
  | "reports"
  | "staff"
  | "transfer";

const PRIMARY: NavItem[] = [
  { href: "/admin", label: "Overview", labelZh: "概览", icon: "overview" },
  { href: "/admin/inbox", label: "Inbox", labelZh: "收件箱", icon: "inbox" },
  { href: "/admin/whatsapp", label: "WhatsApp", labelZh: "设置与群发", icon: "whatsapp" },
  { href: "/admin/ai", label: "AI", labelZh: "AI 助手", icon: "ai" },
  { href: "/admin/participants", label: "Participants", labelZh: "学员", icon: "participants" },
  { href: "/admin/events", label: "Events", labelZh: "活动", icon: "events" },
  { href: "/admin/group-reports", label: "Group reports", labelZh: "小组报告", icon: "reports" },
  { href: "/admin/programmes", label: "Programmes", labelZh: "课程", icon: "programmes" },
  { href: "/admin/finance", label: "Finance", labelZh: "财务", icon: "finance" },
  { href: "/admin/staff", label: "Staff", labelZh: "员工", icon: "staff", superAdminOnly: true },
];

// Active detection compares each nav href against the active route segment.
// `segment` is supplied by AdminShell — server-derived from the `x-pathname`
// header for SSR/first paint, then the live `useSelectedLayoutSegment()` after
// mount — so server and client agree and there is no hydration mismatch.
// Every nav href is "/admin" or "/admin/<segment>", so:
function isActive(segment: string | null, href: string): boolean {
  if (href === "/admin") return segment === null;
  // Broadcasts live inside WhatsApp.
  if (href === "/admin/whatsapp" && segment === "broadcasts") return true;
  return segment === href.slice("/admin/".length);
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
    case "ai":
      // A spark, not a robot — this is a control surface, not a mascot.
      return (
        <svg {...common}>
          <path d="M8 2.2l1.5 3.6 3.6 1.5-3.6 1.5L8 12.4 6.5 8.8 2.9 7.3l3.6-1.5z" />
          <path d="M12.6 11.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <path d="M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5V11a1.5 1.5 0 0 1-1.5 1.5H6L3.5 14.5V12.5H4A1.5 1.5 0 0 1 2.5 11z" />
          <path d="M5.5 7h5M5.5 9h3" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M3 13l.8-2.6A5.2 5.2 0 1 1 5.8 12.3z" />
          <path d="M6.4 6.2c0 2 1.5 3.5 3.5 3.6l.7-.9-1.1-.6-.5.4c-.6-.3-1-.7-1.2-1.2l.4-.5-.6-1.1z" />
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
    case "programmes":
      return (
        <svg {...common}>
          <path d="M8 2.5L14 5l-6 2.5L2 5z" />
          <path d="M4.5 6.2v3.4c0 1 1.6 1.9 3.5 1.9s3.5-.9 3.5-1.9V6.2" />
          <path d="M14 5v3.5" />
        </svg>
      );
    case "staff":
      return (
        <svg {...common}>
          <rect x="2.5" y="3" width="11" height="10.5" rx="1.5" />
          <circle cx="8" cy="7" r="1.8" />
          <path d="M5 12c.4-1.3 1.6-2 3-2s2.6.7 3 2M6.5 3V1.8h3V3" />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <rect x="2" y="6" width="9" height="5" rx="1" />
          <path d="M11 7h2l1 2v2h-3" />
          <circle cx="5" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M4 2.5h5l3 3v8H4z" />
          <path d="M9 2.5v3h3" />
          <path d="M6 8h4M6 10.5h4" />
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

export function AdminNav({
  segment,
  collapsed = false,
  role,
}: {
  segment: string | null;
  collapsed?: boolean;
  role: string;
}) {
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
          {PRIMARY.filter((item) => !item.superAdminOnly || role === "super_admin").map((item) => (
            <li key={item.href}>
              <Item
                item={item}
                active={isActive(segment, item.href)}
                collapsed={collapsed}
              />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
