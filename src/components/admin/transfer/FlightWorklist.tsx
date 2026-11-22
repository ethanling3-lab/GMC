"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  EnrolmentSubmission,
  FlightStatus,
  FlightSubmissionStatus,
} from "@/lib/transfer/flight-status";
import { openFlightEditor } from "./FlightEditorDialog";

// The customer service worklist: who still owes flight details, a WhatsApp
// shortcut to ask them, and a record of who was contacted.

type Direction = "arrival" | "departure";
type Filter = "todo" | "needs_time" | "missing" | "draft" | "not_contacted" | "complete" | "all";

const PAGE_SIZE = 50;

const isDone = (s: FlightStatus) => s === "confirmed" || s === "not_needed";
const isComplete = (e: EnrolmentSubmission) => isDone(e.arrival) && isDone(e.departure);
const hasStatus = (e: EnrolmentSubmission, s: FlightStatus) =>
  e.arrival === s || e.departure === s;

const FILTERS: Array<{ key: Filter; label: string; test: (e: EnrolmentSubmission) => boolean }> = [
  { key: "todo", label: "To chase", test: (e) => !isComplete(e) },
  { key: "needs_time", label: "Needs time", test: (e) => hasStatus(e, "needs_time") },
  { key: "missing", label: "Missing", test: (e) => hasStatus(e, "missing") },
  { key: "draft", label: "Draft", test: (e) => hasStatus(e, "draft") },
  { key: "not_contacted", label: "Not contacted", test: (e) => !isComplete(e) && !e.contacted_at },
  { key: "complete", label: "Complete", test: isComplete },
  { key: "all", label: "Everyone", test: () => true },
];

