import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { ManualEnrollmentForm } from "@/components/admin/events/ManualEnrollmentForm";
import { checkCapacity } from "@/lib/event-capacity";

export const metadata: Metadata = { title: "New enrolment" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewEnrollmentPage({ params }: PageProps) {
  const admin = await requireAdmin();
  const { id: eventId } = await params;

  // Manual enrol is super_admin only — regional leads + CS shouldn't bypass
  // the public flow today; if/when that changes, lift the gate inside the
  // POST handler too.
  if (admin.role !== "super_admin") {
    redirect(`/admin/events/${eventId}/enrollments`);
  }

  const supabase = await createSupabaseServerClient();

  // Pull the event with form_schema if migration 008 has shipped, else fall
  // back to the schema-free shape so the page still renders against legacy
  // databases (the form just won't have custom fields).
  let event:
    | {
        id: string;
        slug: string;
        title_en: string | null;
        title_cn: string | null;
        capacity: number | null;
        form_schema?: unknown;
      }
    | null = null;
  {
    const primary = await supabase
      .from("events")
      .select("id, slug, title_en, title_cn, capacity, form_schema")
      .eq("id", eventId)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      const fallback = await supabase
        .from("events")
        .select("id, slug, title_en, title_cn, capacity")
        .eq("id", eventId)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      event = fallback.data ? { ...fallback.data, form_schema: {} } : null;
    } else {
      event = primary.data;
    }
  }
  if (!event) notFound();

  const cap = await checkCapacity(supabase, event.id, event.capacity);

  const title =
    event.title_en || event.title_cn
      ? `${event.title_en ?? ""}${event.title_en && event.title_cn ? " · " : ""}${event.title_cn ?? ""}`
      : event.slug;

  return (
    <div>
      <div className="mb-5">
        <Link
          href={`/admin/events/${event.id}/enrollments`}
          className="inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to enrolments
        </Link>
      </div>

      <header className="mb-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              New enrolment · 新增报名
            </div>
            <h1 className="mt-3 font-display text-[28px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
              {title}
            </h1>
            <p className="mt-2 text-[12.5px] text-[var(--ink-mute)] leading-[1.55] max-w-[64ch]">
              For walk-in registrations and admin-assisted sign-ups (e.g. elderly
              participants who can&rsquo;t use the public form). Picks up where the
              public flow leaves off — same notification path, same audit trail.
            </p>
          </div>
          <CapacityChip current={cap.current} capacity={cap.capacity} full={cap.full} />
        </div>
      </header>

      <ManualEnrollmentForm
        eventId={event.id}
        eventTitle={title}
        eventCapacity={event.capacity}
        capacityCurrent={cap.current}
        capacityFull={cap.full}
        formSchema={event.form_schema ?? {}}
      />
    </div>
  );
}

function CapacityChip({
  current,
  capacity,
  full,
}: {
  current: number;
  capacity: number | null;
  full: boolean;
}) {
  if (capacity === null) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-3 text-right">
        <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">Enrolled</div>
        <div className="mt-0.5 font-display text-[24px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
          {current.toLocaleString()}
        </div>
      </div>
    );
  }
  const pct = capacity === 0 ? 0 : current / capacity;
  const tone = full
    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
    : pct >= 0.9
      ? "border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[var(--ink)]"
      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]";
  return (
    <div className={`rounded-[var(--radius-md)] border ${tone} px-5 py-3 text-right`}>
      <div className="text-[9px] tracking-[0.28em] uppercase opacity-70">
        {full ? "Full" : "Enrolled"}
      </div>
      <div className="mt-0.5 font-display text-[22px] leading-[1] tracking-[-0.015em] tabular-nums">
        {current.toLocaleString()} / {capacity.toLocaleString()}
      </div>
    </div>
  );
}
