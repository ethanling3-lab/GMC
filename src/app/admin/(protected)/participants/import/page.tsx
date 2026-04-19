import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-guard";
import { ImportFlow } from "@/components/admin/participants/import/ImportFlow";

export const metadata: Metadata = { title: "Import · Participants" };
export const dynamic = "force-dynamic";

export default async function ParticipantsImportPage() {
  await requireAdmin();

  return (
    <div>
      {/* Back */}
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

      {/* Header */}
      <header className="mt-6 flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            AI Import · 智能导入
          </div>
          <h1 className="mt-4 font-display text-[38px] md:text-[44px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Bulk import participants
          </h1>
          <p className="mt-4 max-w-[66ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
            Drop an Excel, CSV or PDF — Claude reads it, extracts every
            participant, and normalises names, regions and dates. Existing
            Student IDs in the source are matched and merged; rows without an
            ID get a fresh one auto-assigned on insert.
          </p>
        </div>

        <aside className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-5 py-3.5 text-right shadow-[var(--shadow-paper-1)]">
          <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
            Single file
          </div>
          <div className="mt-1 font-display text-[18px] leading-[1.1] text-[var(--ink)]">
            .xlsx · .csv · .pdf
          </div>
        </aside>
      </header>

      <div className="mt-10">
        <ImportFlow />
      </div>
    </div>
  );
}
