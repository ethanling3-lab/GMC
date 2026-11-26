"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocale } from "@/lib/locale-client";
import { DynamicFormFields } from "@/components/forms/DynamicFormFields";
import { buildAnswersSchema, type FormSchema } from "@/lib/event-form-schema";
import type { RequiredField, RequiredProfile } from "@/lib/participants/required-profile";
import { CompleteProfileCard } from "./CompleteProfileCard";

type Profile = {
  name_cn: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  language_fluency: "en" | "cn" | "both" | null;
  region_id: string | null;
};

type Done = Array<{ participant_id: string; enrollment_id: string; amount_due: number | null; payment_token: string | null }>;

export type Attendee = {
  id: string;
  name: string;
  is_self: boolean;
  birth_date: string | null;
  enrolled: boolean;
  amount_due: number | null;
};

type Props = {
  attendees: Attendee[];
  eventSlug: string;
  eventTitle: string;
  eventTitleAlt: string;
  startDate: string | null;
  venue: string | null;
  price: number | string | null;
  currency: string;
  profile: Profile;
  /** Phase 5: the six required details, and which are still missing. */
  required: RequiredProfile;
  missing: RequiredField[];
  /** The event's own questions, answered once for everyone registered. */
  formSchema: FormSchema;
};

type AnswersForm = { answers: Record<string, unknown> };

