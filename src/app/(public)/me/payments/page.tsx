import type { Metadata } from "next";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfEnrollments } from "@/lib/participant-self";
import { createPaymentAccessToken } from "@/lib/tokens";
import { ComingSoonButton } from "@/components/portal/ComingSoonButton";

export const metadata: Metadata = { title: "Payments · 付款 — GMC" };
export const dynamic = "force-dynamic";

const PAYMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default async function MePaymentsPage() {
  const participant = await requireParticipant();
  const enrollments = await loadSelfEnrollments(participant.id);

  // Split: outstanding (status=approved AND payment_status != paid) vs paid history.
  const outstanding = enrollments.filter(
    (e) => e.status === "approved" && e.payment_status !== "paid",
  );
  const history = enrollments.filter(
    (e) => e.payment_status === "paid" || e.status === "paid",
  );

  return (
    <div>
      <div>
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          — Payments · 付款
        </div>
        <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Your payments.
        </h1>
      </div>

      <section className="mt-8">
        <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Outstanding · 待付款
        </h2>
        <div className="mt-3 space-y-3">
          {outstanding.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">No outstanding payments.</p>
          ) : (
            outstanding.map((e) => {
              const title = e.event.title_cn ?? e.event.title_en ?? e.event.slug;
              const payToken = createPaymentAccessToken(e.enrollment_id, PAYMENT_LINK_TTL_MS);
              return (
                <article
                  key={e.enrollment_id}
                  className="rounded-[var(--radius-lg)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] p-5"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[18px] leading-[1.2] text-[var(--ink)]">
                        {title}
                      </div>
                      <div className="mt-1 text-[12px] tracking-[0.06em] tabular-nums text-[var(--ink-soft)]">
                        Amount · 金额 ${e.event.price ?? "—"}
                      </div>
                    </div>
                    <a
                      href={`/pay/${payToken}`}
                      className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] transition-colors"
                      style={{ color: "var(--paper-warm)" }}
                    >
                      Pay now · 立即付款
                    </a>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
          Payment history · 付款记录
        </h2>
        <div className="mt-3 space-y-2">
          {history.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">No paid enrollments yet.</p>
          ) : (
            history.map((e) => {
              const title = e.event.title_cn ?? e.event.title_en ?? e.event.slug;
              return (
                <article
                  key={e.enrollment_id}
                  className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-[var(--ink)]">{title}</div>
                    <div className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-faint)] tabular-nums mt-0.5">
                      {e.paid_at
                        ? `Paid · 已付款 ${new Date(e.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                        : "Paid"}{" "}
                      · ${e.amount_paid ?? "—"}
                    </div>
                  </div>
                  <ComingSoonButton label_en="Receipt" label_cn="收据" variant="solid" />
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
