"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { CheckInStats } from "@/lib/check-in/types";
import type { FaceBankEntry, FaceMatch } from "@/lib/face-recognition/types";
import { DEFAULT_DISTANCE_THRESHOLD } from "@/lib/face-recognition/types";
import { findBestMatch } from "@/lib/face-recognition/match";
import { extractEmbeddingFromVideo } from "@/lib/face-recognition/extract";
import { loadModels } from "@/lib/face-reading/analyzer.client";
import { useWakeLock } from "@/lib/check-in/use-wake-lock";
import {
  playError,
  playSuccess,
  playWarn,
  primeAudio,
} from "@/lib/check-in/audio-cues";
import { OnSpotCaptureDialog } from "./OnSpotCaptureDialog";

// M7.1c — face-recognition replacement for the QR scanner. Loads the
// per-event embedding bank server-side, runs the live camera through
// face-api.js's recognition net, surfaces a best match with admin
// confirmation. Manual search stays as the always-on fallback.

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventTitleCn: string | null;
  initialStats: CheckInStats;
  bank: FaceBankEntry[];
  bankSummary: {
    total_eligible: number;
    with_consent: number;
    with_embedding: number;
  };
  // Allow ?threshold=0.55 URL override for tuning during smoke.
  thresholdOverride?: number | null;
};

type FrameState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "match"; match: FaceMatch }
  | { kind: "no_match"; sinceMs: number }
  | { kind: "error"; message: string };

type ConfirmState =
  | { kind: "idle" }
  | { kind: "posting" }
  | { kind: "ok"; participantName: string }
  | { kind: "err"; message: string };

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
  has_photo: boolean;
  has_embedding: boolean;
  consented: boolean;
};

const STATS_POLL_MS = 5000;
const FRAME_TICK_MS = 350;        // detection cadence — generous for phones
const NO_MATCH_GRACE_MS = 3000;   // wait this long before nudging to manual
const COOLDOWN_MS = 1800;
const SEARCH_DEBOUNCE_MS = 220;

