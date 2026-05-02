"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Add a flight for an enrolled participant directly from the transfer-list
// detail page. Mirrors the FlightInfoPanel slot form, but lets admin pick
// any approved/paid enrolment for the event without going through an inbox
// thread. Fires POST /api/admin/flight-info with confirm:true so the row
// lands ready to feed the next Generate.

export type EnrolmentOption = {
  enrollment_id: string;
  participant_label: string;       // e.g. "Lim Sheng Chi · MY100"
  region_id: string | null;
};

export function AddFlightDialog({
  enrolments,
  mainVenueName,
  designatedHotels,
}: {
  enrolments: EnrolmentOption[];
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enrolment, setEnrolment] = useState("");
  const [direction, setDirection] = useState<"arrival" | "departure">("arrival");
  const [flightNumber, setFlightNumber] = useState("");
  const [airline, setAirline] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [datePart, setDatePart] = useState("");
  const [timePart, setTimePart] = useState("");
  const [terminal, setTerminal] = useState("");
  const [hotelKey, setHotelKey] = useState("main_venue");
  const [vip, setVip] = useState(false);

  useEffect(() => {
    if (!open) {
      setEnrolment("");
      setDirection("arrival");
      setFlightNumber("");
      setAirline("");
      setOrigin("");
      setDestination("");
      setDatePart("");
      setTimePart("");
      setTerminal("");
      setHotelKey("main_venue");
      setVip(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
    if (!enrolment) {
      setError("Pick a participant.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scheduled =
        datePart && timePart ? `${datePart}T${timePart}:00.000Z` : "";
      const res = await fetch("/api/admin/flight-info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollment_id: enrolment,
          direction,
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
        disabled={enrolments.length === 0}
        title={enrolments.length === 0 ? "No approved enrolments yet" : undefined}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span aria-hidden="true">＋</span>
        Add flight
      </button>

      {!open ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-flight-title"
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
                Add flight · 添加航班
              </div>
              <h2
                id="add-flight-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                Confirm a participant's flight
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                Saved as confirmed flight info. Click Generate after to refresh
                the table.
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3">
              <Field label="Participant">
                <select
                  value={enrolment}
                  onChange={(e) => setEnrolment(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— pick one —</option>
                  {enrolments.map((e) => (
                    <option key={e.enrollment_id} value={e.enrollment_id}>
                      {e.participant_label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Direction">
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)]">
                    <input
                      type="radio"
                      name="direction"
                      value="arrival"
                      checked={direction === "arrival"}
                      onChange={() => setDirection("arrival")}
                      className="accent-[var(--cinnabar)]"
                    />
                    Arrival · 接机
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)]">
                    <input
                      type="radio"
                      name="direction"
                      value="departure"
                      checked={direction === "departure"}
                      onChange={() => setDirection("departure")}
                      className="accent-[var(--cinnabar)]"
                    />
                    Departure · 送机
                  </label>
                </div>
              </Field>
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
                {busy ? "Saving…" : "Save + confirm"}
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
