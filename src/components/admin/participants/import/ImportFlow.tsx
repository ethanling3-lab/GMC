"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  GENDERS,
  LANGUAGES,
  MOTIVATIONS,
  REGIONS,
  type ExtractedRow,
} from "@/lib/participant-import-schema";

type Stage = "idle" | "extracting" | "reviewing" | "importing" | "done";

type JobStatus = "pending" | "running" | "done" | "error";

type StatusResponse = {
  jobId: string;
  status: JobStatus;
  rows: ExtractedRow[];
  summary: string;
  source: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
};

type ExtractResponse = {
  rows: ExtractedRow[];
  summary: string;
  source: string;
  usage?: { input_tokens: number; output_tokens: number };
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

type SaveResponse = {
  total: number;
  succeeded: number;
  failed: number;
  created: number;
  updated: number;
  results: Array<{
    index: number;
    ok: boolean;
    mode?: "created" | "updated";
    region_id?: string | null;
    error?: string;
  }>;
};

const ACCEPT = ".xlsx,.xls,.csv,.txt,.pdf";
const MAX_CLIENT_FILE_MB = 20;

const EMPTY_ROW: ExtractedRow = {
  region_id: null,
  name_en: null,
  name_cn: null,
  email: null,
  phone: null,
  region: null,
  language: null,
  gender: null,
  birth_date: null,
  occupation: null,
  industry: null,
  motivation_tag: null,
  is_old_student: null,
  notes: null,
};

export function ImportFlow() {
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractResponse | null>(null);
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SaveResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCancelRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    return () => {
      if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    };
  }, []);

  function reset() {
    if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    pollCancelRef.current = null;
    setStage("idle");
    setFile(null);
    setPasted("");
    setError(null);
    setExtracted(null);
    setRows([]);
    setSelected(new Set());
    setResult(null);
    setJobStatus(null);
  }

  function handleFileChange(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_CLIENT_FILE_MB * 1024 * 1024) {
      setError(`File is larger than ${MAX_CLIENT_FILE_MB}MB.`);
      return;
    }
    setFile(f);
    setPasted("");
  }

  async function readExcelAsCsv(f: File): Promise<string> {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const chunks: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      chunks.push(`--- sheet: ${name} ---\n${csv}`);
    }
    return chunks.join("\n\n");
  }

  async function startExtract() {
    setError(null);
    setStage("extracting");
    setJobStatus("pending");

    if (pollCancelRef.current) pollCancelRef.current.cancelled = true;
    const cancel = { cancelled: false };
    pollCancelRef.current = cancel;

    try {
      let body: FormData;

      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        body = new FormData();

        if (ext === "pdf") {
          body.append("kind", "pdf");
          body.append("file", file);
        } else if (ext === "xlsx" || ext === "xls") {
          const text = await readExcelAsCsv(file);
          body.append("kind", "text");
          body.append("label", `excel:${file.name}`);
          body.append("text", text);
        } else if (ext === "csv" || ext === "txt") {
          const text = await file.text();
          body.append("kind", "text");
          body.append("label", `${ext}:${file.name}`);
          body.append("text", text);
        } else {
          throw new Error(
            "Unsupported file type. Use .xlsx, .xls, .csv, .txt, or .pdf",
          );
        }
      } else if (pasted.trim()) {
        body = new FormData();
        body.append("kind", "text");
        body.append("label", "pasted");
        body.append("text", pasted);
      } else {
        throw new Error("Select a file or paste some data first.");
      }

      const kickoff = await fetch("/api/admin/participants/import/extract", {
        method: "POST",
        body,
      });

      if (!kickoff.ok && kickoff.status !== 202) {
        const payload = await kickoff.json().catch(() => ({}));
        throw new Error(payload.error ?? `Extract failed (${kickoff.status})`);
      }

      const { jobId } = (await kickoff.json()) as { jobId: string };
      if (!jobId) throw new Error("Kickoff returned no jobId");

      const final = await pollJob(jobId, cancel);
      if (cancel.cancelled) return;

      if (final.status === "error") {
        throw new Error(final.error ?? "Extraction failed");
      }

      const extractData: ExtractResponse = {
        rows: final.rows,
        summary: final.summary,
        source: final.source,
        usage: final.usage,
      };
      setExtracted(extractData);
      setRows(final.rows);
      setSelected(new Set(final.rows.map((_, i) => i)));
      setJobStatus("done");
      setStage("reviewing");
    } catch (err) {
      if (cancel.cancelled) return;
      const msg = err instanceof Error ? err.message : "Extract failed";
      setError(msg);
      setStage("idle");
      setJobStatus(null);
    }
  }

  async function pollJob(
    jobId: string,
    cancel: { cancelled: boolean },
  ): Promise<StatusResponse> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (!cancel.cancelled) {
      const res = await fetch(
        `/api/admin/participants/import/status/${jobId}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Status check failed (${res.status})`);
      }
      const data = (await res.json()) as StatusResponse;
      setJobStatus(data.status);

      if (data.status === "done" || data.status === "error") return data;
      if (Date.now() > deadline) {
        throw new Error("Extraction timed out — job still running after 15 min");
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return {
      jobId,
      status: "pending",
      rows: [],
      summary: "",
      source: "",
    };
  }

  function updateRow(index: number, patch: Partial<ExtractedRow>) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((_, i) => i)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < index) next.add(idx);
        else if (idx > index) next.add(idx - 1);
      });
      return next;
    });
  }

  function addEmptyRow() {
    setRows((prev) => {
      const next = [...prev, { ...EMPTY_ROW }];
      setSelected((prevSel) => {
        const nextSel = new Set(prevSel);
        nextSel.add(next.length - 1);
        return nextSel;
      });
      return next;
    });
  }

  async function confirmImport() {
    setError(null);
    setStage("importing");
    try {
      const toSend = rows.filter((_, i) => selected.has(i));
      if (toSend.length === 0) {
        throw new Error("No rows selected.");
      }
      const res = await fetch("/api/admin/participants/import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: toSend }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      const data = (await res.json()) as SaveResponse;
      setResult(data);
      setStage("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      setStage("reviewing");
    }
  }

  // ---------- RENDER ----------

  if (stage === "idle" || stage === "extracting") {
    return (
      <UploadStep
        file={file}
        pasted={pasted}
        dragOver={dragOver}
        extracting={stage === "extracting"}
        jobStatus={jobStatus}
        error={error}
        fileInputRef={fileInputRef}
        onFileChange={handleFileChange}
        onPasteChange={setPasted}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        onExtract={startExtract}
      />
    );
  }

  if (stage === "reviewing" || stage === "importing") {
    return (
      <ReviewStep
        rows={rows}
        selected={selected}
        summary={extracted?.summary ?? ""}
        source={extracted?.source ?? ""}
        usage={extracted?.usage}
        importing={stage === "importing"}
        error={error}
        onUpdate={updateRow}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onRemove={removeRow}
        onAddRow={addEmptyRow}
        onBack={reset}
        onConfirm={confirmImport}
      />
    );
  }

  // done
  return <DoneStep result={result!} onReset={reset} />;
}

// ================================================================
// Upload step
// ================================================================

function UploadStep({
  file,
  pasted,
  dragOver,
  extracting,
  jobStatus,
  error,
  fileInputRef,
  onFileChange,
  onPasteChange,
  onDragEnter,
  onDragLeave,
  onExtract,
}: {
  file: File | null;
  pasted: string;
  dragOver: boolean;
  extracting: boolean;
  jobStatus: JobStatus | null;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (f: File | null) => void;
  onPasteChange: (s: string) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onExtract: () => void;
}) {
  const canExtract = Boolean(file || pasted.trim());

  const busyLabel =
    jobStatus === "pending"
      ? "Queued — waiting for Claude…"
      : jobStatus === "running"
        ? "Claude is reading…"
        : "Uploading…";

  return (
    <div className="flex flex-col gap-6">
      {/* Drop zone */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          onDragEnter();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragEnter();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          onDragLeave();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDragLeave();
          const f = e.dataTransfer.files?.[0] ?? null;
          onFileChange(f);
        }}
        className={`relative rounded-[var(--radius-lg)] border-2 border-dashed bg-[var(--paper-warm)]
                    px-6 py-14 flex flex-col items-center justify-center gap-4 text-center
                    transition-[background-color,border-color] duration-[var(--dur-base)]
                    ${
                      dragOver
                        ? "border-[var(--cinnabar)]/70 bg-[var(--cinnabar-wash)]"
                        : "border-[var(--paper-shadow)] hover:border-[var(--cinnabar)]/40"
                    }`}
      >
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[var(--paper)] border border-[var(--paper-shadow)] text-[var(--cinnabar)]"
          aria-hidden="true"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 14.5V17a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" />
            <path d="M11 3v11" />
            <path d="M7 7l4-4 4 4" />
          </svg>
        </div>

        <div>
          <div className="font-display text-[22px] tracking-[-0.01em] text-[var(--ink)]">
            Drop your file here
          </div>
          <div className="mt-1.5 text-[12.5px] leading-[1.65] text-[var(--ink-mute)] max-w-[46ch] mx-auto">
            Excel (.xlsx, .xls), CSV, text, or PDF. Claude Haiku 4.5 reads the
            file and extracts every participant it finds — double-check
            everything before confirming.
          </div>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-[var(--radius-pill)]
                     bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] text-[var(--paper-warm)]
                     text-[13px] tracking-[0.04em] font-medium
                     shadow-[0_4px_14px_rgba(37,99,235,0.25)]
                     transition-[background-color,transform] duration-[var(--dur-fast)]
                     active:scale-[0.98]
                     focus-visible:shadow-[var(--shadow-focus)]"
        >
          Browse file
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--ink-soft)] rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-3.5 py-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]"
              aria-hidden="true"
            />
            <span className="font-mono text-[11.5px] truncate max-w-[320px]">
              {file.name}
            </span>
            <span className="text-[var(--ink-faint)]">
              · {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB
            </span>
            <button
              type="button"
              onClick={() => onFileChange(null)}
              aria-label="Remove file"
              className="ml-1 text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* Paste alternative */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
          <span className="w-3 h-px bg-[var(--paper-shadow)]" />
          Or paste raw data · 粘贴
        </div>
        <textarea
          value={pasted}
          onChange={(e) => {
            onPasteChange(e.target.value);
          }}
          placeholder={
            "Paste CSV rows, copied Excel cells, or any text with participant data…\n\nExample:\nName, Email, Phone, Region, DOB\n陈美丽, mei@example.com, +6012-345 6789, MY, 1985-03-15"
          }
          rows={8}
          disabled={Boolean(file)}
          className="mt-3 w-full resize-y rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]
                     px-4 py-3 text-[12.5px] leading-[1.7] text-[var(--ink)]
                     placeholder:text-[var(--ink-faint)] font-mono
                     focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
        />
        {file ? (
          <div className="mt-2 text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            File selected — remove it to paste text instead
          </div>
        ) : null}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onExtract}
          disabled={!canExtract || extracting}
          className={`inline-flex items-center gap-2.5 h-11 px-5 rounded-[var(--radius-pill)]
                      text-[13px] tracking-[0.04em] font-medium
                      transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)]
                      focus-visible:shadow-[var(--shadow-focus)]
                      ${
                        canExtract && !extracting
                          ? "bg-[var(--ink)] text-[var(--paper-warm)] hover:bg-[var(--ink-soft)] shadow-[0_4px_14px_rgba(11,41,84,0.25)] active:scale-[0.98]"
                          : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                      }`}
        >
          {extracting ? (
            <>
              <Spinner />
              {busyLabel}
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 1.5l1.2 2.8L11 5.5l-2.8 1.2L7 9.5 5.8 6.7 3 5.5l2.8-1.2L7 1.5z" />
              </svg>
              Extract participants with AI
            </>
          )}
        </button>
        <div className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
          Model · Haiku 4.5 · ~cents per import
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      {/* How it works */}
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/60 p-6">
        <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-faint)]">
          How it works · 流程
        </div>
        <ol className="mt-4 grid md:grid-cols-4 gap-6">
          {[
            {
              n: "01",
              t: "Upload",
              b: "Drop a file or paste rows. Excel is parsed in your browser; PDFs are sent straight to Claude.",
            },
            {
              n: "02",
              t: "Extract",
              b: "Claude Haiku 4.5 reads the source and normalizes names, regions, phones, dates.",
            },
            {
              n: "03",
              t: "Review",
              b: "Edit anything that looks off. Deselect rows to exclude them.",
            },
            {
              n: "04",
              t: "Import",
              b: "Student IDs from the source are matched; new rows get one auto-assigned.",
            },
          ].map((s) => (
            <li key={s.n} className="grid grid-cols-[36px_1fr] gap-3">
              <span className="font-display text-[12px] tracking-[0.22em] text-[var(--cinnabar)]">
                — {s.n}
              </span>
              <div>
                <div className="text-[13.5px] font-medium text-[var(--ink)]">
                  {s.t}
                </div>
                <p className="mt-1 text-[12px] leading-[1.65] text-[var(--ink-soft)]">
                  {s.b}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ================================================================
// Review step
// ================================================================

function ReviewStep({
  rows,
  selected,
  summary,
  source,
  usage,
  importing,
  error,
  onUpdate,
  onToggleSelect,
  onToggleSelectAll,
  onRemove,
  onAddRow,
  onBack,
  onConfirm,
}: {
  rows: ExtractedRow[];
  selected: Set<number>;
  summary: string;
  source: string;
  usage?: { input_tokens: number; output_tokens: number };
  importing: boolean;
  error: string | null;
  onUpdate: (index: number, patch: Partial<ExtractedRow>) => void;
  onToggleSelect: (index: number) => void;
  onToggleSelectAll: () => void;
  onRemove: (index: number) => void;
  onAddRow: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const allSelected = selected.size === rows.length && rows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary card */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Review · 核对
            </div>
            <h2 className="mt-2 font-display text-[22px] leading-[1.25] tracking-[-0.01em] text-[var(--ink)]">
              {selected.size}{" "}
              <span className="text-[var(--ink-mute)] text-[18px]">
                of {rows.length} selected for import
              </span>
            </h2>
            {summary ? (
              <p className="mt-3 text-[13px] leading-[1.7] text-[var(--ink-soft)] max-w-[70ch]">
                <span className="text-[var(--ink-faint)]">Claude:</span> {summary}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Source
            </div>
            <div className="mt-1 font-mono text-[12px] text-[var(--ink)] break-all max-w-[280px]">
              {source || "—"}
            </div>
            {usage ? (
              <div className="mt-2 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                {usage.input_tokens.toLocaleString()} in · {usage.output_tokens.toLocaleString()} out
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--paper-shadow)] bg-[var(--paper)]/50">
          <label className="inline-flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-[var(--ink-mute)] cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              className="accent-[var(--cinnabar)]"
            />
            {allSelected ? "Deselect all" : "Select all"}
          </label>
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M5 1.5v7M1.5 5h7" />
            </svg>
            Add row
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px] text-[var(--ink-soft)] min-w-[1500px]">
            <thead className="bg-[var(--paper-deep)]/60 text-[9px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
              <tr>
                <th scope="col" className="w-10 px-3 py-3"></th>
                <th scope="col" className="px-3 py-3 font-medium">Student ID</th>
                <th scope="col" className="px-3 py-3 font-medium">Name EN</th>
                <th scope="col" className="px-3 py-3 font-medium">Name 中文</th>
                <th scope="col" className="px-3 py-3 font-medium">Email</th>
                <th scope="col" className="px-3 py-3 font-medium">Phone</th>
                <th scope="col" className="px-3 py-3 font-medium">Region</th>
                <th scope="col" className="px-3 py-3 font-medium">Gender</th>
                <th scope="col" className="px-3 py-3 font-medium">Language</th>
                <th scope="col" className="px-3 py-3 font-medium">Birth</th>
                <th scope="col" className="px-3 py-3 font-medium">Motivation</th>
                <th scope="col" className="px-3 py-3 font-medium">Occupation</th>
                <th scope="col" className="px-3 py-3 font-medium">Industry</th>
                <th scope="col" className="px-3 py-3 font-medium">Old?</th>
                <th scope="col" className="w-12 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-6 py-14 text-center text-[13px] text-[var(--ink-mute)]">
                    No rows. Add one manually or go back and re-extract.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const isSelected = selected.has(i);
                  return (
                    <tr
                      key={i}
                      className={`border-t border-[var(--paper-shadow)] transition-colors ${
                        isSelected ? "bg-[var(--paper-warm)]" : "bg-[var(--paper)]/60"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelect(i)}
                          aria-label={`Select row ${i + 1}`}
                          className="accent-[var(--cinnabar)]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.region_id}
                          onChange={(v) => onUpdate(i, { region_id: v })}
                          width={110}
                          mono
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.name_en}
                          onChange={(v) => onUpdate(i, { name_en: v })}
                          width={140}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.name_cn}
                          onChange={(v) => onUpdate(i, { name_cn: v })}
                          width={120}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.email}
                          onChange={(v) => onUpdate(i, { email: v })}
                          width={180}
                          type="email"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.phone}
                          onChange={(v) => onUpdate(i, { phone: v })}
                          width={140}
                          mono
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellSelect
                          value={r.region}
                          onChange={(v) =>
                            onUpdate(i, {
                              region: v as ExtractedRow["region"],
                            })
                          }
                          options={REGIONS}
                          width={80}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellSelect
                          value={r.gender}
                          onChange={(v) =>
                            onUpdate(i, {
                              gender: v as ExtractedRow["gender"],
                            })
                          }
                          options={GENDERS}
                          width={100}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellSelect
                          value={r.language}
                          onChange={(v) =>
                            onUpdate(i, {
                              language: v as ExtractedRow["language"],
                            })
                          }
                          options={LANGUAGES}
                          width={80}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.birth_date}
                          onChange={(v) => onUpdate(i, { birth_date: v })}
                          width={120}
                          type="date"
                          mono
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellSelect
                          value={r.motivation_tag}
                          onChange={(v) =>
                            onUpdate(i, {
                              motivation_tag:
                                v as ExtractedRow["motivation_tag"],
                            })
                          }
                          options={MOTIVATIONS}
                          width={120}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.occupation}
                          onChange={(v) => onUpdate(i, { occupation: v })}
                          width={140}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <CellInput
                          value={r.industry}
                          onChange={(v) => onUpdate(i, { industry: v })}
                          width={120}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <BoolToggle
                          value={r.is_old_student}
                          onChange={(v) => onUpdate(i, { is_old_student: v })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => onRemove(i)}
                          aria-label="Remove row"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--ink-faint)] hover:text-[var(--cinnabar)] hover:bg-[var(--cinnabar-wash)] transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M2.5 3.5h7M4.5 3.5V2.5h3v1M3.5 3.5l.5 6h4l.5-6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Row notes */}
        {rows.some((r) => r.notes) ? (
          <div className="border-t border-[var(--paper-shadow)] px-5 py-3 bg-[var(--paper)]/40">
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)] mb-2">
              AI notes · 备注
            </div>
            <ul className="flex flex-col gap-1.5 text-[11.5px] text-[var(--ink-soft)]">
              {rows.map((r, i) =>
                r.notes ? (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono text-[var(--ink-faint)] w-8 flex-none">
                      #{i + 1}
                    </span>
                    <span>{r.notes}</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}

      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          disabled={importing}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)]
                     text-[12.5px] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-[background-color,color] duration-[var(--dur-fast)]"
        >
          ← Start over
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={importing || selected.size === 0}
          className={`inline-flex items-center gap-2.5 h-11 px-6 rounded-[var(--radius-pill)]
                      text-[13px] tracking-[0.04em] font-medium
                      transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)]
                      focus-visible:shadow-[var(--shadow-focus)]
                      ${
                        !importing && selected.size > 0
                          ? "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.25)] active:scale-[0.98]"
                          : "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                      }`}
        >
          {importing ? (
            <>
              <Spinner />
              Importing {selected.size}…
            </>
          ) : (
            <>Confirm · import {selected.size} participant{selected.size === 1 ? "" : "s"}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ================================================================
// Done step
// ================================================================

function DoneStep({
  result,
  onReset,
}: {
  result: SaveResponse;
  onReset: () => void;
}) {
  const successRows = result.results.filter((r) => r.ok);
  const failedRows = result.results.filter((r) => !r.ok);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-8">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              Import complete · 完成
            </div>
            <h2 className="mt-3 font-display text-[38px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
              {result.succeeded.toLocaleString()}
              <span className="text-[22px] text-[var(--ink-mute)] ml-2">
                / {result.total.toLocaleString()} imported
              </span>
            </h2>
            <p className="mt-3 text-[13px] text-[var(--ink-soft)]">
              <span>
                <span className="text-[var(--cinnabar-deep)] font-medium">
                  {result.created.toLocaleString()}
                </span>{" "}
                created
              </span>
              {result.updated > 0 ? (
                <>
                  {" · "}
                  <span>
                    <span className="text-[var(--ink)] font-medium">
                      {result.updated.toLocaleString()}
                    </span>{" "}
                    matched existing Student ID and updated
                  </span>
                </>
              ) : null}
              {result.failed > 0 ? (
                <>
                  {" · "}
                  <span className="text-[var(--cinnabar-deep)]">
                    {result.failed} failed — see below
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/participants"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-[background-color,border-color,color] duration-[var(--dur-fast)]"
            >
              ← View participants
            </Link>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-pill)] bg-[var(--ink)] text-[var(--paper-warm)] text-[12.5px] tracking-[0.04em] font-medium hover:bg-[var(--ink-soft)] shadow-[0_4px_14px_rgba(11,41,84,0.25)] transition-[background-color,transform] duration-[var(--dur-fast)] active:scale-[0.98]"
            >
              Import more
            </button>
          </div>
        </div>
      </div>

      {successRows.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-5">
          <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--ink-mute)]">
            Student IDs · 学员编号
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {successRows.map((r) => (
              <li key={r.index}>
                <span
                  className={`inline-flex items-center gap-1.5 font-mono text-[11.5px] px-2 py-1 rounded-[var(--radius-sm)] border
                              ${
                                r.mode === "updated"
                                  ? "text-[var(--ink-soft)] bg-[var(--paper-deep)] border-[var(--paper-shadow)]"
                                  : "text-[var(--ink)] bg-[var(--paper)] border-[var(--paper-shadow)]"
                              }`}
                  title={r.mode === "updated" ? "Matched existing · updated" : "New"}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      r.mode === "updated" ? "bg-[var(--jade)]" : "bg-[var(--cinnabar)]"
                    }`}
                    aria-hidden="true"
                  />
                  {r.region_id ?? "—"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            <span className="inline-flex items-center gap-1.5 mr-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
              New
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--jade)]" aria-hidden="true" />
              Updated existing
            </span>
          </div>
        </div>
      ) : null}

      {failedRows.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] p-5">
          <div className="text-[10px] tracking-[0.24em] uppercase text-[var(--cinnabar-deep)]">
            Failed rows · 失败
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-[12.5px] text-[var(--cinnabar-deep)]">
            {failedRows.map((r) => (
              <li key={r.index} className="flex gap-3">
                <span className="font-mono text-[var(--ink-faint)] w-10 flex-none">
                  #{r.index + 1}
                </span>
                <span className="flex-1">{r.error ?? "Unknown error"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ================================================================
// Small helpers
// ================================================================

function CellInput({
  value,
  onChange,
  width,
  type = "text",
  mono = false,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  width: number;
  type?: "text" | "email" | "date";
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value.length === 0 ? null : e.target.value)
      }
      style={{ width }}
      className={`h-8 px-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent
                  hover:bg-[var(--paper)] hover:border-[var(--paper-shadow)]
                  focus:bg-[var(--paper)] focus:border-[var(--cinnabar)]/40 focus:outline-none
                  text-[12px] text-[var(--ink)]
                  placeholder:text-[var(--ink-faint)]
                  transition-[background-color,border-color] duration-[var(--dur-fast)]
                  ${mono ? "font-mono text-[11.5px]" : ""}`}
      placeholder="—"
    />
  );
}

function CellSelect<T extends string>({
  value,
  onChange,
  options,
  width,
}: {
  value: string | null;
  onChange: (v: T | null) => void;
  options: readonly T[];
  width: number;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value.length === 0 ? null : (e.target.value as T))
      }
      style={{ width }}
      className="h-8 px-2 rounded-[var(--radius-sm)] border border-transparent bg-transparent
                 hover:bg-[var(--paper)] hover:border-[var(--paper-shadow)]
                 focus:bg-[var(--paper)] focus:border-[var(--cinnabar)]/40 focus:outline-none
                 text-[12px] text-[var(--ink)]
                 transition-[background-color,border-color] duration-[var(--dur-fast)]"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function BoolToggle({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const label =
    value === true ? "Yes" : value === false ? "No" : "—";
  const nextValue: boolean | null =
    value === null ? true : value === true ? false : null;
  const tone =
    value === true
      ? "text-[var(--cinnabar-deep)] bg-[var(--cinnabar-wash)] border-[var(--cinnabar)]/25"
      : value === false
        ? "text-[var(--ink-mute)] bg-[var(--paper)] border-[var(--paper-shadow)]"
        : "text-[var(--ink-faint)] bg-[var(--paper)] border-dashed border-[var(--paper-shadow)]";
  return (
    <button
      type="button"
      onClick={() => onChange(nextValue)}
      className={`inline-flex items-center h-7 px-2.5 rounded-full border text-[10px] tracking-[0.14em] uppercase ${tone} transition-[background-color,color,border-color] duration-[var(--dur-fast)]`}
    >
      {label}
    </button>
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