function whatsappHref(e: EnrolmentSubmission, eventTitle: string): string | null {
  if (!e.phone_e164) return null;
  const needsArrival = !isDone(e.arrival);
  const needsDeparture = !isDone(e.departure);
  const en =
    needsArrival && needsDeparture
      ? "arrival and departure flight"
      : needsDeparture
        ? "departure flight"
        : "arrival flight";
  const zh =
    needsArrival && needsDeparture ? "来回程航班" : needsDeparture ? "回程航班" : "抵达航班";
  const text =
    `Hi ${e.name}, for ${eventTitle}, please send us your ${en} ticket so we can arrange your airport transfer. ` +
    `Please cover your passport number before sending.\n\n` +
    `您好，为安排${eventTitle}的机场接送，请发送您的${zh}机票。发送前请遮盖护照号码。`;
  return `https://wa.me/${e.phone_e164.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}

export function FlightWorklist({
  status,
  inboxByParticipant,
  eventTitle,
  canWork,
  defaultOpen,
}: {
  status: FlightSubmissionStatus;
  inboxByParticipant: Record<string, string>;
  eventTitle: string;
  canWork: boolean;
  defaultOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const completeCount = status.enrolments.filter(isComplete).length;
  const toChase = status.total_enrolled - completeCount;
  const needsTime = status.arrival.needs_time + status.departure.needs_time;

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.key, status.enrolments.filter(f.test).length]),
      ) as Record<Filter, number>,
    [status.enrolments],
  );

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const q = query.trim().toLowerCase();
    return status.enrolments.filter(
      (e) =>
        test(e) &&
        (!q || e.name.toLowerCase().includes(q) || (e.region_id ?? "").toLowerCase().includes(q)),
    );
  }, [status.enrolments, filter, query]);

  async function send(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/flight-followups", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollment_id: id, ...body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ?? json.error ?? "Couldn't save that.");
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveContact(id: string) {
    if (await send(id, { action: "contacted", note })) {
      setNoteFor(null);
      setNote("");
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left rounded-[var(--radius-lg)] hover:bg-[var(--paper-deep)]/40 focus-visible:shadow-[var(--shadow-focus)] transition-colors"
      >
        <span className="flex items-center gap-x-4 gap-y-1 flex-wrap">
          <span className="font-display text-[17px] text-[var(--ink)]">
            Flight worklist <span className="text-[13px] text-[var(--ink-mute)]">航班跟进</span>
          </span>
          <span className="text-[12.5px] tabular-nums text-[var(--ink-soft)]">
            {completeCount} of {status.total_enrolled} complete, {toChase} to chase
          </span>
          <Progress label="Arrivals" counts={status.arrival} total={status.total_enrolled} />
          <Progress label="Departures" counts={status.departure} total={status.total_enrolled} />
          {needsTime > 0 ? (
            <span className="text-[12px] font-medium text-[#7A5617]">
              {needsTime} need{needsTime === 1 ? "s" : ""} a flight time
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[12px] text-[var(--ink-mute)]">
          {open ? "Hide" : "Show"} <span aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {!open ? null : (
        <div className="border-t border-[var(--paper-shadow)] px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div role="group" aria-label="Filter worklist" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => {
                    setFilter(f.key);
                    setLimit(PAGE_SIZE);
                  }}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border text-[12px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,border-color,color,transform] ${
                    filter === f.key
                      ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30"
                  }`}
                >
                  {f.label}
                  <span className="tabular-nums opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search name or ID"
              aria-label="Search name or ID"
              className="w-full sm:w-[220px] h-8 px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none transition-[border-color,box-shadow]"
            />
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-[12px] text-[var(--cinnabar-deep)]">
              {error}
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="mt-4 py-6 text-center text-[13px] text-[var(--ink-mute)]">
              {status.total_enrolled === 0
                ? "No approved or paid participants yet."
                : filter === "todo" && !query
                  ? "Everyone's flight details are complete."
                  : "Nobody matches this filter."}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)]">
              <table className="w-full min-w-[860px] border-collapse text-[12.5px] bg-[var(--paper)]">
                <thead className="bg-[var(--paper-deep)] text-left text-[11px] text-[var(--ink-mute)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Participant</th>
                    <th className="px-3 py-2 font-medium w-[150px]">Arrival</th>
                    <th className="px-3 py-2 font-medium w-[150px]">Departure</th>
                    <th className="px-3 py-2 font-medium w-[190px]">Last contact</th>
                    {canWork ? <th className="px-3 py-2 font-medium w-[230px]">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, limit).map((e) => {
                    const wa = whatsappHref(e, eventTitle);
                    const thread = inboxByParticipant[e.participant_id];
                    return (
                      <tr key={e.enrollment_id} className="border-t border-[var(--paper-shadow)] align-top hover:bg-[var(--paper-deep)]/30 transition-colors">
                        <td className="px-3 py-2">
                          <div className="text-[var(--ink)]">{e.name}</div>
                          <div className="font-mono text-[10.5px] tabular-nums text-[var(--cinnabar-deep)]">
                            {e.region_id ?? "No ID"}
                          </div>
                        </td>
                        {(["arrival", "departure"] as Direction[]).map((d) => (
                          <td key={d} className="px-3 py-2">
                            <StatusCell
                              status={e[d]}
                              canWork={canWork}
                              label={`${d} for ${e.name}`}
                              disabled={busy === e.enrollment_id}
                              onEdit={() =>
                                openFlightEditor({
                                  enrollment_id: e.enrollment_id,
                                  direction: d,
                                  participant_label: e.region_id ? `${e.name} · ${e.region_id}` : e.name,
                                  flight: null,
                                })
                              }
                              onNotNeeded={(value) =>
                                send(e.enrollment_id, { action: "not_needed", direction: d, value })
                              }
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-[11.5px] leading-[1.5] text-[var(--ink-soft)]">
                          {e.contacted_at ? (
                            <>
                              <div>
                                {new Date(e.contacted_at).toLocaleString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                                , {e.contacted_by ?? "staff"}
                              </div>
                              {e.contact_note ? (
                                <div className="text-[var(--ink-mute)] break-words">{e.contact_note}</div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[var(--ink-faint)]">Not contacted</span>
                          )}
                        </td>
                        {canWork ? (
                          <td className="px-3 py-2">
                            {noteFor === e.enrollment_id ? (
                              <div className="flex flex-col gap-1.5">
                                <input
                                  autoFocus
                                  value={note}
                                  maxLength={300}
                                  onChange={(ev) => setNote(ev.target.value)}
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter") void saveContact(e.enrollment_id);
                                    if (ev.key === "Escape") setNoteFor(null);
                                  }}
                                  placeholder="Note (optional)"
                                  aria-label={`Contact note for ${e.name}`}
                                  className="h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] focus:border-[var(--cinnabar)]/40 focus:shadow-[var(--shadow-focus)] focus:outline-none"
                                />
                                <div className="flex gap-1.5">
                                  <ActionButton disabled={busy === e.enrollment_id} onClick={() => saveContact(e.enrollment_id)}>
                                    Save
                                  </ActionButton>
                                  <ActionButton onClick={() => setNoteFor(null)}>Cancel</ActionButton>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {!isComplete(e) && wa ? (
                                  <a
                                    href={wa}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={actionClass}
                                    style={{ color: "var(--ink-soft)" }}
                                  >
                                    WhatsApp
                                  </a>
                                ) : !isComplete(e) ? (
                                  <span className="text-[11.5px] text-[var(--cinnabar-deep)]">No valid phone</span>
                                ) : null}
                                {!isComplete(e) ? (
                                  <ActionButton
                                    onClick={() => {
                                      setNote("");
                                      setNoteFor(e.enrollment_id);
                                    }}
                                  >
                                    Mark contacted
                                  </ActionButton>
                                ) : null}
                                {thread ? (
                                  <Link
                                    href={`/admin/inbox/${thread}`}
                                    className={actionClass}
                                    style={{ color: "var(--ink-soft)" }}
                                  >
                                    Inbox
                                  </Link>
                                ) : null}
                              </div>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {visible.length > limit ? (
            <div className="mt-3 text-center">
              <ActionButton onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Show more ({visible.length - limit} left)
              </ActionButton>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

const actionClass =
  "inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30 focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[border-color,color,transform]";

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={actionClass}>
      {children}
    </button>
  );
}

function Progress({
  label,
  counts,
  total,
}: {
  label: string;
  counts: Record<FlightStatus, number>;
  total: number;
}) {
  const needed = total - counts.not_needed;
  return (
    <span className="text-[12px] tabular-nums text-[var(--ink-mute)]">
      {label} {counts.confirmed}/{needed}
    </span>
  );
}

const STATUS: Record<FlightStatus, { label: string; dot: string; text: string }> = {
  confirmed: { label: "Confirmed", dot: "bg-[#5b9a5d]", text: "text-[#3a6b3b]" },
  needs_time: { label: "Needs time", dot: "bg-[#A87A2A]", text: "text-[#7A5617] font-medium" },
  draft: { label: "Draft", dot: "bg-[var(--gold)]", text: "text-[var(--ink-soft)]" },
  missing: { label: "Missing", dot: "bg-[var(--cinnabar)]", text: "text-[var(--cinnabar-deep)]" },
  not_needed: { label: "No transfer", dot: "bg-[var(--ink-faint)]", text: "text-[var(--ink-mute)]" },
};

function StatusCell({
  status,
  canWork,
  label,
  disabled,
  onEdit,
  onNotNeeded,
}: {
  status: FlightStatus;
  canWork: boolean;
  label: string;
  disabled: boolean;
  onEdit: () => void;
  onNotNeeded: (value: boolean) => void;
}) {
  const s = STATUS[status];
  const link =
    "text-[11px] underline decoration-dotted underline-offset-2 text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 transition-colors";
  return (
    <div>
      <span className={`inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap ${s.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
        {s.label}
      </span>
      {canWork ? (
        <div className="mt-0.5 flex items-center gap-2">
          {status !== "not_needed" ? (
            <button type="button" onClick={onEdit} aria-label={`${status === "missing" ? "Add" : "Edit"} ${label}`} className={link}>
              {status === "missing" ? "Add" : "Edit"}
            </button>
          ) : null}
          {status === "missing" ? (
            <button type="button" disabled={disabled} onClick={() => onNotNeeded(true)} aria-label={`No transfer needed: ${label}`} className={link}>
              No transfer
            </button>
          ) : null}
          {status === "not_needed" ? (
            <button type="button" disabled={disabled} onClick={() => onNotNeeded(false)} aria-label={`Undo no transfer: ${label}`} className={link}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
