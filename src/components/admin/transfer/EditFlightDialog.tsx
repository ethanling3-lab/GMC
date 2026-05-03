"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

// Pencil-triggered edit for a single flight_info row, opened from the
// transfer-list detail page. Locks participant + direction (those are the
// upsert key and changing them belongs in the inbox panel / Add flight
// dialog). Hits POST /api/admin/flight-info with confirm:true so the row
// stays "ready" after save.

export type EditFlightInitial = {
  enrollment_id: string;
  direction: "arrival" | "departure";
  participant_label: string;
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
};

export function EditFlightDialog({
  initial,
  mainVenueName,
  designatedHotels,
}: {
  initial: EditFlightInitial;
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [flightNumber, setFlightNumber] = useState(initial.flight_number ?? "");
  const [airline, setAirline] = useState(initial.airline ?? "");
  const [origin, setOrigin] = useState(initial.origin_airport ?? "");
  const [destination, setDestination] = useState(initial.destination_airport ?? "");
  const [datePart, setDatePart] = useState(() => splitIsoDate(initial.scheduled_at));
  const [timePart, setTimePart] = useState(() => splitIsoTime(initial.scheduled_at));
  const [terminal, setTerminal] = useState(initial.terminal ?? "");
  const [hotelKey, setHotelKey] = useState(initial.hotel_key ?? "main_venue");
  const [vip, setVip] = useState(initial.is_vip);

  useEffect(() => {
    if (!open) {
      setFlightNumber(initial.flight_number ?? "");
      setAirline(initial.airline ?? "");
      setOrigin(initial.origin_airport ?? "");
      setDestination(initial.destination_airport ?? "");
      setDatePart(splitIsoDate(initial.scheduled_at));
      setTimePart(splitIsoTime(initial.scheduled_at));
      setTerminal(initial.terminal ?? "");
      setHotelKey(initial.hotel_key ?? "main_venue");
      setVip(initial.is_vip);
      setError(null);
      setBusy(false);
    }
  }, [open, initial]);

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
      const scheduled =
        datePart && timePart ? `${datePart}T${timePart}:00.000Z` : "";
      const res = await fetch("/api/admin/flight-info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollment_id: initial.enrollment_id,
          direction: initial.direction,
          flight_number: flightNumber.trim() || undefined,
          airline: airline.trim() || undefined,
          origin_airport: origin.trim().toUpperCase() || undefined,
          destination_airport: destination.trim().toUpperCase() || undefined,
          scheduled_at: scheduled,
          terminal: terminal.trim() || undefined,
          hotel_key: hotelKey || undefined,
          is_vip: vip,
          confirm: true,
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

  const hotelOptions: Array<{ key: string; label: string }> = [
    {
      key: "main_venue",
      label: mainVenueName ? `Main · ${mainVenueName}` : "Main venue",
    },
    ...Object.entries(designatedHotels).map(([k, v]) => ({
      key: `designated:${k}`,
      label: `Designated · ${v}`,
    })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit flight"
        aria-label="Edit flight"
        className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 transition-colors"
      >
        <span aria-hidden="true" className="text-[11px] leading-none">✎</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-flight-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[480px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                Edit flight · 修改航班
              </div>
              <h2
                id="edit-flight-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {initial.participant_label}
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                {initial.direction === "arrival" ? "Arrival · 接机" : "Departure · 送机"}
                {" · saved as confirmed. Click Generate after to refresh the table."}
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Flight #">
                  <input
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="AK6412"
                    className={inputClass}
                  />
                </Field>
                <Field label="Airline">
                  <input
                    value={airline}
                    onChange={(e) => setAirline(e.target.value)}
                    placeholder="AirAsia"
                    className={inputClass}
                  />
                </Field>
                <Field label="From (IATA)">
                  <input
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                    maxLength={3}
                    placeholder="JHB"
                    className={`${inputClass} uppercase tabular-nums`}
                  />
                </Field>
                <Field label="To (IATA)">
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value.toUpperCase())}
                    maxLength={3}
                    placeholder="PEN"
                    className={`${inputClass} uppercase tabular-nums`}
                  />
                </Field>
                <Field label="Date">
                  <input
                    type="date"
                    value={datePart}
                    onChange={(e) => setDatePart(e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Time (local)">
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
                <Field label="Hotel">
                  <select
                    value={hotelKey}
                    onChange={(e) => setHotelKey(e.target.value)}
                    className={inputClass}
                  >
                    {hotelOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={vip}
                  onChange={(e) => setVip(e.target.checked)}
                  className="accent-[var(--cinnabar)]"
                />
                VIP — private Luxury MPV
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
                {busy ? "Saving…" : "Save"}
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
