"use client";

import { useEffect, useRef, useState } from "react";

// Video/audio player with signed-URL refresh + resume-position memory.
// The server hands us an initial signed URL (10-min TTL); 8 minutes in
// we poll /api/me/recordings/[id]/signed-url for a fresh URL and swap
// it on the <video> element, preserving currentTime + playback state.
//
// Resume position is stored in localStorage per (recording_id) so the
// next visit restarts where the user left off. No server persist for v1.

const REFRESH_BEFORE_EXPIRY_MS = 8 * 60 * 1000; // 8 min — gives 2 min margin
const RESUME_KEY_PREFIX = "gmc-recording-resume:";

export function VideoPlayer({
  recordingId,
  initialSignedUrl,
  mimeType,
}: {
  recordingId: string;
  initialSignedUrl: string;
  mimeType: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState(initialSignedUrl);
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<number>(0);

  // On mount: restore resume position.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const raw = window.localStorage.getItem(RESUME_KEY_PREFIX + recordingId);
      if (raw) {
        const t = Number(raw);
        if (Number.isFinite(t) && t > 5) {
          el.currentTime = t;
        }
      }
    } catch {
      /* noop */
    }
  }, [recordingId]);

  // Save resume position every 5s of playback.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onTimeUpdate() {
      if (!el) return;
      const now = Date.now();
      if (now - lastSavedRef.current < 5000) return;
      lastSavedRef.current = now;
      try {
        window.localStorage.setItem(RESUME_KEY_PREFIX + recordingId, String(el.currentTime));
      } catch {
        /* noop */
      }
    }
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, [recordingId]);

  // Signed-URL refresh loop.
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/me/recordings/${encodeURIComponent(recordingId)}/signed-url`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { signed_url?: string };
        if (json.signed_url && !cancelled) {
          const el = ref.current;
          const wasPaused = el?.paused ?? true;
          const ct = el?.currentTime ?? 0;
          setSrc(json.signed_url);
          // After src swap, restore playback state.
          requestAnimationFrame(() => {
            if (!el) return;
            el.currentTime = ct;
            if (!wasPaused) {
              void el.play().catch(() => {
                /* noop */
              });
            }
          });
        }
      } catch {
        /* swallow — playback continues until URL actually expires */
      }
    }, REFRESH_BEFORE_EXPIRY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [recordingId, src]);

  // Audio MIME types render as <audio>; video as <video>.
  const isAudio = mimeType.startsWith("audio/");

  return (
    <div>
      {isAudio ? (
        <audio
          ref={ref as unknown as React.RefObject<HTMLAudioElement>}
          src={src}
          controls
          preload="metadata"
          className="w-full h-12 bg-black"
          onError={() =>
            setError("Could not load this recording. Try refreshing the page.")
          }
        />
      ) : (
        <video
          ref={ref}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-[70vh] bg-black"
          onError={() =>
            setError("Could not load this recording. Try refreshing the page.")
          }
        />
      )}
      {error ? (
        <div
          role="alert"
          className="px-4 py-3 text-[13px] text-[var(--cinnabar-deep)] bg-[var(--cinnabar-wash)] border-t border-[var(--cinnabar)]/30"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
