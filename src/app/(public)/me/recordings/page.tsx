import type { Metadata } from "next";
import Link from "next/link";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfRecordings } from "@/lib/participant-self";

export const metadata: Metadata = { title: "Recordings · 录像 — GMC" };
export const dynamic = "force-dynamic";

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function MeRecordingsPage() {
  const participant = await requireParticipant();
  const recordings = await loadSelfRecordings(participant.id);

  return (
    <div>
      <div>
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Recordings · 录像
        </div>
        <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Class recordings.
        </h1>
        <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[62ch]">
          Recordings you&apos;ve been given access to. New recordings appear here
          once an admin grants you access.
        </p>
      </div>

      <section className="mt-8">
        {recordings.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-8 text-center text-[13.5px] text-[var(--ink-mute)]">
            No recordings are available to you yet.
            <br />
            <span className="text-[12px] text-[var(--ink-faint)]">
              You&apos;ll see them here once they&apos;re shared with you.
            </span>
          </div>
        ) : (
          <ul className="space-y-3">
            {recordings.map((r) => {
              const title = r.title_cn ?? r.title_en ?? "Recording";
              return (
                <li key={r.id}>
                  <Link
                    href={`/me/recordings/${r.id}`}
                    className="block rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 hover:-translate-y-0.5 transition-transform shadow-[var(--shadow-paper-1)]"
                    style={{ color: "inherit" }}
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                          {r.event_title ?? "Event"}
                        </div>
                        <div className="mt-1 font-display text-[18px] leading-[1.2] text-[var(--ink)]">
                          {title}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] tabular-nums">
                        <span>{formatDuration(r.duration_seconds)}</span>
                        <span className="text-[var(--cinnabar-deep)]">Watch →</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
