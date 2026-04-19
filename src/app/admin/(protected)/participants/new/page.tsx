import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { NewParticipantForm } from "@/components/admin/participants/new/NewParticipantForm";
import type { AdminOption } from "@/components/admin/participants/detail/AssignmentEditor";

export const metadata: Metadata = { title: "New · Participants" };
export const dynamic = "force-dynamic";

export default async function NewParticipantPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [regionLeadsRes, csRes] = await Promise.all([
    supabase
      .from("admins")
      .select("id, name_en, name_cn, role, region")
      .in("role", ["regional_lead", "super_admin"]),
    supabase
      .from("admins")
      .select("id, name_en, name_cn, role, region")
      .in("role", ["customer_service", "super_admin"]),
  ]);

  const regionLeads = (regionLeadsRes.data ?? []) as AdminOption[];
  const customerService = (csRes.data ?? []) as AdminOption[];

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
        <Link
          href="/admin/participants"
          className="inline-flex items-center gap-1.5 hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to participants
        </Link>
      </div>

      <header className="mt-6 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            New · 新增
          </div>
          <h1 className="mt-4 font-display text-[38px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Add a participant
          </h1>
          <p className="mt-4 max-w-[64ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
            Key in the personal info and an optional front-facing photo. The
            region ID (e.g. MY001) is assigned automatically on save.
          </p>
        </div>

        <aside className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-5 py-3.5 text-right shadow-[var(--shadow-paper-1)]">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Required
          </div>
          <div className="mt-1 font-display text-[18px] leading-[1.1] text-[var(--ink)]">
            At least one name
          </div>
        </aside>
      </header>

      <div className="mt-10">
        <NewParticipantForm
          regionLeads={regionLeads}
          customerService={customerService}
        />
      </div>
    </div>
  );
}
