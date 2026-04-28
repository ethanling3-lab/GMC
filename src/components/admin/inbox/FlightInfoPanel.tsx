"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type {
  FlightInfoEnrollmentRow,
  FlightInfoSlot,
} from "@/lib/inbox/flight-info-query";

// Compact right-rail panel for editing flight_info per enrollment + direction.
// Shows one card per enrollment whose event needs transfer logistics, with
// arrival + departure slots side by side. Each slot is collapsed until the
// admin clicks Edit; saving fires POST /api/admin/inbox/[id]/flight-info.

type Direction = "arrival" | "departure";

export function FlightInfoPanel({
  conversationId,
  rows,
}: {
  conversationId: string;
  rows: FlightInfoEnrollmentRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
        <div className="px-5 py-5">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Flight info · 航班信息
          </div>
          <p className="mt-3 text-[12px] leading-[1.6] text-[var(--ink-mute)]">
            No travel-relevant enrolments. Flights only show here for events
            with an arrival or departure day set.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
      <div className="px-5 pt-5 pb-2">
        <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
          <span className="w-4 h-px bg-current" />
          Flight info · 航班信息
        </div>
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.enrollment_id} className="border-t border-[var(--paper-shadow)] first:border-t-0">
            <EnrollmentBlock conversationId={conversationId} row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnrollmentBlock({
  conversationId,
  row,
}: {
  conversationId: string;
  row: FlightInfoEnrollmentRow;
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12.5px] text-[var(--ink)] leading-[1.3] truncate">
        {row.event_title}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        {row.arrival_day ? <span>ARR {short(row.arrival_day)}</span> : null}
        {row.departure_day ? <span>DEP {short(row.departure_day)}</span> : null}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Slot
          conversationId={conversationId}
          enrollmentId={row.enrollment_id}
          direction="arrival"
          slot={row.arrival}
          mainVenueName={row.main_venue_hotel_name}
          designatedHotels={row.designated_hotels}
        />
        <Slot
          conversationId={conversationId}
          enrollmentId={row.enrollment_id}
          direction="departure"
          slot={row.departure}
          mainVenueName={row.main_venue_hotel_name}
          designatedHotels={row.designated_hotels}
        />
      </div>
    </div>
  );
}

function Slot({
  conversationId,
  enrollmentId,
  direction,
  slot,
  mainVenueName,
  designatedHotels,
}: {
  conversationId: string;
  enrollmentId: string;
  direction: Direction;
  slot: FlightInfoSlot;
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const filled = Boolean(slot.id);
  const confirmed = Boolean(slot.confirmed_at);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]">
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--paper-deep)] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full ${
              confirmed
                ? "bg-[#5b9a5d]"
                : filled
                  ? "bg-[var(--gold)]"
                  : "bg-[var(--paper-shadow)]"
            }`}
          />
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {direction === "arrival" ? "ARR" : "DEP"}
          </span>
          <span className="text-[12px] text-[var(--ink-soft)] truncate">
            {filled
              ? `${slot.flight_number ?? "????"} · ${slot.origin_airport ?? "?"}→${slot.destination_airport ?? "?"}${slot.scheduled_at ? ` · ${formatHHMM(slot.scheduled_at)}` : ""}`
              : "Not set"}
          </span>
          {slot.is_vip ? (
            <span className="inline-flex items-center h-[16px] px-1 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 text-[9px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
              VIP
            </span>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className={`text-[var(--ink-faint)] transition-transform duration-[var(--dur-fast)] ${editing ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {editing ? (
        <SlotForm
          conversationId={conversationId}
          enrollmentId={enrollmentId}
          direction={direction}
          slot={slot}
          mainVenueName={mainVenueName}
          designatedHotels={designatedHotels}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function SlotForm({
  conversationId,
  enrollmentId,
  direction,
  slot,
  mainVenueName,
  designatedHotels,
  onClose,
}: {
  conversationId: string;
  enrollmentId: string;
  direction: Direction;
  slot: FlightInfoSlot;
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "confirm" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [flightNumber, setFlightNumber] = useState(slot.flight_number ?? "");
  const [airline, setAirline] = useState(slot.airline ?? "");
  const [origin, setOrigin] = useState(slot.origin_airport ?? "");
  const [destination, setDestination] = useState(slot.destination_airport ?? "");
  const [datePart, setDatePart] = useState(toDatePart(slot.scheduled_at));
  const [timePart, setTimePart] = useState(toTimePart(slot.scheduled_at));
  const [terminal, setTerminal] = useState(slot.terminal ?? "");
  const [hotelKey, setHotelKey] = useState(slot.hotel_key ?? "");
  const [isVip, setIsVip] = useState(slot.is_vip);

  async function submit(action: "save" | "confirm") {
    setBusy(action);
    setError(null);
    try {
      const scheduled =
        datePart && timePart
          ? `${datePart}T${timePart}:00.000Z`
          : "";
      const res = await fetch(
        `/api/admin/inbox/${conversationId}/flight-info`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollment_id: enrollmentId,
            direction,
            flight_number: flightNumber.trim() || undefined,
            airline: airline.trim() || undefined,
            origin_airport: origin.trim().toUpperCase() || undefined,
            destination_airport: destination.trim().toUpperCase() || undefined,
            scheduled_at: scheduled,
            terminal: terminal.trim() || undefined,
            hotel_key: hotelKey.trim() || undefined,
            is_vip: isVip,
            confirm: action === "confirm",
          }),
        },
      );
      const json = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Save failed");
        return;
      }
      startTransition(() => router.refresh());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!slot.id) return;
    setBusy("delete");
    setError(null);
    try {
      const url = `/api/admin/inbox/${conversationId}/flight-info?enrollment_id=${enrollmentId}&direction=${direction}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Delete failed");
        return;
      }
      startTransition(() => router.refresh());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  const hotelOptions: Array<{ key: string; label: string }> = [
    { key: "", label: "—" },
    { key: "main_venue", label: mainVenueName ? `Main · ${mainVenueName}` : "Main venue" },
    ...Object.entries(designatedHotels).map(([k, v]) => ({
      key: `designated:${k}`,
      label: `Designated · ${v}`,
    })),
  ];

  return (
    <div className="px-3 pb-3 pt-1 border-t border-[var(--paper-shadow)] flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
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
              <option key={o.key || "none"} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="inline-flex items-center gap-2 text-[11px] tracking-[0.04em] text-[var(--ink-soft)]">
        <input
          type="checkbox"
          checked={isVip}
          onChange={(e) => setIsVip(e.target.checked)}
          className="accent-[var(--cinnabar)]"
        />
        VIP — private Luxury MPV
      </label>
      {error ? (
        <div className="text-[11px] text-[var(--cinnabar-deep)]">{error}</div>
      ) : null}
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => submit("save")}
          className="inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 disabled:opacity-50 transition-colors"
        >
          {busy === "save" ? "…" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => submit("confirm")}
          className="inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[10.5px] tracking-[0.12em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
        >
          {busy === "confirm" ? "…" : slot.confirmed_at ? "Re-confirm" : "Confirm"}
        </button>
        {slot.id ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={remove}
            className="ml-auto inline-flex items-center h-7 px-2 text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
          >
            {busy === "delete" ? "…" : "Delete"}
          </button>
        ) : null}
      </div>
      {slot.confirmed_at ? (
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">
          Confirmed {new Date(slot.confirmed_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full h-7 px-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[12px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none transition-[border-color,box-shadow]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function short(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function toDatePart(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTimePart(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
