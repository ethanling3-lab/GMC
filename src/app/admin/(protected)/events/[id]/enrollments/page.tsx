import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import { EnrollmentsTable, type EnrollmentRow } from "@/components/admin/events/EnrollmentsTable";
import { STATUS_LABEL as EVENT_STATUS_LABEL, TYPE_LABEL } from "@/lib/events-shared";

export const metadata: Metadata = { title: "Enrollments" };
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventEnrollmentsPage({
  params,
  searchParams,
}: PageProps) {
  const admin = await requireAdmin();
  const { id: eventId } = await params;
  const sp = await searchParams;

  const statusFilter =
    typeof sp.status === "string" &&
    ["pending_approval", "approved", "rejected", "paid", "cancelled"].includes(
      sp.status,
    )
      ? (sp.status as EnrollmentRow["status"])
      : null;

  const supabase = await createSupabaseServerClient();

  let event:
    | {
        id: string;
        slug: string;
        title_en: string | null;
        title_cn: string | null;
        type: string;
        status: string;
        start_date: string | null;
        end_date: string | null;
        form_schema?: unknown;
      }
    | null = null;
  {
    const primary = await supabase
      .from("events")
      .select(
        "id, slug, title_en, title_cn, type, status, start_date, end_date, form_schema",
      )
      .eq("id", eventId)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      const fallback = await supabase
        .from("events")
        .select("id, slug, title_en, title_cn, type, status, start_date, end_date")
        .eq("id", eventId)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      event = fallback.data ? { ...fallback.data, form_schema: {} } : null;
    } else {
      event = primary.data;
    }
  }
  if (!event) notFound();

  // Enrollments joined with participants for display. Service-level read
  // (RLS bypass not needed — admin session + role check). If the form_answers
  // column is missing (pre-migration 008), fall back.
  const enrollmentCols =
    "id, status, payment_status, payment_method, amount_paid, paid_at, confirmed_at, approved_at, created_at, form_answers, participant:participants(id, region_id, name_en, name_cn, region, email, phone, language)";
  const enrollmentColsLegacy =
    "id, status, payment_status, payment_method, amount_paid, paid_at, confirmed_at, approved_at, created_at, participant:participants(id, region_id, name_en, name_cn, region, email, phone, language)";
  let enrollments: unknown[] | null = null;
  {
    let q = supabase
      .from("enrollments")
      .select(enrollmentCols)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    if (statusFilter) q = q.eq("status", statusFilter);
    const primary = await q;
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      let q2 = supabase
        .from("enrollments")
        .select(enrollmentColsLegacy)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (statusFilter) q2 = q2.eq("status", statusFilter);
      const fallback = await q2;
      if (fallback.error) throw new Error(fallback.error.message);
      enrollments = (fallback.data ?? []).map((r) => ({
        ...r,
        form_answers: {},
      }));
    } else {
      enrollments = primary.data ?? [];
    }
  }

  const rows = (enrollments ?? []) as unknown as EnrollmentRow[];

  // Counts per status for the filter bar tabs
  const { data: counts } = await supabase
    .from("enrollments")
    .select("status")
    .eq("event_id", eventId);
  const statusCounts: Record<EnrollmentRow["status"] | "all", number> = {
    all: counts?.length ?? 0,
    pending_approval: 0,
    approved: 0,
    rejected: 0,
    paid: 0,
    cancelled: 0,
  };
  for (const row of counts ?? []) {
    const s = row.status as EnrollmentRow["status"];
    if (s in statusCounts) statusCounts[s]++;
  }

  const title =
    event.title_en || event.title_cn
      ? `${event.title_en ?? ""}${event.title_en && event.title_cn ? " · " : ""}${event.title_cn ?? ""}`
      : event.slug;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-5">
        <Link
          href={`/admin/events/${event.id}`}
          className="inline-flex items-center gap-1.5 text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2L3 5l3 3" />
          </svg>
          Back to event
        </Link>
      </div>

      {/* Event header card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Enrollments · 报名
            </div>
            <h1 className="mt-3 font-display text-[28px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
              {title}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--ink-mute)]">
              <span className="font-mono text-[var(--ink-faint)]">
                /events/{event.slug}
              </span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span className="tracking-[0.14em] uppercase">
                {TYPE_LABEL[event.type as keyof typeof TYPE_LABEL]?.en ?? event.type}
              </span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span className="tracking-[0.14em] uppercase">
                Event: {EVENT_STATUS_LABEL[event.status as keyof typeof EVENT_STATUS_LABEL]?.en ?? event.status}
              </span>
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-3 text-right">
            <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
              Total enrolled
            </div>
            <div className="mt-0.5 font-display text-[28px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
              {statusCounts.all.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Status tabs */}
        <div className="mt-5 flex flex-wrap gap-2">
          <StatusTab
            eventId={event.id}
            code={null}
            label="All"
            count={statusCounts.all}
            active={statusFilter === null}
          />
          <StatusTab
            eventId={event.id}
            code="pending_approval"
            label="Pending · 待审核"
            count={statusCounts.pending_approval}
            active={statusFilter === "pending_approval"}
          />
          <StatusTab
            eventId={event.id}
            code="approved"
            label="Approved · 已批准"
            count={statusCounts.approved}
            active={statusFilter === "approved"}
          />
          <StatusTab
            eventId={event.id}
            code="paid"
            label="Paid · 已付款"
            count={statusCounts.paid}
            active={statusFilter === "paid"}
          />
          <StatusTab
            eventId={event.id}
            code="rejected"
            label="Rejected · 已拒绝"
            count={statusCounts.rejected}
            active={statusFilter === "rejected"}
          />
          <StatusTab
            eventId={event.id}
            code="cancelled"
            label="Cancelled · 已取消"
            count={statusCounts.cancelled}
            active={statusFilter === "cancelled"}
          />
        </div>
      </div>

      <EnrollmentsTable
        eventId={event.id}
        rows={rows}
        canEdit={admin.role === "super_admin"}
        hasFilter={statusFilter !== null}
        formSchema={event.form_schema ?? {}}
      />
    </div>
  );
}

function StatusTab({
  eventId,
  code,
  label,
  count,
  active,
}: {
  eventId: string;
  code: EnrollmentRow["status"] | null;
  label: string;
  count: number;
  active: boolean;
}) {
  const href = code
    ? `/admin/events/${eventId}/enrollments?status=${code}`
    : `/admin/events/${eventId}/enrollments`;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em] transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                  ${
                    active
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/25 hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      {label}
      <span
        className={`tabular-nums text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded-full
                    ${active ? "bg-[var(--cinnabar)]/15" : "bg-[var(--paper-deep)] text-[var(--ink-mute)]"}`}
      >
        {count.toLocaleString()}
      </span>
    </Link>
  );
}
