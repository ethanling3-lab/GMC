"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CourseAssignmentView, SubmissionFileView } from "@/lib/course-portal-types";
import { SUBMISSION_ACCEPT_MIME, SUBMISSION_MAX_BYTES } from "@/lib/course-portal-types";

// One assignment card with an inline submission form. Handles text + file
// homework: existing files are pre-loaded and kept unless removed; newly
// picked files upload direct-to-storage via the upload-url route, then the
// full desired file list is saved through the submit route.

type SavedFile = { storage_path: string; filename: string; mime_type: string | null; byte_size: number | null };
type Stage = "idle" | "uploading" | "saving" | "done" | "error";

function fmtBytes(b: number | null): string {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uploadWithProgress(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function AssignmentSubmit({ assignment }: { assignment: CourseAssignmentView }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const allowsText = assignment.submission_type !== "file";
  const allowsFile = assignment.submission_type !== "text";

  const [text, setText] = useState(assignment.mine?.text_body ?? "");
  const [keptFiles, setKeptFiles] = useState<SubmissionFileView[]>(assignment.mine?.files ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const status = assignment.mine?.status ?? null;
  const title = assignment.title_cn ?? assignment.title_en ?? "Assignment";
  const altTitle = assignment.title_cn && assignment.title_en ? assignment.title_en : null;
  const description = assignment.description_cn ?? assignment.description_en ?? null;
  const kindLabel = assignment.kind === "report" ? "Report · 报告" : "Homework · 作业";
  const busy = stage === "uploading" || stage === "saving";

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    const picked: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > SUBMISSION_MAX_BYTES) {
        setError(`${f.name} is over 50 MB`);
        continue;
      }
      if (!SUBMISSION_ACCEPT_MIME.includes(f.type as (typeof SUBMISSION_ACCEPT_MIME)[number])) {
        setError(`${f.name}: unsupported file type`);
        continue;
      }
      picked.push(f);
    }
    if (picked.length > 0) setError(null);
    setNewFiles((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save(action: "draft" | "submit") {
    setError(null);
    try {
      // Upload any new files first.
      const uploaded: SavedFile[] = [];
      if (allowsFile && newFiles.length > 0) {
        setStage("uploading");
        for (const file of newFiles) {
          const signRes = await fetch(`/api/me/assignments/${assignment.id}/upload-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, mime_type: file.type }),
          });
          const signJson = await signRes.json().catch(() => ({}));
          if (!signRes.ok) throw new Error(signJson?.detail ?? "Could not get upload URL");
          await uploadWithProgress(signJson.upload_url, file);
          uploaded.push({
            storage_path: signJson.storage_path,
            filename: file.name,
            mime_type: file.type || null,
            byte_size: file.size,
          });
        }
      }

      const files: SavedFile[] = allowsFile
        ? [
            ...keptFiles.map((f) => ({
              storage_path: f.storage_path,
              filename: f.filename,
              mime_type: f.mime_type,
              byte_size: f.byte_size,
            })),
            ...uploaded,
          ]
        : [];

      setStage("saving");
      const res = await fetch(`/api/me/assignments/${assignment.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text_body: allowsText ? text : undefined, files }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          text_required: "Please write your answer.",
          file_required: "Please attach at least one file.",
          empty_submission: "Add text or a file before submitting.",
        };
        throw new Error(map[json?.error] ?? json?.detail ?? "Could not save");
      }
      setStage("done");
      setNewFiles([]);
      setTimeout(() => {
        setStage("idle");
        router.refresh();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStage("error");
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 shadow-[var(--shadow-paper-1)]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-[var(--cinnabar)]">
            {kindLabel}
          </div>
          <div className="mt-1.5 font-display text-[17px] leading-[1.25] text-[var(--ink)]">{title}</div>
          {altTitle ? <div className="text-[12.5px] italic text-[var(--ink-soft)]">{altTitle}</div> : null}
        </div>
        <div className="flex-none">
          {status === "submitted" ? (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[#5b9a5d]/12 text-[#3a6b3b]">
              ✓ Submitted · 已提交
            </span>
          ) : status === "draft" ? (
            <span className="text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[var(--ink-mute)]">
              Draft · 草稿
            </span>
          ) : (
            <span className="text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60 text-[var(--ink-faint)]">
              Not started · 未开始
            </span>
          )}
        </div>
      </div>

      {description ? (
        <p className="mt-3 text-[13px] leading-[1.7] text-[var(--ink-soft)] whitespace-pre-wrap max-w-[64ch]">
          {description}
        </p>
      ) : null}
      {assignment.due_at ? (
        <div className="mt-2 text-[11.5px] text-[var(--ink-mute)]">
          Due · 截止：<span className="tabular-nums">{fmtWhen(assignment.due_at)}</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {allowsText ? (
          <label className="block">
            <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Your answer · 你的回答
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={20000}
              placeholder="Write your homework or report here…"
              className="mt-1.5 w-full px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--paper-shadow)] text-[14px] leading-[1.6] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--cinnabar)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.14)] transition-[border-color,box-shadow] duration-[var(--dur-fast)] resize-y"
            />
          </label>
        ) : null}

        {allowsFile ? (
          <div>
            <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Attachments · 附件
            </span>
            {keptFiles.length > 0 || newFiles.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {keptFiles.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-3 text-[12.5px] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--paper)] border border-[var(--paper-shadow)]"
                  >
                    <span className="truncate text-[var(--ink)]">
                      {f.filename}
                      <span className="ml-2 text-[var(--ink-faint)] tabular-nums">{fmtBytes(f.byte_size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setKeptFiles((prev) => prev.filter((x) => x.id !== f.id))}
                      className="text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] text-[11px] tracking-[0.1em] uppercase flex-none"
                    >
                      Remove
                    </button>
                  </li>
                ))}
                {newFiles.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-3 text-[12.5px] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--cinnabar-wash)]/50 border border-[var(--cinnabar)]/20"
                  >
                    <span className="truncate text-[var(--ink)]">
                      {f.name}
                      <span className="ml-2 text-[var(--ink-faint)] tabular-nums">{fmtBytes(f.size)}</span>
                      <span className="ml-2 text-[10px] tracking-[0.14em] uppercase text-[var(--cinnabar-deep)]">new</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] text-[11px] tracking-[0.1em] uppercase flex-none"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={SUBMISSION_ACCEPT_MIME.join(",")}
              onChange={(e) => onPickFiles(e.target.files)}
              className="mt-2 block w-full text-[12.5px] text-[var(--ink-soft)]
                         file:mr-3 file:py-1.5 file:px-3 file:rounded-[var(--radius-pill)] file:border-0
                         file:bg-[var(--paper-deep)] file:text-[var(--ink)] file:text-[11px] file:tracking-[0.08em] file:uppercase
                         hover:file:bg-[var(--cinnabar-wash)] hover:file:text-[var(--cinnabar-deep)] cursor-pointer"
            />
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-3.5 py-2.5 text-[12.5px] text-[var(--cinnabar-deep)]"
          >
            {error}
          </div>
        ) : null}
        {stage === "done" ? (
          <div className="rounded-[var(--radius-md)] border border-[#5b9a5d]/30 bg-[#5b9a5d]/8 px-3.5 py-2.5 text-[12.5px] text-[#3a6b3b]">
            ✓ Saved · 已保存
          </div>
        ) : null}

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => save("submit")}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.06em] uppercase hover:bg-[var(--cinnabar-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
            style={{ color: "var(--paper-warm)" }}
          >
            {stage === "uploading"
              ? "Uploading…"
              : stage === "saving"
                ? "Saving…"
                : status === "submitted"
                  ? "Re-submit · 重新提交"
                  : "Submit · 提交"}
          </button>
          <button
            type="button"
            onClick={() => save("draft")}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] tracking-[0.06em] uppercase text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] active:translate-y-px disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
          >
            Save draft · 存草稿
          </button>
          {assignment.mine?.submitted_at && status === "submitted" ? (
            <span className="text-[11px] text-[var(--ink-faint)] tabular-nums">
              {fmtWhen(assignment.mine.submitted_at)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
