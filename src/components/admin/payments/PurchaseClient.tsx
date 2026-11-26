"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sgDay } from "@/lib/pricing/tiers";
import {
  MANUAL_METHODS,
  STATE_LABEL,
  methodLabel,
  sgd,
  type PaymentMethod,
  type PurchaseView,
} from "@/lib/payments/types";
import { btn, callJson, input, label, panel, primary, stateTone } from "./ui";

// One programme purchase: schedule (editable for this buyer), payments
// (record / void), standing. Finance + Super Admin (Phase 2, 2026-11-26).

type Row = { label: string; due_on: string; amount: string };
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function PurchaseClient({ purchase, lastFx }: { purchase: PurchaseView; lastFx: number | null }) {
  const router = useRouter();
  const s = purchase.standing;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [sched, setSched] = useState<Row[] | null>(null);
  const [schedReason, setSchedReason] = useState("");
  const [pay, setPay] = useState<{
    open: boolean; amount: string; currency: "SGD" | "MYR"; fx: string; method: PaymentMethod; paid_on: string; reference: string; note: string;
  }>({ open: false, amount: "", currency: "SGD", fx: lastFx ? String(lastFx) : "", method: "bank_transfer", paid_on: sgDay(), reference: "", note: "" });
  const [edit, setEdit] = useState<{ title: string; total: string; note: string } | null>(null);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  const savePayment = () =>
    run(async () => {
      const amount = num(pay.amount);
      if (!(amount > 0)) throw new Error("Enter the amount.");
      await callJson(`/api/admin/purchases/${purchase.id}/payments`, "POST", {
        amount,
        currency: pay.currency,
        fx_rate: pay.currency === "MYR" ? num(pay.fx) : null,
        method: pay.method,
        paid_on: pay.paid_on,
        reference: pay.reference.trim() || null,
        note: pay.note.trim() || null,
      });
      setPay((p) => ({ ...p, open: false, amount: "", reference: "", note: "" }));
      return "✓ Payment recorded.";
    });

  const voidPayment = (id: string) => {
    const reason = window.prompt("Why is this payment being voided? (kept on record)");
    if (!reason?.trim()) return;
    void run(async () => {
      await callJson(`/api/admin/payments/${id}`, "PATCH", { action: "void", reason: reason.trim() });
      return "✓ Payment voided.";
    });
  };

  const saveSchedule = () =>
    run(async () => {
      if (!sched) return "";
      const rows = sched.map((r) => ({ label: r.label.trim(), due_on: r.due_on || null, amount_sgd: num(r.amount) }));
      if (rows.some((r) => !Number.isFinite(r.amount_sgd) || !r.label)) throw new Error("Every row needs a label and an amount.");
      await callJson(`/api/admin/purchases/${purchase.id}`, "PATCH", { action: "schedule", rows, reason: schedReason });
      setSched(null);
      setSchedReason("");
      return "✓ Schedule saved.";
    });

  const saveEdit = () =>
    run(async () => {
      if (!edit) return "";
      await callJson(`/api/admin/purchases/${purchase.id}`, "PATCH", { action: "edit", title: edit.title, total_sgd: num(edit.total), note: edit.note.trim() || null });
      setEdit(null);
      return "✓ Saved.";
    });

  const cancel = () => {
    const reason = window.prompt("Why is this purchase cancelled? Payments stay on record.");
    if (!reason?.trim()) return;
    void run(async () => {
      await callJson(`/api/admin/purchases/${purchase.id}`, "PATCH", { action: "cancel", reason: reason.trim() });
      return "✓ Cancelled.";
    });
  };

  const sgdPreview = pay.currency === "MYR" && num(pay.amount) > 0 && num(pay.fx) > 0 ? Math.round(num(pay.amount) * num(pay.fx) * 100) / 100 : null;
  const schedSum = sched ? sched.reduce((t, r) => t + (Number.isFinite(num(r.amount)) ? num(r.amount) : 0), 0) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Standing */}
      <section className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className={`rounded-full px-2.5 py-1 text-[12px] ${stateTone[s.state]}`}>
              {STATE_LABEL[s.state].cn} · {STATE_LABEL[s.state].en}
              {s.state === "behind" ? ` ${sgd(s.behind)}` : ""}
            </span>
            <div className="mt-3 font-display text-[30px] leading-none tracking-[-0.03em] text-[var(--ink)] tabular-nums">
              {sgd(s.paid)} <span className="text-[16px] text-[var(--ink-mute)]">of {sgd(s.total)}</span>
            </div>
            <div className="mt-2 text-[12.5px] text-[var(--ink-soft)]">
              Balance {sgd(s.balance)}
              {s.next ? ` · next ${s.next.label} ${sgd(s.next.remaining)}${s.next.due_on ? ` due ${s.next.due_on}` : ""}` : ""}
            </div>
            {purchase.cancel_reason ? <div className="mt-1 text-[12.5px] text-[var(--cinnabar-deep)]">Cancelled: {purchase.cancel_reason}</div> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {purchase.status !== "cancelled" ? (
              <>
                <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} onClick={() => setPay({ ...pay, open: true })}>
                  Record payment
                </button>
                <button type="button" className={btn} onClick={() => setEdit({ title: purchase.title, total: String(purchase.total_sgd), note: purchase.note ?? "" })}>
                  Edit total / title
                </button>
                <button type="button" className={btn} onClick={cancel}>
                  Cancel purchase
                </button>
              </>
            ) : (
              <button type="button" className={btn} disabled={busy} onClick={() => void run(async () => { await callJson(`/api/admin/purchases/${purchase.id}`, "PATCH", { action: "reopen" }); return "✓ Reopened."; })}>
                Reopen
              </button>
            )}
          </div>
        </div>
        {s.paid > 0 ? (
          <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--gold-soft)] px-3 py-2 text-[12.5px] text-[var(--ink)]">
            名额: {s.state === "complete" ? "完款 paid" : "定金 paid"}. Check the seats they&apos;re due are issued on their profile.
          </p>
        ) : null}
        {msg ? <p className={`mt-3 text-[13px] ${msg.ok ? "text-[var(--jade-deep)]" : "text-[var(--cinnabar-deep)]"}`}>{msg.text}</p> : null}

        {edit ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Title</span>
              <input className={input} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Total SGD</span>
              <input className={input} inputMode="decimal" value={edit.total} onChange={(e) => setEdit({ ...edit, total: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-3">
              <span className={label}>Note</span>
              <input className={input} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </label>
            <div className="sm:col-span-3 flex gap-2">
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy} onClick={() => void saveEdit()}>Save</button>
              <button type="button" className={btn} onClick={() => setEdit(null)}>Close</button>
            </div>
          </div>
        ) : null}

        {pay.open ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4">
            <label className="flex flex-col gap-1">
              <span className={label}>Amount</span>
              <input className={input} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} autoFocus />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Currency</span>
              <select className={input} value={pay.currency} onChange={(e) => setPay({ ...pay, currency: e.target.value as "SGD" | "MYR" })}>
                <option value="SGD">SGD</option>
                <option value="MYR">MYR</option>
              </select>
            </label>
            {pay.currency === "MYR" ? (
              <label className="flex flex-col gap-1">
                <span className={label}>Rate: SGD for 1 MYR</span>
                <input className={input} inputMode="decimal" placeholder="e.g. 0.3072" value={pay.fx} onChange={(e) => setPay({ ...pay, fx: e.target.value })} />
              </label>
            ) : (
              <span />
            )}
            <label className="flex flex-col gap-1">
              <span className={label}>Method</span>
              <select className={input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
                {MANUAL_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.en} · {m.cn}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Paid on</span>
              <input className={input} type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{pay.method === "card_pos" ? "Approval code *" : "Reference"}</span>
              <input className={input} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-3">
              <span className={label}>Note</span>
              <input className={input} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </label>
            {sgdPreview != null ? <p className="sm:col-span-3 text-[12.5px] text-[var(--ink-soft)]">= {sgd(sgdPreview)} counted against the balance.</p> : null}
            <div className="sm:col-span-3 flex gap-2">
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy} onClick={() => void savePayment()}>
                {busy ? "Saving…" : "Save payment"}
              </button>
              <button type="button" className={btn} onClick={() => setPay({ ...pay, open: false })}>Close</button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Schedule */}
      <section className={panel}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[19px] text-[var(--ink)]">Schedule · 付款时间表</h2>
          {!sched && purchase.status !== "cancelled" ? (
            <button type="button" className={btn} onClick={() => setSched(purchase.schedule.map((r) => ({ label: r.label, due_on: r.due_on ?? "", amount: String(r.amount_sgd) })))}>
              Change schedule
            </button>
          ) : null}
        </div>
        {!sched ? (
          purchase.schedule.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--ink-faint)] italic">No schedule rows. They are never counted as behind.</p>
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-[var(--ink-mute)]">
                  <th className="py-1.5 font-normal">Row</th>
                  <th className="py-1.5 font-normal">Due</th>
                  <th className="py-1.5 font-normal text-right">SGD</th>
                </tr>
              </thead>
              <tbody>
                {purchase.schedule.map((r, i) => (
                  <tr key={r.id ?? i} className="border-t border-[var(--paper-shadow)]">
                    <td className="py-2 text-[var(--ink)]">{r.label}</td>
                    <td className="py-2 text-[var(--ink-soft)] tabular-nums">{r.due_on ?? "no date"}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--ink)]">{sgd(r.amount_sgd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <div className="mt-3">
            {sched.map((r, i) => (
              <div key={i} className="mt-1.5 grid grid-cols-[1fr_160px_120px_32px] gap-2">
                <input className={input} value={r.label} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className={input} type="date" value={r.due_on} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, due_on: e.target.value } : x)))} />
                <input className={input} inputMode="decimal" value={r.amount} onChange={(e) => setSched(sched.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <button type="button" aria-label="Remove row" className={`${btn} h-9 px-0`} onClick={() => setSched(sched.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className={`${btn} mt-2`} onClick={() => setSched([...sched, { label: `第${sched.length}期`, due_on: "", amount: "" }])}>
              + Add row
            </button>
            <p className={`mt-2 text-[12px] ${Math.abs(schedSum - purchase.total_sgd) > 0.005 ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-soft)]"}`}>
              Rows add up to {sgd(schedSum)} · total {sgd(purchase.total_sgd)}
            </p>
            <label className="mt-3 flex flex-col gap-1">
              <span className={label}>Why is it changing? (kept in the history)</span>
              <input className={input} value={schedReason} onChange={(e) => setSchedReason(e.target.value)} />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy || schedReason.trim().length < 2} onClick={() => void saveSchedule()}>
                Save schedule
              </button>
              <button type="button" className={btn} onClick={() => setSched(null)}>Close</button>
            </div>
          </div>
        )}
      </section>

      {/* Payments */}
      <section className={panel}>
        <h2 className="font-display text-[19px] text-[var(--ink)]">Payments · 付款记录</h2>
        {purchase.payments.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--ink-faint)] italic">No payments yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--paper-shadow)]">
            {purchase.payments.map((p) => (
              <li key={p.id} className={`py-2.5 flex items-start justify-between gap-4 ${p.voided_at ? "opacity-55" : ""}`}>
                <div className="min-w-0 text-[13px]">
                  <div className={`text-[var(--ink)] tabular-nums ${p.voided_at ? "line-through" : ""}`}>
                    {sgd(p.amount_sgd)}
                    {p.currency === "MYR" ? <span className="ml-2 text-[12px] text-[var(--ink-soft)]">MYR {p.amount.toLocaleString("en-MY")} @ {p.fx_rate}</span> : null}
                  </div>
                  <div className="text-[12px] text-[var(--ink-soft)]">
                    {p.paid_on} · {methodLabel(p.method)}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.recorded_by_name ? ` · by ${p.recorded_by_name}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </div>
                  {p.voided_at ? <div className="text-[12px] text-[var(--cinnabar-deep)]">Voided: {p.void_reason}</div> : null}
                </div>
                {!p.voided_at ? (
                  <button type="button" className={btn} disabled={busy} onClick={() => voidPayment(p.id)}>
                    Void
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
