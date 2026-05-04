import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-guard";
import {
  EnrollmentsTable,
  type EnrollmentRow,
  type LatestNotification,
  type ReferrerRef,
} from "@/components/admin/events/EnrollmentsTable";
import { EnrollmentsToolbar } from "@/components/admin/events/EnrollmentsToolbar";
import { STATUS_LABEL as EVENT_STATUS_LABEL, TYPE_LABEL } from "@/lib/events-shared";
import { checkCapacity } from "@/lib/event-capacity";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

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

  const qRaw = typeof sp.q === "string" ? sp.q.trim() : "";
  const q = qRaw.slice(0, 120);

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
        capacity: number | null;
        form_schema?: unknown;
      }
    | null = null;
  {
    const primary = await supabase
      .from("events")
      .select(
        "id, slug, title_en, title_cn, type, status, start_date, end_date, capacity, form_schema",
      )
      .eq("id", eventId)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") throw new Error(primary.error.message);
      const fallback = await supabase
        .from("events")
        .select("id, slug, title_en, title_cn, type, status, start_date, end_date, capacity")
        .eq("id", eventId)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      event = fallback.data ? { ...fallback.data, form_schema: {} } : null;
    } else {
      event = primary.data;
    }
  }
  if (!event) notFound();

  // If a search term is set, resolve participant ids that match first, then
  // scope the enrolments by those ids. Two small queries are simpler than a
  // nested-or on a foreign table and avoids PostgREST embedding quirks.
  let participantIdsForQ: string[] | null = null;
  if (q) {
    const needle = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const { data: pRows, error: pErr } = await supabase
      .from("participants")
      .select("id")
      .or(
        [
          `name_en.ilike.${needle}`,
          `name_cn.ilike.${needle}`,
          `region_id.ilike.${needle}`,
          `email.ilike.${needle}`,
          `phone.ilike.${needle}`,
        ].join(","),
      )
      .limit(5000);
    if (pErr) throw new Error(pErr.message);
    participantIdsForQ = (pRows ?? []).map((r) => r.id as string);
  }

  // Participant join includes referrer free-text columns (migration 009) +
  // is_old_student so we can render the referrer pill and OLD chip inline.
  // If 009 hasn't been applied yet, the select falls back to the legacy set.
  const participantFull =
    "id, region_id, name_en, name_cn, region, email, phone, language, is_old_student, referrer_id, referrer_name, referrer_contact, zu_zhang_tier";
  const participantLegacy =
    "id, region_id, name_en, name_cn, region, email, phone, language, is_old_student, referrer_id";
  // Enrolment selects come in four shapes (cross-product of: form_answers
  // shipped in 008, transfer_slip_* shipped in 011). Older databases
  // gracefully fall back via the attempt ladder below. Post-022 we also
  // pull serving_as_zu_zhang + zu_zhang_tier_for_event for the per-row
  // 组长 chip.
  const enrollmentColsWithBoth = (participant: string) =>
    `id, status, payment_status, payment_method, amount_paid, paid_at, confirmed_at, approved_at, created_at, form_answers, transfer_slip_url, transfer_slip_uploaded_at, pinned_group_no, serving_as_zu_zhang, zu_zhang_tier_for_event, participant:participants(${participant})`;
  const enrollmentColsWithSchema = (participant: string) =>
    `id, status, payment_status, payment_method, amount_paid, paid_at, confirmed_at, approved_at, created_at, form_answers, participant:participants(${participant})`;
  const enrollmentColsLegacy = (participant: string) =>
    `id, status, payment_status, payment_method, amount_paid, paid_at, confirmed_at, approved_at, created_at, participant:participants(${participant})`;

  let enrollments: unknown[] | null = null;
  {
    const runQuery = async (selectCols: string) => {
      let q2 = supabase
        .from("enrollments")
        .select(selectCols)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (statusFilter) q2 = q2.eq("status", statusFilter);
      if (participantIdsForQ) {
        if (participantIdsForQ.length === 0) return { data: [], error: null };
        q2 = q2.in("participant_id", participantIdsForQ);
      }
      return q2;
    };

    const attempts: {
      cols: () => string;
      stripSlip: boolean;
      stripForm: boolean;
      stripReferrer: boolean;
    }[] = [
      { cols: () => enrollmentColsWithBoth(participantFull), stripSlip: false, stripForm: false, stripReferrer: false },
      { cols: () => enrollmentColsWithBoth(participantLegacy), stripSlip: false, stripForm: false, stripReferrer: true },
      { cols: () => enrollmentColsWithSchema(participantFull), stripSlip: true, stripForm: false, stripReferrer: false },
      { cols: () => enrollmentColsWithSchema(participantLegacy), stripSlip: true, stripForm: false, stripReferrer: true },
      { cols: () => enrollmentColsLegacy(participantFull), stripSlip: true, stripForm: true, stripReferrer: false },
      { cols: () => enrollmentColsLegacy(participantLegacy), stripSlip: true, stripForm: true, stripReferrer: true },
    ];

    let success = false;
    for (const attempt of attempts) {
      const res = await runQuery(attempt.cols());
      if (res.error) {
        const code = (res.error as { code?: string }).code;
        if (code !== "42703") throw new Error(res.error.message);
        continue;
      }
      const rows = (res.data ?? []) as Array<Record<string, unknown>>;
      enrollments = rows.map((r) => {
        const next: Record<string, unknown> = { ...r };
        if (attempt.stripForm) next.form_answers = {};
        if (attempt.stripSlip) {
          next.transfer_slip_url = null;
          next.transfer_slip_uploaded_at = null;
        }
        if (attempt.stripReferrer && next.participant && typeof next.participant === "object") {
          next.participant = {
            ...(next.participant as Record<string, unknown>),
            referrer_name: null,
            referrer_contact: null,
          };
        }
        return next;
      });
      success = true;
      break;
    }
    if (!success) throw new Error("Failed to load enrolments");
  }

  const rows = (enrollments ?? []) as unknown as EnrollmentRow[];

  // Resolve referrer participants in a single second query when enrolments
  // reference other participants as the source of the 感召.
  const referrerIds = Array.from(
    new Set(
      rows
        .map((r) => r.participant?.referrer_id ?? null)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const referrerById: Record<string, ReferrerRef> = {};
  if (referrerIds.length > 0) {
    const { data: refRows, error: refErr } = await supabase
      .from("participants")
      .select("id, region_id, name_en, name_cn")
      .in("id", referrerIds);
    if (refErr) throw new Error(refErr.message);
    for (const r of refRows ?? []) {
      referrerById[(r as { id: string }).id] = {
        id: (r as { id: string }).id,
        region_id: (r as { region_id: string | null }).region_id,
        name_en: (r as { name_en: string | null }).name_en,
        name_cn: (r as { name_cn: string | null }).name_cn,
      };
    }
  }

  // Latest notification per visible enrolment, for the delivery dot in the
  // table. Ordered desc on created_at so the first row per enrollment_id is
  // the most recent. We grab a wide window (4 × the row count) to make the
  // group-by-then-pick-first work without touching server functions.
  const enrollmentIdsForNotif = rows.map((r) => r.id);
  const latestNotificationByEnrollment: Record<string, LatestNotification> = {};
  if (enrollmentIdsForNotif.length > 0) {
    const { data: notifRows } = await supabase
      .from("notifications")
      .select("enrollment_id, channel, template, status, sent_at, created_at")
      .in("enrollment_id", enrollmentIdsForNotif)
      .order("created_at", { ascending: false })
      .limit(Math.min(2000, enrollmentIdsForNotif.length * 8));
    for (const n of notifRows ?? []) {
      const id = (n as { enrollment_id: string | null }).enrollment_id;
      if (!id || latestNotificationByEnrollment[id]) continue;
      latestNotificationByEnrollment[id] = {
        channel: (n as { channel: string }).channel,
        template: (n as { template: string }).template,
        status: (n as { status: string }).status,
        sent_at: (n as { sent_at: string | null }).sent_at,
        created_at: (n as { created_at: string }).created_at,
      };
    }
  }

  // Counts per status for the filter bar tabs. The counts ignore `q` so the
  // tab totals always describe the full event — the active tab indicates
  // what the table is filtered to, not how many matched the search.
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

  // Capacity check uses pending_approval + approved + paid (the same set the
  // enrolment guard uses) so the chip matches what the public form sees.
  const cap = await checkCapacity(supabase, event.id, event.capacity ?? null);

  const title =
    event.title_en || event.title_cn
      ? `${event.title_en ?? ""}${event.title_en && event.title_cn ? " · " : ""}${event.title_cn ?? ""}`
      : event.slug;

  return (
    <div>
      <CrumbLabel segment={event.id} label={title} />
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
          <div className="flex items-stretch gap-3">
            <CapacityChip current={cap.current} capacity={cap.capacity} full={cap.full} />
            <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-3 text-right">
              <div className="text-[9px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
                Total enrolled
              </div>
              <div className="mt-0.5 font-display text-[28px] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
                {statusCounts.all.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {admin.role === "super_admin" ? (
          <div className="mt-5 -mb-2">
            <Link
              href={`/admin/events/${event.id}/enrollments/new`}
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                         border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[var(--paper-warm)]
                         text-[12px] tracking-[0.04em] font-medium
                         hover:bg-[var(--cinnabar-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color] duration-[var(--dur-fast)]"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M5.5 2v7M2 5.5h7" />
              </svg>
              Enrol participant
            </Link>
            <span className="ml-3 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
              Walk-ins · admin-assisted
            </span>
          </div>
        ) : null}

        {/* Toolbar: search + export. Renders above the status tabs so the
            tabs remain the visually primary control. */}
        <EnrollmentsToolbar
          eventId={event.id}
          initialQ={q}
          statusFilter={statusFilter}
          matched={rows.length}
          hasQ={q.length > 0}
        />

        {/* Status tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusTab
            eventId={event.id}
            code={null}
            label="All"
            count={statusCounts.all}
            active={statusFilter === null}
            q={q}
          />
          <StatusTab
            eventId={event.id}
            code="pending_approval"
            label="Pending · 待审核"
            count={statusCounts.pending_approval}
            active={statusFilter === "pending_approval"}
            q={q}
          />
          <StatusTab
            eventId={event.id}
            code="approved"
            label="Approved · 已批准"
            count={statusCounts.approved}
            active={statusFilter === "approved"}
            q={q}
          />
          <StatusTab
            eventId={event.id}
            code="paid"
            label="Paid · 已付款"
            count={statusCounts.paid}
            active={statusFilter === "paid"}
            q={q}
          />
          <StatusTab
            eventId={event.id}
            code="rejected"
            label="Rejected · 已拒绝"
            count={statusCounts.rejected}
            active={statusFilter === "rejected"}
            q={q}
          />
          <StatusTab
            eventId={event.id}
            code="cancelled"
            label="Cancelled · 已取消"
            count={statusCounts.cancelled}
            active={statusFilter === "cancelled"}
            q={q}
          />
        </div>
      </div>

      <EnrollmentsTable
        eventId={event.id}
        rows={rows}
        canEdit={admin.role === "super_admin"}
        hasFilter={statusFilter !== null || q.length > 0}
        formSchema={event.form_schema ?? {}}
        referrerById={referrerById}
        latestNotificationByEnrollment={latestNotificationByEnrollment}
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
  if (capacity === null) return null;
  const pct = capacity === 0 ? 0 : current / capacity;
  const tone = full
    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
    : pct >= 0.9
      ? "border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[var(--ink)]"
      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)]";
  return (
    <div className={`rounded-[var(--radius-md)] border ${tone} px-5 py-3 text-right`}>
      <div className="text-[9px] tracking-[0.28em] uppercase opacity-70">
        {full ? "Full" : "Capacity"}
      </div>
      <div className="mt-0.5 font-display text-[22px] leading-[1] tracking-[-0.015em] tabular-nums">
        {current.toLocaleString()} / {capacity.toLocaleString()}
      </div>
    </div>
  );
}

function StatusTab({
  eventId,
  code,
  label,
  count,
  active,
  q,
}: {
  eventId: string;
  code: EnrollmentRow["status"] | null;
  label: string;
  count: number;
  active: boolean;
  q: string;
}) {
  const params = new URLSearchParams();
  if (code) params.set("status", code);
  if (q) params.set("q", q);
  const qs = params.toString();
  const href = qs
    ? `/admin/events/${eventId}/enrollments?${qs}`
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
