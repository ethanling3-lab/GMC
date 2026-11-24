import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";
import { loadSeats } from "@/lib/check-in/check-in-query";
import {
  ENROLLMENT_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type EnrollmentStatus,
  type PaymentStatus,
} from "@/lib/enrollments-shared";
import { formatMoney } from "@/lib/finance/format";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const metadata: Metadata = { title: "My participants" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

type Row = {
  id: string;
  status: EnrollmentStatus;
  payment_status: PaymentStatus;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
  };
};

const money = (value: number | string | null, currency: string | null) =>
  value === null || value === "" ? "Not set" : formatMoney(Number(value), currency);

const personName = (p: Row["participant"]) =>
  [p.name_en?.trim(), p.name_cn?.trim()].filter(Boolean).join(" · ") || "Unnamed";

export default async function MyParticipantsPage({ params }: PageProps) {
  const admin = await requireAdmin();
  if (admin.role !== "customer_service") redirect(`/admin/events`);
  const { id: eventId } = await params;

  // Role checked above. This query is limited to the signed-in person's
  // assigned participants and to the fields shown on this page.
  const service = createSupabaseServiceClient();
  const { data: event, error: eventError } = await service
    .from("events")
    .select("id, slug, title_en, title_cn, currency")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) throw new Error(eventError.message);
  if (!event) notFound();

  const [{ data, error }, seats] = await Promise.all([
    service
      .from("enrollments")
      .select(
        "id, status, payment_status, amount_due, amount_paid, participant:participants!inner(id, region_id, name_en, name_cn)",
      )
      .eq("event_id", eventId)
      .eq("participant.assigned_cs_id", admin.id)
      .order("created_at", { ascending: true })
      .returns<Row[]>(),
    loadSeats(service, eventId),
  ]);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const title = event.title_en || event.title_cn || event.slug;

  return (
    <div>
      <CrumbLabel segment={event.id} label={title} />
      <h1 className="font-display text-[32px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">
        {title}
      </h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        Your assigned participants at this event · 您负责的学员
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <WorkLink href={`/admin/events/${event.id}/check-in`} label="Check-in · 签到" />
        <WorkLink href={`/admin/events/${event.id}/logistics`} label="Flights · 航班" />
      </div>

      <div className="mt-6 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-[14px] leading-[1.7] text-[var(--ink-mute)]">
            None of your assigned participants are enrolled in this event.
            <br />
            您负责的学员尚未报名此活动。
          </p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-[13px] text-[var(--ink-soft)]">
            <thead className="bg-[var(--paper-deep)]/70 text-[12px] text-[var(--ink-mute)]">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Participant · 学员</th>
                <th scope="col" className="px-5 py-3 font-medium">Enrolment · 报名</th>
                <th scope="col" className="px-5 py-3 font-medium">Payment · 付款</th>
                <th scope="col" className="px-5 py-3 font-medium text-right">Due · 应付</th>
                <th scope="col" className="px-5 py-3 font-medium text-right">Paid · 已付</th>
                <th scope="col" className="px-5 py-3 font-medium">Group and seat · 小组座位</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const seat = seats.get(row.participant.id);
                return (
                  <tr key={row.id} className="border-t border-[var(--paper-shadow)]">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/admin/participants/${row.participant.id}`}
                        className="rounded-sm font-medium text-[var(--ink)] hover:text-[var(--cinnabar)] focus-visible:shadow-[var(--shadow-focus)] active:opacity-70 transition-[color,opacity] duration-[var(--dur-fast)]"
                      >
                        {personName(row.participant)}
                      </Link>
                      <div className="mt-0.5 font-mono text-[11.5px] text-[var(--ink-faint)]">
                        {row.participant.region_id ?? "No ID"}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{ENROLLMENT_STATUS_LABEL[row.status].en}</td>
                    <td className="px-5 py-3.5">
                      {row.payment_status === "none"
                        ? "Not started"
                        : PAYMENT_STATUS_LABEL[row.payment_status].en}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {money(row.amount_due, event.currency)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {money(row.amount_paid, event.currency)}
                    </td>
                    <td className="px-5 py-3.5">
                      {seat?.group_no != null
                        ? `Group ${seat.group_no}${seat.table_no != null ? `, table ${seat.table_no}` : ""}${seat.seat_no != null ? `, seat ${seat.seat_no}` : ""}`
                        : "Not placed"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WorkLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 text-[12.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px transition-[border-color,color,transform] duration-[var(--dur-fast)]"
    >
      {label}
    </Link>
  );
}
