"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Scanner } from "@yudiel/react-qr-scanner";
import type { CheckInStats } from "@/lib/check-in/types";
import { useWakeLock } from "@/lib/check-in/use-wake-lock";
import {
  playError,
  playSuccess,
  playWarn,
  primeAudio,
} from "@/lib/check-in/audio-cues";

// Focused scanner station — designed for door staff on a single phone or
// tablet. Strips everything organizational (sparkline, group grid,
// absentee list) and gives the entire viewport to the camera + manual
// fallback. Pairs with the dashboard at /admin/events/[id]/check-in
// which the event organizer keeps open on a laptop in parallel; both
// surfaces hit the same backend so check-ins from either device sync
// within one 5-second poll.

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventTitleCn: string | null;
  initialStats: CheckInStats;
};

type FeedbackState =
  | { kind: "idle" }
  | {
      kind: "success";
      participant: {
        name_cn: string | null;
        name_en: string | null;
        region_id: string | null;
      };
      group_no: number | null;
      seat_no: number | null;
      method: "qr" | "manual";
    }
  | { kind: "error"; message: string; tone: "warn" | "danger" };

type ManualSearchRow = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  group_no: number | null;
  checked_in_at: string | null;
  check_in_id: string | null;
};

const STATS_POLL_MS = 5000;
const COOLDOWN_MS = 1600;
const SEARCH_DEBOUNCE_MS = 220;

