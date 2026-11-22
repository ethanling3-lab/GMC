"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HotelSelect } from "./HotelSelect";

// The one place to add or change a participant's flight. Choosing someone who
// already has a flight loads it for that direction. The pencil on a list row
// opens this same editor through EDIT_FLIGHT_EVENT, so the page needs only one
// copy of the participant list.

type Direction = "arrival" | "departure";

export type FlightDetails = {
  flight_number: string | null;
  airline: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_at: string | null;
  terminal: string | null;
  hotel_key: string | null;
  is_vip: boolean;
  confirmed: boolean;
};

export type EnrolmentOption = {
  enrollment_id: string;
  participant_label: string; // e.g. "Lim Sheng Chi · MY100"
  name_en: string | null;
  name_cn: string | null;
  region_id: string | null;
  arrival_flight: FlightDetails | null;
  departure_flight: FlightDetails | null;
};

type EditFlightDetail = {
  enrollment_id: string;
  direction: Direction;
  participant_label: string;
  flight: FlightDetails | null;
};

const EDIT_FLIGHT_EVENT = "gmc:edit-flight";

type FormState = {
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  terminal: string;
  hotelKey: string;
  vip: boolean;
};

const BLANK: FormState = {
  flightNumber: "",
  airline: "",
  origin: "",
  destination: "",
  date: "",
  time: "",
  terminal: "",
  hotelKey: "main_venue",
  vip: false,
};

function formFrom(f: FlightDetails): FormState {
  const d = f.scheduled_at ? new Date(f.scheduled_at) : null;
  const valid = d && !Number.isNaN(d.getTime());
  return {
    flightNumber: f.flight_number ?? "",
    airline: f.airline ?? "",
    origin: f.origin_airport ?? "",
    destination: f.destination_airport ?? "",
    // Flight times are stored as local clock values in the UTC fields.
    date: valid ? d.toISOString().slice(0, 10) : "",
    time: valid ? d.toISOString().slice(11, 16) : "",
    terminal: f.terminal ?? "",
    hotelKey: f.hotel_key ?? "main_venue",
    vip: f.is_vip,
  };
}

const flightOf = (o: EnrolmentOption | undefined, dir: Direction) =>
  (dir === "arrival" ? o?.arrival_flight : o?.departure_flight) ?? null;

type TransferResult = {
  list: "unchanged" | "none" | "final" | "error" | "updated";
  outcome?: "stayed" | "combined" | "new_pickup" | "removed";
  group_no?: number | null;
  vehicle?: string | null;
};

function transferNotice(name: string, t: TransferResult | undefined): string {
  const group = t?.group_no ? `Group ${t.group_no}` : "the list";
  const vehicle = t?.vehicle ? ` (${t.vehicle})` : "";
  switch (t?.list) {
    case "unchanged":
      return `No changes to save for ${name}.`;
    case "final":
      return `Saved. This list is final, so ${name}'s vehicle wasn't changed. Move it to draft to apply.`;
    case "error":
      return `Saved, but the list couldn't update. Click Regenerate.`;
    case "updated":
      if (t.outcome === "combined") return `Saved. ${name} now shares ${group}${vehicle}.`;
      if (t.outcome === "new_pickup") return `Saved. ${name} needs a new pickup: ${group}${vehicle}.`;
      if (t.outcome === "removed") return `Saved. ${name} is no longer on this list.`;
      return `Saved. ${name} stays in ${group}${vehicle}.`;
    default:
      return `Saved. Generate the list to give ${name} a vehicle.`;
  }
}

export function openFlightEditor(detail: EditFlightDetail) {
  window.dispatchEvent(new CustomEvent(EDIT_FLIGHT_EVENT, { detail }));
}

function reviewNotice(r: {
  flagged?: boolean;
  vip_requested?: boolean;
  flag_failed?: boolean;
}): string {
  if (r.flag_failed) return " The admin couldn't be flagged, so please tell them directly.";
  if (r.vip_requested && r.flagged) return " Change flagged and VIP request sent to an admin.";
  if (r.vip_requested) return " VIP request sent to an admin.";
  if (r.flagged) return " Change flagged for an admin.";
  return "";
}

export function EditFlightButton(detail: EditFlightDetail) {
  return (
    <button
      type="button"
      onClick={() => openFlightEditor(detail)}
      title="Edit flight"
      aria-label={`Edit flight for ${detail.participant_label}`}
      className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper-deep)]/60 focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[background-color,color,transform]"
    >
      <span aria-hidden="true" className="text-[11px] leading-none">✎</span>
    </button>
  );
}

