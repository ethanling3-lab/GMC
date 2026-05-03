"use client";

import { useState } from "react";
import Link from "next/link";
import type { FlightSubmissionStatus } from "@/lib/transfer/flight-status";

// Collapsible card showing who's submitted vs missing flight info, per
// direction. Default state shows just the totals; expand to see the full
// chaseable list. Each pending row links to the participant's inbox thread
// when an inbox conversation exists, falling back to participant detail.

export function PendingFlightsPanel({
  status,
  inboxByParticipant,
}: {
  status: FlightSubmissionStatus;
  // participant_id → most-recent conversation_id; missing entries fall back
  // to the participant detail page.
  inboxByParticipant?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);

  const arrivalGap = status.arrival.missing + status.arrival.draft;
  const departureGap = status.departure.missing + status.departure.draft;
  const anyGap = arrivalGap > 0 || departureGap > 0;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left hover:bg-[var(--paper-deep)]/40 transition-colors rounded-[var(--radius-lg)]"
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Flight readiness · 航班接收
          </div>
          <span className="text-[12.5px] text-[var(--ink-soft)]">
            {status.total_enrolled} enrolled
          </span>
          <DirChip
            label="Arrivals"
            confirmed={status.arrival.confirmed}
            total={status.total_enrolled}
            gap={arrivalGap}
          />
          <DirChip
            label="Departures"
            confirmed={status.departure.confirmed}
            total={status.total_enrolled}
            gap={departureGap}
          />
        </div>
        <span
          className="text-[var(--ink-mute)] text-[11px] tracking-[0.18em] uppercase"
          aria-hidden="true"
        >
          {open ? "Hide ▲" : anyGap ? `${arrivalGap + departureGap} pending ▼` : "All set ▼"}
        </span>
      </button>

      {!open ? null : (
        <div className="border-t border-[var(--paper-shadow)] px-5 py-4">
          {status.enrolments.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink-mute)] py-2">
              No approved/paid enrolments yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)]">
              <table className="w-full border-collapse text-[12px] bg-[var(--paper)]">
                <thead className="bg-[var(--paper-deep)]">
                  <tr className="text-left text-[9.5px] tracking-[0.2em] uppercase text-[var(--ink-mute)]">
                    <th className="px-3 py-2 font-normal w-[100px]">Region ID</th>
                    <th className="px-3 py-2 font-normal">Participant</th>
                    <th className="px-3 py-2 font-normal w-[110px] text-center">Arrival</th>
                    <th className="px-3 py-2 font-normal w-[110px] text-center">Departure</th>
                    <th className="px-3 py-2 font-normal w-[120px] text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {status.enrolments.map((e) => {
                    const conversationId = inboxByParticipant?.[e.participant_id];
                    const fallbackHref = e.participant_id
                      ? `/admin/participants/${e.participant_id}`
                      : "#";
                    const chaseHref = conversationId
                      ? `/admin/inbox/${conversationId}`
                      : fallbackHref;
                    const needsAny =
                      e.arrival !== "confirmed" || e.departure !== "confirmed";
                    return (
                      <tr
                        key={e.enrollment_id}
                        className={
                          needsAny
                            ? "border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/40 transition-colors"
                            : "border-t border-[var(--paper-shadow)] hover:bg-[var(--paper-deep)]/40 transition-colors text-[var(--ink-mute)]"
                        }
                      >
                        <td className="px-3 py-1.5 font-mono text-[10.5px] tabular-nums text-[var(--cinnabar-deep)]">
                          {e.region_id ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[var(--ink)]">{e.name}</td>
                        <td className="px-3 py-1.5 text-center">
                          <StatusPip status={e.arrival} />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <StatusPip status={e.departure} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {needsAny ? (
                            <Link
                              href={chaseHref}
                              className="inline-flex items-center gap-1 text-[10.5px] tracking-[0.14em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
                              style={{ color: "var(--cinnabar-deep)" }}
                            >
                              Chase
                              <span aria-hidden="true">→</span>
                            </Link>
                          ) : (
                            <span className="text-[10.5px] text-[var(--ink-faint)]">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DirChip({
  label,
  confirmed,
  total,
  gap,
}: {
  label: string;
  confirmed: number;
  total: number;
  gap: number;
}) {
  const tone =
    gap === 0
      ? "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]"
      : "border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[var(--ink-soft)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-[var(--radius-pill)] border ${tone} text-[10.5px] tracking-[0.12em] uppercase tabular-nums`}
    >
      <span className="font-medium">{label}</span>
      <span className="opacity-60">·</span>
      <span>
        {confirmed}/{total}
      </span>
    </span>
  );
}

function StatusPip({ status }: { status: "confirmed" | "draft" | "missing" }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.12em] uppercase text-[#3a6b3b]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#5b9a5d]" aria-hidden="true" />
        Confirmed
      </span>
    );
  }
  if (status === "draft") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-soft)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" aria-hidden="true" />
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.12em] uppercase text-[var(--cinnabar-deep)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
      Missing
    </span>
  );
}
