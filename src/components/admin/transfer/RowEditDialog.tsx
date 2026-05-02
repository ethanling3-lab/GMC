"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// Per-row admin override modal. Submits PATCH /api/admin/transfer-lists/[id]/rows/[rowId]
// and flips `admin_edited` true server-side. The row keeps its admin tweaks
// across regenerations unless the admin re-runs Generate with ?force=1.
//
// Field semantics:
//   * Vehicle           — free text; algorithm pre-fills standard labels but admin can write anything.
//   * Time (date+local) — landing time (arrivals) or hotel-departure time (departures).
//                          Round-trips through UTC components — admin enters local clock.
//   * Terminal          — empty string clears to null.
//   * Destination       — drop-off (arrival) or pickup point (departure).
//   * Remark            — multi-line; empty string clears to null.
//   * VIP               — toggles cinnabar tinting + locks the row out of consolidation
//                          on the next regenerate (algorithm side).

export type RowEditInitial = {
  id: string;
  vehicle_type: string | null;
  landing_or_takeoff_at: string | null;
  terminal: string | null;
  destination: string | null;
  remark: string | null;
  vip: boolean;
};

export function RowEditDialog({
  listId,
  row,
  direction,
}: {
  listId: string;
  row: RowEditInitial;
  direction: "arrival" | "departure";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vehicle, setVehicle] = useState(row.vehicle_type ?? "");
  const [datePart, setDatePart] = useState(toDatePart(row.landing_or_takeoff_at));
  const [timePart, setTimePart] = useState(toTimePart(row.landing_or_takeoff_at));
  const [terminal, setTerminal] = useState(row.terminal ?? "");
  const [destination, setDestination] = useState(row.destination ?? "");
  const [remark, setRemark] = useState(row.remark ?? "");
  const [vip, setVip] = useState(row.vip);

  useEffect(() => {
    if (!open) {
      setVehicle(row.vehicle_type ?? "");
      setDatePart(toDatePart(row.landing_or_takeoff_at));
      setTimePart(toTimePart(row.landing_or_takeoff_at));
      setTerminal(row.terminal ?? "");
      setDestination(row.destination ?? "");
      setRemark(row.remark ?? "");
      setVip(row.vip);
      setError(null);
      setBusy(false);
    }
  }, [open, row]);

  useBodyScrollLock(open);

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
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        vehicle_type: vehicle.trim(),
        terminal: terminal.trim() === "" ? null : terminal.trim(),
        destination: destination.trim(),
        remark: remark.trim() === "" ? null : remark.trim(),
        vip,
      };
      if (datePart && timePart) {
        body.landing_or_takeoff_at = `${datePart}T${timePart}:00.000Z`;
      }
      const res = await fetch(
        `/api/admin/transfer-lists/${listId}/rows/${row.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Save failed");
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit row"
        className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-pill)] text-[var(--ink-faint)] hover:text-[var(--cinnabar)] hover:bg-[var(--paper-deep)] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1.5l2.5 2.5L4 10.5H1.5V8z" />
        </svg>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`row-edit-${row.id}-title`}
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[440px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Override · 手动调整
              </div>
              <h2
                id={`row-edit-${row.id}-title`}
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                Edit transfer row
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                Saves your tweaks and prevents regenerate from wiping them
                unless you re-run with force.
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3">
              <Field label="Vehicle">
                <input
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  placeholder="Sedan / Regular MPV / Van (18-seater) — VIP"
                  className={inputClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    value={datePart}
                    onChange={(e) => setDatePart(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label={direction === "arrival" ? "Landing (local)" : "Hotel dep. (local)"}
                >
                  <input
                    type="time"
                    value={timePart}
                    onChange={(e) => setTimePart(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Terminal">
                  <input
                    value={terminal}
                    onChange={(e) => setTerminal(e.target.value)}
                    placeholder="T1"
                    className={inputClass}
                  />
                </Field>
                <Field label="Destination">
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={direction === "arrival" ? "St. Giles" : "St. Giles (pickup)"}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Remark">
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={2}
                  className={`${inputClass} h-auto py-2 leading-[1.5]`}
                  placeholder="Notes for logistics — special instructions, driver hints, etc."
                />
              </Field>
              <label className="inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={vip}
                  onChange={(e) => setVip(e.target.checked)}
                  className="accent-[var(--cinnabar)]"
                />
                VIP — private transfer
              </label>
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
                {busy ? "Saving…" : "Save override"}
              </button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}

const inputClass =
  "w-full h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none transition-[border-color,box-shadow]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function toDatePart(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toTimePart(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