export function FaceScannerStation({
  eventId,
  eventSlug,
  eventTitle,
  eventTitleCn,
  initialStats,
  bank,
  bankSummary,
  thresholdOverride,
}: Props) {
  const threshold = thresholdOverride ?? DEFAULT_DISTANCE_THRESHOLD;

  const [stats, setStats] = useState<CheckInStats>(initialStats);
  const [modelState, setModelState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState<boolean>(true);
  const [frame, setFrame] = useState<FrameState>({ kind: "idle" });
  const [confirmState, setConfirmState] = useState<ConfirmState>({ kind: "idle" });

  // M7.1d — keep the iPad / phone awake while the scanner is the
  // foreground tab. Silent no-op on unsupported browsers.
  useWakeLock(cameraOn && modelState === "ready");

  // Prime the Web Audio context on the first user gesture so iOS Safari
  // allows programmatic playback for the rest of the session.
  useEffect(() => {
    const handler = () => primeAudio();
    document.addEventListener("pointerdown", handler, { once: true });
    document.addEventListener("keydown", handler, { once: true });
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  const ignoreUntilRef = useRef<number>(0);
  const seenFaceAtRef = useRef<number | null>(null);
  const cooldownRef = useRef<number | null>(null);

  // Manual search fallback ----------------------------------------------
  const [manualQ, setManualQ] = useState<string>("");
  const [searchRows, setSearchRows] = useState<ManualSearchRow[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  // M7.1d — on-spot capture target. When set, OnSpotCaptureDialog opens.
  const [captureTarget, setCaptureTarget] = useState<ManualSearchRow | null>(null);

  // --- Stats poll ------------------------------------------------------
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { stats: CheckInStats };
      if (json.stats) setStats(json.stats);
    } catch {
      /* silent */
    }
  }, [eventId]);

  useEffect(() => {
    const t = window.setInterval(refreshStats, STATS_POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshStats]);

  // --- Model + camera lifecycle ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadModels();
        if (!cancelled) setModelState("ready");
      } catch (err) {
        if (cancelled) return;
        setModelState("error");
        setModelError(err instanceof Error ? err.message : "unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cameraOn) {
      stopCamera();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setModelState("error");
        setModelError(
          err instanceof Error
            ? `Camera: ${err.message}`
            : "Camera unavailable",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  // --- Detection loop --------------------------------------------------
  useEffect(() => {
    if (modelState !== "ready" || !cameraOn) return;
    if (confirmState.kind === "posting" || confirmState.kind === "ok") return;

    const tick = async () => {
      const now = Date.now();
      if (now < ignoreUntilRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        const result = await extractEmbeddingFromVideo(video);
        if (!result.ok) {
          // No face this frame — reset the no-match grace timer.
          if (frame.kind !== "no_match" && frame.kind !== "match") {
            seenFaceAtRef.current = null;
            setFrame({ kind: "idle" });
          }
          return;
        }
        if (seenFaceAtRef.current === null) seenFaceAtRef.current = now;
        const match = findBestMatch(result.embedding, bank, { threshold });
        if (match) {
          setFrame({ kind: "match", match });
        } else {
          const since = now - (seenFaceAtRef.current ?? now);
          setFrame({ kind: "no_match", sinceMs: since });
        }
      } catch {
        // Single-frame failures are normal; don't surface unless persistent.
      }
    };

    tickRef.current = window.setInterval(tick, FRAME_TICK_MS);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelState, cameraOn, bank, threshold, confirmState.kind]);

  // --- Confirmation actions --------------------------------------------
  const performConfirm = useCallback(
    async (entry: FaceBankEntry) => {
      if (confirmState.kind === "posting") return;
      setConfirmState({ kind: "posting" });
      try {
        const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollment_id: entry.enrollment_id,
            method: "face_match",
          }),
        });
        const json = (await res.json()) as unknown;
        if (res.status === 200 && (json as { ok?: boolean }).ok === true) {
          setConfirmState({
            kind: "ok",
            participantName:
              entry.name_cn ?? entry.name_en ?? entry.region_id ?? "—",
          });
          playSuccess();
          void refreshStats();
        } else if ((json as { error?: string }).error === "already_checked_in") {
          setConfirmState({
            kind: "err",
            message: "Already checked in · 已签到",
          });
          playWarn();
          void refreshStats();
        } else {
          const err = (json as { error?: string }).error ?? "server_error";
          setConfirmState({
            kind: "err",
            message: `Check-in failed · ${err}`,
          });
          playError();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setConfirmState({ kind: "err", message: msg });
        playError();
      } finally {
        if (cooldownRef.current !== null)
          window.clearTimeout(cooldownRef.current);
        cooldownRef.current = window.setTimeout(() => {
          setConfirmState({ kind: "idle" });
          setFrame({ kind: "idle" });
          seenFaceAtRef.current = null;
        }, COOLDOWN_MS);
      }
    },
    [eventId, confirmState.kind, refreshStats],
  );

  const dismissMatch = useCallback(() => {
    // Ignore the rejected face for a few seconds so we don't immediately
    // re-match the same person and re-show the same wrong card.
    ignoreUntilRef.current = Date.now() + 5000;
    setFrame({ kind: "idle" });
    seenFaceAtRef.current = null;
  }, []);

  // --- Manual search ---------------------------------------------------
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

  const performManualCheckIn = useCallback(
    async (row: ManualSearchRow) => {
      if (postingId) return;
      setPostingId(row.enrollment_id);
      try {
        const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollment_id: row.enrollment_id,
            method: "manual",
          }),
        });
        if (res.ok) {
          void refreshStats();
          // Re-fetch the manual list to flip the row to "checked in".
          if (manualQ) {
            const r = await fetch(
              `/api/admin/events/${eventId}/check-in/search?q=${encodeURIComponent(manualQ)}`,
              { cache: "no-store" },
            );
            if (r.ok) {
              const j = (await r.json()) as { rows: ManualSearchRow[] };
              setSearchRows(j.rows ?? []);
            }
          }
        }
      } finally {
        setPostingId(null);
      }
    },
    [eventId, manualQ, postingId, refreshStats],
  );

  // --- Derived ---------------------------------------------------------
  const pct = useMemo(() => {
    if (stats.total_eligible === 0) return 0;
    return Math.round((stats.total_checked_in / stats.total_eligible) * 100);
  }, [stats]);

  const consentCoverage = useMemo(() => {
    if (bankSummary.total_eligible === 0) return 0;
    return Math.round(
      (bankSummary.with_embedding / bankSummary.total_eligible) * 100,
    );
  }, [bankSummary]);

  // --- Render ----------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Face check-in · 人脸签到 · {eventSlug}
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

      {/* Live counter */}
      <div className="flex items-center gap-3 flex-wrap">
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
          Indexed {bankSummary.with_embedding} / {bankSummary.total_eligible} ·
          {" "}
          {consentCoverage}%
        </span>
      </div>

      {/* Camera card */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-paper)]">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
            {modelState === "ready"
              ? "Aim camera at participant's face · 对准人脸"
              : modelState === "loading"
                ? "Loading face model · 加载中"
                : "Face model error · 加载失败"}
          </div>
          <button
            type="button"
            onClick={() => {
              primeAudio();
              setCameraOn((v) => !v);
            }}
            className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
          >
            {cameraOn ? "Pause · 暂停" : "Resume · 继续"}
          </button>
        </div>
        <div className="relative aspect-square sm:aspect-[4/3] bg-black/85 m-4 mt-3 rounded-[18px] overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover"
          />
          {/* live overlay status */}
          {confirmState.kind === "idle" || confirmState.kind === "err" ? (
            <ScannerOverlay
              modelState={modelState}
              frame={frame}
              cameraOn={cameraOn}
              threshold={threshold}
              onConfirm={(entry) => void performConfirm(entry)}
              onDismiss={dismissMatch}
              errorBanner={
                confirmState.kind === "err" ? confirmState.message : null
              }
            />
          ) : null}
          {confirmState.kind === "posting" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/55 text-[var(--paper)] text-[14px] tracking-[0.06em]">
              Checking in · 签到中…
            </div>
          ) : null}
          {confirmState.kind === "ok" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/55 px-6 py-8 text-center">
              <SuccessCard name={confirmState.participantName} />
            </div>
          ) : null}
        </div>
        {modelError ? (
          <div className="px-5 pb-4 text-[11.5px] text-[var(--ink-soft)]">
            <strong className="text-[var(--cinnabar)]">Camera / model:</strong>{" "}
            {modelError} · Try refreshing or allow camera permission in your
            browser site settings.
          </div>
        ) : null}
        {bankSummary.with_embedding < bankSummary.total_eligible / 2 ? (
          <div className="px-5 pb-4 text-[11.5px] text-[var(--ink-soft)]">
            <strong className="text-[var(--cinnabar)]">Heads up:</strong>{" "}
            Only {bankSummary.with_embedding} of {bankSummary.total_eligible}{" "}
            attendees are face-indexed. Use the manual search below for the
            rest.
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
              <li
                key={row.enrollment_id}
                className="px-5 py-2.5 flex items-center gap-3 hover:bg-[var(--paper)]/40 transition-colors"
              >
                <span className="inline-flex items-center justify-center h-[22px] min-w-[44px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] font-medium text-[var(--ink-mute)] tabular-nums">
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
                {row.checked_in_at ? (
                  <span className="inline-flex items-center h-[40px] px-3 rounded-[var(--radius-pill)] bg-[var(--cinnabar)]/10 text-[var(--cinnabar)] text-[11px] tracking-[0.04em]">
                    ✓ Checked in
                  </span>
                ) : !row.has_embedding ? (
                  <button
                    type="button"
                    onClick={() => setCaptureTarget(row)}
                    className="inline-flex items-center h-[40px] px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.04em] font-medium hover:opacity-90 transition-opacity"
                    title="No face on file — capture now and check in"
                  >
                    Capture & check in
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void performManualCheckIn(row)}
                    disabled={postingId === row.enrollment_id}
                    className="inline-flex items-center h-[40px] px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.04em] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {postingId === row.enrollment_id ? "…" : "Check in"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <OnSpotCaptureDialog
        open={captureTarget !== null}
        onClose={() => setCaptureTarget(null)}
        onSuccess={() => {
          void refreshStats();
          if (manualQ) {
            // Re-run search so the captured row flips to "checked in"
            void (async () => {
              const r = await fetch(
                `/api/admin/events/${eventId}/check-in/search?q=${encodeURIComponent(manualQ)}`,
                { cache: "no-store" },
              );
              if (r.ok) {
                const j = (await r.json()) as { rows: ManualSearchRow[] };
                setSearchRows(j.rows ?? []);
              }
            })();
          }
        }}
        eventId={eventId}
        participant={
          captureTarget ?? {
            enrollment_id: "",
            participant_id: "",
            region_id: null,
            name_cn: null,
            name_en: null,
          }
        }
      />
    </div>
  );
}

function ScannerOverlay({
  modelState,
  frame,
  cameraOn,
  threshold,
  onConfirm,
  onDismiss,
  errorBanner,
}: {
  modelState: "loading" | "ready" | "error";
  frame: FrameState;
  cameraOn: boolean;
  threshold: number;
  onConfirm: (entry: FaceBankEntry) => void;
  onDismiss: () => void;
  errorBanner: string | null;
}) {
  if (errorBanner) {
    return (
      <div className="absolute inset-x-0 bottom-0 m-3 rounded-[12px] bg-[var(--cinnabar)] text-[var(--paper)] px-4 py-3 text-[13px] flex items-center justify-between">
        <span>{errorBanner}</span>
      </div>
    );
  }
  if (!cameraOn) {
    return (
      <div className="absolute inset-0 grid place-items-center text-[var(--paper-deep)] text-[12px] tracking-[0.12em] uppercase">
        Paused · 暂停
      </div>
    );
  }
  if (modelState === "loading") {
    return (
      <div className="absolute inset-x-0 bottom-0 m-3 rounded-[12px] bg-black/55 text-[var(--paper)] px-4 py-3 text-[12px] tracking-[0.08em]">
        Loading face model · 加载人脸模型 (~5MB, first time only)
      </div>
    );
  }
  if (frame.kind === "match") {
    const { match } = frame;
    return (
      <div className="absolute inset-x-0 bottom-0 m-3 rounded-[14px] bg-[var(--paper-warm)] border border-[var(--paper-deep)] shadow-[var(--shadow-elevated)] p-3 flex items-center gap-3">
        {match.entry.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={match.entry.photo_url}
            alt=""
            className="w-20 h-20 rounded-[10px] object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-[10px] bg-[var(--paper-deep)] flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-display text-[17px] leading-tight text-[var(--ink)] truncate">
            {match.entry.name_cn ?? match.entry.name_en ?? "—"}
          </div>
          <div className="text-[10.5px] tracking-[0.08em] uppercase text-[var(--ink-mute)] tabular-nums flex items-center gap-2 mt-0.5">
            <span>{match.entry.region_id ?? "—"}</span>
            {match.entry.group_no !== null ? (
              <span className="opacity-80">· Group {match.entry.group_no}</span>
            ) : null}
            <span className="opacity-50">·</span>
            <span className="opacity-70">
              dist {match.distance.toFixed(3)} / thr {threshold.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onConfirm(match.entry)}
            className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.06em] font-medium hover:opacity-90 transition-opacity"
          >
            Confirm · 确认
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper)] text-[var(--ink-mute)] text-[11px] tracking-[0.06em] border border-[var(--paper-deep)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar)] transition-colors"
          >
            Not this person
          </button>
        </div>
      </div>
    );
  }
  if (frame.kind === "no_match" && frame.sinceMs > NO_MATCH_GRACE_MS) {
    return (
      <div className="absolute inset-x-0 bottom-0 m-3 rounded-[12px] bg-[var(--gold-soft,#FFF4E0)] border border-[var(--gold)]/30 text-[var(--ink-soft)] px-4 py-3 text-[12.5px]">
        Couldn't match this face · 未能识别。Try the manual search below ·
        请用手动查找
      </div>
    );
  }
  return null;
}

function SuccessCard({ name }: { name: string }) {
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
      <div className="font-display text-[24px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
        {name}
      </div>
      <div className="mt-2 text-[10.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
        Checked in · 已签到
      </div>
    </div>
  );
}
