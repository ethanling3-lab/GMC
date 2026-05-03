"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PAYMENT_METHOD_LABEL,
  type EnrollmentStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/enrollments-shared";
import {
  normalizeFormSchema,
  OTHER_OPTION_VALUE,
  type CustomField,
  type FormSchema,
} from "@/lib/event-form-schema";
import {
  canTransition,
  deriveJourneyStage,
  JOURNEY_LABEL,
  JOURNEY_TONE,
  TRANSITION_REASON_LABEL,
  type EnrollmentAction,
  type JourneyStage,
} from "@/lib/enrollment-transitions";
import {
  RejectReasonModal,
  type RejectReasonValue,
} from "./RejectReasonModal";

type ParticipantRef = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
  is_old_student: boolean | null;
  referrer_id: string | null;
  referrer_name: string | null;
  referrer_contact: string | null;
};

export type ReferrerRef = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
};

export type LatestNotification = {
  channel: string;
  template: string;
  status: string;
  sent_at: string | null;
  created_at: string;
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
  /** Set when the participant uploaded a transfer slip on /pay/[token]. Optional so pre-011 schemas still work. */
  transfer_slip_url?: string | null;
  transfer_slip_uploaded_at?: string | null;
  /** M6 grouping pin — admin-set hint that this person should land in group N
   * when the LLM/balance algorithm runs. Optional so pre-021 schemas still work. */
  pinned_group_no?: number | null;
};

type Props = {
  eventId: string;
  rows: EnrollmentRow[];
  canEdit: boolean;
  hasFilter: boolean;
  formSchema: unknown;
  referrerById: Record<string, ReferrerRef>;
  latestNotificationByEnrollment?: Record<string, LatestNotification>;
};

type PendingReject =
  | { kind: "row"; id: string }
  | { kind: "bulk"; ids: string[] }
  | null;

type BulkAction = EnrollmentAction;
type Toast = { message: string } | null;

const JOURNEY_TONE_CLASS: Record<
  "neutral" | "info" | "warn" | "go" | "done" | "danger",
  { dot: string; bg: string; ring: string; text: string }
> = {
  neutral: {
    dot: "bg-[var(--ink-faint)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--paper-shadow)]",
    text: "text-[var(--ink-mute)]",
  },
  info: {
    dot: "bg-[var(--cinnabar-soft)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar-soft)]/35",
    text: "text-[var(--cinnabar-deep)]",
  },
  warn: {
    dot: "bg-[var(--gold)]",
    bg: "bg-[var(--gold-soft)]",
    ring: "border-[var(--gold)]/40",
    text: "text-[var(--ink)]",
  },
  go: {
    dot: "bg-[var(--jade)]",
    bg: "bg-[var(--jade-wash)]",
    ring: "border-[var(--jade)]/30",
    text: "text-[var(--jade-deep)]",
  },
  done: {
    dot: "bg-[var(--ink)]",
    bg: "bg-[var(--paper-deep)]",
    ring: "border-[var(--ink-faint)]/40",
    text: "text-[var(--ink)]",
  },
  danger: {
    dot: "bg-[var(--cinnabar)]",
    bg: "bg-[var(--cinnabar-wash)]",
    ring: "border-[var(--cinnabar)]/30",
    text: "text-[var(--cinnabar-deep)]",
  },
};

const JOURNEY_SECONDARY_EN: Record<JourneyStage, string | null> = {
  registered: "Not confirmed",
  info_confirmed: "Confirmed",
  approved_unpaid: "Awaiting payment",
  paid: "Complete",
  rejected: null,
  cancelled: null,
};

