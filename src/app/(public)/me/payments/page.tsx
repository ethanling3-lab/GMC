import type { Metadata } from "next";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfEnrollments } from "@/lib/participant-self";
import { createPaymentAccessToken } from "@/lib/tokens";
import { loadMemberPurchases, type MemberPurchase } from "@/lib/payments/member";
import { methodLabel, sgd } from "@/lib/payments/types";
import { ComingSoonButton } from "@/components/portal/ComingSoonButton";

export const metadata: Metadata = { title: "Payments · 付款 — GMC" };
export const dynamic = "force-dynamic";

const PAYMENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const fmtDay = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No date";

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

const STATE_TEXT: Record<string, { cn: string; en: string; tone: string }> = {
  complete: { cn: "完款", en: "Paid in full", tone: "bg-[var(--jade-wash)] text-[var(--jade-deep)]" },
  partial: { cn: "分期中", en: "Paying in instalments", tone: "bg-[var(--gold-soft)] text-[var(--ink)]" },
  unpaid: { cn: "未付", en: "Not paid yet", tone: "bg-[var(--paper-deep)] text-[var(--ink-soft)]" },
  behind: { cn: "逾期", en: "Overdue", tone: "bg-[#FBEAE7] text-[#A8321F]" },
};

const ROW_TEXT: Record<string, { label: string; tone: string }> = {
  paid: { label: "Paid · 已付", tone: "text-[var(--jade-deep)]" },
  part: { label: "Part paid · 部分已付", tone: "text-[var(--ink)]" },
  due: { label: "Upcoming · 待付", tone: "text-[var(--ink-soft)]" },
  overdue: { label: "Overdue · 逾期", tone: "text-[#A8321F]" },
};