export function ScannerStation({
  eventId,
  eventSlug,
  eventTitle,
  eventTitleCn,
  initialStats,
}: Props) {
  const [stats, setStats] = useState<CheckInStats>(initialStats);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [cameraOn, setCameraOn] = useState<boolean>(true);

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

  // --- Lightweight stats poll --------------------------------------------
  // Only refreshes the counter — the heavy dashboard panels live on the
  // separate /check-in route, so we ignore everything else in the response.
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { stats: CheckInStats };
      if (json.stats) setStats(json.stats);
    } catch {
      // Silent — next tick will retry.
    }
  }, [eventId]);

  useEffect(() => {
    const t = window.setInterval(refreshStats, STATS_POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshStats]);

  // --- Manual search ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/check-in/search?q=${encodeURIComponent(manualQ)}`,
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
  }, [eventId, manualQ]);

  // --- Scanner ------------------------------------------------------------

  const extractToken = (raw: string): string => {
    const trimmed = raw.trim();
    const match = trimmed.match(/\/checkin\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  };

  const handleCheckInResponse = (status: number, json: unknown) => {
    if (status === 200 && (json as { ok?: boolean }).ok === true) {
      const r = json as {
        participant: {
          name_cn: string | null;
          name_en: string | null;
          region_id: string | null;
        };
        group_no: number | null;
        seat_no: number | null;
        check_in: { method: "qr" | "manual" };
      };
      setFeedback({
        kind: "success",
        participant: r.participant,
        group_no: r.group_no,
        seat_no: r.seat_no,
        method: r.check_in.method,
      });
      playSuccess();
      void refreshStats();
      if (manualQ) void retriggerSearch();
      return;
    }
    const err = (json as { error?: string }).error ?? "server_error";
    if (err === "already_checked_in") {
      setFeedback({
        kind: "error",
        message: "Already checked in · 已签到",
        tone: "warn",
      });
      playWarn();
      void refreshStats();
      return;
    }
    if (err === "wrong_event") {
      setFeedback({
        kind: "error",
        message: "QR is for a different event · 此二维码不属于本场活动",
        tone: "danger",
      });
      return;
    }
    if (err === "not_eligible") {
      setFeedback({
        kind: "error",
        message: "Enrolment not approved or paid · 报名未批准/未付款",
        tone: "warn",
      });
      return;
    }
    if (err === "invalid_token" || err === "not_found") {
      setFeedback({
        kind: "error",
        message: "QR not recognised · 二维码无效",
        tone: "danger",
      });
      return;
    }
    setFeedback({
      kind: "error",
      message: `Check-in failed · ${err}`,
      tone: "danger",
    });
    playError();
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
          body: JSON.stringify({ qr_token: token }),
        });
        const json = (await res.json()) as unknown;
        handleCheckInResponse(res.status, json);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setFeedback({ kind: "error", message: msg, tone: "danger" });
      } finally {
        setPostingToken(false);
        if (cooldownRef.current !== null) {
          window.clearTimeout(cooldownRef.current);
        }
        cooldownRef.current = window.setTimeout(() => {
          lastTokenRef.current = null;
          setFeedback({ kind: "idle" });
        }, COOLDOWN_MS);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, postingToken],
  );

  const performManualCheckIn = useCallback(
    async (row: ManualSearchRow) => {
      if (postingId) return;
      setPostingId(row.enrollment_id);
      try {
        const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollment_id: row.enrollment_id }),
        });
        const json = (await res.json()) as unknown;
        handleCheckInResponse(res.status, json);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setFeedback({ kind: "error", message: msg, tone: "danger" });
      } finally {
        setPostingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, postingId],
  );

  const retriggerSearch = async () => {
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/check-in/search?q=${encodeURIComponent(manualQ)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { rows: ManualSearchRow[] };
      setSearchRows(json.rows ?? []);
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

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
        await refreshStats();
        if (manualQ) await retriggerSearch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        window.alert(msg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, manualQ, refreshStats],
  );

  // --- Derived ------------------------------------------------------------

  const pct = useMemo(() => {
    if (stats.total_eligible === 0) return 0;
    return Math.round((stats.total_checked_in / stats.total_eligible) * 100);
  }, [stats]);

  // --- Render -------------------------------------------------------------

  return (
    <div className="flex flex-col gap-5">
      {/* Compact header — designed to stay above the camera viewport on
          phone, never to push it off-screen. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Scanner · 扫码 · {eventSlug}
          </div>
          <h1 className="mt-2 font-display text-[20px] md:text-[24px] leading-[1.15] tracking-[-0.01em] text-[var(--ink)] truncate">
            {eventTitle}
            {eventTitleCn ? (
              <span className="ml-2 text-[var(--ink-mute)] text-[15px] md:text-[18px]">
                {eventTitleCn}
              </span>
            ) : null}
          </h1>
        </div>
        <Link
          href={`/admin/events/${eventId}/check-in`}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar)] transition-colors"
          style={{ color: "var(--ink-mute)" }}
        >
          Dashboard
        </Link>
      </div>

      {/* Live counter pill — small, stays out of the way of the camera. */}
      <div className="flex items-center gap-3">
        <span className="font-display text-[32px] leading-none tracking-[-0.02em] text-[var(--ink)] tabular-nums">
          {stats.total_checked_in}
        </span>
        <span className="text-[var(--ink-faint)] text-[13px] tabular-nums">
          / {stats.total_eligible}
        </span>
        <span className="inline-flex items-center h-[22px] px-2 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[10.5px] tracking-[0.06em] font-medium tabular-nums">
          {pct}%
        </span>
        <span className="text-[9.5px] tracking-[0.22em] uppercase text-[var(--ink-faint)] ml-auto">
          QR {stats.by_method.qr} · Manual {stats.by_method.manual}
        </span>
      </div>

      {/* Camera card */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-paper)]">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
            Aim camera at the participant's QR
          </div>
          <button
            type="button"
            onClick={() => setCameraOn((v) => !v)}
            className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
          >
            {cameraOn ? "Pause · 暂停" : "Resume · 继续"}
          </button>
        </div>
        <div className="relative aspect-square sm:aspect-[4/3] bg-black/85 m-4 mt-3 rounded-[18px] overflow-hidden">
          {cameraOn ? (
            <Scanner
              onScan={(detected) => {
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
            <div className="absolute inset-0 grid place-items-center text-[var(--paper-deep)] text-[12px] tracking-[0.12em] uppercase">
              Paused · 暂停
            </div>
          )}
          {feedback.kind !== "idle" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/55 px-6 py-8 text-center">
              {feedback.kind === "success" ? (
                <SuccessCard feedback={feedback} />
              ) : (
                <ErrorCard
                  message={feedback.message}
                  tone={feedback.tone}
                  onDismiss={() => {
                    setFeedback({ kind: "idle" });
                    lastTokenRef.current = null;
                  }}
                />
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
                : "Showing first 30 eligible"}
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
                posting={postingId === row.enrollment_id}
                onCheckIn={() => void performManualCheckIn(row)}
                onUndo={() =>
                  row.check_in_id ? void performUndo(row.check_in_id) : null
                }
              />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

// -- Subcomponents ----------------------------------------------------------

function SuccessCard({
  feedback,
}: {
  feedback: Extract<FeedbackState, { kind: "success" }>;
}) {
  const name = feedback.participant.name_cn ?? feedback.participant.name_en ?? "—";
  return (
    <div className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[18px] px-6 py-7 shadow-[var(--shadow-elevated)] max-w-[400px]">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--cinnabar)] mx-auto mb-3">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--paper)]"
        >
          <polyline points="5 12 10 17 19 8" />
        </svg>
      </div>
      <div className="font-display text-[26px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
        {name}
      </div>
      {feedback.participant.region_id ? (
        <div className="mt-1 text-[12px] tracking-[0.08em] text-[var(--ink-mute)] tabular-nums">
          {feedback.participant.region_id}
        </div>
      ) : null}
      {feedback.group_no !== null || feedback.seat_no !== null ? (
        <div className="mt-3 inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
          {feedback.group_no !== null ? (
            <span className="inline-flex items-center h-[22px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] tabular-nums">
              Group {feedback.group_no}
            </span>
          ) : null}
          {feedback.seat_no !== null ? (
            <span className="inline-flex items-center h-[22px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] tabular-nums">
              Seat {feedback.seat_no}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
        Checked in · 已签到
      </div>
    </div>
  );
}

function ErrorCard({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: "warn" | "danger";
  onDismiss: () => void;
}) {
  const accent = tone === "warn" ? "var(--gold, #C99B47)" : "var(--cinnabar)";
  return (
    <div
      className="bg-[var(--paper-warm)] border rounded-[18px] px-6 py-7 shadow-[var(--shadow-elevated)] max-w-[400px]"
      style={{ borderColor: accent }}
    >
      <div
        className="flex items-center justify-center w-12 h-12 rounded-full mx-auto mb-3"
        style={{ background: accent }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--paper)]"
        >
          <line x1="12" y1="8" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="1" />
        </svg>
      </div>
      <div className="text-[15.5px] leading-snug text-[var(--ink)]">{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 inline-flex items-center h-[32px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:bg-[var(--paper)] transition-colors"
      >
        Dismiss · 关闭
      </button>
    </div>
  );
}

function ManualRow({
  row,
  posting,
  onCheckIn,
  onUndo,
}: {
  row: ManualSearchRow;
  posting: boolean;
  onCheckIn: () => void;
  onUndo: () => void;
}) {
  const isCheckedIn = row.checked_in_at !== null;
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
          {row.group_no !== null ? `Group ${row.group_no} · ` : ""}
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
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}
