"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CounterPerson, PersonHit, Takings } from "@/lib/payments/counter";
import {
  MANUAL_METHODS,
  STATE_LABEL,
  methodLabel,
  sgd,
  type PaymentMethod,
  type PaymentTemplate,
} from "@/lib/payments/types";
import { btn, callJson, input, label, panel, primary, stateTone } from "./ui";

// Payment counter · 收款台 (Phase 2, 2026-11-26).
// 1 Who → 2 What they're paying for → 3 Pay. One card swipe can cover the
// event fee, a programme 定金/全款 and an instalment together.

export type CounterProgramme = {
  id: string;
  name_cn: string;
  name_en: string;
  price_sgd: number;
  on_site_sgd: number | null;
};

type Props = {
  eventId: string;
  eventTitle: string;
  programmes: CounterProgramme[];
  templates: PaymentTemplate[];
  initialTakings: Takings;
  /** Only Super Admin can open participant profiles (Finance can't). */
  canOpenProfile: boolean;
};

type NewForm = {
  name_cn: string;
  name_en: string;
  phone: string;
  email: string;
  gender: string;
  region: string;
  occupation: string;
  industry: string;
  referrer_contact: string;
};
const EMPTY_FORM: NewForm = {
  name_cn: "", name_en: "", phone: "", email: "", gender: "", region: "MY", occupation: "", industry: "", referrer_contact: "",
};

type ProgDraft = {
  on: boolean;
  programme_id: string;
  template_id: string;
  title: string;
  kind: "new" | "upgrade" | "other";
  total: string;
  mode: "deposit" | "full";
  amount: string;
  set_current: boolean;
};
const EMPTY_PROG: ProgDraft = {
  on: false, programme_id: "", template_id: "", title: "", kind: "new", total: "", mode: "deposit", amount: "", set_current: true,
};

