"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Per-passenger pencil that opens a dialog letting an admin re-route one
// passenger out of the row they currently sit in and into either:
//   - another existing row in the same direction, or
//   - a brand-new manual row at a custom time.
//
// Hits POST /api/admin/transfer-lists/:id/rows/:sourceRowId/move-passenger.
// Both source + target rows come back stamped admin_edited=true so the next
// regenerate refuses to silently overwrite.
//
// The dialog is intentionally narrow in scope: it never edits the moved
// passenger itself (use EditFlight / EditManualPassenger for that), and it
// never re-orders pax within a row. It only changes which row a passenger
// belongs to.

export type MoveTargetOption = {
  row_id: string;
  group_no: number;
  vehicle_type: string | null;
  landing_or_takeoff_at: string | null;
  destination: string | null;
  pax_count: number;
  vip: boolean;
  is_manual: boolean;
};

export type MovePassengerSubject =
  | { kind: "real"; flight_info_id: string; label: string }
  | { kind: "manual"; manual_index: number; label: string };

export function MovePassengerDialog({
  listId,
  sourceRowId,
  sourceLabel,
  direction,
  subject,
  targets,
}: {
  listId: string;
  sourceRowId: string;
  sourceLabel: string;
  direction: "arrival" | "departure";
  subject: MovePassengerSubject;
  targets: MoveTargetOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Targets minus the source row (admin can't move into the same row).
  const eligible = useMemo(
    () => targets.filter((t) => t.row_id !== sourceRowId),
    [targets, sourceRowId],
  );

  type Choice =
    | { kind: "existing"; row_id: string }
    | { kind: "new_manual" };
  const [choice, setChoice] = useState<Choice>(() =>
    eligible.length > 0
      ? { kind: "existing", row_id: eligible[0].row_id }
      : { kind: "new_manual" },
  );

  // New-manual-row form state. Pre-filled to mirror the source row when the
  // dialog opens, so admin only edits what's actually different. The defaults
  // get derived from the matching source target row when present.
  const sourceAsTarget = targets.find((t) => t.row_id === sourceRowId);
  const [newDate, setNewDate] = useState(() =>
    splitIsoDate(sourceAsTarget?.landing_or_takeoff_at ?? null),
  );
  const [newTime, setNewTime] = useState(() =>
    splitIsoTime(sourceAsTarget?.landing_or_takeoff_at ?? null),
  );
  const [newDestination, setNewDestination] = useState(
    sourceAsTarget?.destination ?? "",
  );
  const [newVehicle, setNewVehicle] = useState("Sedan");
  const [newTerminal, setNewTerminal] = useState("");
  const [newVip, setNewVip] = useState(sourceAsTarget?.vip ?? false);

  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!open) {
      setChoice(
        eligible.length > 0
          ? { kind: "existing", row_id: eligible[0].row_id }
          : { kind: "new_manual" },
      );
      setNewDate(splitIsoDate(sourceAsTarget?.landing_or_takeoff_at ?? null));
      setNewTime(splitIsoTime(sourceAsTarget?.landing_or_takeoff_at ?? null));
      setNewDestination(sourceAsTarget?.destination ?? "");
      setNewVehicle("Sedan");
      setNewTerminal("");
      setNewVip(sourceAsTarget?.vip ?? false);
      setRemark("");
      setError(null);
      setBusy(false);
    }
  }, [open, eligible, sourceAsTarget]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (busy) return;

    let target: Record<string, unknown>;
    if (choice.kind === "existing") {
      target = { kind: "existing", row_id: choice.row_id };
    } else {
      if (!newDate || !newTime) {
        setError("Date and time are required for the new row.");
        return;
      }
      if (!newDestination.trim()) {
        setError("Destination is required.");
        return;
      }
      if (!newVehicle.trim()) {
        setError("Vehicle is required.");
        return;
      }
      target = {
        kind: "new_manual",
        vehicle_type: newVehicle.trim(),
        landing_or_takeoff_at: `${newDate}T${newTime}:00.000Z`,
        terminal: newTerminal.trim() === "" ? null : newTerminal.trim(),
        destination: newDestination.trim(),
        vip: newVip,
      };
    }

    const from =
      subject.kind === "real"
        ? { kind: "real", flight_info_id: subject.flight_info_id }
        : { kind: "manual", manual_index: subject.manual_index };

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/transfer-lists/${listId}/rows/${sourceRowId}/move-passenger`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from,
            target,
            ...(remark.trim() ? { remark: remark.trim() } : {}),
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Move failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const directionLabelEn = direction === "arrival" ? "Arrival" : "Departure";
  const directionLabelZh = direction === "arrival" ? "接机" : "送机";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Move to another row"
        aria-label="Move passenger to another row"
        className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
      >
        <span aria-hidden="true" className="text-[11px] leading-none">↕</span>
      </button>

      {!open ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-passenger-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[560px] max-h-[90vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Move passenger · 调换车辆
              </div>
              <h2
                id="move-passenger-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {subject.label}
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                {directionLabelEn} · {directionLabelZh} · currently on{" "}
                <span className="text-[var(--ink-soft)]">{sourceLabel}</span>
              </p>
            </div>

            <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  Move to · 转入
                </span>

                {eligible.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 px-3 py-3 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                    No other rows in this {directionLabelEn.toLowerCase()} list — create a new manual row below.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                    {eligible.map((t) => {
                      const selected =
                        choice.kind === "existing" && choice.row_id === t.row_id;
                      return (
                        <li key={t.row_id}>
                          <label
                            className={`flex items-start gap-3 px-3 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                              selected
                                ? "border-[var(--cinnabar)]/50 bg-[var(--paper)] shadow-[var(--shadow-focus)]"
                                : "border-[var(--paper-shadow)] bg-[var(--paper)] hover:border-[var(--cinnabar)]/30"
                            }`}
                          >
                            <input
                              type="radio"
                              name="move-target"
                              checked={selected}
                              onChange={() =>
                                setChoice({ kind: "existing", row_id: t.row_id })
                              }
                              className="mt-1 accent-[var(--cinnabar)]"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="font-mono text-[10px] tabular-nums text-[var(--cinnabar-deep)]">
                                  #{t.group_no}
                                </span>
                                <span className="text-[12px] text-[var(--ink)] truncate">
                                  {t.vehicle_type ?? "—"}
                                </span>
                                {t.vip ? (
                                  <span className="inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 text-[8.5px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
                                    VIP
                                  </span>
                                ) : null}
                                {t.is_manual ? (
                                  <span className="inline-flex items-center h-[15px] px-1 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 text-[8.5px] tracking-[0.18em] uppercase text-[var(--ink-soft)]">
                                    manual
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 flex items-baseline gap-2 flex-wrap text-[10.5px] tabular-nums text-[var(--ink-mute)]">
                                <span>
                                  {t.landing_or_takeoff_at
                                    ? formatTimeBlock(t.landing_or_takeoff_at)
                                    : "—"}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{t.destination ?? "—"}</span>
                                <span aria-hidden="true">·</span>
                                <span>{t.pax_count} pax</span>
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <label
                  className={`mt-1 flex items-start gap-3 px-3 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                    choice.kind === "new_manual"
                      ? "border-[var(--cinnabar)]/50 bg-[var(--paper)] shadow-[var(--shadow-focus)]"
                      : "border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 hover:border-[var(--cinnabar)]/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="move-target"
                    checked={choice.kind === "new_manual"}
                    onChange={() => setChoice({ kind: "new_manual" })}
                    className="mt-1 accent-[var(--cinnabar)]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[var(--ink)]">
                      Create new manual row at custom time
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-[var(--ink-mute)]">
                      A fresh row at the bottom of this {directionLabelEn.toLowerCase()} list.
                    </div>
                  </div>
                </label>

                {choice.kind === "new_manual" ? (
                  <div className="mt-2 px-3 pt-3 pb-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]/80 flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Date">
                        <input
                          type="date"
                          value={newDate}
                          onChange={(e) => setNewDate(e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                      <Field
                        label={
                          direction === "arrival"
                            ? "Landing (local)"
                            : "Hotel dep. (local)"
                        }
                      >
                        <input
                          type="time"
                          value={newTime}
                          onChange={(e) => setNewTime(e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Vehicle">
                        <input
                          value={newVehicle}
                          onChange={(e) => setNewVehicle(e.target.value)}
                          placeholder="Sedan"
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Terminal">
                        <input
                          value={newTerminal}
                          onChange={(e) => setNewTerminal(e.target.value)}
                          placeholder="T1"
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Destination" className="col-span-2">
                        <input
                          value={newDestination}
                          onChange={(e) => setNewDestination(e.target.value)}
                          placeholder={
                            direction === "arrival"
                              ? "St. Giles"
                              : "St. Giles (pickup)"
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                      <input
                        type="checkbox"
                        checked={newVip}
                        onChange={(e) => setNewVip(e.target.checked)}
                        className="accent-[var(--cinnabar)]"
                      />
                      VIP — private transfer
                    </label>
                  </div>
                ) : null}
              </div>

              <Field label="Remark · 备注 (optional)">
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={2}
                  className={`${inputClass} h-auto py-2 leading-[1.5]`}
                  placeholder={
                    choice.kind === "existing"
                      ? "Appended to target row's remark"
                      : "Saved as the new row's remark"
                  }
                />
              </Field>

              {error ? (
                <div className="text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                {busy ? "Moving…" : "Move passenger"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function splitIsoDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function splitIsoTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimeBlock(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} · ${hh}${mm}`;
}

const inputClass =
  "w-full h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none transition-[border-color,box-shadow]";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
