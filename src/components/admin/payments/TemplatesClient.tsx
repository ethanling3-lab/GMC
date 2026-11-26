"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PURCHASE_KINDS, sgd, type PaymentTemplate, type PurchaseKind } from "@/lib/payments/types";
import { btn, callJson, input, label, panel, primary } from "./ui";

// Payment plans · 付款方案 — reusable schedules Finance sets up (Phase 2,
// 2026-11-26). A buyer gets a COPY of the rows, so editing a plan never
// changes what an existing buyer owes.

type Programme = { id: string; name_cn: string; name_en: string };
type Row = { label: string; amount: string; months: string };
type Draft = {
  id: string | null;
  name: string;
  programme_id: string;
  kind: PurchaseKind;
  total: string;
  note: string;
  active: boolean;
  rows: Row[];
};

const blank = (): Draft => ({
  id: null,
  name: "",
  programme_id: "",
  kind: "new",
  total: "",
  note: "",
  active: true,
  rows: [
    { label: "定金", amount: "", months: "0" },
    { label: "第1期", amount: "", months: "1" },
  ],
});

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function TemplatesClient({ templates, programmes }: { templates: PaymentTemplate[]; programmes: Programme[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progName = (id: string | null) => {
    const p = programmes.find((x) => x.id === id);
    return p ? p.name_cn : "Any programme";
  };

  const edit = (t: PaymentTemplate) =>
    setDraft({
      id: t.id,
      name: t.name,
      programme_id: t.programme_id ?? "",
      kind: t.kind,
      total: String(t.total_sgd),
      note: t.note ?? "",
      active: t.active,
      rows: t.items.map((i) => ({ label: i.label, amount: String(i.amount_sgd), months: String(i.due_after_months) })),
    });

  const rowsSum = draft ? draft.rows.reduce((s, r) => s + (Number.isFinite(num(r.amount)) ? num(r.amount) : 0), 0) : 0;

  const save = async () => {
    if (!draft) return;
    setError(null);
    const items = draft.rows.map((r) => ({ label: r.label.trim(), amount_sgd: num(r.amount), due_after_months: Math.max(0, Math.round(Number(r.months) || 0)) }));
    if (items.some((i) => !Number.isFinite(i.amount_sgd))) return setError("Every row needs an amount.");
    const body = {
      name: draft.name.trim(),
      programme_id: draft.programme_id || null,
      kind: draft.kind,
      total_sgd: num(draft.total),
      note: draft.note.trim() || null,
      active: draft.active,
      items,
    };
    if (!Number.isFinite(body.total_sgd)) return setError("Enter the total.");
    setBusy(true);
    try {
      if (draft.id) await callJson(`/api/admin/finance/templates/${draft.id}`, "PATCH", body);
      else await callJson(`/api/admin/finance/templates`, "POST", body);
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!draft ? (
        <div>
          <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} onClick={() => setDraft(blank())}>
            New payment plan
          </button>
        </div>
      ) : (
        <section className={panel}>
          <h2 className="font-display text-[20px] text-[var(--ink)] tracking-[-0.01em]">{draft.id ? "Edit plan" : "New plan"}</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Name · 名称</span>
              <input className={input} placeholder="e.g. 荣贵 · 定金 + 6期" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Programme</span>
              <select className={input} value={draft.programme_id} onChange={(e) => setDraft({ ...draft, programme_id: e.target.value })}>
                <option value="">Any programme</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_cn} · {p.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Kind</span>
              <select className={input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PurchaseKind })}>
                {PURCHASE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.en} · {k.cn}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Total SGD</span>
              <input className={input} inputMode="decimal" value={draft.total} onChange={(e) => setDraft({ ...draft, total: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Note</span>
              <input className={input} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
          </div>

          <div className="mt-5">
            <div className={label}>Rows · 分期</div>
            <div className="mt-2 grid grid-cols-[1fr_120px_150px_32px] gap-2 text-[11px] text-[var(--ink-mute)]">
              <span>Label</span>
              <span>SGD</span>
              <span>Due (months after signing)</span>
              <span />
            </div>
            {draft.rows.map((r, i) => (
              <div key={i} className="mt-1.5 grid grid-cols-[1fr_120px_150px_32px] gap-2">
                <input className={input} value={r.label} onChange={(e) => setDraft({ ...draft, rows: draft.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <input className={input} inputMode="decimal" value={r.amount} onChange={(e) => setDraft({ ...draft, rows: draft.rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                <input className={input} inputMode="numeric" value={r.months} onChange={(e) => setDraft({ ...draft, rows: draft.rows.map((x, j) => (j === i ? { ...x, months: e.target.value } : x)) })} />
                <button type="button" aria-label="Remove row" className={`${btn} h-9 px-0`} disabled={draft.rows.length <= 1} onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${btn} mt-2`}
              onClick={() => {
                const last = draft.rows[draft.rows.length - 1];
                const nextMonths = String((Number(last?.months) || 0) + 1);
                setDraft({ ...draft, rows: [...draft.rows, { label: `第${draft.rows.length}期`, amount: last?.amount ?? "", months: nextMonths }] });
              }}
            >
              + Add row
            </button>
            <p className={`mt-2 text-[12px] ${Math.abs(rowsSum - (num(draft.total) || 0)) > 0.005 ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-soft)]"}`}>
              Rows add up to {sgd(rowsSum)}
              {Number.isFinite(num(draft.total)) ? ` · total ${sgd(num(draft.total))}` : ""}
              {Math.abs(rowsSum - (num(draft.total) || 0)) > 0.005 ? " — these don't match; any gap shows as an undated balance." : ""}
            </p>
            <p className="mt-1 text-[12px] text-[var(--ink-mute)]">Month 0 = due on the day they sign. A one-row plan is a full payment.</p>
          </div>

          <label className="mt-4 flex items-center gap-2 text-[12.5px] text-[var(--ink)]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--cinnabar)]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            Offer this plan at the counter
          </label>

          {error ? <p className="mt-3 text-[13px] text-[var(--cinnabar-deep)]">{error}</p> : null}
          <div className="mt-5 flex gap-2">
            <button type="button" className={primary} style={{ color: "var(--paper-warm)" }} disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save plan"}
            </button>
            <button type="button" className={btn} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className={panel}>
        {templates.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-faint)] italic">No payment plans yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--paper-shadow)]">
            {templates.map((t) => (
              <li key={t.id} className={`py-3 flex items-start justify-between gap-4 ${t.active ? "" : "opacity-55"}`}>
                <div className="min-w-0">
                  <div className="text-[14.5px] text-[var(--ink)]">
                    {t.name}
                    {!t.active ? <span className="ml-2 text-[11px] text-[var(--ink-mute)]">not offered</span> : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--ink-soft)]">
                    {progName(t.programme_id)} · {PURCHASE_KINDS.find((k) => k.value === t.kind)?.cn} · {sgd(t.total_sgd)}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--ink-mute)]">
                    {t.items.map((i) => `${i.label} ${sgd(i.amount_sgd)}${i.due_after_months ? ` +${i.due_after_months}mo` : ""}`).join(" · ")}
                  </div>
                </div>
                <button type="button" className={btn} onClick={() => edit(t)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
