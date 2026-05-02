"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// Add a fully manual row to a transfer list — vehicle assignment that
// isn't tied to any participant or flight_info. Use cases:
//   * External pickups (driver picking up a non-participant)
//   * Driver placeholders so the Sheet shows full vehicle assignments
//   * Vendor cars with their own crew
//   * Special arrangements (early-morning pre-event run)
//
// Manual rows are persisted to transfer_list_rows with admin_edited=true,
// flight_info_ids=[], and the typed passenger names in manual_passengers.

type Passenger = { name: string; region_id: string; note: string };

export function AddManualRowDialog({
  listId,
  direction,
}: {
  listId: string;
  direction: "arrival" | "departure";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vehicle, setVehicle] = useState("");
  const [datePart, setDatePart] = useState("");
  const [timePart, setTimePart] = useState("");
  const [terminal, setTerminal] = useState("");
  const [destination, setDestination] = useState("");
  const [remark, setRemark] = useState("");
  const [vip, setVip] = useState(false);
  const [passengers, setPassengers] = useState<Passenger[]>([
    { name: "", region_id: "", note: "" },
  ]);

  useEffect(() => {
    if (!open) {
      setVehicle("");
      setDatePart("");
      setTimePart("");
      setTerminal("");
      setDestination("");
      setRemark("");
      setVip(false);
      setPassengers([{ name: "", region_id: "", note: "" }]);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function updatePassenger(i: number, patch: Partial<Passenger>) {
    setPassengers((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function addPassenger() {
    setPassengers((prev) => [...prev, { name: "", region_id: "", note: "" }]);
  }
  function removePassenger(i: number) {
    setPassengers((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i),
    );
  }

  async function submit() {
    if (busy) return;
    const validPassengers = passengers
      .map((p) => ({
        name: p.name.trim(),
        region_id: p.region_id.trim() || undefined,
        note: p.note.trim() || undefined,
      }))
      .filter((p) => p.name.length > 0);
    if (validPassengers.length === 0) {
      setError("Add at least one passenger.");
      return;
    }
    if (!vehicle.trim()) {
      setError("Vehicle is required.");
      return;
    }
    if (!datePart || !timePart) {
      setError("Date and time are required.");
      return;
    }
    if (!destination.trim()) {
      setError("Destination is required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/transfer-lists/${listId}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vehicle_type: vehicle.trim(),
          landing_or_takeoff_at: `${datePart}T${timePart}:00.000Z`,
          terminal: terminal.trim() === "" ? null : terminal.trim(),
          destination: destination.trim(),
          remark: remark.trim() === "" ? null : remark.trim(),
          vip,
          manual_passengers: validPassengers,
        }),
      });
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
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 transition-colors"
      >
        <span aria-hidden="true">＋</span>
        Add manual row
      </button>

      {!open ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-manual-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[520px] max-h-[90vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Add manual row · 手动添加
              </div>
              <h2
                id="add-manual-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                Manual {direction === "arrival" ? "arrival" : "departure"} row
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                For external pickups, driver placeholders, and special
                arrangements not tied to any participant. Survives regenerate
                until you Force.
              </p>
            </div>
            <div className="overflow-y-auto px-6 py-5 flex flex-col gap-3">
              <Field label="Vehicle">
                <input
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  placeholder="Sedan / Private MPV — external"
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
                  placeholder="vendor: GoCar / pre-event setup run"
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

              <div className="mt-1 pt-3 border-t border-[var(--paper-shadow)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                    Passengers · 乘客
                  </span>
                  <button
                    type="button"
                    onClick={addPassenger}
                    className="text-[11px] tracking-[0.04em] text-[var(--cinnabar-deep)] hover:text-[var(--cinnabar)] transition-colors"
                    style={{ color: "var(--cinnabar-deep)" }}
                  >
                    + Add passenger
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {passengers.map((p, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1.4fr_0.6fr_1fr_auto] gap-2 items-center"
                    >
                      <input
                        value={p.name}
                        onChange={(e) =>
                          updatePassenger(i, { name: e.target.value })
                        }
                        placeholder="Name"
                        className={inputClass}
                      />
                      <input
                        value={p.region_id}
                        onChange={(e) =>
                          updatePassenger(i, { region_id: e.target.value })
                        }
                        placeholder="MY100"
                        className={`${inputClass} font-mono uppercase`}
                      />
                      <input
                        value={p.note}
                        onChange={(e) =>
                          updatePassenger(i, { note: e.target.value })
                        }
                        placeholder="Note (optional)"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removePassenger(i)}
                        disabled={passengers.length === 1}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-pill)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Remove passenger"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

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
                {busy ? "Saving…" : "Add row"}
              </button>
            </div>
          </div>
        </div>
      )}
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