type Done = {
  name: string;
  total: number;
  method: PaymentMethod;
  reference: string | null;
  lines: string[];
  participantId: string;
  /** Programme purchases this checkout created or paid into. */
  purchaseIds: string[];
  seatsReminder: boolean;
};

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const personName = (p: { name_cn: string | null; name_en: string | null }) => p.name_cn || p.name_en || "—";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function PersonSearch({
  eventId,
  placeholder,
  onPick,
  autoFocus,
}: {
  eventId: string | null;
  placeholder: string;
  onPick: (p: PersonHit) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PersonHit[]>([]);
  const [loading, setLoading] = useState(false);
  const dq = useDebounced(q.trim(), 250);
  useEffect(() => {
    if (dq.length < 2) {
      setRows([]);
      return;
    }
    let live = true;
    setLoading(true);
    const qs = new URLSearchParams({ q: dq });
    if (eventId) qs.set("event", eventId);
    callJson<{ rows: PersonHit[] }>(`/api/admin/payments/people?${qs}`, "GET")
      .then((j) => live && setRows(j.rows))
      .catch(() => live && setRows([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [dq, eventId]);

  return (
    <div>
      <input
        className={`${input} h-11 text-[15px]`}
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
      />
      {dq.length >= 2 ? (
        <ul className="mt-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] divide-y divide-[var(--paper-shadow)] bg-[var(--paper)]">
          {rows.length === 0 ? (
            <li className="px-3 py-2.5 text-[12.5px] text-[var(--ink-faint)]">{loading ? "Searching…" : "No one found."}</li>
          ) : (
            rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setQ("");
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-[var(--cinnabar-wash)] focus-visible:bg-[var(--cinnabar-wash)] focus-visible:outline-none active:bg-[var(--paper-deep)] transition-[background-color] duration-[var(--dur-fast)]"
                >
                  <span className="text-[14px] text-[var(--ink)]">{personName(r)}</span>
                  {r.name_cn && r.name_en ? <span className="ml-1.5 text-[12px] text-[var(--ink-soft)]">{r.name_en}</span> : null}
                  {r.region_id ? <span className="ml-2 font-mono text-[11.5px] text-[var(--ink-mute)]">{r.region_id}</span> : null}
                  <span className="block text-[12px] text-[var(--ink-soft)]">
                    {[r.phone, r.email].filter(Boolean).join(" · ") || "No contact"}
                    {r.enrollment ? ` · registered (${r.enrollment.status.replace("_", " ")})` : ""}
                    {r.open_purchases ? ` · ${r.open_purchases} programme${r.open_purchases > 1 ? "s" : ""} paying` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function Step({ n, title, titleZh, children, muted }: { n: number; title: string; titleZh: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`${panel} ${muted ? "opacity-50 pointer-events-none" : ""}`}>
      <h2 className="flex items-baseline gap-3">
        <span className="font-display text-[22px] leading-none text-[var(--cinnabar)] tabular-nums">{n}</span>
        <span className="font-display text-[19px] text-[var(--ink)] tracking-[-0.01em]">{title}</span>
        <span className="text-[12px] text-[var(--ink-mute)]">{titleZh}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TickRow({
  checked,
  onChange,
  title,
  sub,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-[var(--radius-md)] border p-3.5 transition-[border-color,background-color] duration-[var(--dur-fast)] ${checked ? "border-[var(--cinnabar)]/50 bg-[var(--cinnabar-wash)]/40" : "border-[var(--paper-shadow)]"}`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--cinnabar)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">
          <span className="block text-[14px] text-[var(--ink)]">{title}</span>
          {sub ? <span className="block text-[12px] text-[var(--ink-soft)]">{sub}</span> : null}
        </span>
      </label>
      {checked && children ? <div className="mt-3 pl-7">{children}</div> : null}
    </div>
  );
}

export function CounterClient({ eventId, eventTitle, programmes, templates, initialTakings, canOpenProfile }: Props) {
  const [mode, setMode] = useState<"find" | "new" | "person">("find");
  const [person, setPerson] = useState<CounterPerson | null>(null);
  const [form, setForm] = useState<NewForm>(EMPTY_FORM);
  const [referrer, setReferrer] = useState<PersonHit | null>(null);
  const [newQuote, setNewQuote] = useState<{ amount: number | null; label: string } | null>(null);
  const [matches, setMatches] = useState<PersonHit[] | null>(null);

  const [eventOn, setEventOn] = useState(false);
  const [eventAmt, setEventAmt] = useState("");
  const [prog, setProg] = useState<ProgDraft>(EMPTY_PROG);
  const [inst, setInst] = useState<Record<string, { on: boolean; amount: string }>>({});

  const [method, setMethod] = useState<PaymentMethod>("card_pos");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [takings, setTakings] = useState<Takings>(initialTakings);
  const topRef = useRef<HTMLDivElement>(null);

  const refreshTakings = useCallback(() => {
    callJson<Takings>(`/api/admin/events/${eventId}/counter/takings`, "GET").then(setTakings).catch(() => {});
  }, [eventId]);

  const resetAll = () => {
    setMode("find");
    setPerson(null);
    setForm(EMPTY_FORM);
    setReferrer(null);
    setMatches(null);
    setEventOn(false);
    setEventAmt("");
    setProg(EMPTY_PROG);
    setInst({});
    setMethod("card_pos");
    setReference("");
    setNote("");
    setError(null);
    setFull(null);
    setDone(null);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openPerson = async (id: string) => {
    setError(null);
    setMatches(null);
    setReference("");
    setNote("");
    try {
      const j = await callJson<{ person: CounterPerson }>(`/api/admin/events/${eventId}/counter/person?id=${id}`, "GET");
      const p = j.person;
      setPerson(p);
      setMode("person");
      // Pre-tick the event fee when something is still owed on it.
      const owed = p.enrollment
        ? Math.max(0, (p.enrollment.amount_due ?? 0) - p.enrollment.amount_paid)
        : p.quote.amount ?? 0;
      const paidUp = p.enrollment?.status === "paid" && owed <= 0;
      setEventOn(!paidUp && owed > 0);
      setEventAmt(owed > 0 ? String(owed) : "");
      setInst(
        Object.fromEntries(
          p.purchases
            .filter((x) => x.status === "active" && x.standing.next)
            .map((x) => [x.id, { on: false, amount: String(x.standing.behind > 0 ? x.standing.behind : x.standing.next!.remaining) }]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this person");
    }
  };

  const startNew = async () => {
    setMode("new");
    setPerson(null);
    setInst({});
    setError(null);
    if (!newQuote) {
      try {
        const j = await callJson<{ quote: { amount: number | null; label: string } }>(`/api/admin/events/${eventId}/counter/person`, "GET");
        setNewQuote(j.quote);
        setEventOn(true);
        setEventAmt(j.quote.amount != null ? String(j.quote.amount) : "");
      } catch {
        setNewQuote({ amount: null, label: "新人 · New student" });
      }
    } else {
      setEventOn(true);
      setEventAmt(newQuote.amount != null ? String(newQuote.amount) : "");
    }
  };

  // Programme pre-fill
  const progTemplates = useMemo(
    () => templates.filter((t) => t.active && (!prog.programme_id || !t.programme_id || t.programme_id === prog.programme_id)),
    [templates, prog.programme_id],
  );
  const pickProgramme = (programmeId: string) => {
    const pr = programmes.find((x) => x.id === programmeId);
    const tpl = templates.find((t) => t.active && t.programme_id === programmeId) ?? null;
    const total = tpl?.total_sgd ?? pr?.on_site_sgd ?? pr?.price_sgd ?? 0;
    setProg((d) => ({
      ...d,
      programme_id: programmeId,
      template_id: tpl?.id ?? "",
      kind: tpl?.kind ?? d.kind,
      title: pr ? (/\d{4}/.test(pr.name_cn) ? pr.name_cn : `${pr.name_cn} ${new Date().getFullYear()}`) : d.title,
      total: total ? String(total) : "",
      amount: d.mode === "full" ? String(total || "") : String(tpl?.items[0]?.amount_sgd ?? ""),
    }));
  };
  const pickTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId) ?? null;
    setProg((d) => ({
      ...d,
      template_id: templateId,
      kind: tpl?.kind ?? d.kind,
      total: tpl ? String(tpl.total_sgd) : d.total,
      amount: d.mode === "full" ? String(tpl?.total_sgd ?? d.total) : String(tpl?.items[0]?.amount_sgd ?? d.amount),
    }));
  };
  const setProgMode = (m: "deposit" | "full") => {
    const tpl = templates.find((t) => t.id === prog.template_id) ?? null;
    setProg((d) => ({ ...d, mode: m, amount: m === "full" ? d.total : String(tpl?.items[0]?.amount_sgd ?? "") }));
  };
  const selectedTemplate = templates.find((t) => t.id === prog.template_id) ?? null;

  const total = useMemo(() => {
    let t = 0;
    if (eventOn) t += num(eventAmt);
    if (prog.on) t += num(prog.amount);
    for (const v of Object.values(inst)) if (v.on) t += num(v.amount);
    return Math.round(t * 100) / 100;
  }, [eventOn, eventAmt, prog, inst]);

  const anyTicked = eventOn || prog.on || Object.values(inst).some((v) => v.on);
  const whoReady = mode === "person" ? Boolean(person) : mode === "new" ? Boolean((form.name_cn.trim() || form.name_en.trim()) && form.phone.trim().length >= 6) : false;

  const submit = async (opts: { confirmNew?: boolean; forceCapacity?: boolean } = {}) => {
    setError(null);
    setFull(null);
    if (method === "card_pos" && !reference.trim()) {
      setError("Type the approval code from the terminal receipt.");
      return;
    }
    const items: unknown[] = [];
    const lines: string[] = [];
    if (eventOn) {
      items.push({ type: "event", amount: num(eventAmt) });
      lines.push(`Event fee · ${eventTitle} — ${sgd(num(eventAmt))}`);
    }
    if (prog.on) {
      items.push({
        type: "programme",
        programme_id: prog.programme_id,
        template_id: prog.template_id || null,
        title: prog.title,
        kind: prog.kind,
        total_sgd: num(prog.total),
        mode: prog.mode,
        amount: num(prog.amount),
        set_current: prog.set_current,
      });
      lines.push(`${prog.title} · ${prog.mode === "full" ? "全款 Full" : "定金 Deposit"} — ${sgd(num(prog.amount))} of ${sgd(num(prog.total))}`);
    }
    for (const [pid, v] of Object.entries(inst)) {
      if (!v.on) continue;
      items.push({ type: "instalment", purchase_id: pid, amount: num(v.amount) });
      const pu = person?.purchases.find((x) => x.id === pid);
      lines.push(`${pu?.title ?? "Programme"} · instalment — ${sgd(num(v.amount))}`);
    }
    const participant =
      mode === "person" && person
        ? { existing_id: person.id }
        : {
            new: {
              ...form,
              email: form.email.trim() || null,
              name_cn: form.name_cn.trim() || null,
              name_en: form.name_en.trim() || null,
              referrer_id: referrer?.id ?? null,
              referrer_name: referrer ? personName(referrer) : null,
            },
            confirm_new: Boolean(opts.confirmNew),
          };
    setBusy(true);
    try {
      const j = await callJson<{ participant_id: string; total_sgd: number; purchases?: string[] }>(`/api/admin/events/${eventId}/counter/checkout`, "POST", {
        participant,
        items,
        payment: { method, reference: reference.trim() || null, note: note.trim() || null },
        force_capacity: Boolean(opts.forceCapacity),
      });
      setDone({
        name: mode === "person" && person ? personName(person) : form.name_cn.trim() || form.name_en.trim(),
        total: j.total_sgd,
        method,
        reference: reference.trim() || null,
        lines,
        participantId: j.participant_id,
        purchaseIds: Array.isArray(j.purchases) ? j.purchases : [],
        seatsReminder: prog.on,
      });
      refreshTakings();
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      const err = e as Error & { status?: number; body?: Record<string, unknown> };
      if (err.body?.error === "phone_match") {
        setMatches((err.body.matches as PersonHit[]) ?? []);
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (err.body?.error === "no_seats") {
        setFull(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- render
  if (done) {
    return (
      <div ref={topRef} className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        <section className={panel}>
          <div className="text-[12px] tracking-[0.04em] text-[var(--jade-deep)]">Recorded · 已记录</div>
          <h2 className="mt-2 font-display text-[30px] leading-[1.1] tracking-[-0.02em] text-[var(--ink)]">
            {sgd(done.total)} from {done.name}
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-soft)]">
            {methodLabel(done.method)}
            {done.reference ? ` · approval ${done.reference}` : ""}
          </p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[13.5px] text-[var(--ink)]">
            {done.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {done.seatsReminder ? (
            <p className="mt-4 rounded-[var(--radius-md)] bg-[var(--gold-soft)] px-3 py-2 text-[12.5px] text-[var(--ink)]">
              Programme sold: check whether 名额 are due and issue them on their profile.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className={`${primary} h-10 px-5 text-[13px]`} style={{ color: "var(--paper-warm)" }} onClick={resetAll} autoFocus>
              Next person · 下一位
            </button>
            {done.purchaseIds.length === 1 ? (
              <Link href={`/admin/finance/purchases/${done.purchaseIds[0]}`} className={`${btn} h-10 px-4`}>
                Open the purchase · 查看配套
              </Link>
            ) : null}
            {canOpenProfile ? (
              <Link href={`/admin/participants/${done.participantId}`} className={`${btn} h-10 px-4`}>
                Open their profile
              </Link>
            ) : null}
          </div>
        </section>
        <TakingsPanel takings={takings} />
      </div>
    );
  }

  const owedOnEvent =
    mode === "person" && person?.enrollment
      ? Math.max(0, (person.enrollment.amount_due ?? 0) - person.enrollment.amount_paid)
      : null;
  const eventPaidUp = mode === "person" && person?.enrollment?.status === "paid" && (owedOnEvent ?? 0) <= 0;

  return (
    <div ref={topRef} className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
      <div className="flex flex-col gap-5">
        {/* 1 — Who */}
        <Step n={1} title="Who is paying" titleZh="付款人">
          {mode === "find" ? (
            <div>
              <PersonSearch eventId={eventId} placeholder="Search name, phone or student ID…" onPick={(p) => void openPerson(p.id)} autoFocus />
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[12px] text-[var(--ink-mute)]">Not in the CRM yet?</span>
                <button type="button" className={btn} onClick={() => void startNew()}>
                  New person from paper form · 新学员
                </button>
              </div>
            </div>
          ) : null}

          {mode === "person" && person ? (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[17px] text-[var(--ink)]">
                  {personName(person)}
                  {person.name_cn && person.name_en ? <span className="ml-2 text-[13px] text-[var(--ink-soft)]">{person.name_en}</span> : null}
                  {person.region_id ? <span className="ml-2 font-mono text-[12px] text-[var(--ink-mute)]">{person.region_id}</span> : null}
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--ink-soft)]">
                  {[person.phone, person.email].filter(Boolean).join(" · ") || "No contact"}
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--ink-soft)]">
                  {person.programme ? `Programme: ${person.programme}` : "No programme"}
                  {person.referrer ? ` · Brought by ${person.referrer}` : ""}
                </div>
              </div>
              <button type="button" className={btn} onClick={resetAll}>
                Change
              </button>
            </div>
          ) : null}

          {mode === "new" ? (
            <div>
              {matches ? (
                <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] p-3.5">
                  <p className="text-[13px] text-[var(--cinnabar-deep)]">This phone is already in the CRM. Is it the same person?</p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {matches.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3">
                        <span className="text-[13px] text-[var(--ink)]">
                          {personName(m)} {m.region_id ? <span className="font-mono text-[11.5px] text-[var(--ink-mute)]">{m.region_id}</span> : null}
                          <span className="ml-2 text-[12px] text-[var(--ink-soft)]">{m.phone}</span>
                        </span>
                        <button type="button" className={btn} onClick={() => void openPerson(m.id)}>
                          Yes, use them
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={`${btn} mt-3`} disabled={busy} onClick={() => void submit({ confirmNew: true })}>
                    No, a different person — save as new
                  </button>
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className={label}>Chinese name · 中文名</span>
                  <input className={input} value={form.name_cn} onChange={(e) => setForm({ ...form, name_cn: e.target.value })} autoFocus />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>English name</span>
                  <input className={input} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Phone · 电话 *</span>
                  <input className={input} type="tel" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setMatches(null); }} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Country · 国家</span>
                  <select className={input} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                    <option value="MY">Malaysia</option>
                    <option value="SG">Singapore</option>
                    <option value="TW">Taiwan</option>
                    <option value="HK">Hong Kong</option>
                    <option value="CN">China</option>
                    <option value="VN">Vietnam</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Email (optional)</span>
                  <input className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Gender · 性别</span>
                  <select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="">—</option>
                    <option value="male">Male · 男</option>
                    <option value="female">Female · 女</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Occupation · 职业</span>
                  <input className={input} value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Industry · 行业</span>
                  <input className={input} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
                </label>
                <div className="sm:col-span-2 flex flex-col gap-1">
                  <span className={label}>Brought by · 介绍人</span>
                  {referrer ? (
                    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] px-3 py-2">
                      <span className="text-[13.5px] text-[var(--ink)]">
                        {personName(referrer)} {referrer.region_id ? <span className="font-mono text-[11.5px] text-[var(--ink-mute)]">{referrer.region_id}</span> : null}
                        <span className="ml-2 text-[12px] text-[var(--ink-soft)]">Their CS will look after this person too.</span>
                      </span>
                      <button type="button" className={btn} onClick={() => setReferrer(null)}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <PersonSearch eventId={null} placeholder="Search the person who brought them…" onPick={setReferrer} />
                  )}
                </div>
              </div>
              <div className="mt-3">
                <button type="button" className={btn} onClick={resetAll}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </Step>

        {/* 2 — What */}
        <Step n={2} title="What they're paying for" titleZh="付款项目" muted={mode === "find"}>
          <div className="flex flex-col gap-3">
            {eventPaidUp ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] p-3.5 text-[13px] text-[var(--ink-soft)]">
                Event fee for {eventTitle}: <span className="text-[var(--jade-deep)]">paid in full</span>.
              </div>
            ) : (
              <TickRow
                checked={eventOn}
                onChange={setEventOn}
                title={`Event fee · ${eventTitle}`}
                sub={
                  mode === "person" && person
                    ? person.enrollment
                      ? `${person.enrollment.price_label} · ${person.enrollment.amount_due != null ? sgd(person.enrollment.amount_due) : "no price"}${person.enrollment.amount_paid ? ` · paid ${sgd(person.enrollment.amount_paid)}` : ""}`
                      : `Not registered yet · ${person.quote.label} · ${person.quote.amount != null ? sgd(person.quote.amount) : "no price set"}`
                    : newQuote
                      ? `${newQuote.label} · ${newQuote.amount != null ? sgd(newQuote.amount) : "no price set"}`
                      : undefined
                }
              >
                <label className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--ink-mute)] whitespace-nowrap">Paying now SGD</span>
                  <input className={`${input} w-36`} inputMode="decimal" value={eventAmt} onChange={(e) => setEventAmt(e.target.value)} />
                </label>
              </TickRow>
            )}

            <TickRow
              checked={prog.on}
              onChange={(v) => setProg((d) => ({ ...d, on: v }))}
              title="Programme · 配套"
              sub="Sold today: 定金 deposit or 全款 full payment"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className={label}>Programme</span>
                  <select className={input} value={prog.programme_id} onChange={(e) => pickProgramme(e.target.value)}>
                    <option value="">Pick…</option>
                    {programmes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name_cn} · {p.name_en}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Payment plan · 付款方案</span>
                  <select className={input} value={prog.template_id} onChange={(e) => pickTemplate(e.target.value)}>
                    <option value="">No plan (just a deposit)</option>
                    {progTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {sgd(t.total_sgd)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Title</span>
                  <input className={input} value={prog.title} onChange={(e) => setProg({ ...prog, title: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={label}>Programme total SGD</span>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={prog.total}
                    onChange={(e) => setProg({ ...prog, total: e.target.value, amount: prog.mode === "full" ? e.target.value : prog.amount })}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className={label}>Paying today</span>
                  <div className="flex gap-2">
                    {(["deposit", "full"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={prog.mode === m}
                        onClick={() => setProgMode(m)}
                        className={`inline-flex items-center justify-center h-9 px-3 rounded-[var(--radius-pill)] border text-[12px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,background-color,color,transform] duration-[var(--dur-fast)] ${
                          prog.mode === m
                            ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper-warm)]"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]"
                        }`}
                      >
                        {m === "deposit" ? "定金 Deposit" : "全款 Full"}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className={label}>Amount today SGD</span>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={prog.amount}
                    disabled={prog.mode === "full"}
                    onChange={(e) => setProg({ ...prog, amount: e.target.value })}
                  />
                </label>
                {prog.mode === "deposit" && selectedTemplate ? (
                  <div className="sm:col-span-2 text-[12px] text-[var(--ink-soft)]">
                    Their schedule:{" "}
                    {selectedTemplate.items
                      .map((i) => `${i.label} ${sgd(i.amount_sgd)}${i.due_after_months ? ` in ${i.due_after_months} mo` : " today"}`)
                      .join(" · ")}
                    . Finance can change it for them later.
                  </div>
                ) : null}
                <label className="sm:col-span-2 flex items-center gap-2 text-[12.5px] text-[var(--ink)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--cinnabar)]"
                    checked={prog.set_current}
                    onChange={(e) => setProg({ ...prog, set_current: e.target.checked })}
                  />
                  Make this their current programme (valid from the 1st of this month)
                </label>
              </div>
            </TickRow>

            {mode === "person" && person
              ? person.purchases
                  .filter((pu) => pu.status === "active" && pu.standing.next)
                  .map((pu) => {
                    const v = inst[pu.id] ?? { on: false, amount: "" };
                    const s = pu.standing;
                    return (
                      <TickRow
                        key={pu.id}
                        checked={v.on}
                        onChange={(on) => setInst({ ...inst, [pu.id]: { ...v, on } })}
                        title={`Instalment · ${pu.title}`}
                        sub={`Paid ${sgd(s.paid)} of ${sgd(s.total)} · next ${s.next!.label} ${sgd(s.next!.remaining)}${s.next!.due_on ? ` due ${s.next!.due_on}` : ""}${s.behind > 0 ? ` · behind ${sgd(s.behind)}` : ""}`}
                      >
                        <label className="flex items-center gap-2">
                          <span className="text-[12px] text-[var(--ink-mute)] whitespace-nowrap">Paying now SGD</span>
                          <input
                            className={`${input} w-36`}
                            inputMode="decimal"
                            value={v.amount}
                            onChange={(e) => setInst({ ...inst, [pu.id]: { ...v, amount: e.target.value } })}
                          />
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${stateTone[s.state]}`}>
                            {STATE_LABEL[s.state].cn}
                          </span>
                        </label>
                      </TickRow>
                    );
                  })
              : null}
          </div>
        </Step>

        {/* 3 — Pay */}
        <Step n={3} title="Take payment" titleZh="收款" muted={mode === "find"}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className={label}>Charge on the terminal</div>
              <div className="mt-1 font-display text-[40px] leading-none tracking-[-0.03em] text-[var(--ink)] tabular-nums">{sgd(total)}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>Method</span>
              <select className={input} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {MANUAL_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.en} · {m.cn}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{method === "card_pos" ? "Approval code (on the receipt) *" : "Reference / receipt no."}</span>
              <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label className="sm:col-span-2 flex flex-col gap-1">
              <span className={label}>Note (optional)</span>
              <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          {error ? <p className="mt-3 text-[13px] text-[var(--cinnabar-deep)]">{error}</p> : null}
          {full ? (
            <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] p-3 text-[13px] text-[var(--cinnabar-deep)]">
              {full}{" "}
              <button type="button" className={`${btn} ml-2`} disabled={busy} onClick={() => void submit({ forceCapacity: true })}>
                Register them anyway
              </button>
            </div>
          ) : null}
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              className={`${primary} h-11 px-6 text-[14px]`}
              style={{ color: "var(--paper-warm)" }}
              disabled={busy || !whoReady || !anyTicked || total <= 0 || (prog.on && (!prog.programme_id || !prog.title.trim() || num(prog.total) <= 0))}
              onClick={() => void submit()}
            >
              {busy ? "Recording…" : `Record ${sgd(total)} · 记录`}
            </button>
            {!whoReady && mode === "new" ? (
              <span className="text-[12px] text-[var(--ink-mute)]">Enter a name and phone first.</span>
            ) : null}
          </div>
        </Step>
      </div>

      <TakingsPanel takings={takings} />
    </div>
  );
}

function TakingsPanel({ takings }: { takings: Takings }) {
  return (
    <aside className={`${panel} lg:sticky lg:top-20`}>
      <div className={label}>Today&apos;s takings · 今日收款</div>
      <div className="mt-2 font-display text-[28px] leading-none tracking-[-0.02em] text-[var(--ink)] tabular-nums">{sgd(takings.total_sgd)}</div>
      <div className="mt-1 text-[12px] text-[var(--ink-soft)]">
        {takings.count} payment{takings.count === 1 ? "" : "s"} · {takings.day}
      </div>
      {takings.by_method.length ? (
        <ul className="mt-3 flex flex-col gap-1 text-[12.5px]">
          {takings.by_method.map((m) => (
            <li key={m.method} className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">
                {methodLabel(m.method)} ×{m.count}
              </span>
              <span className="tabular-nums text-[var(--ink)]">{sgd(m.total_sgd)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[11.5px] text-[var(--ink-faint)]">Card total should match the terminal&apos;s settlement report.</p>
      {takings.rows.length ? (
        <ul className="mt-4 border-t border-[var(--paper-shadow)] pt-3 flex flex-col gap-2 max-h-[420px] overflow-y-auto">
          {takings.rows.map((r) => (
            <li key={r.id} className="text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="text-[var(--ink)] truncate">
                  {r.person} {r.region_id ? <span className="font-mono text-[10.5px] text-[var(--ink-mute)]">{r.region_id}</span> : null}
                </span>
                <span className="tabular-nums text-[var(--ink)]">{sgd(r.amount_sgd)}</span>
              </div>
              <div className="text-[var(--ink-mute)] truncate">
                {r.what} · {methodLabel(r.method)}
                {r.reference ? ` · ${r.reference}` : ""}
                {r.by ? ` · ${r.by}` : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
