"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Direct browser → Supabase Storage upload. The Next API route mints a
// signed upload URL; we PUT the file straight to Supabase (bypassing the
// Netlify 26s system-handler timeout + payload limits). On success, we
// POST the metadata to insert the event_recordings row.

const ACCEPT = "video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/ogg";

type Stage = "idle" | "signing" | "uploading" | "saving" | "done" | "error";

export function RecordingUploader({ eventId }: { eventId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [titleCn, setTitleCn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setStage("idle");
    setProgress(0);
    setError(null);
    setFile(null);
    setTitleCn("");
    setTitleEn("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onUpload() {
    if (!file) {
      setError("Pick a file");
      return;
    }
    if (!titleEn.trim() && !titleCn.trim()) {
      setError("Add a title (EN or 中文)");
      return;
    }
    setError(null);
    setStage("signing");
    try {
      const signRes = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/recordings/upload-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mime_type: file.type || "video/mp4",
          }),
        },
      );
      const signJson = await signRes.json().catch(() => ({}));
      if (!signRes.ok) {
        throw new Error(signJson?.detail ?? "Could not get upload URL");
      }
      const { storage_path, upload_url } = signJson as { storage_path: string; upload_url: string };

      setStage("uploading");
      await uploadWithProgress(upload_url, file, (loaded, total) => {
        setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
      });

      setStage("saving");
      // Compute duration for video/audio if possible.
      const duration = await readDuration(file).catch(() => null);

      const saveRes = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/recordings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage_path,
            title_en: titleEn.trim() || undefined,
            title_cn: titleCn.trim() || undefined,
            mime_type: file.type || "video/mp4",
            byte_size: file.size,
            duration_seconds: duration,
          }),
        },
      );
      const saveJson = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        throw new Error(saveJson?.detail ?? "Could not save metadata");
      }

      setStage("done");
      setTimeout(() => {
        reset();
        router.refresh();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStage("error");
    }
  }

  const fieldClass =
    "mt-1.5 w-full px-3 h-10 rounded-[var(--radius-md)] bg-[var(--paper-warm)] " +
    "border border-[var(--paper-shadow)] text-[14px] text-[var(--ink)] " +
    "placeholder:text-[var(--ink-faint)] outline-none " +
    "focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] " +
    "transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Title · 标题 (中文)
          </span>
          <input
            type="text"
            value={titleCn}
            onChange={(e) => setTitleCn(e.target.value)}
            placeholder="例：黄金法则 Day 1"
            className={fieldClass}
            maxLength={200}
          />
        </label>
        <label className="block">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            Title · Title (English)
          </span>
          <input
            type="text"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder="e.g. Golden Principles Day 1"
            className={fieldClass}
            maxLength={200}
          />
        </label>
      </div>

      <div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setFile(f ?? null);
            setError(null);
          }}
          className="block w-full text-[13px] text-[var(--ink-soft)]
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-[var(--radius-pill)] file:border-0
                     file:bg-[var(--paper-deep)] file:text-[var(--ink)]
                     file:text-[12px] file:tracking-[0.08em] file:uppercase
                     hover:file:bg-[var(--cinnabar-wash)] hover:file:text-[var(--cinnabar-deep)]
                     cursor-pointer"
        />
        {file ? (
          <div className="mt-2 text-[11.5px] tabular-nums text-[var(--ink-mute)]">
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || "unknown"}
          </div>
        ) : null}
      </div>

      {stage === "uploading" ? (
        <div className="h-1.5 rounded-full bg-[var(--paper-deep)] overflow-hidden">
          <div
            className="h-full bg-[var(--cinnabar)] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] text-[var(--cinnabar-deep)]"
        >
          {error}
        </div>
      ) : null}

      {stage === "done" ? (
        <div className="rounded-[var(--radius-md)] border border-[#5b9a5d]/30 bg-[#5b9a5d]/8 px-4 py-3 text-[13px] text-[#3a6b3b]">
          ✓ Uploaded · 已上传
        </div>
      ) : null}

      <button
        type="button"
        onClick={onUpload}
        disabled={stage === "signing" || stage === "uploading" || stage === "saving" || !file}
        className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
        style={{ color: "var(--paper-warm)" }}
      >
        {stage === "signing"
          ? "Preparing…"
          : stage === "uploading"
            ? `Uploading… ${progress}%`
            : stage === "saving"
              ? "Saving…"
              : "Upload recording · 上传"}
      </button>
    </div>
  );
}

function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

async function readDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio") as
      | HTMLVideoElement
      | HTMLAudioElement;
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = isFinite(el.duration) ? Math.round(el.duration) : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}
