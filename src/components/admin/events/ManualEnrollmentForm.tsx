"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ParticipantPicker,
  type ParticipantHit,
} from "./ParticipantPicker";
import {
  normalizeFormSchema,
  OTHER_OPTION_VALUE,
  type CustomField,
  type FormSchema,
} from "@/lib/event-form-schema";

type InitialState = "pending" | "approved" | "paid";
type PaymentMethodValue = "hitpay" | "stripe" | "bank_transfer" | "tt";

type Props = {
  eventId: string;
  eventTitle: string;
  eventCapacity: number | null;
  capacityCurrent: number;
  capacityFull: boolean;
  formSchema: unknown;
};

type NewParticipantDraft = {
  name_en: string;
  name_cn: string;
  email: string;
  phone: string;
  region: string;
  language: string;
  referrer_name: string;
  referrer_contact: string;
  is_old_student: boolean;
};

const EMPTY_NEW: NewParticipantDraft = {
  name_en: "",
  name_cn: "",
  email: "",
  phone: "",
  region: "",
  language: "",
  referrer_name: "",
  referrer_contact: "",
  is_old_student: false,
};

const PAYMENT_METHODS: { value: PaymentMethodValue; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "tt", label: "Telegraphic transfer" },
  { value: "hitpay", label: "HitPay" },
  { value: "stripe", label: "Stripe" },
];