export function QuickRegisterConfirm({
  attendees,
  eventSlug,
  eventTitle,
  eventTitleAlt,
  startDate,
  venue,
  price,
  currency,
  profile,
  required,
  missing,
  formSchema,
}: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const questions = formSchema.fields.filter((f) => f.type !== "section_header");
  const answersResolver = useMemo(
    () => zodResolver(z.object({ answers: buildAnswersSchema(formSchema) })),
    [formSchema],
  );
  const defaultAnswers = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of formSchema.fields) {
      if (f.type === "section_header") continue;
      out[f.id] = f.type === "multi_select" ? [] : f.type === "checkbox_ack" ? false : "";
    }
    return out;
  }, [formSchema]);
  const qForm = useForm<AnswersForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: answersResolver as any,
    defaultValues: { answers: defaultAnswers },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFamily = attendees.length > 1;
  const [done, setDone] = useState<Done | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(attendees.filter((a) => a.is_self && !a.enrolled).map((a) => a.id)),
  );
  const chosen = attendees.filter((a) => picked.has(a.id) && !a.enrolled);
  const total = chosen.reduce((sum, a) => sum + (Number(a.amount_due) || 0), 0);
  const allRegistered = attendees.length > 0 && attendees.every((a) => a.enrolled);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConfirm() {
    if (chosen.length === 0) {
      setError("Tick who is attending. · 请勾选参加者。");
      return;
    }
    let answers: Record<string, unknown> = {};
    if (questions.length > 0) {
      let ok = false;
      await qForm.handleSubmit((vals) => {
        answers = vals.answers;
        ok = true;
      })();
      if (!ok) {
        setError("Please answer the event's questions above. · 请回答上方的活动问题。");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/me/events/${encodeURIComponent(eventSlug)}/register`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participant_ids: chosen.map((a) => a.id), answers }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err =
          json?.error === "already_enrolled"
            ? "You're already enrolled in this event."
            : json?.error === "event_full"
              ? "This event is full."
              : json?.error === "event_not_open"
                ? "This event is not currently open for registration."
                : json?.error === "profile_incomplete"
                ? "Please complete your profile first. · 请先完善个人资料。"
                : json?.detail || "Could not complete registration. Please try again.";
        setError(err);
        setSubmitting(false);
        return;
      }
      const created = (json?.created ?? []) as Done;
      if (created.length > 1) {
        // Several people: one pay link each.
        setDone(created);
        setSubmitting(false);
        return;
      }
      if (json?.payment_token) {
        window.location.href = `/pay/${json.payment_token}`;
        return;
      }
      router.push(`/me/enrollments?just_registered=${eventSlug}`);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const langLabel =
    profile.language_fluency === "cn"
      ? "中文"
      : profile.language_fluency === "en"
        ? "English"
        : profile.language_fluency === "both"
          ? "Both · 双语"
          : null;

  if (done) {
    const nameOf = (id: string) => attendees.find((a) => a.id === id)?.name ?? "";
    return (
      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">Registered · 已报名</div>
        <ul className="mt-3 divide-y divide-[var(--paper-shadow)]">
          {done.map((d) => (
            <li key={d.enrollment_id} className="flex items-center justify-between gap-3 py-3">
              <span className="text-[14px] text-[var(--ink)]">{nameOf(d.participant_id)}</span>
              {d.payment_token ? (
                <a
                  href={`/pay/${d.payment_token}`}
                  className="inline-flex items-center h-9 px-4 rounded-full bg-[var(--cinnabar)] text-[12.5px] hover:bg-[var(--cinnabar-deep)] active:scale-[0.98] transition-[background-color,transform]"
                  style={{ color: "var(--paper-warm)" }}
                >
                  Pay {currency} {Number(d.amount_due).toLocaleString("en-US")} · 付款
                </a>
              ) : (
                <span className="text-[12.5px] text-[var(--ink-mute)]">Nothing to pay · 无需付款</span>
              )}
            </li>
          ))}
        </ul>
        <a
          href="/me/enrollments"
          className="mt-4 inline-block text-[12px] tracking-[0.1em] uppercase text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)]"
          style={{ color: "var(--cinnabar-deep)" }}
        >
          See all registrations →
        </a>
      </section>
    );
  }

  if (missing.length > 0) {
    return <CompleteProfileCard initial={required} missing={missing} />;
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Event summary card */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
          Event · 活动
        </div>
        <div className="mt-2 font-display text-[22px] leading-[1.2] text-[var(--ink)]">
          {eventTitle}
        </div>
        {eventTitleAlt && eventTitleAlt !== eventTitle ? (
          <div className="text-[13px] italic text-[var(--ink-soft)]">{eventTitleAlt}</div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] tracking-[0.06em] text-[var(--ink-soft)] tabular-nums">
          {startDate ? <span>📅 {startDate}</span> : null}
          {venue ? <span>📍 {venue}</span> : null}
          {price && !hasFamily ? (
            <span>
              <span className="text-[var(--ink-faint)]">Price</span>{" "}
              <span className="text-[var(--ink)] font-medium">{currency} {Number(price).toLocaleString("en-US")}</span>
            </span>
          ) : null}
        </div>
      </section>

      {/* Profile summary */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Your details · 您的资料
          </div>
          <a
            href="/me/profile"
            className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)]"
            style={{ color: "var(--ink-mute)" }}
          >
            Edit · 编辑 →
          </a>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Pair label="Name · 姓名" value={profile.name_cn ?? profile.name_en} />
          <Pair label="Region ID" value={profile.region_id} mono />
          <Pair label="Email · 邮箱" value={profile.email} />
          <Pair label="Phone · 电话" value={profile.phone} />
          <Pair label="Region · 区域" value={profile.region} />
          <Pair label="Language · 语言" value={langLabel} />
        </dl>
      </section>

      {questions.length > 0 ? (
        <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
          <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Event questions · 活动问题
          </div>
          <div className="mt-4">
            <DynamicFormFields
              schema={formSchema}
              locale={locale}
              register={qForm.register}
              control={qForm.control}
              errors={qForm.formState.errors}
            />
          </div>
        </section>
      ) : null}

      <WhoIsAttending
        attendees={attendees}
        picked={picked}
        onToggle={toggle}
        currency={currency}
        total={total}
        onAdded={(id) => {
          setPicked((prev) => new Set(prev).add(id));
          router.refresh();
        }}
      />

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.55] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}

      <div className="sticky bottom-4 z-10 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] p-4 flex items-center justify-between gap-4 flex-wrap">
        <a
          href="/events"
          className="text-[12px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)]"
          style={{ color: "var(--ink-mute)" }}
        >
          ← Cancel
        </a>
        {allRegistered ? (
          <a
            href="/me/enrollments"
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[13px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:bg-[var(--paper)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,transform]"
            style={{ color: "var(--cinnabar-deep)" }}
          >
            {hasFamily ? "Everyone is registered" : "You're registered"} · 已报名 — My enrollments
          </a>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || chosen.length === 0}
            className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ color: "var(--paper-warm)" }}
          >
            {submitting
              ? "Confirming…"
              : chosen.length === 0
                ? "Tick who is attending · 请勾选"
                : chosen.length > 1
                  ? `Register ${chosen.length} · 报名 ${chosen.length} 位`
                  : "Confirm & pay · 确认并付款"}
          </button>
        )}
      </div>
    </div>
  );
}

function Pair({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">{label}</dt>
      <dd className={`mt-0.5 text-[var(--ink)] ${mono ? "font-mono tabular-nums" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function WhoIsAttending({
  attendees,
  picked,
  onToggle,
  currency,
  total,
  onAdded,
}: {
  attendees: Attendee[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  currency: string;
  total: number;
  onAdded: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name_cn: "", name_en: "", birth_date: "", gender: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const money = (n: number | null) => (n && n > 0 ? `${currency} ${Number(n).toLocaleString("en-US")}` : "Free · 免费");
  const field =
    "h-10 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  async function addChild() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/me/children", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name_cn: form.name_cn,
          name_en: form.name_en || null,
          birth_date: form.birth_date,
          gender: form.gender || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string; child?: { id: string } };
      if (!res.ok || !j.child) throw new Error(j.detail ?? "Could not add the child.");
      setForm({ name_cn: "", name_en: "", birth_date: "", gender: "" });
      setAdding(false);
      onAdded(j.child.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the child.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">Who is attending? · 谁参加？</div>
      <ul className="mt-3 divide-y divide-[var(--paper-shadow)]">
        {attendees.map((a) => (
          <li key={a.id}>
            <label className={`flex items-center gap-3 py-3 ${a.enrolled ? "opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--cinnabar)]"
                checked={a.enrolled || picked.has(a.id)}
                disabled={a.enrolled}
                onChange={() => onToggle(a.id)}
              />
              <span className="flex-1 min-w-0">
                <span className="text-[14px] text-[var(--ink)]">{a.name}</span>
                <span className="ml-2 text-[11.5px] text-[var(--ink-mute)]">
                  {a.is_self ? "Me · 本人" : `Child · 子女${a.birth_date ? ` · ${a.birth_date}` : ""}`}
                </span>
              </span>
              <span className="text-[13px] tabular-nums text-[var(--ink-soft)]">
                {a.enrolled ? "Registered · 已报名" : money(a.amount_due)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">Chinese name · 中文名</span>
            <input className={field} value={form.name_cn} onChange={(e) => setForm({ ...form, name_cn: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">English name · 英文名 (optional)</span>
            <input className={field} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">Birth date · 出生日期</span>
            <input type="date" className={field} value={form.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">Gender · 性别</span>
            <select className={field} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">—</option>
              <option value="male">Male · 男</option>
              <option value="female">Female · 女</option>
            </select>
          </label>
          {err ? <p className="sm:col-span-2 text-[12.5px] text-[var(--cinnabar-deep)]">{err}</p> : null}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-9 px-4 rounded-full border border-[var(--paper-shadow)] text-[12.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 active:scale-[0.98] transition-[border-color,transform]">
              Cancel
            </button>
            <button
              type="button"
              onClick={addChild}
              disabled={saving || !form.name_cn.trim() || !form.birth_date}
              className="h-9 px-4 rounded-full bg-[var(--cinnabar)] text-[12.5px] hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 active:scale-[0.98] transition-[background-color,transform]"
              style={{ color: "var(--paper-warm)" }}
            >
              {saving ? "Adding…" : "Add child · 添加"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] focus-visible:underline"
          style={{ color: "var(--cinnabar-deep)" }}
        >
          + Add a child · 添加子女
        </button>
      )}

      {picked.size > 0 ? (
        <div className="mt-4 pt-3 border-t border-[var(--paper-shadow)] flex items-baseline justify-between text-[13px]">
          <span className="text-[var(--ink-mute)]">Total · 合计</span>
          <span className="tabular-nums text-[var(--ink)] font-medium">{total > 0 ? `${currency} ${total.toLocaleString("en-US")}` : "—"}</span>
        </div>
      ) : null}
    </section>
  );
}
