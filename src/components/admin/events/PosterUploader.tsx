"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  eventId: string;
  initialUrl: string | null;
  canEdit: boolean;
};

const MAX_MB = 15;
const ACCEPT = "image/jpeg,image/png,image/webp";

export function PosterUploader({ eventId, initialUrl, canEdit }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
      const res = await fetch(`/api/admin/events/${eventId}/poster`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: true; url: string | null };
      setUrl(data.url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removePoster() {
    setError(null);
    setRemoving(true);
    try {
      const body = new FormData();
      body.append("action", "remove");
      const res = await fetch(`/api/admin/events/${eventId}/poster`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Remove failed (${res.status})`);
      }
      setUrl(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  const busy = uploading || removing;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        onDragEnter={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          onFile(f);
        }}
        className={`relative aspect-[16/9] rounded-[var(--radius-lg)] overflow-hidden
                    border-2 border-dashed
                    transition-[background-color,border-color] duration-[var(--dur-fast)]
                    ${
                      dragOver
                        ? "border-[var(--cinnabar)]/70 bg-[var(--cinnabar-wash)]"
                        : "border-[var(--paper-shadow)] bg-[var(--paper-deep)]"
                    }`}
      >
        {url ? (
          <Image
            src={url}
            alt="Event poster"
            fill
            sizes="(max-width: 1024px) 100vw, 720px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
            style={{
              backgroundImage:
                "radial-gradient(540px 340px at 50% 30%, rgba(37,99,235,0.06), transparent 65%)",
            }}
          >
            <span
              className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--paper)] border border-[var(--paper-shadow)] text-[var(--cinnabar)]"
              aria-hidden="true"
            >
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4.5" width="16" height="13" rx="1.8" />
                <circle cx="8" cy="9.5" r="1.6" />
                <path d="M3 14l4.5-4 3 3 3-3.5 5.5 5.5" />
              </svg>
            </span>
            <div>
              <div className="text-[13px] text-[var(--ink)]">
                {canEdit ? "Drop an image, or browse" : "No poster yet"}
              </div>
              {canEdit ? (
                <div className="mt-1 text-[11.5px] text-[var(--ink-mute)]">
                  JPEG · PNG · WebP · max {MAX_MB}MB · landscape works best
                </div>
              ) : null}
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

      {canEdit ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {url ? "Current poster" : "No poster"}
          </div>
          <div className="flex items-center gap-2">
            {url ? (
              <button
                type="button"
                onClick={removePoster}
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
      ) : null}

      {error ? (
        <div className="text-[12px] leading-[1.55] text-[var(--cinnabar-deep)]">
          {error}
        </div>
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
