import Link from "next/link";
import type { ConversationListRow, EnrollmentSummary } from "@/lib/inbox/inbox-query";

// Right-rail card for the thread view. Shows:
//   - Participant identity (name, region_id, status chip, email, phone)
//   - Assigned admin
//   - Recent enrolments with status + amount_paid
//
// Kept as a server component — pure data render.

export function ParticipantCard({
  participant,
  enrollments,
  conversationStatus,
  assignedAdmin,
}: {
  participant: ConversationListRow["participant"];
  enrollments: EnrollmentSummary[];
  conversationStatus: string;
  assignedAdmin: ConversationListRow["assigned_admin"];
}) {
  if (!participant) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 p-5 text-[12.5px] text-[var(--ink-mute)]">
        Participant record missing.
      </div>
    );
  }

  const displayName = participant.name_en ?? participant.name_cn ?? "(unnamed)";
  const isLead = participant.status === "lead";

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
      <div className="px-5 py-5">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          Participant · 学员
        </div>
        <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
          {participant.region_id ? (
            <span className="font-mono text-[12px] text-[var(--cinnabar-deep)]">
              {participant.region_id}
            </span>
          ) : null}
          <span className="font-display text-[18px] leading-[1.25] text-[var(--ink)]">
            {displayName}
          </span>
        </div>
        {isLead ? (
          <div className="mt-2 inline-flex items-center gap-1.5 h-[20px] px-2 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[9.5px] tracking-[0.2em] uppercase text-[var(--ink)]">
            Lead · needs linking
          </div>
        ) : null}

        <dl className="mt-4 flex flex-col gap-2 text-[12.5px]">
          {participant.region ? (
            <MetaRow label="Region" value={participant.region} />
          ) : null}
          {participant.phone ? (
            <MetaRow label="Phone" value={participant.phone} />
          ) : null}
          {participant.email ? (
            <MetaRow label="Email" value={participant.email} />
          ) : null}
          <MetaRow
            label="Thread"
            value={conversationStatus}
            valueClass="uppercase tracking-[0.14em] text-[var(--ink-soft)] text-[11px]"
          />
          <MetaRow
            label="Assigned"
            value={
              assignedAdmin?.name_en ??
              assignedAdmin?.name_cn ??
              "Unassigned"
            }
          />
        </dl>

        <div className="mt-4 pt-4 border-t border-[var(--paper-shadow)] flex flex-wrap gap-2">
          <Link
            href={`/admin/participants/${participant.id}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.08em] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/25 transition-colors"
          >
            View profile
          </Link>
        </div>
      </div>

      <div className="border-t border-[var(--paper-shadow)] px-5 py-4">
        <div className="text-[10px] tracking-[0.28em] uppercase text-[var(--ink-faint)]">
          Enrolments · 报名
        </div>
        {enrollments.length === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--ink-mute)] leading-[1.6]">
            No enrolments yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {enrollments.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link
                  href={`/admin/events/${e.event_id}/enrollments`}
                  className="block rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3 py-2 hover:border-[var(--cinnabar)]/25 transition-colors"
                >
                  <div className="text-[12.5px] text-[var(--ink)] leading-[1.3] truncate">
                    {e.event_title || e.event_slug}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] tracking-[0.1em] uppercase text-[var(--ink-faint)]">
                    <span>{e.status}</span>
                    <span className="tabular-nums">
                      {e.amount_paid != null && e.currency
                        ? `${e.currency} ${e.amount_paid.toFixed(0)}`
                        : e.payment_status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </dt>
      <dd className={`text-[var(--ink)] truncate max-w-[72%] ${valueClass ?? ""}`}>
        {value}
      </dd>
    </div>
  );
}
