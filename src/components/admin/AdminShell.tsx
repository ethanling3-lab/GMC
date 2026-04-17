import Link from "next/link";
import type { AdminContext } from "@/lib/admin-guard";
import { LogoutButton } from "./LogoutButton";

type NavItem = { href: string; label: string; eyebrow?: string };

const nav: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/participants", label: "Participants" },
  { href: "/admin/events", label: "Events", eyebrow: "Soon" },
  { href: "/admin/travel", label: "Travel", eyebrow: "Soon" },
  { href: "/admin/finance", label: "Finance", eyebrow: "Soon" },
  { href: "/admin/notifications", label: "Notifications", eyebrow: "Soon" },
];

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

export function AdminShell({
  admin,
  children,
}: {
  admin: AdminContext;
  children: React.ReactNode;
}) {
  const displayName = admin.name_en ?? admin.name_cn ?? admin.email;

  return (
    <div className="min-h-[100dvh] grid grid-cols-[260px_1fr] bg-[var(--paper)]">
      <aside className="border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)] flex flex-col">
        <div className="px-7 py-8 border-b border-[var(--paper-shadow)]">
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--ink-mute)]">
            GMC
          </div>
          <div className="mt-1 font-display text-[22px] leading-[1.1] text-[var(--ink)]">
            Administration
          </div>
        </div>

        <nav className="flex-1 px-3 py-6">
          <ul className="space-y-1">
            {nav.map((item) => {
              const disabled = Boolean(item.eyebrow);
              return (
                <li key={item.href}>
                  {disabled ? (
                    <span className="flex items-center justify-between px-4 py-2.5 text-[13px] text-[var(--ink-faint)] cursor-not-allowed">
                      <span>{item.label}</span>
                      <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                        {item.eyebrow}
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className="block px-4 py-2.5 text-[13px] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] focus-visible:shadow-[var(--shadow-focus)] transition-colors duration-[var(--dur-fast)]"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="px-5 py-5 border-t border-[var(--paper-shadow)] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[var(--ink)] text-[var(--paper-warm)] flex items-center justify-center text-[12px] tracking-[0.06em]">
            {initials(displayName, admin.email)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-[var(--ink)] truncate">{displayName}</div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
              {ROLE_LABEL[admin.role]}
            </div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="px-10 py-10 max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
