"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PersonHit } from "@/lib/payments/counter";
import { addMonthsDay } from "@/lib/payments/standing";
import { sgDay } from "@/lib/pricing/tiers";
import { PURCHASE_KINDS, sgd, type PaymentTemplate, type PurchaseKind } from "@/lib/payments/types";
import { PersonSearch } from "./CounterClient";
import { btn, callJson, input, label, panel, primary } from "./ui";

// Record a programme purchase away from the counter (bought earlier, an
// upgrade, a phone sale). Payments are added on the purchase page after.

type Programme = { id: string; name_cn: string; name_en: string; price_sgd: number };
type Row = { label: string; due_on: string; amount: string };
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function NewPurchaseClient({
  programmes,
  templates,
  initialPerson,
}: {
  programmes: Programme[];
  templates: PaymentTemplate[];
  initialPerson: { id: string; name: string; region_id: string | null } | null;
}) {
  const router = useRouter();
  const [person, setPerson] = useState(initialPerson);
  const [programmeId, setProgrammeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PurchaseKind>("new");
  const [total, setTotal] = useState("");
  const [registeredOn, setRegisteredOn] = useState(sgDay());
  const [rows, setRows] = useState<Row[]>([{ label: "全款", due_on: sgDay(), amount: "" }]);
  const [note, setNote] = useState("");
  const [setCurrent, setSetCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (tplId: string, reg = registeredOn) => {
    setTemplateId(tplId);
    const t = templates.find((x) => x.id === tplId);
    if (!t) return;
    setKind(t.kind);
    setTotal(String(t.total_sgd));
    setRows(t.items.map((i) => ({ label: i.label, due_on: addMonthsDay(reg, i.due_after_months), amount: String(i.amount_sgd) })));
  };

  const pickProgramme = (id: string) => {
    setProgrammeId(id);
    const p = programmes.find((x) => x.id === id);
    if (p && !title) setTitle(`${p.name_cn} ${registeredOn.slice(0, 4)}`);
    const t = templates.find((x) => x.active && x.programme_id === id);
    if (t) applyTemplate(t.id);
    else if (p && !total) setTotal(String(p.price_sgd));
  };

  const sum = rows.reduce((s, r) => s + (Number.isFinite(num(r.amount)) ? num(r.amount) : 0), 0);

  const save = async () => {
    if (!person) return;
    setError(null);
    const schedule = rows.map((r) => ({ label: r.label.trim(), due_on: r.due_on || null, amount_sgd: num(r.amount) }));
    if (schedule.some((r) => !r.label || !Number.isFinite(r.amount_sgd))) return setError("Every schedule row needs a label and an amount.");
    setBusy(true);
    try {
      const j = await callJson<{ id: string }>(`/api/admin/participants/${person.id}/purchases`, "POST", {
        programme_id: programmeId || null,
        template_id: templateId || null,
        title: title.trim(),
        kind,
        total_sgd: num(total),
        registered_on: registeredOn,
        schedule,
        note: note.trim() || null,
        set_current: Boolean(programmeId) && setCurrent,
      });
      router.push(`/admin/finance/purchases/${j.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <section className={panel}>
      <div className="flex flex-col gap-1">
        <span className={label}>Buyer · 购买人</span>
        {person ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] px-3 py-2">
            <span className="text-[14px] text-[var(--ink)]">
              {person.name} {person.region_id ? <span className="font-mono text-[11.5px] text-[var(--ink-mute)]">{person.region_id}</span> : null}
            </span>
            <button type="button" className={btn} onClick={() => setPerson(null)}>Change</button>
          </div>
        ) : (
          <PersonSearch
            eventId={null}
            placeholder="Search name, phone or student ID…"
            onPick={(p: PersonHit) => setPerson({ id: p.id, name: p.name_cn || p.name_en || "—", region_id: p.region_id })}
            autoFocus
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Programme</span>
          <select className={input} value={programmeId} onChange={(e) => pickProgramme(e.target.value)}>
            <option value="">None (other purchase)</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>{p.name_cn} · {p.name_en}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Start from a plan</span>
          <select className={input} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Blank</option>
            {templates.filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {sgd(t.total_sgd)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Title</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Kind</span>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as PurchaseKind)}>
            {PURCHASE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.en} · {k.cn}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Total SGD</span>
          <input className={input} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Registered on · 报名日期</span>
          <input
            className={input}
            type="date"
            value={registeredOn}
            onChange={(e) => {
              setRegisteredOn(e.target.value);
              if (templateId && e.target.value) applyTemplate(templateId, e.target.value);
            }}
          />
        </label>
      </div>

      <div className="mt-5">
        <div className={label}>Their schedule · 付款时间表</div>
        {rows.map((r, i) => (
          <div key={i} className="mt-1.5 grid grid-cols-[1fr_160px_120px_32px] gap-2">
            <input className={input} value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className={input} type="date" value={r.due_on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, due_on: e.target.value } : x)))} />
            <input className={input} inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <button type="button" aria-label="Remove row" className={`${btn} h-9 px-0`} disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className={`${btn} mt-2`} onClick={() => setRows([...rows, { label: `第${rows.length}期`, due_on: "", amount: "" }])}>+ Add row</button>
        <p className={`mt-2 text-[12px] ${Math.abs(sum - (num(total) || 0)) > 0.005 ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink-soft)]"}`}>
          Rows add up to {sgd(sum)}{Number.isFinite(num(total)) ? ` · total ${sgd(num(total))}` : ""}
        </p>
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className={label}>Note</span>
        <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {programmeId ? (
        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--ink)]">
          <input type="checkbox" className="h-4 w-4 accent-[var(--cinnabar)]" checked={setCurrent} onChange={(e) => setSetCurrent(e.target.checked)} />
          Make this their current programme (valid from 1 {new Date(`${registeredOn}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })})
        </label>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-[var(--cinnabar-deep)]">{error}</p> : null}
      <div className="mt-5">
        <button
          type="button"
          className={primary}
          style={{ color: "var(--paper-warm)" }}
          disabled={busy || !person || !title.trim() || !(num(total) > 0)}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save purchase"}
        </button>
      </div>
    </section>
  );
}
