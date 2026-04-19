"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  eventId: string;
  initialImages: string[]; // first = hero (a.k.a. poster_url)
  canEdit: boolean;
};

const MAX_MB = 15;
const ACCEPT = "image/jpeg,image/png,image/webp";

export function PosterUploader({
  eventId,
  initialImages,
  canEdit,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>(initialImages);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [pending, setPending] = useState<string | null>(null); // url currently being acted on
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const hero = images[0] ?? null;
  const showIdx = Math.min(activeIndex, Math.max(0, images.length - 1));
  const showing = images[showIdx] ?? null;

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setError(null);

    for (const file of files) {
      if (file.size > MAX_MB * 1024 * 1024) {
        setError(`"${file.name}" is larger than ${MAX_MB}MB — skipped.`);
        continue;
      }
      setUploadingCount((c) => c + 1);
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
        const data = (await res.json()) as { ok: true; images: string[] };
        setImages(data.images);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }

    router.refresh();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function removeImage(url: string) {
    setError(null);
    setPending(url);
    try {
      const body = new FormData();
      body.append("action", "remove");
      body.append("url", url);
      const res = await fetch(`/api/admin/events/${eventId}/poster`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Remove failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: true; images: string[] };
      setImages(data.images);
      setActiveIndex((i) => Math.min(i, Math.max(0, data.images.length - 1)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setPending(null);
    }
  }

  async function setHero(url: string) {
    if (url === hero) return;
    setError(null);
    setPending(url);
    try {
      const body = new FormData();
      body.append("action", "set_hero");
      body.append("url", url);
      const res = await fetch(`/api/admin/events/${eventId}/poster`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Update failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: true; images: string[] };
      setImages(data.images);
      setActiveIndex(0);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(null);
    }
  }

  const uploading = uploadingCount > 0;
  const busy = uploading || pending !== null;

  return (
    <div className="flex flex-col gap-3">
      {/* Hero / active preview */}
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
          const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
            f.type.startsWith("image/"),
          );
          uploadFiles(files);
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
        {showing ? (
          <Image
            src={showing}
            alt={showIdx === 0 ? "Event hero" : `Slide ${showIdx + 1}`}
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
                {canEdit ? "Drop images here, or browse" : "No poster yet"}
              </div>
              {canEdit ? (
                <div className="mt-1 text-[11.5px] text-[var(--ink-mute)]">
                  JPEG · PNG · WebP · max {MAX_MB}MB each · first image is the hero
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Hero ribbon */}
        {showing && showIdx === 0 ? (
          <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--ink)]/85 text-[var(--paper-warm)] text-[10px] tracking-[0.22em] uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
            Hero
          </div>
        ) : null}

        {/* Busy overlay */}
        {busy ? (
          <div className="absolute inset-0 bg-[var(--ink)]/35 backdrop-blur-[2px] flex items-center justify-center">
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] text-[12px] tracking-[0.08em] uppercase text-[var(--ink)]">
              <Spinner />
              {uploading
                ? `Uploading ${uploadingCount}…`
                : pending
                  ? "Updating"
                  : ""}
            </div>
          </div>
        ) : null}

        {/* Nav arrows when >1 image */}
        {images.length > 1 && showing ? (
          <>
            <button
              type="button"
              onClick={() =>
                setActiveIndex((i) => (i - 1 + images.length) % images.length)
              }
              aria-label="Previous slide"
              className="absolute top-1/2 -translate-y-1/2 left-3 w-9 h-9 rounded-full bg-[var(--paper-warm)]/90 hover:bg-[var(--paper-warm)] text-[var(--ink)] shadow-[var(--shadow-paper-1)] inline-flex items-center justify-center transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8.5 3L5 7l3.5 4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((i) => (i + 1) % images.length)}
              aria-label="Next slide"
              className="absolute top-1/2 -translate-y-1/2 right-3 w-9 h-9 rounded-full bg-[var(--paper-warm)]/90 hover:bg-[var(--paper-warm)] text-[var(--ink)] shadow-[var(--shadow-paper-1)] inline-flex items-center justify-center transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5.5 3L9 7l-3.5 4" />
              </svg>
            </button>
            <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-[var(--ink)]/70 text-[var(--paper-warm)] text-[10px] tracking-[0.14em] font-mono">
              {showIdx + 1} / {images.length}
            </div>
          </>
        ) : null}
      </div>

      {/* Thumbnail strip + add button */}
      {(images.length > 0 || canEdit) ? (
        <div className="flex flex-wrap items-stretch gap-2">
          {images.map((url, i) => {
            const isHero = i === 0;
            const isActive = i === showIdx;
            const rowBusy = pending === url;
            return (
              <div
                key={url}
                className={`relative group w-[110px] aspect-[16/10] rounded-[var(--radius-md)] overflow-hidden border
                            transition-[border-color,transform] duration-[var(--dur-fast)]
                            ${
                              isActive
                                ? "border-[var(--cinnabar)]/60 shadow-[0_0_0_2px_var(--cinnabar-wash)]"
                                : "border-[var(--paper-shadow)]"
                            }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  aria-label={`Show slide ${i + 1}`}
                  className="absolute inset-0"
                >
                  <Image
                    src={url}
                    alt={`Slide ${i + 1}`}
                    fill
                    sizes="110px"
                    className="object-cover"
                    unoptimized
                  />
                </button>

                {isHero ? (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-[var(--ink)]/85 text-[var(--paper-warm)] text-[8px] tracking-[0.22em] uppercase">
                    Hero
                  </span>
                ) : null}

                {canEdit ? (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1 py-1 bg-[var(--ink)]/70 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-fast)]">
                    {!isHero ? (
                      <button
                        type="button"
                        onClick={() => setHero(url)}
                        disabled={busy}
                        className="text-[9.5px] tracking-[0.1em] uppercase text-[var(--paper-warm)] hover:text-[var(--cinnabar-soft)] disabled:opacity-50"
                      >
                        Make hero
                      </button>
                    ) : (
                      <span className="text-[9.5px] tracking-[0.1em] uppercase text-[var(--paper-warm)]/60">
                        Hero
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(url)}
                      disabled={busy}
                      aria-label="Remove image"
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--paper-warm)]/10 hover:bg-[var(--cinnabar)] text-[var(--paper-warm)] disabled:opacity-50 transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    </button>
                  </div>
                ) : null}

                {rowBusy ? (
                  <div className="absolute inset-0 bg-[var(--ink)]/50 flex items-center justify-center">
                    <Spinner />
                  </div>
                ) : null}
              </div>
            );
          })}

          {canEdit ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="w-[110px] aspect-[16/10] rounded-[var(--radius-md)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]
                         flex flex-col items-center justify-center gap-1.5
                         text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 3v8M3 7h8" />
              </svg>
              <span className="text-[10px] tracking-[0.18em] uppercase">
                Add
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Hidden file input (multiple) */}
      {canEdit ? (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) =>
            uploadFiles(Array.from(e.target.files ?? []))
          }
        />
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
