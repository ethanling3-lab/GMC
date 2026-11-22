"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Scanner } from "@yudiel/react-qr-scanner";
import { useWakeLock } from "@/lib/check-in/use-wake-lock";
import {
  playError,
  playSuccess,
  playWarn,
  primeAudio,
} from "@/lib/check-in/audio-cues";
import { groupNumber } from "@/lib/group-number";
import { EVENT_TZ } from "@/lib/check-in/day";
import { SESSION_LABEL, sessionOf, type Session } from "@/lib/check-in/mode";
import type { DeskState } from "@/lib/check-in/types";
import {
  CheckInAlreadyCard,
  CheckInErrorCard,
  CheckInSuccessCard,
  CheckInUnpaidCard,
  ClassScanCard,
  checkInErrorMessage,
  type ClassAction,
  type DeskPerson,
} from "./CheckInResultCards";

// The desk's half of the one-stop check-in page: a compact QR camera with
// the result card on top of it, and the manual search beside it. Lives
// inside CheckInClient, which owns the headcount and polling — this panel
// just tells it when something changed (onCheckedIn) so the numbers move
// immediately instead of on the next 5-second tick.
//
// Check-ins always land on TODAY (the server picks the date). When the page
// is showing another day, the panel steps aside rather than let anyone
// think they're checking people in for that day.
//
// The organizer sets which registration is on (desk.mode); each desk picks
// what its scans do: Check in, or Out/Back for people leaving class. A desk
// always opens on Check in and returns to it when the session changes, so an
// arrival is never logged as leaving. Every POST carries the mode this desk
// is showing; if the organizer switched in between, the server refuses
// (mode_changed) and the desk refreshes and asks for a rescan.

type Props = {
  eventId: string;
  /** Live desk state from the page's poll. */
  desk: DeskState;
  /** "8–14 Apr" — shown when the desk is locked outside the event dates. */
  eventDatesLabel: string;
  /** True when the page is showing today — the only day a desk can scan for. */
  active: boolean;
  /** Link to today's view, for the "switch to Today" note. */
  todayHref: string;
  /** A check-in, exit or undo happened — refresh the dashboard. */
  onCheckedIn: () => void;
  /** Changes when any desk checks someone in or logs them out/back. */
  listVersion: string;
};

type FeedbackState =
  | { kind: "idle" }
  | { kind: "success"; person: DeskPerson; unpaidOverride: boolean }
  | { kind: "already"; person: DeskPerson; checkedInAt: string | null }
  // Waits for the desk: "check in anyway" re-posts by enrollment id.
  | {
      kind: "unpaid";
      person: DeskPerson;
      enrollmentId: string;
      method: "qr" | "manual";
      posting: boolean;
    }
  | {
      kind: "class";
      person: DeskPerson;
      action: ClassAction;
      enrollmentId: string;
      outAt: string | null;
      minutes: number | null;
      notCheckedIn: boolean;
      checkingIn: boolean;
    }
  | { kind: "error"; message: string };

type ManualSearchRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
  table_no: number | null;
  paid: boolean;
  checked_in_at: string | null;
  check_in_id: string | null;
  out_since: string | null;
};

const CAMERA_PREF_KEY = "gmc-desk-camera";
// Long enough to read the group number and turn to the badge pile.
const COOLDOWN_MS = 3000;
const SEARCH_DEBOUNCE_MS = 220;

