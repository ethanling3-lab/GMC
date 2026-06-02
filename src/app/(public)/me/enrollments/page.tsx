import type { Metadata } from "next";
import Link from "next/link";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfEnrollments } from "@/lib/participant-self";

export const metadata: Metadata = { title: "Enrollments · 报名 — GMC" };
export const dynamic = "force-dynamic";

function statusTone(status: string): string {
  if (status === "paid") return "border-[#5b9a5d]/30 bg-[#5b9a5d]/8 text-[#3a6b3b]";
  if (status === "approved") return "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
  if (status === "pending_approval")
    return "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--ink-soft)]";
  if (status === "rejected" || status === "cancelled")
    return "border-[var(--ink-faint)]/30 bg-[var(--paper-deep)] text-[var(--ink-mute)]";
  return "border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[var(--ink-soft)]";
}

const STATUS_LABEL: Record<string, { en: string; cn: string }> = {
  pending_approval: { en: "Pending", cn: "审核中" },
  approved: { en: "Approved", cn: "已通过" },
  paid: { en: "Paid", cn: "已付款" },
  rejected: { en: "Rejected", cn: "已拒绝" },
  cancelled: { en: "Cancelled", cn: "已取消" },
};

export default async function MeEnrollmentsPage() {
  const participant = await requireParticipant();
  const enrollments = await loadSelfEnrollments(participant.id);

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            — Enrollments · 报名
          </div>
          <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
            Your classes.
          </h1>
        </div>
        <Link
          href="/events"
          className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] transition-colors"
          style={{ color: "var(--paper-warm)" }}
        >
          Register for new event · 报名新课
        </Link>
      </div>

      <section className="mt-8 space-y-3">
        {enrollments.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-8 text-center text-[13.5px] text-[var(--ink-mute)]">
            You haven&apos;t enrolled in any classes yet.
            <br />
            <Link
              href="/events"
              className="mt-3 inline-block text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
              style={{ color: "var(--cinnabar-deep)" }}
            >
              Browse upcoming events →
            </Link>
          </div>
        ) : (
          enrollments.map((e) => {
            const title = e.event.title_cn ?? e.event.title_en ?? e.event.slug;
            const tone = statusTone(e.status);
            const label = STATUS_LABEL[e.status] ?? { en: e.status, cn: e.status };
            return (
              <article
                key={e.enrollment_id}
                className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 shadow-[var(--shadow-paper-1)]"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[18px] leading-[1.2] text-[var(--ink)]">
                      {title}
                    </div>
                    {e.event.title_en && e.event.title_cn ? (
                      <div className="mt-0.5 text-[12px] italic text-[var(--ink-soft)]">
                        {e.event.title_en}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] tabular-nums">
                      {e.event.start_date ? <span>{e.event.start_date}</span> : null}
                      {e.event.venue ? <span>· {e.event.venue}</span> : null}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 h-[22px] rounded-[var(--radius-pill)] border ${tone} text-[10.5px] tracking-[0.14em] uppercase tabular-nums`}
                  >
                    <span className="font-medium">{label.en}</span>
                    <span className="text-[var(--ink-faint)]">·</span>
                    <span>{label.cn}</span>
                  </span>
                </div>
                <div className="mt-4 pt-4 border-t border-[var(--paper-shadow)] flex items-center justify-between gap-3 flex-wrap text-[12.5px] text-[var(--ink-soft)]">
                  <div className="tabular-nums">
                    {e.event.price ? (
                      <>
                        <span className="text-[var(--ink-faint)]">Price · 价格</span>{" "}
                        <span className="text-[var(--ink)] font-medium">${e.event.price}</span>
                      </>
                    ) : null}
                  </div>
                  <Link
                    href={`/events/${e.event.slug}`}
                    className="inline-flex items-center gap-1 text-[11.5px] tracking-[0.1em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
                    style={{ color: "var(--cinnabar-deep)" }}
                  >
                    View event →
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
