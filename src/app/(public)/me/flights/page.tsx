import type { Metadata } from "next";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfFlights } from "@/lib/participant-self";
import { ComingSoonButton } from "@/components/portal/ComingSoonButton";

export const metadata: Metadata = { title: "Flights · 航班 — GMC" };
export const dynamic = "force-dynamic";

export default async function MeFlightsPage() {
  const participant = await requireParticipant();
  const flights = await loadSelfFlights(participant.id);

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            — Flights · 航班
          </div>
          <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
            Your travel.
          </h1>
        </div>
        <ComingSoonButton label_en="Submit flight info" label_cn="提交航班信息" />
      </div>

      <section className="mt-8">
        {flights.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-8 text-center text-[13.5px] text-[var(--ink-mute)]">
            No flight information on file yet.
            <br />
            <span className="text-[12px] text-[var(--ink-faint)]">
              Submit your details once you&apos;ve booked.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {flights.map((f) => (
              <article
                key={f.id}
                className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                      {f.direction === "arrival" ? "Arrival · 抵达" : "Departure · 离开"}
                      {f.event_title ? ` · ${f.event_title}` : ""}
                    </div>
                    <div className="mt-1.5 font-display text-[16px] text-[var(--ink)] tabular-nums">
                      {f.flight_number ?? "—"}
                      {f.airline ? <span className="text-[12px] italic text-[var(--ink-soft)] ml-2">{f.airline}</span> : null}
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--ink-soft)] tabular-nums">
                      {f.iata ? `${f.iata}` : "—"}
                      {f.scheduled_at
                        ? ` · ${new Date(f.scheduled_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                      {f.terminal ? ` · Terminal ${f.terminal}` : ""}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 h-[20px] rounded-[var(--radius-pill)] border text-[10px] tracking-[0.16em] uppercase ${
                      f.confirmed
                        ? "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]"
                        : "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--ink-soft)]"
                    }`}
                  >
                    {f.confirmed ? "Confirmed" : "Draft"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