export function DeskScanner({
  eventId,
  desk,
  eventDatesLabel,
  active,
  todayHref,
  onCheckedIn,
  listVersion,
}: Props) {
  const mode = desk.mode;
  const session = sessionOf(mode);
  // Deliberately not remembered across reloads — see the note above.
  const [deskAction, setDeskAction] = useState<"check_in" | "out_back">("check_in");
  const classMode = deskAction === "out_back";
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  // Off until someone presses "Start scanning", so opening the page on a
  // laptop doesn't trigger a camera prompt. A desk device remembers it was
  // scanning and comes back ready.
  const [cameraOn, setCameraOn] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CAMERA_PREF_KEY) === "on") setCameraOn(true);
    } catch {
      /* storage blocked — start off */
    }
  }, []);
  const setCamera = (on: boolean) => {
    setCameraOn(on);
    try {
      window.localStorage.setItem(CAMERA_PREF_KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
  };

  // M7.1d — keep the iPad / phone awake while scanner is in front.
  useWakeLock(cameraOn);

  // Prime Web Audio context on first user gesture (iOS Safari).
  useEffect(() => {
    const handler = () => primeAudio();
    document.addEventListener("pointerdown", handler, { once: true });
    document.addEventListener("keydown", handler, { once: true });
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, []);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [postingToken, setPostingToken] = useState<boolean>(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  const cooldownRef = useRef<number | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  const [manualQ, setManualQ] = useState<string>("");
  const [searchRows, setSearchRows] = useState<ManualSearchRow[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  // Bumped after any check-in / undo to re-run the current search. A counter
  // (not a call from the handlers) because those handlers are memoised and
  // would read a stale `manualQ` — the list never refreshed after a check-in.
  const [searchNonce, setSearchNonce] = useState(0);

  // --- Manual search ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/check-in/search?q=${encodeURIComponent(manualQ)}&session=${session}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          setSearchRows([]);
          return;
        }
        const json = (await res.json()) as { rows: ManualSearchRow[] };
        if (!cancelled) setSearchRows(json.rows ?? []);
      } catch {
        if (!cancelled) setSearchRows([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [eventId, manualQ, searchNonce, session, listVersion]);

  // Mode moved on (organizer switched): a pending card belongs to the old
  // mode, and the list's buttons need the new session's status.
  const shownModeRef = useRef(mode);
  useEffect(() => {
    if (shownModeRef.current === mode) return;
    shownModeRef.current = mode;
    setDeskAction("check_in");
    setFeedback({ kind: "idle" });
    lastTokenRef.current = null;
    setSearchNonce((n) => n + 1);
  }, [mode]);

  // --- Scanner ------------------------------------------------------------

  const extractToken = (raw: string): string => {
    const trimmed = raw.trim();
    const match = trimmed.match(/\/checkin\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  };

  const handleCheckInResponse = (
    status: number,
    json: unknown,
    method: "qr" | "manual",
  ) => {
    const r = json as {
      ok?: boolean;
      kind?: "class";
      error?: string;
      enrollment_id?: string;
      checked_in_at?: string;
      check_in?: { unpaid_override?: boolean };
      action?: ClassAction;
      exit?: { out_at: string; minutes: number | null };
      not_checked_in?: boolean;
    } & DeskPerson;
    const person: DeskPerson = {
      participant: r.participant,
      group_no: r.group_no,
      table_no: r.table_no,
      seat_no: r.seat_no,
    };
    if (status === 200 && r.ok === true && r.kind === "class" && r.action && r.enrollment_id) {
      setFeedback({
        kind: "class",
        person,
        action: r.action,
        enrollmentId: r.enrollment_id,
        outAt: r.exit?.out_at ?? null,
        minutes: r.exit?.minutes ?? null,
        notCheckedIn: r.not_checked_in === true && r.action === "out",
        checkingIn: false,
      });
      if (r.action === "already_out" || r.action === "already_back" || r.not_checked_in) {
        playWarn();
      } else {
        playSuccess();
      }
      onCheckedIn();
      setSearchNonce((n) => n + 1);
      return;
    }
    if (status === 200 && r.ok === true) {
      setFeedback({
        kind: "success",
        person,
        unpaidOverride: r.check_in?.unpaid_override === true,
      });
      playSuccess();
      onCheckedIn();
      setSearchNonce((n) => n + 1);
      return;
    }
    const err = r.error ?? "server_error";
    if (err === "already_checked_in") {
      setFeedback({ kind: "already", person, checkedInAt: r.checked_in_at ?? null });
      playWarn();
      onCheckedIn();
      return;
    }
    if (err === "unpaid" && r.enrollment_id) {
      setFeedback({
        kind: "unpaid",
        person,
        enrollmentId: r.enrollment_id,
        method,
        posting: false,
      });
      playWarn();
      return;
    }
    setFeedback({ kind: "error", message: checkInErrorMessage(err) });
    playError();
    // Locked / mode_changed mean this desk's view of the mode is
    // stale — pull the live state now rather than on the next tick.
    if (err === "mode_changed" || err === "locked") onCheckedIn();
  };

  // Success / already-checked-in clear themselves; an unpaid prompt or an
  // error waits for the desk to act.
  const scheduleClear = () => {
    if (cooldownRef.current !== null) {
      window.clearTimeout(cooldownRef.current);
    }
    cooldownRef.current = window.setTimeout(() => {
      lastTokenRef.current = null;
      setFeedback((f) =>
        f.kind === "success" ||
        f.kind === "already" ||
        (f.kind === "class" && !f.notCheckedIn)
          ? { kind: "idle" }
          : f,
      );
    }, COOLDOWN_MS);
  };

  const dismissFeedback = () => {
    setFeedback({ kind: "idle" });
    lastTokenRef.current = null;
  };

  const confirmUnpaid = async () => {
    if (feedback.kind !== "unpaid" || feedback.posting) return;
    const pending = feedback;
    setFeedback({ ...pending, posting: true });
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: pending.enrollmentId,
          method: pending.method,
          allow_unpaid: true,
          mode,
        }),
      });
      handleCheckInResponse(res.status, await res.json(), pending.method);
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      scheduleClear();
    }
  };

  // "Check in now" on an out-of-class card: register them for this session.
  const checkInNow = async () => {
    if (feedback.kind !== "class" || feedback.checkingIn) return;
    const pending = feedback;
    setFeedback({ ...pending, checkingIn: true });
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: pending.enrollmentId,
          method: "manual",
          mode,
        }),
      });
      handleCheckInResponse(res.status, await res.json(), "manual");
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      scheduleClear();
    }
  };

  const performScan = useCallback(
    async (raw: string) => {
      if (postingToken) return;
      const token = extractToken(raw);
      if (!token) return;
      if (lastTokenRef.current === token) return;
      lastTokenRef.current = token;
      setPostingToken(true);
      try {
        const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr_token: token, mode, ...(classMode ? { scan: "out_back" } : {}) }),
        });
        const json = (await res.json()) as unknown;
        handleCheckInResponse(res.status, json, "qr");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setFeedback({ kind: "error", message: msg });
      } finally {
        setPostingToken(false);
        scheduleClear();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, postingToken, mode, classMode],
  );

  const performManualCheckIn = useCallback(
    async (row: ManualSearchRow, intent?: "out" | "back") => {
      if (postingId) return;
      // Picking an unpaid row from the list IS the override decision, but
      // make it a deliberate one.
      if (
        !intent &&
        !row.paid &&
        !window.confirm(
          `${row.name_cn ?? row.name_en ?? "This person"} hasn't paid · 未付款.\nCheck in anyway? · 仍然签到？`,
        )
      ) {
        return;
      }
      setPostingId(row.enrollment_id);
      try {
        const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollment_id: row.enrollment_id,
            method: "manual",
            mode,
            ...(intent ? { intent, scan: "out_back" } : row.paid ? {} : { allow_unpaid: true }),
          }),
        });
        const json = (await res.json()) as unknown;
        handleCheckInResponse(res.status, json, "manual");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setFeedback({ kind: "error", message: msg });
      } finally {
        setPostingId(null);
        scheduleClear();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, postingId, mode],
  );

  const performUndo = useCallback(
    async (checkInId: string) => {
      if (!window.confirm("Undo this check-in · 撤销该签到？")) return;
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/check-in?check_in_id=${encodeURIComponent(checkInId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          window.alert(`Undo failed · ${json?.error ?? "server_error"}`);
          return;
        }
        onCheckedIn();
        setSearchNonce((n) => n + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        window.alert(msg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, manualQ, onCheckedIn],
  );

  // --- Render -------------------------------------------------------------

  // Locked trumps "switch to today": today isn't offered as a day at all.
  if (desk.locked) {
    return (
      <Notice>
        <strong className="font-medium text-[var(--ink)]">Check-in is closed today · 今天不开放签到.</strong>{" "}
        It opens on the event dates ({eventDatesLabel}) · 活动日期才开放签到. To rehearse before
        then, an organizer can turn on Test mode below.
      </Notice>
    );
  }

  if (!active) {
    return (
      <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-4 text-[13px] text-[var(--ink-soft)]">
        Scanning records today&apos;s arrivals · 扫码只记录今天的签到.{" "}
        <Link
          href={todayHref}
          scroll={false}
          className="font-medium underline underline-offset-4 hover:text-[var(--cinnabar-deep)] focus-visible:outline-none focus-visible:text-[var(--cinnabar-deep)]"
          style={{ color: "var(--cinnabar)" }}
        >
          Switch to today to scan · 切换到今天
        </Link>
      </section>
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label="What this desk's scans do" className="mb-3 inline-flex p-1 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]">
        {(
          [
            ["check_in", "Check in · 签到"],
            ["out_back", "Out / Back · 外出"],
          ] as const
        ).map(([value, label]) => {
          const on = deskAction === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (on) return;
                setDeskAction(value);
                setFeedback({ kind: "idle" });
                lastTokenRef.current = null;
              }}
              className={`h-10 px-5 rounded-[var(--radius-pill)] text-[13.5px] font-medium focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px transition-[background-color,color,transform] duration-[var(--dur-fast)] ${
                on
                  ? value === "out_back"
                    ? "bg-[#A87A2A] text-[var(--paper)]"
                    : "bg-[var(--cinnabar)] text-[var(--paper)]"
                  : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {/* Camera beside the manual list on wider screens; stacked on phones.
          The camera only has to frame a badge QR held up to it, so it stays
          a compact square rather than filling the page. */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-5 items-start">
      {/* Camera card */}
      <section className="w-full max-w-[440px] mx-auto md:mx-0 bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-paper)]">
        <div className="flex items-center justify-between px-5 pt-4">
          <div
            className={`text-[10.5px] tracking-[0.22em] uppercase ${
              classMode ? "text-[var(--gold-deep,#A87A2A)]" : "text-[var(--cinnabar)]"
            }`}
          >
            {classMode ? "Scan out / back · 外出扫码" : "Scan badge QR · 扫胸牌二维码"}
          </div>
          {cameraOn ? (
            <button
              type="button"
              onClick={() => setCamera(false)}
              className="shrink-0 whitespace-nowrap text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] focus-visible:outline-none focus-visible:text-[var(--cinnabar)] transition-colors"
            >
              Stop · 停止
            </button>
          ) : null}
        </div>
        <div className="relative aspect-[4/5] sm:aspect-square bg-black/85 m-4 mt-3 rounded-[18px] overflow-hidden">
          {cameraOn ? (
            <Scanner
              onScan={(detected) => {
                // Hold the camera while the desk decides something.
                if (feedback.kind === "unpaid") return;
                if (feedback.kind === "class" && feedback.notCheckedIn) return;
                if (detected && detected.length > 0) {
                  void performScan(detected[0].rawValue);
                }
              }}
              onError={(err) => {
                const msg = err instanceof Error ? err.message : String(err);
                setCameraError(msg || "Camera unavailable");
              }}
              styles={{
                container: { width: "100%", height: "100%" },
                video: {
                  width: "100%",
                  height: "100%",
                  objectFit: "cover" as const,
                },
              }}
              formats={["qr_code"]}
              components={{ finder: false }}
              scanDelay={300}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <button
                type="button"
                onClick={() => {
                  primeAudio();
                  setCamera(true);
                }}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[14px] font-medium text-[var(--paper)] hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform] duration-[var(--dur-fast)]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
                  <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
                  <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
                  <path d="M9.5 9.5h2v2M13.5 9.5v.01M9.5 13.5h.01M11.5 13.5h2" />
                </svg>
                Start scanning · 开始扫码
              </button>
            </div>
          )}
          {feedback.kind !== "idle" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/55 p-3 overflow-y-auto">
              {feedback.kind === "success" ? (
                <CheckInSuccessCard person={feedback.person} unpaidOverride={feedback.unpaidOverride} />
              ) : feedback.kind === "already" ? (
                <CheckInAlreadyCard
                  person={feedback.person}
                  checkedInAt={feedback.checkedInAt}
                  sessionLabel={sessionLabel(session)}
                  onDismiss={dismissFeedback}
                />
              ) : feedback.kind === "class" ? (
                <ClassScanCard
                  person={feedback.person}
                  action={feedback.action}
                  outAt={feedback.outAt}
                  minutes={feedback.minutes}
                  notCheckedIn={feedback.notCheckedIn}
                  checkingIn={feedback.checkingIn}
                  onCheckInNow={() => void checkInNow()}
                  onDismiss={dismissFeedback}
                />
              ) : feedback.kind === "unpaid" ? (
                <CheckInUnpaidCard
                  person={feedback.person}
                  posting={feedback.posting}
                  onConfirm={() => void confirmUnpaid()}
                  onCancel={dismissFeedback}
                />
              ) : (
                <CheckInErrorCard message={feedback.message} onDismiss={dismissFeedback} />
              )}
            </div>
          ) : null}
        </div>
        {cameraError ? (
          <div className="px-5 pb-4 text-[11.5px] text-[var(--ink-soft)]">
            <strong className="text-[var(--cinnabar)]">Camera:</strong>{" "}
            {cameraError} · Try refreshing or allow camera permission in your
            browser site settings.
          </div>
        ) : null}
      </section>

      {/* Manual search */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] flex flex-col min-h-0">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--paper-deep)]">
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)] mb-2">
            Manual · 手动查找
          </div>
          <input
            type="search"
            value={manualQ}
            onChange={(e) => setManualQ(e.target.value)}
            placeholder="Region ID / 姓名 / phone"
            className="w-full h-[40px] px-3 rounded-[10px] bg-[var(--paper)] border border-[var(--paper-deep)] text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--cinnabar)] focus:ring-2 focus:ring-[var(--cinnabar)]/15 transition-colors"
          />
          <div className="mt-2 text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)]">
            {searching
              ? "Searching · 搜索中"
              : manualQ
                ? `${searchRows.length} match${searchRows.length === 1 ? "" : "es"}`
                : "First 30 · paid and approved"}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[440px]">
          {searchRows.length === 0 && !searching ? (
            <div className="px-5 py-8 text-center text-[12px] text-[var(--ink-faint)]">
              No matches · 无匹配
            </div>
          ) : null}
          <ul className="divide-y divide-[var(--paper-deep)]/70">
            {searchRows.map((row) => (
              <ManualRow
                key={row.enrollment_id}
                row={row}
                classMode={classMode}
                posting={postingId === row.enrollment_id}
                onCheckIn={() => void performManualCheckIn(row)}
                onOut={() => void performManualCheckIn(row, "out")}
                onBack={() => void performManualCheckIn(row, "back")}
                onUndo={() =>
                  row.check_in_id ? void performUndo(row.check_in_id) : null
                }
              />
            ))}
          </ul>
        </div>
      </section>
      </div>
    </div>
  );
}

// -- Subcomponents ----------------------------------------------------------

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)] px-5 py-4 text-[13px] leading-[1.6] text-[var(--ink-soft)]">
      {children}
    </section>
  );
}

function sessionLabel(session: Session): string {
  const l = SESSION_LABEL[session];
  return `${l.en} · ${l.cn}`;
}

function ManualRow({
  row,
  classMode,
  posting,
  onCheckIn,
  onOut,
  onBack,
  onUndo,
}: {
  row: ManualSearchRow;
  classMode: boolean;
  posting: boolean;
  onCheckIn: () => void;
  onOut: () => void;
  onBack: () => void;
  onUndo: () => void;
}) {
  const isCheckedIn = row.checked_in_at !== null;
  if (classMode) {
    return (
      <li className="px-5 py-2.5 flex items-center gap-3 hover:bg-[var(--paper)]/40 transition-colors">
        <span
          className="inline-flex items-center justify-center h-[22px] min-w-[44px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] font-medium text-[var(--ink-mute)] tabular-nums"
          title="Region ID"
        >
          {row.region_id ?? "—"}
        </span>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-[13px] font-medium text-[var(--ink)] truncate">
            {row.name_cn ?? row.name_en ?? "(unnamed)"}
          </div>
          <div className="text-[10.5px] text-[var(--ink-faint)] tabular-nums truncate">
            {row.group_no !== null ? `${groupNumber(row).en} · ` : ""}
            {isCheckedIn ? `In ${formatTime(row.checked_in_at!)}` : "Not checked in · 未签到"}
          </div>
        </div>
        {row.out_since ? (
          <button
            type="button"
            onClick={onBack}
            disabled={posting}
            title={`Out since ${formatTime(row.out_since)}`}
            className="inline-flex items-center h-[28px] px-3 rounded-[var(--radius-pill)] bg-[#A87A2A] text-[var(--paper)] text-[11px] tracking-[0.06em] hover:opacity-90 active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[opacity,transform]"
          >
            {posting ? "…" : `Back · 回来 (out ${formatTime(row.out_since)})`}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOut}
            disabled={posting}
            className="inline-flex items-center h-[28px] px-3 rounded-[var(--radius-pill)] border border-[#A87A2A] text-[var(--gold-deep,#A87A2A)] text-[11px] tracking-[0.06em] hover:bg-[#A87A2A]/15 active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform]"
          >
            {posting ? "…" : "Out · 外出"}
          </button>
        )}
      </li>
    );
  }
  return (
    <li className="px-5 py-2.5 flex items-center gap-3 hover:bg-[var(--paper)]/40 transition-colors">
      <span
        className="inline-flex items-center justify-center h-[22px] min-w-[44px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] font-medium text-[var(--ink-mute)] tabular-nums"
        title="Region ID"
      >
        {row.region_id ?? "—"}
      </span>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[13px] font-medium text-[var(--ink)] truncate">
          {row.name_cn ?? row.name_en ?? "(unnamed)"}
        </div>
        <div className="text-[10.5px] text-[var(--ink-faint)] tabular-nums truncate">
          {!row.paid ? (
            <span className="mr-1.5 inline-flex items-center px-1.5 rounded-full bg-[var(--gold,#C99B47)]/20 text-[var(--ink-soft)]">
              Unpaid · 未付款
            </span>
          ) : null}
          {row.group_no !== null ? `${groupNumber(row).en} · ` : ""}
          {row.phone ?? ""}
        </div>
      </div>
      {isCheckedIn ? (
        <button
          type="button"
          onClick={onUndo}
          title={row.checked_in_at ? `Checked in ${formatTime(row.checked_in_at)}` : ""}
          className="inline-flex items-center h-[28px] px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)]/12 text-[var(--cinnabar)] text-[11px] tracking-[0.06em] hover:bg-[var(--cinnabar)]/20 transition-colors"
        >
          ✓ {formatTime(row.checked_in_at!)}
        </button>
      ) : (
        <button
          type="button"
          onClick={onCheckIn}
          disabled={posting}
          className="inline-flex items-center h-[28px] px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11px] tracking-[0.06em] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {posting ? "…" : "Check in"}
        </button>
      )}
    </li>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: EVENT_TZ,
    });
  } catch {
    return "—";
  }
}
