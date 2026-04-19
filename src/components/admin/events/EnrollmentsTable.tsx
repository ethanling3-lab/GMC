"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ENROLLMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  type EnrollmentStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/enrollments-shared";
import {
  normalizeFormSchema,
  type CustomField,
  type FormSchema,
} from "@/lib/event-form-schema";

type ParticipantRef = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
};

export type EnrollmentRow = {
  id: string;
  status: EnrollmentStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  amount_paid: number | null;
  paid_at: string | null;
  confirmed_at: string | null;
  approved_at: string | null;
  created_at: string;
  form_answers: Record<string, unknown> | null;
  participant: ParticipantRef | null;
};

type Props = {
  eventId: string;
  rows: EnrollmentRow[];
  canEdit: boolean;
  hasFilter: boolean;
  formSchema: unknown;
};

type BulkAction = "approve" | "reject" | "cancel" | "mark_paid";
type Toast = { message: string } | null;

const STATUS_TONE: Record<
  EnrollmentStatus,
  { dot: string; bg: string; ring: string; text: string }
> = {
  pending_approval: {
    dot: "bg-[var(--cinnabar-soft)]",
    bg: "bg-[var(--gold-soft)]",
    ring: "border-[var(--cinnabar-soft)]/35",
    text: "text-[var(--cinnabar-deep)]",
  },
  approved: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/25",
    text: "text-[var(--jade-deep)]",
  },
  paid: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
  rejected: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/25",
    text: "text-[var(--cinnabar-deep)]",
  },
  cancelled: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
};

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  none: "text-[var(--ink-faint)]",
  pending: "text-[var(--cinnabar-deep)]",
  paid: "text-[var(--jade-deep)]",
  failed: "text-[var(--cinnabar-deep)]",
  refunded: "text-[var(--ink-mute)]",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function participantName(p: ParticipantRef | null): string {
  if (!p) return "(removed)";
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

export function EnrollmentsTable({
  eventId,
  rows,
  canEdit,
  hasFilter,
  formSchema,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const parsedSchema: FormSchema = useMemo(
    () => normalizeFormSchema(formSchema),
    [formSchema],
  );
  const answerableFields = useMemo(
    () => parsedSchema.fields.filter((f) => f.type !== "section_header"),
    [parsedSchema],
  );
  const hasCustomFields = answerableFields.length > 0;

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rowKey = useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
  useEffect(() => {
    setSelected(new Set());
    setError(null);
  }, [rowKey]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const indeterminate = someOnPage && !allOnPage;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOnPage) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function runBulk(action: BulkAction) {
    if (selected.size === 0) return;
    setBusy(action);
    setError(null);
    try {
      const ids = Array.from(selected);
      const res = await fetch(
        `/api/admin/events/${eventId}/enrollments/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Bulk ${action} failed (${res.status})`);
      }
      const count = ids.length;
      const verb =
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : action === "cancel"
              ? "cancelled"
              : "marked paid";
      setSelected(new Set());
      router.refresh();
      setToast({
        message: `${count.toLocaleString()} enrollment${count === 1 ? "" : "s"} ${verb}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Bulk ${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  const count = selected.size;

  return (
    <div
      className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 shadow-[var(--shadow-paper-1)] overflow-hidden"
    >
      {count > 0 && canEdit ? (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--cinnabar-wash)]/60">
          <div className="inline-flex items-center gap-2 text-[12px] text-[var(--cinnabar-deep)] mr-1">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="inline-flex items-center justify-center w-5 h-5 rounded-[4px] border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar)] hover:bg-[var(--cinnabar)]/10 transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 5h5" />
              </svg>
            </button>
            <span className="font-medium tabular-nums">
              {count.toLocaleString()} selected
            </span>
          </div>

          <div className="h-5 w-px bg-[var(--cinnabar)]/20" aria-hidden="true" />

          <BulkButton
            label="Approve"
            onClick={() => runBulk("approve")}
            busy={busy === "approve"}
            disabled={busy !== null}
            tone="jade"
          />
          <BulkButton
            label="Mark paid"
            onClick={() => runBulk("mark_paid")}
            busy={busy === "mark_paid"}
            disabled={busy !== null}
          />
          <BulkButton
            label="Reject"
            onClick={() => runBulk("reject")}
            busy={busy === "reject"}
            disabled={busy !== null}
            tone="danger"
          />
          <BulkButton
            label="Cancel"
            onClick={() => runBulk("cancel")}
            busy={busy === "cancel"}
            disabled={busy !== null}
          />

          {error ? (
            <div className="ml-auto text-[12px] text-[var(--cinnabar-deep)] font-medium">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px] text-[var(--ink-soft)]">
          <thead className="bg-[var(--paper-deep)]/70 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
            <tr>
              {canEdit ? (
                <th scope="col" className="w-10 pl-5 pr-2 py-3.5">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allOnPage}
                    onChange={toggleAll}
                    disabled={rows.length === 0}
                    aria-label="Select all on page"
                    className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </th>
              ) : null}
              <th scope="col" className="px-5 py-3.5 font-medium">Participant</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Region</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
              <th scope="col" className="px-5 py-3.5 font-medium">Payment</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Amount</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Enrolled</th>
              {hasCustomFields ? (
                <th scope="col" className="w-10 pr-3 py-3.5" aria-label="Expand answers" />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    (canEdit ? 7 : 6) + (hasCustomFields ? 1 : 0)
                  }
                  className="px-6 py-16 text-center"
                >
                  <div className="inline-flex flex-col items-center gap-3">
                    <span
                      className="inline-flex items-center justify-center w-10 h-10 rounded-full
                                 border border-[var(--paper-shadow)] bg-[var(--paper)]
                                 text-[var(--cinnabar)]"
                      aria-hidden="true"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="6" r="2.6" />
                        <path d="M3 13.2a5 5 0 0 1 10 0" />
                      </svg>
                    </span>
                    <div className="text-[13px] text-[var(--ink)]">
                      {hasFilter ? "No enrollments in this status" : "No enrollments yet"}
                    </div>
                    <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                      {hasFilter
                        ? "Switch the status tab above to see the rest."
                        : "Once the public event page is live (or an admin enrolls a participant manually), rows will appear here."}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.flatMap((r) => {
                const tone = STATUS_TONE[r.status];
                const payTone = PAYMENT_TONE[r.payment_status];
                const isSelected = selected.has(r.id);
                const isExpanded = expanded.has(r.id);
                const totalCols = (canEdit ? 7 : 6) + (hasCustomFields ? 1 : 0);
                return [
                  <tr
                    key={r.id}
                    className={`border-t border-[var(--paper-shadow)]
                               hover:bg-[var(--paper-deep)]/55
                               transition-colors duration-[var(--dur-fast)]
                               has-[a:focus-visible]:bg-[var(--paper-deep)]/55
                               ${isSelected ? "bg-[var(--cinnabar-wash)]/40" : ""}
                               ${isExpanded ? "bg-[var(--paper-deep)]/40" : ""}`}
                  >
                    {canEdit ? (
                      <td className="w-10 pl-5 pr-2 py-3.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${participantName(r.participant)}`}
                          className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer"
                        />
                      </td>
                    ) : null}
                    <td className="px-5 py-3.5">
                      {r.participant ? (
                        <Link
                          href={`/admin/participants/${r.participant.id}`}
                          className="block hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                        >
                          <div className="text-[var(--ink)] font-medium">
                            {participantName(r.participant)}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-faint)]">
                            {r.participant.region_id ?? "—"}
                          </div>
                        </Link>
                      ) : (
                        <span className="text-[var(--ink-faint)] italic">
                          participant removed
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)] whitespace-nowrap">
                      {r.participant?.region ?? (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                    text-[10px] tracking-[0.14em] uppercase
                                    ${tone.bg} ${tone.ring} ${tone.text}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${tone.dot}`}
                          aria-hidden="true"
                        />
                        {ENROLLMENT_STATUS_LABEL[r.status].en}
                      </span>
                    </td>
                    <td className={`px-5 py-3.5 ${payTone}`}>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[12px]">
                          {PAYMENT_STATUS_LABEL[r.payment_status].en}
                        </span>
                        {r.payment_method ? (
                          <span className="text-[10px] tracking-[0.14em] uppercase text-[var(--ink-faint)]">
                            {PAYMENT_METHOD_LABEL[r.payment_method]}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {r.amount_paid !== null ? (
                        <span className="text-[var(--ink)]">
                          {r.amount_paid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-[var(--ink-mute)] whitespace-nowrap">
                      {formatDate(r.created_at)}
                    </td>
                    {hasCustomFields ? (
                      <td className="pr-3 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(r.id)}
                          aria-label={
                            isExpanded ? "Hide form answers" : "Show form answers"
                          }
                          aria-expanded={isExpanded}
                          className={`w-7 h-7 rounded-full border inline-flex items-center justify-center
                                      transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]
                                      ${
                                        isExpanded
                                          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                          : "border-[var(--paper-shadow)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/30 hover:text-[var(--cinnabar-deep)]"
                                      }`}
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            className={`transition-transform duration-[var(--dur-fast)] ${isExpanded ? "rotate-180" : ""}`}
                          >
                            <path d="M2 4l3 3 3-3" />
                          </svg>
                        </button>
                      </td>
                    ) : null}
                  </tr>,
                  isExpanded && hasCustomFields ? (
                    <tr key={`${r.id}-answers`} className="bg-[var(--paper-deep)]/40">
                      <td colSpan={totalCols} className="px-6 py-5 border-t border-[var(--paper-shadow)]">
                        <AnswersGrid
                          fields={answerableFields}
                          answers={r.form_answers ?? {}}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })
            )}
          </tbody>
        </table>
      </div>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="toast-in fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                     inline-flex items-center gap-4 pl-5 pr-2 py-2
                     rounded-[var(--radius-pill)]
                     bg-[var(--ink)] text-[var(--paper-warm)]
                     shadow-[0_12px_32px_rgba(11,41,84,0.28)]"
        >
          <span className="text-[13px] tracking-[0.02em]">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--paper-warm)]/70 hover:text-[var(--paper-warm)] hover:bg-[var(--paper-warm)]/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AnswersGrid({
  fields,
  answers,
}: {
  fields: CustomField[];
  answers: Record<string, unknown>;
}) {
  function formatValue(f: CustomField, v: unknown): string {
    if (v === undefined || v === null || v === "") return "—";
    if (f.type === "checkbox_ack") return v === true ? "✓ Acknowledged" : "—";
    if (f.type === "multi_select") {
      if (!Array.isArray(v) || v.length === 0) return "—";
      return v
        .map((val) => {
          const opt = f.options.find((o) => o.value === val);
          return opt ? opt.label_en || opt.label_cn || opt.value : String(val);
        })
        .join(", ");
    }
    if (f.type === "single_select") {
      const opt = f.options.find((o) => o.value === v);
      return opt ? opt.label_en || opt.label_cn || opt.value : String(v);
    }
    return String(v);
  }

  return (
    <div>
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)] mb-3">
        <span className="w-5 h-px bg-current" />
        Form answers · 报名问答
      </div>
      <dl className="grid md:grid-cols-2 gap-x-8 gap-y-4">
        {fields.map((f) => {
          const v = formatValue(f, answers[f.id]);
          const labelPrimary = f.label_en || f.label_cn || f.id;
          const labelSecondary =
            f.label_en && f.label_cn && f.label_en !== f.label_cn
              ? f.label_cn
              : null;
          return (
            <div key={f.id}>
              <dt className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
                {labelPrimary}
                {labelSecondary ? (
                  <span className="text-[var(--ink-faint)] normal-case tracking-[0.08em]">
                    {" · "}
                    {labelSecondary}
                  </span>
                ) : null}
              </dt>
              <dd className="mt-1 text-[13px] leading-[1.6] text-[var(--ink)] break-words whitespace-pre-wrap">
                {v}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function BulkButton({
  label,
  onClick,
  busy,
  disabled,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  tone?: "default" | "jade" | "danger";
}) {
  const base =
    "inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] font-medium border transition-[background-color,border-color,color] duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:shadow-[var(--shadow-focus)]";
  const toneCls =
    tone === "danger"
      ? "border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]"
      : tone === "jade"
        ? "border-[var(--jade)]/40 bg-[var(--paper)] text-[var(--jade-deep)] hover:bg-[var(--jade)] hover:text-[var(--paper-warm)] hover:border-[var(--jade)]"
        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${toneCls}`}
    >
      {busy ? (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
          <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : null}
      {label}
    </button>
  );
}