export function FlightEditorDialog({
  enrolments,
  mainVenueName,
  designatedHotels,
  canSetVip = true,
}: {
  enrolments: EnrolmentOption[];
  mainVenueName: string | null;
  designatedHotels: Record<string, string>;
  /** Without this, ticking VIP asks an admin to approve it. */
  canSetVip?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<Direction>("arrival");
  const [form, setForm] = useState<FormState>(BLANK);
  // A row can outlive its registration (e.g. cancelled, list not regenerated).
  const [rowOption, setRowOption] = useState<EnrolmentOption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 10000);
    return () => clearTimeout(t);
  }, [notice]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const selected =
    enrolments.find((e) => e.enrollment_id === enrolment) ??
    (rowOption?.enrollment_id === enrolment ? rowOption : undefined);
  const existing = flightOf(selected, direction);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setEnrolment("");
    setQuery("");
    setDirection("arrival");
    setForm(BLANK);
    setRowOption(null);
    setError(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    function onEdit(e: Event) {
      const d = (e as CustomEvent<EditFlightDetail>).detail;
      const known = enrolments.find((o) => o.enrollment_id === d.enrollment_id);
      setRowOption(
        known
          ? null
          : {
              enrollment_id: d.enrollment_id,
              participant_label: d.participant_label,
              name_en: null,
              name_cn: null,
              region_id: null,
              arrival_flight: d.direction === "arrival" ? d.flight : null,
              departure_flight: d.direction === "departure" ? d.flight : null,
            },
      );
      setEnrolment(d.enrollment_id);
      setDirection(d.direction);
      const saved = flightOf(known, d.direction) ?? d.flight;
      setForm(saved ? formFrom(saved) : BLANK);
      setError(null);
      setOpen(true);
    }
    window.addEventListener(EDIT_FLIGHT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_FLIGHT_EVENT, onEdit);
  }, [enrolments]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndReset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeAndReset]);

  function choose(option: EnrolmentOption) {
    const saved = flightOf(option, direction);
    setEnrolment(option.enrollment_id);
    // Keep anything typed for a new flight; a saved flight always wins.
    if (saved) setForm(formFrom(saved));
    setError(null);
  }

  function changeDirection(next: Direction) {
    if (next === direction) return;
    const saved = flightOf(selected, next);
    if (saved) setForm(formFrom(saved));
    else if (existing) setForm(BLANK);
    setDirection(next);
    setError(null);
  }

  function clearParticipant() {
    if (existing) setForm(BLANK);
    setEnrolment("");
    setRowOption(null);
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  const filteredEnrolments = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = enrolments.filter(
      (e) =>
        !q ||
        (e.name_en ?? "").toLowerCase().includes(q) ||
        (e.name_cn ?? "").toLowerCase().includes(q) ||
        (e.region_id ?? "").toLowerCase().includes(q),
    );
    // People still needing this direction first, then those who have it.
    return filtered.slice().sort((a, b) => {
      const aHas = Boolean(flightOf(a, direction));
      const bHas = Boolean(flightOf(b, direction));
      if (aHas !== bHas) return aHas ? 1 : -1;
      const an = (a.name_en || a.name_cn || "").toLowerCase();
      const bn = (b.name_en || b.name_cn || "").toLowerCase();
      return an.localeCompare(bn);
    });
  }, [enrolments, query, direction]);

  async function submit() {
    if (busy) return;
    if (!enrolment) {
      setError("Pick a participant.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/flight-info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollment_id: enrolment,
          direction,
          flight_number: form.flightNumber.trim() || undefined,
          airline: form.airline.trim() || undefined,
          origin_airport: form.origin.trim().toUpperCase() || undefined,
          destination_airport: form.destination.trim().toUpperCase() || undefined,
          scheduled_at:
            form.date && form.time ? `${form.date}T${form.time}:00.000Z` : "",
          terminal: form.terminal.trim() || undefined,
          hotel_key: form.hotelKey || undefined,
          is_vip: form.vip,
          confirm: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        transfer?: TransferResult;
        flagged?: boolean;
        vip_requested?: boolean;
        flag_failed?: boolean;
      };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Save failed");
        setBusy(false);
        return;
      }
      setNotice(
        transferNotice(
          (selected?.participant_label ?? "Passenger").split(" · ")[0],
          json.transfer,
        ) + reviewNotice(json),
      );
      closeAndReset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  const directionLabel = direction === "arrival" ? "arrival" : "departure";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={enrolments.length === 0}
        title={enrolments.length === 0 ? "No approved enrolments yet" : undefined}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-[border-color,color,transform]"
      >
        <span aria-hidden="true">＋</span>
        Add / edit flight
      </button>

      {notice ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,520px)] flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-4 py-3 text-[13px] leading-[1.5] text-[var(--ink)] shadow-[var(--shadow-paper-2)]"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 w-6 h-6 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[background-color,color,transform]"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ) : null}

      {!open ? null : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="flight-editor-title"
        >
          <div
            className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
            onClick={() => !busy && closeAndReset()}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[480px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
            <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
              <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                <span className="w-4 h-px bg-current" />
                {existing ? "Edit flight · 修改航班" : "Add flight · 添加航班"}
              </div>
              <h2
                id="flight-editor-title"
                className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
              >
                {selected?.participant_label ?? "Choose a participant"}
              </h2>
              <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
                {!selected
                  ? "If they already have a flight, it opens here to check and change."
                  : existing
                    ? `${existing.confirmed ? "Saved" : "Draft"} ${directionLabel} flight loaded. Save a change and their transport updates automatically.`
                    : `No ${directionLabel} flight yet. Saving confirms it and places them on the list.`}
              </p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3">
              <Field label="Participant">
                {selected ? (
                  <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/30">
                    <span className="text-[12.5px] text-[var(--ink)] truncate">
                      {selected.participant_label}
                    </span>
                    <button
                      type="button"
                      onClick={clearParticipant}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--paper)]/60 focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[background-color,color,transform]"
                      aria-label="Choose a different participant"
                      title="Choose a different participant"
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
                            Not enrolled? Close this and use{" "}
                            <strong className="text-[var(--ink-soft)]">+ Add manual row</strong>.
                          </span>
                        </div>
                      ) : (
                        <ul>
                          {filteredEnrolments.map((opt) => {
                            const has = Boolean(flightOf(opt, direction));
                            return (
                              <li key={opt.enrollment_id}>
                                <button
                                  type="button"
                                  onClick={() => choose(opt)}
                                  className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 hover:bg-[var(--paper-deep)]/60 focus:bg-[var(--paper-deep)]/60 focus:outline-none active:bg-[var(--paper-deep)] transition-colors"
                                >
                                  <span className="flex items-center gap-2 truncate text-[var(--ink)]">
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
                                    <span className="inline-flex items-center h-[16px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/40 bg-[var(--gold-soft)] text-[8.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] whitespace-nowrap">
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
              <div className="flex flex-col gap-1">
                <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
                  Direction
                </span>
                <div className="flex items-center gap-3">
                  {(["arrival", "departure"] as const).map((d) => (
                    <label key={d} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-soft)]">
                      <input
                        type="radio"
                        name="flight-editor-direction"
                        value={d}
                        checked={direction === d}
                        onChange={() => changeDirection(d)}
                        className="accent-[var(--cinnabar)]"
                      />
                      {d === "arrival" ? "Arrival · 接机" : "Departure · 送机"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Flight #">
                  <input value={form.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} placeholder="AK6412" className={inputClass} />
                </Field>
                <Field label="Airline">
                  <input value={form.airline} onChange={(e) => set("airline", e.target.value)} placeholder="AirAsia" className={inputClass} />
                </Field>
                <Field label="From (IATA)">
                  <input value={form.origin} onChange={(e) => set("origin", e.target.value.toUpperCase())} maxLength={3} placeholder="JHB" className={`${inputClass} uppercase tabular-nums`} />
                </Field>
                <Field label="To (IATA)">
                  <input value={form.destination} onChange={(e) => set("destination", e.target.value.toUpperCase())} maxLength={3} placeholder="PEN" className={`${inputClass} uppercase tabular-nums`} />
                </Field>
                <Field label="Date">
                  <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputClass} />
                </Field>
                <Field label="Time (local)">
                  <input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} className={inputClass} />
                </Field>
                <Field label="Terminal">
                  <input value={form.terminal} onChange={(e) => set("terminal", e.target.value)} placeholder="T1" className={inputClass} />
                </Field>
                <Field label="Hotel">
                  <HotelSelect
                    value={form.hotelKey}
                    onChange={(v) => set("hotelKey", v)}
                    mainVenueName={mainVenueName}
                    designatedHotels={designatedHotels}
                    className={inputClass}
                  />
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                <input
                  type="checkbox"
                  checked={form.vip}
                  onChange={(e) => set("vip", e.target.checked)}
                  className="accent-[var(--cinnabar)]"
                />
                {canSetVip ? "VIP — private Alphard" : "Request VIP — an admin must approve"}
              </label>
              {error ? (
                <div role="alert" className="text-[11.5px] text-[var(--cinnabar-deep)] leading-[1.5]">
                  {error}
                </div>
              ) : null}
            </div>
            <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeAndReset}
                disabled={busy}
                className="inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11px] tracking-[0.1em] uppercase text-[var(--ink-soft)] hover:text-[var(--ink)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[color,transform]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="inline-flex items-center h-8 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.1em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform]"
              >
                {busy ? "Saving…" : existing ? "Save changes" : "Save + confirm"}
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
    <div className="flex flex-col gap-1">
      <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label}
      </span>
      {children}
    </div>
  );
}
