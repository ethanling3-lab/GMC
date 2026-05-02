"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// Add a flight for an enrolled participant directly from the transfer-list
// detail page. Mirrors the FlightInfoPanel slot form, but lets admin pick
// any approved/paid enrolment for the event without going through an inbox
// thread. Fires POST /api/admin/flight-info with confirm:true so the row
// lands ready to feed the next Generate.
//
// The picker is a typeahead: admin types name / region_id / phone fragment,
// results sort with no-flight-yet first (for the chosen direction), then
// already-has-flight at the bottom (dimmed + badge). Picking an enrolment
// that already has a flight means the new save will OVERWRITE that flight
// (upsert key is enrollment_id+direction), so the badge doubles as a
// "you're about to overwrite" cue.

export type EnrolmentOption = {
  enrollment_id: string;
  participant_label: string;       // e.g. "Lim Sheng Chi · MY100"
  name_en: string | null;
  name_cn: string | null;
  region_id: string | null;
  has_arrival_flight: boolean;
  has_departure_flight: boolean;
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
  const [query, setQuery] = useState("");
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
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setEnrolment("");
      setQuery("");
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
    } else {
      // Autofocus the search box when the dialog opens.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const selectedEnrolment = enrolments.find(
    (e) => e.enrollment_id === enrolment,
  );

  const filteredEnrolments = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = enrolments.filter((e) => {
      if (!q) return true;
      return (
        (e.name_en ?? "").toLowerCase().includes(q) ||
        (e.name_cn ?? "").toLowerCase().includes(q) ||
        (e.region_id ?? "").toLowerCase().includes(q)
      );
    });
    // Sort: no-flight-yet for the chosen direction first, then those who
    // already have a flight (dimmed). Within each bucket, alphabetical.
    return filtered.slice().sort((a, b) => {
      const aHas = direction === "arrival" ? a.has_arrival_flight : a.has_departure_flight;
      const bHas = direction === "arrival" ? b.has_arrival_flight : b.has_departure_flight;
      if (aHas !== bHas) return aHas ? 1 : -1;
      const an = (a.name_en || a.name_cn || "").toLowerCase();
      const bn = (b.name_en || b.name_cn || "").toLowerCase();
      return an.localeCompare(bn);
    });
  }, [enrolments, query, direction]);

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

      {open && typeof document !== "undefined"
        ? createPortal(
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
                {selectedEnrolment ? (
                  <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/30">
                    <span className="text-[12.5px] text-[var(--ink)] truncate">
                      {selectedEnrolment.participant_label}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEnrolment("");
                        setQuery("");
                        requestAnimationFrame(() => searchRef.current?.focus());
                      }}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper)]/60 transition-colors"
                      aria-label="Clear selection"
                      title="Clear selection"
                    >
                      <span aria-hidden="true" className="text-[12px] leading-none">✕</span>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search name or region ID…"
                      className={inputClass}
                    />
                    <div className="mt-1 max-h-[180px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]">
                      {filteredEnrolments.length === 0 ? (
                        <div className="px-3 py-4 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                          No matches.{" "}
                          <span className="text-[var(--ink-faint)]">
                            Not enrolled? Close this dialog and use{" "}
                            <strong className="text-[var(--ink-soft)]">+ Add manual row</strong>{" "}
                            instead.
                          </span>
                        </div>
                      ) : (
                        <ul>
                          {filteredEnrolments.map((opt) => {
                            const has =
                              direction === "arrival"
                                ? opt.has_arrival_flight
                                : opt.has_departure_flight;
                            return (
                              <li key={opt.enrollment_id}>
                                <button
                                  type="button"
                                  onClick={() => setEnrolment(opt.enrollment_id)}
                                  className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 hover:bg-[var(--paper-deep)]/60 focus:bg-[var(--paper-deep)]/60 focus:outline-none transition-colors"
                                >
                                  <span
                                    className={`flex items-center gap-2 truncate ${has ? "text-[var(--ink-mute)]" : "text-[var(--ink)]"}`}
                                  >
                                    {opt.region_id ? (
                                      <span className="font-mono text-[10px] text-[var(--cinnabar-deep)] tabular-nums">
                                        {opt.region_id}
                                      </span>
                                    ) : null}
                                    <span className="text-[12px] truncate">
                                      {opt.name_en || opt.name_cn || "—"}
                                    </span>
                                  </span>
                                  {has ? (
                                    <span
                                      title="Already has a flight for this direction — saving will overwrite"
                                      className="inline-flex items-center h-[16px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[8.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] whitespace-nowrap"
                                    >
                                      has flight
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
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