function ProgrammeCard({ p }: { p: MemberPurchase }) {
  const st = STATE_TEXT[p.state] ?? STATE_TEXT.partial;
  const pct = p.total > 0 ? Math.min(100, Math.round((p.paid / p.total) * 100)) : 100;
  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[0_1px_2px_rgba(20,40,80,0.04),0_10px_28px_-16px_rgba(20,40,80,0.18)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]">{p.title}</h3>
          <div className="mt-1 text-[12.5px] text-[var(--ink-soft)]">Signed up · 报名 {fmtDay(p.registered_on)}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${st.tone}`}>
          {st.cn} · {st.en}
        </span>
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="font-display text-[28px] leading-none tracking-[-0.03em] text-[var(--ink)] tabular-nums">
          {sgd(p.paid)} <span className="text-[14px] text-[var(--ink-mute)]">paid of {sgd(p.total)}</span>
        </div>
        {p.balance > 0 ? (
          <div className="text-[13px] text-[var(--ink-soft)] tabular-nums">
            Balance · 余款 <span className="text-[var(--ink)]">{sgd(p.balance)}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-[var(--paper-deep)] overflow-hidden" role="presentation">
        <div className="h-full rounded-full bg-[var(--cinnabar)]" style={{ width: `${pct}%` }} />
      </div>
      {p.overdue > 0 ? (
        <p className="mt-3 text-[13px] text-[#A8321F]">
          {sgd(p.overdue)} is overdue. Please pay at the next class or contact your CS · 请于下次上课时付款或联系客服。
        </p>
      ) : null}

      {p.rows.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-[12px] text-[var(--ink-mute)]">Schedule · 付款时间表</h4>
          <ul className="mt-2 divide-y divide-[var(--paper-shadow)]">
            {p.rows.map((r, i) => {
              const t = ROW_TEXT[r.state];
              return (
                <li key={i} className="py-2.5 flex items-center justify-between gap-3 text-[13.5px]">
                  <div className="min-w-0">
                    <div className="text-[var(--ink)]">{r.label}</div>
                    <div className="text-[12px] text-[var(--ink-mute)] tabular-nums">{r.due_on ? `due ${fmtDay(r.due_on)}` : "no fixed date"}</div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums whitespace-nowrap">
                    <div className="text-[var(--ink)]">{sgd(r.amount_sgd)}</div>
                    <div className={`text-[11.5px] ${t.tone}`}>
                      {r.state === "part" || (r.state === "overdue" && r.left < r.amount_sgd) ? `${sgd(r.left)} left · ` : ""}
                      {t.label}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {p.payments.length > 0 ? (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-[12.5px] text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] focus-visible:outline-none focus-visible:underline">
            Payments made · 付款记录 ({p.payments.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {p.payments.map((pay, i) => (
              <li key={i} className="flex justify-between gap-3 text-[12.5px] tabular-nums">
                <span className="text-[var(--ink-soft)]">
                  {fmtDay(pay.paid_on)} · {methodLabel(pay.method)}
                  {pay.currency === "MYR" ? ` · MYR ${pay.amount.toLocaleString("en-MY")}` : ""}
                </span>
                <span className="text-[var(--ink)]">{sgd(pay.amount_sgd)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

export default async function MePaymentsPage() {
  const participant = await requireParticipant();
  const [enrollments, purchases] = await Promise.all([
    loadSelfEnrollments(participant.id),
    loadMemberPurchases(participant.id),
  ]);

  // Event fees still owed: approved and not fully paid (counter part-payments count).
  const outstanding = enrollments
    .filter((e) => e.status === "approved" && e.payment_status !== "paid")
    .map((e) => {
      const due = num(e.amount_due) ?? num(e.event.price);
      const paid = num(e.amount_paid) ?? 0;
      return { e, due, paid, left: due == null ? null : Math.max(0, Math.round((due - paid) * 100) / 100) };
    });
  const history = enrollments.filter((e) => e.payment_status === "paid" || e.status === "paid");

  return (
    <div>
      <div>
        <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">— Payments · 付款</div>
        <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
          Your payments.
        </h1>
      </div>

      {purchases.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">My programmes · 我的配套</h2>
          <div className="mt-3 space-y-4">
            {purchases.map((p) => (
              <ProgrammeCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">Course fees to pay · 待付课程费</h2>
        <div className="mt-3 space-y-3">
          {outstanding.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">No course fees to pay.</p>
          ) : (
            outstanding.map(({ e, due, paid, left }) => {
              const title = e.event.title_cn ?? e.event.title_en ?? e.event.slug;
              const payToken = createPaymentAccessToken(e.enrollment_id, PAYMENT_LINK_TTL_MS);
              return (
                <article
                  key={e.enrollment_id}
                  className="rounded-[var(--radius-lg)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] p-5"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-[14rem] flex-1">
                      <div className="font-display text-[18px] leading-[1.2] text-[var(--ink)]">{title}</div>
                      {e.for_child ? (
                        <div className="mt-1 text-[12.5px] text-[var(--cinnabar-deep)]">For {e.for_child.name} · 子女</div>
                      ) : null}
                      <div className="mt-1 text-[12.5px] tabular-nums text-[var(--ink-soft)]">
                        {left == null ? "Amount to be confirmed · 金额待定" : `To pay · 应付 ${sgd(left)}`}
                        {paid > 0 && due != null ? ` (paid ${sgd(paid)} of ${sgd(due)})` : ""}
                      </div>
                    </div>
                    {left != null && left > 0 ? (
                    <a
                      href={`/pay/${payToken}`}
                      className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,transform] duration-[var(--dur-fast)]"
                      style={{ color: "var(--paper-warm)" }}
                    >
                      Pay now · 立即付款
                    </a>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">Course fees paid · 已付课程费</h2>
        <div className="mt-3 space-y-2">
          {history.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-mute)]">No paid course fees yet.</p>
          ) : (
            history.map((e) => {
              const title = e.event.title_cn ?? e.event.title_en ?? e.event.slug;
              const amt = num(e.amount_paid);
              return (
                <article
                  key={e.enrollment_id}
                  className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-[var(--ink)]">
                      {title}
                      {e.for_child ? <span className="ml-2 text-[12px] text-[var(--cinnabar-deep)]">For {e.for_child.name} · 子女</span> : null}
                    </div>
                    <div className="text-[12px] text-[var(--ink-soft)] tabular-nums mt-0.5">
                      {e.paid_at ? `Paid · 已付款 ${fmtDay(e.paid_at)}` : "Paid · 已付款"}
                      {amt != null ? ` · ${sgd(amt)}` : ""}
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
