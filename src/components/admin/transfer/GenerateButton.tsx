"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Pre-generation confirm dialog ensures admin sees which rules are about to
// apply (per-event override merged over defaults) plus the confirmed-flight
// count. Avoids the silent-default-rules trap where a generator quietly uses
// a 12:00 coach pickup that wasn't appropriate for this event.
// Manual edits are kept unless the admin explicitly chooses to discard them.

type EffectiveRules = {
  consolidation_window_minutes: number;
  departure_lead_hours: number;
  coach_cutoff_hour_local: number;
  coach_hotel_departure_local: string;
  coach_rule_enabled: boolean;
  oversize_strategy: "split" | "bus";
  other_hotel_pickup: "own" | "main";
};

export function GenerateButton({
  eventId,
  direction,
  hasExisting,
  hasFlights,
  variant = "primary",
  effectiveRules,
  confirmedFlightCount,
  leftOut = [],
  editedCount = 0,
}: {
  eventId: string;
  direction: "arrival" | "departure";
  hasExisting: boolean;
  hasFlights: boolean;
  variant?: "primary" | "ghost";
  effectiveRules: EffectiveRules;
  confirmedFlightCount: number;
  /** People with a confirmed flight but no time, who can't be given a vehicle. */
  leftOut?: string[];
  /** Vehicle groups on this list that staff have edited. */
  editedCount?: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [coachEnabled, setCoachEnabled] = useState(effectiveRules.coach_rule_enabled);
  const [oversize, setOversize] = useState(effectiveRules.oversize_strategy);
  const [editsChoice, setEditsChoice] = useState<"keep" | "discard">("keep");
  const [otherPickup, setOtherPickup] = useState(effectiveRules.other_hotel_pickup);

  useEffect(() => {
    if (!confirmOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  async function fire() {
    setBusy(true);
    setError(null);
    try {
      const force = editedCount > 0 && editsChoice === "discard";
      const url = `/api/admin/transfer-lists${force ? "?force=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          direction,
          rules: {
            oversize_strategy: oversize,
            ...(direction === "departure"
              ? { coach_rule_enabled: coachEnabled, other_hotel_pickup: otherPickup }
              : {}),
          },
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Generate failed");
        return;
      }
      setConfirmOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? hasExisting
      ? "Regenerating…"
      : "Generating…"
    : hasExisting
      ? "Regenerate"
      : "Generate";

  const cls =
    variant === "primary"
      ? "inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      : "inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy || !hasFlights}
        onClick={() => {
          setCoachEnabled(effectiveRules.coach_rule_enabled);
          setOversize(effectiveRules.oversize_strategy);
          setEditsChoice("keep");
          setOtherPickup(effectiveRules.other_hotel_pickup);
          setConfirmOpen(true);
        }}
        className={cls}
        title={!hasFlights ? "No confirmed flights for this direction yet" : undefined}
      >
        {label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--cinnabar-deep)]">{error}</span>
      ) : null}

      {/* Pre-generation confirm dialog */}
      {!confirmOpen ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gen-confirm-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setConfirmOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[480px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Confirm rules · 确认规则
              </div>
              <h2
                id="gen-confirm-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {hasExisting ? "Regenerate" : "Generate"} {direction === "arrival" ? "arrival" : "departure"} list
              </h2>
              <p className="mt-1.5 text-[12px] text-[var(--ink-mute)] leading-[1.55]">
                <strong className="text-[var(--ink)] tabular-nums">{confirmedFlightCount}</strong>{" "}
                confirmed {direction} flight{confirmedFlightCount === 1 ? "" : "s"}.
                Review the rules below before generating.
              </p>
            </div>

            <div className="px-6 py-5 flex flex-col gap-2">
              {leftOut.length > 0 ? (
                <div
                  role="alert"
                  className="mb-1 rounded-[var(--radius-md)] border border-[#A87A2A]/40 bg-[#A87A2A]/10 px-3 py-2.5 text-[12px] leading-[1.55] text-[#5F4312]"
                >
                  <strong className="font-semibold">
                    {`${leftOut.length} ${leftOut.length === 1 ? "person" : "people"} won't get a vehicle`}
                  </strong>{" "}
                  because their flight has no time: {leftOut.join(", ")}.
                </div>
              ) : null}
              <RuleRow label="Consolidation window" value={`${effectiveRules.consolidation_window_minutes} min`} />
              <RuleRow label="Departure lead time" value={`${effectiveRules.departure_lead_hours} hours`} />
              <ChoiceRow
                label="Groups over 14 pax"
                value={oversize}
                onChange={setOversize}
                disabled={busy}
                options={[
                  { value: "split", label: "Split into vehicles" },
                  { value: "bus", label: "45-seater bus" },
                ]}
              />
              {direction === "departure" ? (
                <ChoiceRow
                  label={`Shared coach at ${effectiveRules.coach_hotel_departure_local} for flights from ${effectiveRules.coach_cutoff_hour_local}:00`}
                  value={coachEnabled ? "on" : "off"}
                  onChange={(v) => setCoachEnabled(v === "on")}
                  disabled={busy}
                  options={[
                    { value: "on", label: "Use coach" },
                    { value: "off", label: "No coach" },
                  ]}
                />
              ) : null}
              {direction === "departure" ? (
                <ChoiceRow
                  label="Pick up guests at other hotels from"
                  value={otherPickup}
                  onChange={setOtherPickup}
                  disabled={busy}
                  options={[
                    { value: "own", label: "Their hotel" },
                    { value: "main", label: "Main venue" },
                  ]}
                />
              ) : null}
              {editedCount > 0 ? (
                <ChoiceRow
                  label={`${editedCount} manually edited vehicle ${editedCount === 1 ? "group" : "groups"}`}
                  value={editsChoice}
                  onChange={setEditsChoice}
                  disabled={busy}
                  options={[
                    { value: "keep", label: "Keep my edits" },
                    { value: "discard", label: "Discard edits" },
                  ]}
                />
              ) : null}
              <Link
                href={`/admin/events/${eventId}`}
                className="self-start mt-2 inline-flex items-center gap-1 text-[11.5px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
                style={{ color: "var(--cinnabar-deep)" }}
              >
                Edit rules in event editor
                <span aria-hidden="true">↗</span>
              </Link>
              {error ? (
                <div className="mt-2 text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={fire}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                {busy ? "Generating…" : "Confirm + generate"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function ChoiceRow<T extends string>({
  label,
  value,
  onChange,
  disabled,
  options,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  disabled: boolean;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset className="px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--paper)]">
      <legend className="float-left w-full mb-2 text-[12px] leading-[1.4] text-[var(--ink-soft)]">
        {label}
      </legend>
      <div className="clear-both grid grid-cols-2 gap-1.5">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={`min-h-8 px-2 rounded-[var(--radius-sm)] border text-[12px] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,border-color,color,transform] ${
                selected
                  ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] font-medium"
                  : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--ink)]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function RuleRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "active" | "muted";
}) {
  const valueCls =
    tone === "muted"
      ? "text-[var(--ink-mute)]"
      : "text-[var(--ink)]";
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--paper)]">
      <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      <span className={`text-[12px] tabular-nums ${valueCls}`}>{value}</span>
    </div>
  );
}