export function ManualEnrollmentForm({
  eventId,
  eventTitle,
  eventCapacity,
  capacityCurrent,
  capacityFull,
  formSchema,
}: Props) {
  const router = useRouter();
  const parsedSchema: FormSchema = useMemo(
    () => normalizeFormSchema(formSchema),
    [formSchema],
  );
  const answerableFields = useMemo(
    () => parsedSchema.fields.filter((f) => f.type !== "section_header"),
    [parsedSchema],
  );

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [picked, setPicked] = useState<ParticipantHit | null>(null);
  const [newDraft, setNewDraft] = useState<NewParticipantDraft>(EMPTY_NEW);
  const [initialState, setInitialState] = useState<InitialState>("pending");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>("bank_transfer");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [csNotes, setCsNotes] = useState("");
  const [forceCapacity, setForceCapacity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAnswer(id: string, v: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  }

  function ready(): { ok: true } | { ok: false; reason: string } {
    if (mode === "existing") {
      if (!picked) return { ok: false, reason: "Pick a participant or switch to ‘Add new’." };
    } else {
      if (!newDraft.name_en.trim()) return { ok: false, reason: "Name (EN) is required." };
      if (!newDraft.email.trim()) return { ok: false, reason: "Email is required." };
      if (!newDraft.phone.trim()) return { ok: false, reason: "Phone is required." };
      if (!newDraft.region.trim()) return { ok: false, reason: "Region is required." };
    }
    if (initialState === "paid") {
      if (!amountPaid.trim() || !Number.isFinite(Number(amountPaid))) {
        return { ok: false, reason: "Amount paid is required when state is ‘Paid’." };
      }
    }
    if (capacityFull && !forceCapacity) {
      return { ok: false, reason: "Event is full. Tick ‘Override capacity’ to enrol anyway." };
    }
    return { ok: true };
  }

  async function submit() {
    const check = ready();
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        participant:
          mode === "existing"
            ? { existing_id: picked!.id }
            : {
                new: {
                  name_en: newDraft.name_en.trim(),
                  name_cn: newDraft.name_cn.trim() || undefined,
                  email: newDraft.email.trim(),
                  phone: newDraft.phone.trim(),
                  region: newDraft.region.trim(),
                  language_fluency:
                    (newDraft.language.trim() || undefined) as
                      | "cn"
                      | "en"
                      | "both"
                      | undefined,
                  referrer_name: newDraft.referrer_name.trim() || undefined,
                  referrer_contact: newDraft.referrer_contact.trim() || undefined,
                  is_old_student: newDraft.is_old_student,
                },
              },
        initial_state: initialState,
      };
      if (initialState === "paid") {
        body.amount_paid = Number(amountPaid);
        body.payment_method = paymentMethod;
      }
      if (answerableFields.length > 0) body.form_answers = answers;
      if (csNotes.trim()) body.cs_notes = csNotes.trim();
      if (capacityFull && forceCapacity) body.force_capacity = true;

      const res = await fetch(`/api/admin/events/${eventId}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.error === "no_seats") {
          throw new Error(
            `Event is full (${payload.current ?? "?"}/${payload.capacity ?? "?"}). Tick ‘Override capacity’ to force-enrol.`,
          );
        }
        if (payload?.error === "already_enrolled") {
          throw new Error("This participant is already enrolled in this event.");
        }
        throw new Error(payload?.detail ?? payload?.error ?? `Failed (${res.status})`);
      }
      router.push(`/admin/events/${eventId}/enrollments`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual enrol failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <ModeTabs mode={mode} onChange={(m) => setMode(m)} />

      {/* Step 1: participant */}
      <Section
        eyebrow="Step 1 · 报名人"
        title="Find or add the participant"
        subtitle={
          mode === "existing"
            ? "Search the master list. Returning participants surface with an OLD chip."
            : "Adds a brand-new participant row, then enrols them into this event."
        }
      >
        {mode === "existing" ? (
          <ParticipantPicker
            value={picked}
            onPick={setPicked}
            disabled={busy}
          />
        ) : (
          <NewParticipantFields draft={newDraft} setDraft={setNewDraft} disabled={busy} />
        )}
      </Section>

      {/* Step 2: form_answers */}
      {answerableFields.length > 0 ? (
        <Section
          eyebrow="Step 2 · 报名问答"
          title="Form answers"
          subtitle="Same custom fields the public form shows. Optional from admin — leave blank to fill in later."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {answerableFields.map((f) => (
              <FieldRenderer key={f.id} field={f} value={answers[f.id]} setValue={(v) => setAnswer(f.id, v)} disabled={busy} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* Step 3: state */}
      <Section
        eyebrow={answerableFields.length > 0 ? "Step 3 · 状态" : "Step 2 · 状态"}
        title="What state should the enrolment land in?"
        subtitle="Approved fires the payment-link email + WhatsApp. Paid records the offline payment + sends a receipt."
      >
        <StatePicker value={initialState} onChange={setInitialState} disabled={busy} />

        {initialState === "paid" ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Amount paid" required>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="1000000"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                disabled={busy}
                className={TEXTINPUT_CLASS}
                placeholder="e.g. 1280"
              />
            </Field>
            <Field label="Payment method" required>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodValue)}
                disabled={busy}
                className={TEXTINPUT_CLASS}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
      </Section>

      {/* CS notes + capacity override */}
      <Section eyebrow="Optional · 备注" title="Notes">
        <Field label="CS follow-up notes">
          <textarea
            value={csNotes}
            onChange={(e) => setCsNotes(e.target.value.slice(0, 2000))}
            disabled={busy}
            rows={3}
            placeholder="Walk-in registration, paid in cash at venue, etc."
            className={`${TEXTINPUT_CLASS} resize-y`}
          />
          <div className="mt-1 text-[10.5px] text-[var(--ink-faint)] text-right tabular-nums">
            {csNotes.length} / 2000
          </div>
        </Field>

        {capacityFull ? (
          <label className="mt-4 flex items-start gap-3 px-3.5 py-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/40 cursor-pointer">
            <input
              type="checkbox"
              checked={forceCapacity}
              onChange={(e) => setForceCapacity(e.target.checked)}
              disabled={busy}
              className="mt-1 accent-[var(--cinnabar)] cursor-pointer"
            />
            <div className="text-[12.5px] text-[var(--ink)] leading-[1.55]">
              <strong className="font-semibold">Override capacity.</strong>{" "}
              <span className="text-[var(--ink-mute)]">
                Event is full ({capacityCurrent.toLocaleString()}
                {eventCapacity !== null ? ` / ${eventCapacity.toLocaleString()}` : ""}).
                The override is logged to the audit trail.
              </span>
            </div>
          </label>
        ) : null}
      </Section>

      {error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/60 px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--paper-shadow)]">
        <Link
          href={`/admin/events/${eventId}/enrollments`}
          className="text-[12px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)] transition-colors"
        >
          Cancel
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hidden sm:inline">
            {eventTitle}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar)] text-[13px] tracking-[0.04em] font-medium text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] transition-[background-color] duration-[var(--dur-fast)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
                <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : null}
            Create enrolment
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: "existing" | "new";
  onChange: (m: "existing" | "new") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Participant source"
      className="inline-flex p-1 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] self-start"
    >
      {(["existing", "new"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m)}
            className={`h-9 px-4 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] font-medium transition-[background-color,color] duration-[var(--dur-fast)]
                        ${
                          active
                            ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                            : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
                        }`}
          >
            {m === "existing" ? "Use existing participant" : "Add new participant"}
          </button>
        );
      })}
    </div>
  );
}

function NewParticipantFields({
  draft,
  setDraft,
  disabled,
}: {
  draft: NewParticipantDraft;
  setDraft: (d: NewParticipantDraft) => void;
  disabled: boolean;
}) {
  function set<K extends keyof NewParticipantDraft>(k: K, v: NewParticipantDraft[K]) {
    setDraft({ ...draft, [k]: v });
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Name (EN)" required>
        <input className={TEXTINPUT_CLASS} value={draft.name_en} onChange={(e) => set("name_en", e.target.value)} disabled={disabled} placeholder="e.g. Tan Mei Ling" />
      </Field>
      <Field label="Name (中文)">
        <input className={TEXTINPUT_CLASS} value={draft.name_cn} onChange={(e) => set("name_cn", e.target.value)} disabled={disabled} placeholder="陈美玲" />
      </Field>
      <Field label="Email" required>
        <input className={TEXTINPUT_CLASS} type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} disabled={disabled} />
      </Field>
      <Field label="Phone" required>
        <input className={TEXTINPUT_CLASS} type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} disabled={disabled} placeholder="+65 9123 4567" />
      </Field>
      <Field label="Region / country" required>
        <input className={TEXTINPUT_CLASS} value={draft.region} onChange={(e) => set("region", e.target.value)} disabled={disabled} placeholder="MY · SG · TW · HK · CN · …" />
      </Field>
      <Field label="Language fluency · 上课语种">
        <select className={TEXTINPUT_CLASS} value={draft.language} onChange={(e) => set("language", e.target.value)} disabled={disabled}>
          <option value="">—</option>
          <option value="cn">中文 · Chinese</option>
          <option value="en">English</option>
          <option value="both">中英文 · Both</option>
        </select>
      </Field>
      <Field label="Referrer · 感召人姓名">
        <input className={TEXTINPUT_CLASS} value={draft.referrer_name} onChange={(e) => set("referrer_name", e.target.value)} disabled={disabled} placeholder="Optional" />
      </Field>
      <Field label="Referrer contact · 感召人联系">
        <input className={TEXTINPUT_CLASS} value={draft.referrer_contact} onChange={(e) => set("referrer_contact", e.target.value)} disabled={disabled} placeholder="Optional" />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-[var(--ink)] md:col-span-2">
        <input
          type="checkbox"
          checked={draft.is_old_student}
          onChange={(e) => set("is_old_student", e.target.checked)}
          disabled={disabled}
          className="accent-[var(--cinnabar)] cursor-pointer"
        />
        Mark as returning participant (老学员)
      </label>
    </div>
  );
}

function StatePicker({
  value,
  onChange,
  disabled,
}: {
  value: InitialState;
  onChange: (v: InitialState) => void;
  disabled: boolean;
}) {
  const options: { value: InitialState; label: string; sub: string }[] = [
    {
      value: "pending",
      label: "Pending → approve later",
      sub: "Lands in the approval queue. No notification fires.",
    },
    {
      value: "approved",
      label: "Approved → fire payment link",
      sub: "Sends approval email + WhatsApp with /pay link.",
    },
    {
      value: "paid",
      label: "Paid → already paid offline",
      sub: "Records the payment + sends a receipt.",
    },
  ];
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            aria-pressed={selected}
            className={`text-left rounded-[var(--radius-md)] border px-4 py-3 transition-[background-color,border-color] duration-[var(--dur-fast)] disabled:opacity-50 disabled:cursor-not-allowed
                        ${
                          selected
                            ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/60"
                            : "border-[var(--paper-shadow)] bg-[var(--paper)] hover:bg-[var(--paper-deep)]/55"
                        }`}
          >
            <div className={`text-[13px] font-medium ${selected ? "text-[var(--cinnabar-deep)]" : "text-[var(--ink)]"}`}>
              {o.label}
            </div>
            <div className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.55]">
              {o.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        {eyebrow}
      </div>
      <h2 className="mt-2 font-display text-[18px] leading-[1.25] tracking-[-0.005em] text-[var(--ink)]">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-[12.5px] text-[var(--ink-mute)] leading-[1.55] max-w-[64ch]">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const TEXTINPUT_CLASS =
  "w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] leading-[1.5] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)]/50 focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] disabled:opacity-50 disabled:cursor-not-allowed";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-mute)] mb-1.5">
        {label}
        {required ? <span className="ml-1 text-[var(--cinnabar)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function FieldRenderer({
  field,
  value,
  setValue,
  disabled,
}: {
  field: CustomField;
  value: unknown;
  setValue: (v: unknown) => void;
  disabled: boolean;
}) {
  const labelEn = field.label_en || field.label_cn || field.id;
  const labelCn =
    field.label_en && field.label_cn && field.label_en !== field.label_cn
      ? field.label_cn
      : null;
  const label = labelCn ? `${labelEn} · ${labelCn}` : labelEn;

  if (field.type === "checkbox_ack") {
    return (
      <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => setValue(e.target.checked)}
          disabled={disabled}
          className="mt-1 accent-[var(--cinnabar)] cursor-pointer"
        />
        <span className="text-[12.5px] text-[var(--ink)] leading-[1.5]">
          {label}
        </span>
      </label>
    );
  }

  if (field.type === "single_select") {
    const v = typeof value === "string" ? value : "";
    return (
      <Field label={label}>
        <select className={TEXTINPUT_CLASS} value={v} onChange={(e) => setValue(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label_en || o.label_cn || o.value}
            </option>
          ))}
          {field.allow_other ? (
            <option value={OTHER_OPTION_VALUE}>Other</option>
          ) : null}
        </select>
      </Field>
    );
  }

  if (field.type === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    function toggle(opt: string) {
      const next = arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt];
      setValue(next);
    }
    return (
      <Field label={label}>
        <div className="flex flex-wrap gap-2">
          {field.options.map((o) => {
            const sel = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                disabled={disabled}
                aria-pressed={sel}
                className={`px-3 h-8 rounded-[var(--radius-pill)] border text-[12px] transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                            ${
                              sel
                                ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:text-[var(--ink)]"
                            }`}
              >
                {o.label_en || o.label_cn || o.value}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }

  if (field.type === "date") {
    const v = typeof value === "string" ? value : "";
    return (
      <Field label={label}>
        <input className={TEXTINPUT_CLASS} type="date" value={v} onChange={(e) => setValue(e.target.value)} disabled={disabled} />
      </Field>
    );
  }

  if (field.type === "long_text") {
    const v = typeof value === "string" ? value : "";
    return (
      <Field label={label}>
        <textarea
          className={`${TEXTINPUT_CLASS} resize-y`}
          rows={3}
          value={v}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
        />
      </Field>
    );
  }

  // short_text fallthrough
  const v = typeof value === "string" ? value : "";
  return (
    <Field label={label}>
      <input className={TEXTINPUT_CLASS} value={v} onChange={(e) => setValue(e.target.value)} disabled={disabled} />
    </Field>
  );
}