const JOURNEY_SECONDARY_ZH: Record<JourneyStage, string | null> = {
  registered: "未核对",
  info_confirmed: "已核对",
  approved_unpaid: "待付款",
  paid: "已完成",
  rejected: null,
  cancelled: null,
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}  ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function participantName(p: ParticipantRef | null): string {
  if (!p) return "(removed)";
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

function referrerLabel(r: ReferrerRef): string {
  const en = r.name_en?.trim();
  const cn = r.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || r.region_id || "(unnamed)";
}

// Picks the first answerable field that has a filled value, then returns a
// compact "Label: Value" string for preview purposes. Returns null when no
// field has an answer yet.
function firstAnswerPreview(
  fields: CustomField[],
  answers: Record<string, unknown>,
): { label: string; value: string } | null {
  for (const f of fields) {
    const raw = answers[f.id];
    if (raw === undefined || raw === null || raw === "") continue;
    if (Array.isArray(raw) && raw.length === 0) continue;
    const label = f.label_en || f.label_cn || f.id;
    const rendered = renderPreviewValue(f, raw, answers[`${f.id}__other`]);
    if (!rendered) continue;
    return { label, value: rendered };
  }
  return null;
}

function renderPreviewValue(
  f: CustomField,
  v: unknown,
  otherText?: unknown,
): string {
  if (f.type === "checkbox_ack") return v === true ? "✓" : "";
  const otherLabel =
    typeof otherText === "string" && otherText.trim()
      ? `Other: ${otherText.trim()}`
      : "Other";
  if (f.type === "multi_select") {
    if (!Array.isArray(v) || v.length === 0) return "";
    return v
      .map((val) => {
        if (val === OTHER_OPTION_VALUE) return otherLabel;
        const opt = f.options.find((o) => o.value === val);
        return opt ? opt.label_en || opt.label_cn || opt.value : String(val);
      })
      .join(", ");
  }
  if (f.type === "single_select") {
    if (v === OTHER_OPTION_VALUE) return otherLabel;
    const opt = f.options.find((o) => o.value === v);
    return opt ? opt.label_en || opt.label_cn || opt.value : String(v);
  }
  return String(v);
}

export function EnrollmentsTable({
  eventId,
  rows,
  canEdit,
  hasFilter,
  formSchema,
  referrerById,
  latestNotificationByEnrollment = {},
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState<string>("");
  const [amountBusy, setAmountBusy] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState<PendingReject>(null);
  const [resendBusyId, setResendBusyId] = useState<string | null>(null);
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
    setEditingAmountId(null);
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

  async function runBulk(
    action: BulkAction,
    extra?: { reject_reason?: RejectReasonValue; reject_note?: string | null },
  ) {
    if (selected.size === 0) return;
    setBusy(action);
    setError(null);
    try {
      const ids = Array.from(selected);
      const payloadBody: Record<string, unknown> = { action, ids };
      if (action === "reject" && extra?.reject_reason) {
        payloadBody.reject_reason = extra.reject_reason;
        if (extra.reject_note) payloadBody.reject_note = extra.reject_note;
      }
      const res = await fetch(
        `/api/admin/events/${eventId}/enrollments/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBody),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.error === "transition_blocked") {
          const blocked = (payload.results ?? []).filter(
            (r: { ok: boolean }) => !r.ok,
          );
          const reasons = blocked
            .map((r: { reason?: string }) =>
              r.reason
                ? TRANSITION_REASON_LABEL[r.reason]?.en ?? r.reason
                : "blocked",
            )
            .join(", ");
          throw new Error(
            `${blocked.length} enrolment${blocked.length === 1 ? "" : "s"} can't ${action.replace("_", " ")}: ${reasons}`,
          );
        }
        throw new Error(
          payload?.error ?? `Bulk ${action} failed (${res.status})`,
        );
      }
      const count = payload?.affected ?? ids.length;
      const verb =
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : action === "cancel"
              ? "cancelled"
              : action === "mark_paid"
                ? "marked paid"
                : "marked unpaid";
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

  async function runRow(
    id: string,
    action: EnrollmentAction,
    extra?: { reject_reason?: RejectReasonValue; reject_note?: string | null },
  ) {
    setError(null);
    try {
      const payloadBody: Record<string, unknown> = { action };
      if (action === "reject" && extra?.reject_reason) {
        payloadBody.reject_reason = extra.reject_reason;
        if (extra.reject_note) payloadBody.reject_note = extra.reject_note;
      }
      const res = await fetch(`/api/admin/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.error === "transition_blocked" && payload.reason) {
          const hint =
            TRANSITION_REASON_LABEL[payload.reason]?.en ?? payload.reason;
          throw new Error(hint);
        }
        throw new Error(
          payload?.error ?? `Couldn't ${action.replace("_", " ")}`,
        );
      }
      router.refresh();
      const verb =
        action === "approve"
          ? "Approved"
          : action === "reject"
            ? "Rejected"
            : action === "cancel"
              ? "Cancelled"
              : action === "mark_paid"
                ? "Marked paid"
                : "Marked unpaid";
      setToast({ message: verb });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Row action failed");
    }
  }

  function startEditAmount(row: EnrollmentRow) {
    if (!canEdit) return;
    setEditingAmountId(row.id);
    setAmountDraft(
      row.amount_paid === null ? "" : String(row.amount_paid),
    );
    setError(null);
  }

  function cancelEditAmount() {
    setEditingAmountId(null);
    setAmountDraft("");
  }

  async function runResend(id: string) {
    setResendBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/enrollments/${id}/resend`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.error === "no_template_for_status") {
          throw new Error(`No template applies to a "${payload.status}" enrolment.`);
        }
        throw new Error(payload?.detail ?? payload?.error ?? `Re-send failed (${res.status})`);
      }
      router.refresh();
      setToast({ message: "Notification re-sent" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-send failed");
    } finally {
      setResendBusyId(null);
    }
  }

  async function confirmReject(args: { reason: RejectReasonValue; note: string | null }) {
    if (!pendingReject) return;
    if (pendingReject.kind === "row") {
      await runRow(pendingReject.id, "reject", {
        reject_reason: args.reason,
        reject_note: args.note,
      });
    } else {
      await runBulk("reject", {
        reject_reason: args.reason,
        reject_note: args.note,
      });
    }
    setPendingReject(null);
  }

  async function saveEditAmount(id: string, original: number | null) {
    const trimmed = amountDraft.trim();
    // Treat empty string as "no change requested" — just close the editor.
    if (trimmed === "") {
      cancelEditAmount();
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
      setError("Amount must be between 0 and 1,000,000.");
      return;
    }
    if (original !== null && parsed === original) {
      cancelEditAmount();
      return;
    }
    setAmountBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_paid: parsed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? `Couldn't update amount (${res.status})`);
      }
      setEditingAmountId(null);
      setAmountDraft("");
      router.refresh();
      setToast({
        message: `Amount updated to ${parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Amount update failed");
    } finally {
      setAmountBusy(null);
    }
  }

  // Pin-to-group editor — uses window.prompt for v1 simplicity. The richer
  // GroupBuilder UI in M6.3 lets admin set this from the group cards.
  async function editPin(id: string, current: number | null | undefined) {
    if (!canEdit) return;
    const raw = window.prompt(
      "Pin participant to group # (blank or 0 to clear):",
      current != null ? String(current) : "",
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    let next: number | null;
    if (trimmed === "" || trimmed === "0") {
      next = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 999) {
        setError("Pin must be a positive integer ≤ 999, or blank to clear.");
        return;
      }
      next = Math.floor(parsed);
    }
    if ((current ?? null) === next) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned_group_no: next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error ?? `Couldn't update pin (${res.status})`);
      }
      router.refresh();
      setToast({
        message: next == null ? "Pin cleared" : `Pinned to group ${next}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pin update failed");
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
            label="Mark unpaid"
            onClick={() => runBulk("mark_unpaid")}
            busy={busy === "mark_unpaid"}
            disabled={busy !== null}
          />
          <BulkButton
            label="Reject"
            onClick={() =>
              setPendingReject({ kind: "bulk", ids: Array.from(selected) })
            }
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

      {/* Non-bulk errors (e.g. amount update) still need a surface. */}
      {count === 0 && error ? (
        <div className="px-5 py-2.5 border-b border-[var(--paper-shadow)] bg-[var(--cinnabar-wash)]/40 text-[12px] text-[var(--cinnabar-deep)] font-medium">
          {error}
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
              <th scope="col" className="px-5 py-3.5 font-medium">Journey</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Amount</th>
              <th scope="col" className="px-5 py-3.5 font-medium text-right">Enrolled</th>
              {canEdit ? (
                <th scope="col" className="w-10 pr-1 py-3.5" aria-label="Row actions" />
              ) : null}
              {hasCustomFields ? (
                <th scope="col" className="w-[180px] pr-3 py-3.5 font-medium text-right">
                  Answers
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    5 + (canEdit ? 2 : 0) + (hasCustomFields ? 1 : 0)
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
                      {hasFilter ? "No enrollments match" : "No enrollments yet"}
                    </div>
                    <div className="text-[12px] text-[var(--ink-mute)] max-w-[44ch]">
                      {hasFilter
                        ? "Try clearing the search or switching the status tab above."
                        : "Once the public event page is live (or an admin enrolls a participant manually), rows will appear here."}
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.flatMap((r) => {
                const stage = deriveJourneyStage({
                  status: r.status,
                  payment_status: r.payment_status,
                  confirmed_at: r.confirmed_at,
                });
                const journeyTone = JOURNEY_TONE_CLASS[JOURNEY_TONE[stage]];
                const journeyPrimary = JOURNEY_LABEL[stage].en;
                const journeyZh = JOURNEY_LABEL[stage].zh;
                const journeySecondaryEn = JOURNEY_SECONDARY_EN[stage];
                const journeySecondaryZh = JOURNEY_SECONDARY_ZH[stage];
                const isSelected = selected.has(r.id);
                const isExpanded = expanded.has(r.id);
                const totalCols =
                  5 + (canEdit ? 2 : 0) + (hasCustomFields ? 1 : 0);

                const p = r.participant;
                const referrerLinked =
                  p?.referrer_id && referrerById[p.referrer_id]
                    ? referrerById[p.referrer_id]
                    : null;
                const referrerFreeText =
                  !referrerLinked && (p?.referrer_name || p?.referrer_contact)
                    ? `${p?.referrer_name ?? ""}${p?.referrer_name && p?.referrer_contact ? " · " : ""}${p?.referrer_contact ?? ""}`.trim()
                    : null;

                const preview =
                  hasCustomFields
                    ? firstAnswerPreview(answerableFields, r.form_answers ?? {})
                    : null;

                const trail = [
                  `Registered: ${formatDateTime(r.created_at)}`,
                  `Confirmed: ${formatDateTime(r.confirmed_at)}`,
                  `Approved: ${formatDateTime(r.approved_at)}`,
                  `Paid: ${formatDateTime(r.paid_at)}`,
                ].join("\n");

                const isEditingAmount = editingAmountId === r.id;
                const isSavingAmount = amountBusy === r.id;

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
                      <td className="w-10 pl-5 pr-2 py-3.5 align-top">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${participantName(p)}`}
                          className="w-3.5 h-3.5 accent-[var(--cinnabar)] cursor-pointer mt-0.5"
                        />
                      </td>
                    ) : null}
                    <td className="px-5 py-3.5 align-top">
                      {p ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/admin/participants/${p.id}`}
                              className="text-[var(--ink)] font-medium hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)] focus-visible:shadow-[var(--shadow-focus)] rounded-sm"
                            >
                              {participantName(p)}
                            </Link>
                            {p.is_old_student ? <OldChipInline /> : null}
                            <DeliveryDot
                              latest={latestNotificationByEnrollment[r.id]}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ink-faint)]">
                            <span className="font-mono">
                              {p.region_id ?? "—"}
                            </span>
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  editPin(r.id, r.pinned_group_no ?? null);
                                }}
                                title="Pin to group # for next grouping run"
                                className={`inline-flex items-center h-[18px] px-1.5 rounded-[var(--radius-pill)] border text-[10px] tracking-[0.04em] transition-colors duration-[var(--dur-fast)] ${
                                  r.pinned_group_no
                                    ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/60"
                                    : "border-[var(--paper-shadow)] bg-[var(--paper)] !text-[var(--ink-faint)] hover:!text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/30"
                                }`}
                              >
                                {r.pinned_group_no
                                  ? `Pin · #${r.pinned_group_no}`
                                  : "Pin"}
                              </button>
                            ) : null}
                            {p.email ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <a
                                  href={`mailto:${p.email}`}
                                  className="font-mono !text-[var(--ink-mute)] hover:!text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {p.email}
                                </a>
                              </>
                            ) : null}
                            {p.phone ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <a
                                  href={`tel:${p.phone.replace(/\s+/g, "")}`}
                                  className="font-mono !text-[var(--ink-mute)] hover:!text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {p.phone}
                                </a>
                              </>
                            ) : null}
                          </div>
                          {referrerLinked || referrerFreeText ? (
                            <div className="mt-0.5">
                              {referrerLinked ? (
                                <Link
                                  href={`/admin/participants/${referrerLinked.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full
                                             border border-[var(--paper-shadow)] bg-[var(--paper)]
                                             text-[10.5px] tracking-[0.04em] !text-[var(--ink-mute)]
                                             hover:border-[var(--cinnabar)]/30 hover:bg-[var(--cinnabar-wash)] hover:!text-[var(--cinnabar-deep)]
                                             transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
                                  title="Referred by · 感召"
                                >
                                  <svg
                                    width="9"
                                    height="9"
                                    viewBox="0 0 10 10"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                    className="opacity-70"
                                  >
                                    <path d="M2 6.5l2 2 4-5" />
                                  </svg>
                                  <span className="truncate max-w-[24ch]">
                                    {referrerLabel(referrerLinked)}
                                  </span>
                                </Link>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full
                                             border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]
                                             text-[10.5px] tracking-[0.04em] text-[var(--ink-faint)]"
                                  title="Referred by (free text) · 感召（文字）"
                                >
                                  <svg
                                    width="9"
                                    height="9"
                                    viewBox="0 0 10 10"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <circle cx="5" cy="3.5" r="1.4" />
                                    <path d="M2 8.2a3 3 0 0 1 6 0" />
                                  </svg>
                                  <span className="truncate max-w-[24ch]">
                                    {referrerFreeText}
                                  </span>
                                </span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[var(--ink-faint)] italic">
                          participant removed
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[var(--ink-mute)] whitespace-nowrap align-top">
                      {p?.region ?? (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 align-top">
                      <div className="flex flex-col gap-1.5 items-start">
                        <span
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border
                                      text-[10px] tracking-[0.14em] uppercase
                                      ${journeyTone.bg} ${journeyTone.ring} ${journeyTone.text}`}
                          title={journeyZh}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${journeyTone.dot}`}
                            aria-hidden="true"
                          />
                          {journeyPrimary}
                        </span>
                        {journeySecondaryEn ? (
                          <span
                            className="text-[10.5px] tracking-[0.06em] text-[var(--ink-mute)]"
                            title={journeySecondaryZh ?? undefined}
                          >
                            {journeySecondaryEn}
                            {r.payment_method &&
                            (stage === "approved_unpaid" || stage === "paid")
                              ? ` · ${PAYMENT_METHOD_LABEL[r.payment_method]}`
                              : ""}
                          </span>
                        ) : null}
                        {r.transfer_slip_url && stage === "approved_unpaid" ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-[var(--cinnabar-deep)]"
                            title={
                              r.transfer_slip_uploaded_at
                                ? `Slip uploaded ${formatDateTime(r.transfer_slip_uploaded_at)} · verify and mark paid`
                                : "Slip uploaded · verify and mark paid"
                            }
                          >
                            <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
                            Slip received
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums align-top">
                      {isEditingAmount ? (
                        <div
                          className="inline-flex items-center gap-1 justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            max="1000000"
                            autoFocus
                            value={amountDraft}
                            onChange={(e) => setAmountDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                saveEditAmount(r.id, r.amount_paid);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditAmount();
                              }
                            }}
                            disabled={isSavingAmount}
                            aria-label="Amount paid"
                            className="w-[104px] h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--cinnabar)]/40 bg-[var(--paper)]
                                       text-[12.5px] text-right text-[var(--ink)]
                                       focus:outline-none focus:shadow-[var(--shadow-focus)]
                                       tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => saveEditAmount(r.id, r.amount_paid)}
                            disabled={isSavingAmount}
                            aria-label="Save amount"
                            className="w-7 h-7 rounded-full inline-flex items-center justify-center border border-[var(--jade)]/40 text-[var(--jade-deep)] hover:bg-[var(--jade-wash)] transition-colors duration-[var(--dur-fast)] disabled:opacity-50"
                          >
                            {isSavingAmount ? (
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
                                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
                                <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M2 5.2l2 2 4-4.4" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditAmount}
                            disabled={isSavingAmount}
                            aria-label="Cancel edit"
                            className="w-7 h-7 rounded-full inline-flex items-center justify-center border border-[var(--paper-shadow)] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-colors duration-[var(--dur-fast)] disabled:opacity-50"
                          >
                            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                              <path d="M3 3l4 4M7 3l-4 4" />
                            </svg>
                          </button>
                        </div>
                      ) : canEdit ? (
                        <button
                          type="button"
                          onClick={() => startEditAmount(r)}
                          title="Click to edit amount"
                          className="group inline-flex items-center gap-1.5 px-1.5 py-0.5 -mr-1.5 rounded-[var(--radius-sm)]
                                     hover:bg-[var(--cinnabar-wash)]/60 hover:text-[var(--cinnabar-deep)]
                                     focus-visible:shadow-[var(--shadow-focus)]
                                     transition-colors duration-[var(--dur-fast)]"
                        >
                          {r.amount_paid !== null ? (
                            <span className="text-[var(--ink)] tabular-nums">
                              {r.amount_paid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-[var(--ink-faint)]">—</span>
                          )}
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            className="opacity-0 group-hover:opacity-70 text-[var(--cinnabar)] transition-opacity duration-[var(--dur-fast)]"
                          >
                            <path d="M6.5 2l1.5 1.5L4 7.5l-1.8.3L2.5 6z" />
                          </svg>
                        </button>
                      ) : r.amount_paid !== null ? (
                        <span className="text-[var(--ink)]">
                          {r.amount_paid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-[var(--ink-faint)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-[var(--ink-mute)] whitespace-nowrap align-top">
                      <span
                        title={trail}
                        className="cursor-help underline decoration-dotted decoration-[var(--ink-faint)] underline-offset-[3px]"
                      >
                        {formatDate(r.created_at)}
                      </span>
                    </td>
                    {canEdit ? (
                      <td className="pr-1 py-3.5 text-right align-top">
                        <RowActions
                          status={r.status}
                          resending={resendBusyId === r.id}
                          onAction={(a) => {
                            if (a === "reject") {
                              setPendingReject({ kind: "row", id: r.id });
                              return;
                            }
                            if (a === "resend") {
                              runResend(r.id);
                              return;
                            }
                            runRow(r.id, a);
                          }}
                        />
                      </td>
                    ) : null}
                    {hasCustomFields ? (
                      <td className="pr-3 py-3.5 text-right align-top">
                        <div className="inline-flex flex-col items-end gap-1 max-w-[180px]">
                          {preview ? (
                            <span
                              className="text-[10.5px] leading-[1.4] text-[var(--ink-mute)] truncate max-w-[172px] text-right"
                              title={`${preview.label}: ${preview.value}`}
                            >
                              <span className="text-[var(--ink-faint)]">
                                {preview.label}:
                              </span>{" "}
                              {preview.value}
                            </span>
                          ) : (
                            <span className="text-[10px] tracking-[0.1em] uppercase text-[var(--ink-faint)]">
                              No answers
                            </span>
                          )}
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
                        </div>
                      </td>
                    ) : null}
                  </tr>,
                  isExpanded && hasCustomFields ? (
                    <tr key={`${r.id}-answers`} className="bg-[var(--paper-deep)]/40">
                      <td colSpan={totalCols} className="px-6 py-5 border-t border-[var(--paper-shadow)]">
                        {r.transfer_slip_url ? (
                          <SlipPanel
                            enrollmentId={r.id}
                            uploadedAt={r.transfer_slip_uploaded_at ?? null}
                          />
                        ) : null}
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

      <RejectReasonModal
        open={pendingReject !== null}
        busy={busy === "reject"}
        count={
          pendingReject?.kind === "bulk"
            ? pendingReject.ids.length
            : 1
        }
        onCancel={() => setPendingReject(null)}
        onConfirm={confirmReject}
      />
    </div>
  );
}

function OldChipInline() {
  return (
    <span
      title="Returning participant · 老学员"
      className="inline-flex items-center gap-1 h-4 px-1.5 rounded-full
                 border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]
                 text-[9px] tracking-[0.2em] uppercase text-[var(--cinnabar-deep)]"
    >
      <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
      Old
    </span>
  );
}

function DeliveryDot({ latest }: { latest: LatestNotification | undefined }) {
  if (!latest) return null;
  const tone =
    latest.status === "sent"
      ? "bg-[var(--jade)]"
      : latest.status === "failed"
        ? "bg-[var(--cinnabar)]"
        : "bg-[var(--gold)]";
  const ts = latest.sent_at ?? latest.created_at;
  const when = ts ? formatDateTime(ts) : "—";
  return (
    <span
      title={`Last notification: ${latest.template} · ${latest.channel} · ${latest.status} · ${when}`}
      className="inline-flex items-center"
      aria-label={`Last notification ${latest.status}`}
    >
      <span className={`w-2 h-2 rounded-full ${tone}`} aria-hidden="true" />
    </span>
  );
}

function SlipPanel({
  enrollmentId,
  uploadedAt,
}: {
  enrollmentId: string;
  uploadedAt: string | null;
}) {
  const href = `/api/admin/enrollments/${enrollmentId}/slip`;
  return (
    <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)]/40 px-4 py-3 flex items-start gap-3">
      <span
        className="inline-flex items-center justify-center w-8 h-8 rounded-full
                   border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar)]"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="2.5" width="9" height="11" rx="1" />
          <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] tracking-[0.16em] uppercase text-[var(--cinnabar-deep)]">
          Transfer slip
        </div>
        <div className="mt-0.5 text-[12.5px] text-[var(--ink)] leading-[1.55]">
          Participant uploaded a transfer receipt
          {uploadedAt ? ` on ${formatDateTime(uploadedAt)}` : ""}. Verify before
          marking the enrolment paid.
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                   border border-[var(--cinnabar)]/40 bg-[var(--paper)] !text-[var(--cinnabar-deep)]
                   text-[11.5px] tracking-[0.04em] font-medium
                   hover:bg-[var(--cinnabar)] hover:!text-[var(--paper-warm)] hover:border-[var(--cinnabar)]
                   transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
      >
        Open slip
      </a>
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
  function formatValue(f: CustomField, v: unknown, otherText?: unknown): string {
    if (v === undefined || v === null || v === "") return "—";
    if (f.type === "checkbox_ack") return v === true ? "✓ Acknowledged" : "—";
    const otherLabel =
      typeof otherText === "string" && otherText.trim()
        ? `Other: ${otherText.trim()}`
        : "Other";
    if (f.type === "multi_select") {
      if (!Array.isArray(v) || v.length === 0) return "—";
      return v
        .map((val) => {
          if (val === OTHER_OPTION_VALUE) return otherLabel;
          const opt = f.options.find((o) => o.value === val);
          return opt ? opt.label_en || opt.label_cn || opt.value : String(val);
        })
        .join(", ");
    }
    if (f.type === "single_select") {
      if (v === OTHER_OPTION_VALUE) return otherLabel;
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
          const v = formatValue(f, answers[f.id], answers[`${f.id}__other`]);
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

const ACTION_LABEL: Record<EnrollmentAction, { en: string; tone: "default" | "jade" | "danger" }> = {
  approve: { en: "Approve", tone: "jade" },
  mark_paid: { en: "Mark paid", tone: "default" },
  mark_unpaid: { en: "Mark unpaid", tone: "default" },
  reject: { en: "Reject", tone: "danger" },
  cancel: { en: "Cancel", tone: "default" },
};

const ACTION_ORDER: EnrollmentAction[] = [
  "approve",
  "mark_paid",
  "mark_unpaid",
  "reject",
  "cancel",
];

type MenuAction = EnrollmentAction | "resend";

function RowActions({
  status,
  resending,
  onAction,
}: {
  status: EnrollmentStatus;
  resending: boolean;
  onAction: (a: MenuAction) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-7 h-7 rounded-full border border-[var(--paper-shadow)]
                   text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]
                   inline-flex items-center justify-center
                   transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="2" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="10" cy="6" r="1" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-[200px]
                     rounded-[var(--radius-md)] border border-[var(--paper-shadow)]
                     bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] p-1.5"
        >
          {RESEND_LABEL[status] ? (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={resending}
                onClick={() => {
                  setOpen(false);
                  onAction("resend");
                }}
                className="w-full text-left px-3 py-2 rounded-[var(--radius-sm)] text-[12.5px]
                           text-[var(--ink)] hover:bg-[var(--paper-deep)]
                           transition-[background-color,color] duration-[var(--dur-fast)]
                           inline-flex items-center justify-between gap-2 disabled:opacity-50"
              >
                <span>{RESEND_LABEL[status]}</span>
                {resending ? (
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
                    <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : null}
              </button>
              <div className="my-1.5 mx-2 h-px bg-[var(--paper-shadow)]/70" aria-hidden="true" />
            </>
          ) : null}
          {ACTION_ORDER.map((a) => {
            const check = canTransition(status, a);
            const disabled = !check.ok;
            const { en, tone } = ACTION_LABEL[a];
            const toneCls =
              tone === "danger"
                ? "text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)]"
                : tone === "jade"
                  ? "text-[var(--jade-deep)] hover:bg-[var(--jade-wash)]"
                  : "text-[var(--ink)] hover:bg-[var(--paper-deep)]";
            return (
              <button
                key={a}
                type="button"
                role="menuitem"
                disabled={disabled}
                title={
                  disabled && !check.ok
                    ? TRANSITION_REASON_LABEL[check.reason]?.en ?? check.reason
                    : undefined
                }
                onClick={() => {
                  setOpen(false);
                  onAction(a);
                }}
                className={`w-full text-left px-3 py-2 rounded-[var(--radius-sm)] text-[12.5px]
                            transition-[background-color,color] duration-[var(--dur-fast)]
                            ${disabled ? "opacity-40 cursor-not-allowed" : toneCls}`}
              >
                {en}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const RESEND_LABEL: Partial<Record<EnrollmentStatus, string>> = {
  approved: "Re-send payment link",
  paid: "Re-send receipt",
  rejected: "Re-send rejection",
};

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
