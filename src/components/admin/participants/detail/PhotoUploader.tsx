"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractEmbeddingFromImage } from "@/lib/face-recognition/extract";

type EmbeddingState =
  | "idle"
  | "extracting"
  | "computed"
  | "skipped_no_consent"
  | "failed";

type Props = {
  participantId: string;
  initialUrl: string | null;
  initials: string;
  consent: boolean;
  initialEmbeddingState: EmbeddingState;
  initialEmbeddingDetail?: string | null;
};

const MAX_MB = 5;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export function PhotoUploader({
  participantId,
  initialUrl,
  initials,
  consent,
  initialEmbeddingState,
  initialEmbeddingDetail = null,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [embeddingState, setEmbeddingState] = useState<EmbeddingState>(
    initialEmbeddingState,
  );
  const [embeddingDetail, setEmbeddingDetail] = useState<string | null>(
    initialEmbeddingDetail,
  );

  // M7.1c — kick off face-embedding extraction whenever a fresh photo
  // URL is available + the participant has consented. Failures are
  // logged + surfaced in the embedding-status pill below the image; they
  // never block the upload itself.
  async function recomputeEmbedding(photoUrl: string) {
    if (!consent) {
      setEmbeddingState("skipped_no_consent");
      return;
    }
    setEmbeddingState("extracting");
    setEmbeddingDetail(null);
    try {
      const result = await extractEmbeddingFromImage(photoUrl);
      const body = result.ok
        ? { embedding: result.embedding, confidence: result.confidence }
        : { error: result.error, detail: result.detail };
      const res = await fetch(
        `/api/admin/participants/${participantId}/face-embedding`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setEmbeddingState("failed");
        setEmbeddingDetail(payload.error ?? `persist_failed_${res.status}`);
        return;
      }
      if (result.ok) {
        setEmbeddingState("computed");
        setEmbeddingDetail(null);
      } else {
        setEmbeddingState("failed");
        setEmbeddingDetail(result.error);
      }
    } catch (err) {
      setEmbeddingState("failed");
      setEmbeddingDetail(err instanceof Error ? err.message : "unknown");
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);

    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Image is larger than ${MAX_MB}MB.`);
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("action", "upload");
      body.append("file", file);
      const res = await fetch(
        `/api/admin/participants/${participantId}/photo`,
        {
          method: "POST",
          body,
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: true; url: string | null };
      setUrl(data.url);
      router.refresh();
      if (data.url) {
        // Fire-and-forget; the spinner already turned off but the
        // embedding pill conveys ongoing state. Failure here is fine —
        // admin can hit the re-compute button later.
        void recomputeEmbedding(data.url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removePhoto() {
    setError(null);
    setRemoving(true);
    try {
      const body = new FormData();
      body.append("action", "remove");
      const res = await fetch(
        `/api/admin/participants/${participantId}/photo`,
        {
          method: "POST",
          body,
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Remove failed (${res.status})`);
      }
      setUrl(null);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Remove failed";
      setError(msg);
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || removing;

  return (
    <div className="relative rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
      {/*
        Photo area takes the uploaded image's NATIVE aspect ratio — the
        cell adapts to the photo, not the other way around. No cropping,
        no padding around the image. When there's no photo, fall back
        to a fixed 4:7 placeholder so the empty state has a known size.
      */}
      <div className="relative">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Participant photo"
            className="block w-full h-auto"
          />
        ) : (
          <div
            className="relative aspect-[4/7] flex flex-col items-center justify-center gap-4"
            style={{
              backgroundImage:
                "radial-gradient(540px 340px at 50% 20%, rgba(37,99,235,0.08), transparent 65%)," +
                "linear-gradient(180deg, var(--paper) 0%, var(--paper-deep) 100%)",
            }}
          >
            <span
              className="inline-flex items-center justify-center w-20 h-20 rounded-full
                         bg-[var(--ink)] text-[var(--paper-warm)]
                         font-display text-[28px] tracking-[0.02em]
                         shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_28px_rgba(11,41,84,0.22)]"
              aria-hidden="true"
            >
              {initials}
            </span>
            <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-faint)]">
              No photo yet
            </div>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 bg-[var(--ink)]/35 backdrop-blur-[2px] flex items-center justify-center">
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] text-[12px] tracking-[0.08em] uppercase text-[var(--ink)]">
              <Spinner />
              {uploading ? "Uploading" : "Removing"}
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-5 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-between gap-3">
        <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
          Front photo · 正脸
        </span>
        <div className="flex items-center gap-2">
          {url ? (
            <button
              type="button"
              onClick={removePhoto}
              disabled={busy}
              className="text-[11px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper)]
                       text-[11.5px] text-[var(--ink-soft)]
                       hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1.5 7.5v1a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-1" />
              <path d="M5 1v5.5M3 3l2-2 2 2" />
            </svg>
            {url ? "Replace" : "Upload"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {error ? (
        <div className="px-5 pb-4 text-[12px] leading-[1.55] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      <EmbeddingPill
        consent={consent}
        state={embeddingState}
        detail={embeddingDetail}
        canRecompute={!!url && !uploading && !removing}
        onRecompute={() => {
          if (url) void recomputeEmbedding(url);
        }}
      />
    </div>
  );
}

function EmbeddingPill({
  consent,
  state,
  detail,
  canRecompute,
  onRecompute,
}: {
  consent: boolean;
  state: EmbeddingState;
  detail: string | null;
  canRecompute: boolean;
  onRecompute: () => void;
}) {
  if (!consent) {
    return (
      <div className="px-5 pb-4 text-[11px] tracking-[0.04em] text-[var(--ink-faint)] flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--paper-shadow)]" />
        Face-match · 人脸识别: not consented
      </div>
    );
  }
  if (state === "extracting") {
    return (
      <div className="px-5 pb-4 text-[11px] tracking-[0.04em] text-[var(--ink-mute)] flex items-center gap-1.5">
        <Spinner />
        Face-match · 人脸识别: computing embedding
      </div>
    );
  }
  if (state === "computed") {
    return (
      <div className="px-5 pb-4 text-[11px] tracking-[0.04em] flex items-center gap-2 text-[var(--ink-mute)]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]" />
        <span>Face-match · 人脸识别: ready</span>
        {canRecompute ? (
          <button
            type="button"
            onClick={onRecompute}
            className="ml-auto text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] transition-colors"
          >
            Recompute
          </button>
        ) : null}
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="px-5 pb-4 text-[11px] tracking-[0.04em] flex items-center gap-2 text-[var(--cinnabar-deep)]">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--cinnabar-deep)]" />
        <span>
          Face-match · 人脸识别: failed{detail ? ` · ${detail}` : ""}
        </span>
        {canRecompute ? (
          <button
            type="button"
            onClick={onRecompute}
            className="ml-auto text-[10.5px] tracking-[0.12em] uppercase text-[var(--cinnabar)] hover:text-[var(--cinnabar-deep)] transition-colors"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  // idle / skipped_no_consent already covered above; this is "consented
  // but never extracted" — surface a compute CTA.
  return (
    <div className="px-5 pb-4 text-[11px] tracking-[0.04em] flex items-center gap-2 text-[var(--ink-mute)]">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--paper-shadow)]" />
      <span>Face-match · 人脸识别: pending</span>
      {canRecompute ? (
        <button
          type="button"
          onClick={onRecompute}
          className="ml-auto text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar)] transition-colors"
        >
          Compute now
        </button>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
