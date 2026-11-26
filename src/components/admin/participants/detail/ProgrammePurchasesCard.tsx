import Link from "next/link";
import { CardShell } from "./CardShell";
import { STATE_LABEL, sgd, type PurchaseView } from "@/lib/payments/types";
import { stateTone } from "@/components/admin/payments/ui";

// Programme purchases · 配套付款 on the participant page (Phase 2,
// 2026-11-26). Read-only summary; Super Admin opens each purchase to edit
// or record payments (Finance does that from Finance → Instalments).
export function ProgrammePurchasesCard({
  participantId,
  purchases,
  canManage,
}: {
  participantId: string;
  purchases: PurchaseView[];
  canManage: boolean;
}) {
  return (
    <CardShell eyebrow="Payments" eyebrowZh="配套付款" title="Programme purchases" editing={false} editable={false}>
      {purchases.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[var(--ink-faint)] italic">No programme purchases recorded.</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {purchases.map((pu) => {
            const s = pu.standing;
            return (
              <li key={pu.id} className="py-3 border-b border-[var(--paper-shadow)] last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {canManage ? (
                      <Link href={`/admin/finance/purchases/${pu.id}`} className="text-[13.5px] text-[var(--ink)] hover:text-[var(--cinnabar-deep)] underline decoration-[var(--paper-shadow)] underline-offset-2">
                        {pu.title}
                      </Link>
                    ) : (
                      <span className="text-[13.5px] text-[var(--ink)]">{pu.title}</span>
                    )}
                    <div className="mt-0.5 text-[12px] text-[var(--ink-soft)] tabular-nums">
                      Paid {sgd(s.paid)} of {sgd(s.total)} · registered {pu.registered_on}
                    </div>
                    {s.next && pu.status !== "cancelled" ? (
                      <div className="text-[12px] text-[var(--ink-soft)] tabular-nums">
                        Next {s.next.label} {sgd(s.next.remaining)}
                        {s.next.due_on ? ` due ${s.next.due_on}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] ${stateTone[s.state]}`}>
                    {STATE_LABEL[s.state].cn}
                    {s.state === "behind" ? ` ${sgd(s.behind)}` : ""}
                  </span>
                </div>
                {pu.schedule.length > 0 ? (
                  <div className="mt-1.5 text-[11.5px] text-[var(--ink-mute)]">
                    {pu.schedule.map((r) => `${r.label} ${sgd(r.amount_sgd)}${r.due_on ? ` · ${r.due_on}` : ""}`).join("  /  ")}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? (
        <div className="mt-4">
          <Link
            href={`/admin/finance/purchases/new?participant=${participantId}`}
            className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,color,transform] duration-[var(--dur-fast)]"
          >
            Record a purchase · 新增配套
          </Link>
        </div>
      ) : null}
    </CardShell>
  );
}
