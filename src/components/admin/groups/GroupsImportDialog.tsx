"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Grouping spreadsheet round-trip — upload an edited export (.xlsx/.csv),
// preview the diff, confirm to apply. Portal-mounted on document.body per
// the dialog-portal convention (feedback_dialog_portal).
//
// Two server steps: POST .../groups/import/preview (multipart, no writes)
// then POST .../groups/import/apply (confirmed desired_state).

type Props = {
  eventId: string;
  onClose: () => void;
  onApplied: () => void;
};

type Warning = {
  severity: "error" | "warn";
  code: string;
  message: string;
  group_no?: number | null;
};

type DesiredState = {
  groups: Array<{
    group_no: number;
    group_class: string;
    name_en: string | null;
    name_cn: string | null;
  }>;
  members: Array<{
    participant_id: string;
    group_no: number;
    role: string;
  }>;
};

type PreviewResponse = {
  ok: true;
  filename: string;
  dropped_rows: number;
  desired_state: DesiredState;
  diff: {
    moves: Array<{ label: string; from_group_no: number | null; to_group_no: number }>;
    role_changes: Array<{ label: string; group_no: number; from_role: string; to_role: string }>;
    new_groups: number[];
    removed_groups: number[];
    group_meta_changes: Array<{ group_no: number; field: string; from: string | null; to: string | null }>;
    unassigned: Array<{ label: string; from_group_no: number | null }>;
  };
  warnings: Warning[];
  counts: { file_rows: number; resolved_members: number; groups_in_file: number };
  affects_locked: boolean;
};

type ApplyResponse = {
  ok: true;
  groups_created: number;
  groups_updated: number;
  groups_deleted: number;
  members_moved: number;
  members_unassigned: number;
  leaders_set: number;
  skipped_locked: number;
};

type Stage = "upload" | "uploading" | "review" | "applying" | "done" | "error";

const ROLE_SHORT: Record<string, string> = {
  zu_zhang: "组长",
  fu_zu_zhang: "副组长",
  pai_zhang: "排长",
  participant: "member",
};

export function GroupsImportDialog({ eventId, onClose, onApplied }: Props) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>("upload");
  const [dragging, setDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);
  const [unassignMissing, setUnassignMissing] = useState(true);
  const [overrideLocked, setOverrideLocked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "uploading" && stage !== "applying") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  async function handleFile(file: File) {
    setErrorMsg(null);
    setStage("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/admin/events/${eventId}/groups/import/preview`,
        { method: "POST", body: fd },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.detail ?? json.error ?? "Could not read the file.");
        setStage("error");
        return;
      }
      setPreview(json as PreviewResponse);
      setOverrideLocked(false);
      setStage("review");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStage("error");
    }
  }

  async function handleApply() {
    if (!preview) return;
    setErrorMsg(null);
    setStage("applying");
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/groups/import/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: preview.filename,
            desired_state: preview.desired_state,
            options: {
              override_locked: overrideLocked,
              unassign_missing: unassignMissing,
            },
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.detail ?? json.error ?? "Import failed.");
        setStage("error");
        return;
      }
      setApplied(json as ApplyResponse);
      setStage("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStage("error");
    }
  }

  if (!mounted) return null;

  const errorCount = preview?.warnings.filter((w) => w.severity === "error").length ?? 0;
  const warnCount = preview?.warnings.filter((w) => w.severity === "warn").length ?? 0;

  const content = (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (
          e.target === e.currentTarget &&
          stage !== "uploading" &&
          stage !== "applying"
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[640px] max-h-[88vh] overflow-y-auto bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[18px] shadow-[var(--shadow-elevated)] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[var(--paper-deep)] flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              Import grouping · 导入分组
            </div>
            <div className="mt-1 font-display text-[18px] leading-tight text-[var(--ink)]">
              Upload edited spreadsheet
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={stage === "uploading" || stage === "applying"}
            className="text-[var(--ink-faint)] hover:text-[var(--ink)] disabled:opacity-40 text-[18px] leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* UPLOAD */}
        {stage === "upload" || stage === "uploading" ? (
          <div className="px-5 py-5">
            <p className="text-[13px] leading-[1.7] text-[var(--ink-soft)]">
              Export the grouping first. Each row is a participant (name +{" "}
              <strong>Student ID</strong>). Edit <strong>Group #</strong>,{" "}
              <strong>Role</strong>, <strong>Class</strong> or{" "}
              <strong>Group Name</strong> in Google Sheets, then download as{" "}
              <strong>.xlsx</strong> or <strong>.csv</strong> and drop it here.
              Leave the last <em>Participant ID</em> column alone.
            </p>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                dragging
                  ? "border-[var(--cinnabar)]/60 bg-[var(--cinnabar-wash)]/40"
                  : "border-[var(--paper-shadow)] bg-[var(--paper)]/50 hover:border-[var(--cinnabar)]/40"
              }`}
            >
              {stage === "uploading" ? (
                <div className="text-[13px] text-[var(--ink-soft)]">
                  Reading file…
                </div>
              ) : (
                <>
                  <div className="text-[13px] text-[var(--ink)]">
                    Drop .xlsx / .csv here, or click to choose
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--ink-faint)]">
                    Max 5 MB
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}

        {/* REVIEW */}
        {stage === "review" && preview ? (
          <div className="px-5 py-5">
            <div className="text-[12px] text-[var(--ink-soft)]">
              <span className="font-mono">{preview.filename}</span> ·{" "}
              {preview.counts.resolved_members} people ·{" "}
              {preview.counts.groups_in_file} groups
            </div>

            {/* Change summary */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <SummaryChip n={preview.diff.moves.length} label="moves" />
              <SummaryChip n={preview.diff.role_changes.length} label="role changes" />
              <SummaryChip n={preview.diff.new_groups.length} label="new groups" tone="good" />
              <SummaryChip n={preview.diff.removed_groups.length} label="removed groups" tone="warn" />
              <SummaryChip n={preview.diff.group_meta_changes.length} label="group edits" />
              <SummaryChip n={preview.diff.unassigned.length} label="to unassign" tone="warn" />
            </div>

            {preview.diff.moves.length > 0 ? (
              <DiffBlock title="Moves">
                {preview.diff.moves.slice(0, 40).map((m, i) => (
                  <div key={i} className="text-[12px] text-[var(--ink-soft)]">
                    {m.label}: {m.from_group_no ?? "—"} → <strong>#{m.to_group_no}</strong>
                  </div>
                ))}
                {preview.diff.moves.length > 40 ? (
                  <div className="text-[11px] text-[var(--ink-faint)]">
                    +{preview.diff.moves.length - 40} more…
                  </div>
                ) : null}
              </DiffBlock>
            ) : null}

            {preview.diff.role_changes.length > 0 ? (
              <DiffBlock title="Role changes">
                {preview.diff.role_changes.slice(0, 20).map((r, i) => (
                  <div key={i} className="text-[12px] text-[var(--ink-soft)]">
                    {r.label} (#{r.group_no}): {ROLE_SHORT[r.from_role] ?? r.from_role} →{" "}
                    <strong>{ROLE_SHORT[r.to_role] ?? r.to_role}</strong>
                  </div>
                ))}
              </DiffBlock>
            ) : null}

            {/* Warnings */}
            {preview.warnings.length > 0 ? (
              <div className="mt-4 space-y-1.5">
                {preview.warnings.map((w, i) => (
                  <div
                    key={i}
                    className={`text-[12px] leading-[1.5] rounded-[var(--radius-md)] px-3 py-2 border ${
                      w.severity === "error"
                        ? "border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                        : "border-[var(--gold)]/45 bg-[var(--gold-soft)] text-[var(--gold-deep)]"
                    }`}
                  >
                    {w.severity === "error" ? "⚠ " : "· "}
                    {w.message}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Options */}
            <div className="mt-4 space-y-2 border-t border-[var(--paper-deep)] pt-3">
              <label className="flex items-start gap-2 text-[12.5px] text-[var(--ink)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={unassignMissing}
                  onChange={(e) => setUnassignMissing(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Unassign people missing from the file
                  <span className="block text-[11px] text-[var(--ink-faint)]">
                    Full snapshot: anyone enrolled but not in the file is removed from
                    their group. Uncheck to leave them where they are.
                  </span>
                </span>
              </label>
              {preview.affects_locked ? (
                <label className="flex items-start gap-2 text-[12.5px] text-[var(--ink)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideLocked}
                    onChange={(e) => setOverrideLocked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Override locked groups
                    <span className="block text-[11px] text-[var(--ink-faint)]">
                      Locked 🔒 groups are skipped by default. Enable to let the file
                      change them too.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>

            {errorCount > 0 ? (
              <div className="mt-3 text-[12px] text-[var(--cinnabar-deep)]">
                Fix {errorCount} error{errorCount === 1 ? "" : "s"} in the file and
                re-upload before importing.
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setStage("upload");
                }}
                className="h-9 px-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] hover:bg-[var(--paper-deep)]/40 transition-colors"
              >
                Choose another file
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={errorCount > 0}
                className="h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.08em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                Import {preview.counts.resolved_members} people
              </button>
            </div>
            {warnCount > 0 && errorCount === 0 ? (
              <div className="mt-2 text-right text-[11px] text-[var(--ink-faint)]">
                {warnCount} warning{warnCount === 1 ? "" : "s"} — review above, then import.
              </div>
            ) : null}
          </div>
        ) : null}

        {/* APPLYING */}
        {stage === "applying" ? (
          <div className="px-5 py-10 text-center text-[13px] text-[var(--ink-soft)]">
            Applying grouping…
          </div>
        ) : null}

        {/* DONE */}
        {stage === "done" && applied ? (
          <div className="px-5 py-6">
            <div className="text-[14px] text-[var(--ink)]">✓ Grouping imported.</div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] text-[var(--ink-soft)]">
              <SummaryLine label="Groups created" n={applied.groups_created} />
              <SummaryLine label="Groups updated" n={applied.groups_updated} />
              <SummaryLine label="Groups removed" n={applied.groups_deleted} />
              <SummaryLine label="People moved" n={applied.members_moved} />
              <SummaryLine label="People unassigned" n={applied.members_unassigned} />
              <SummaryLine label="Leaders set" n={applied.leaders_set} />
              {applied.skipped_locked > 0 ? (
                <SummaryLine label="Skipped (locked)" n={applied.skipped_locked} />
              ) : null}
            </div>
            <p className="mt-4 text-[11.5px] leading-[1.6] text-[var(--ink-faint)]">
              Imported groups are auto-protected from Regenerate. Moved people had their
              floor-plan seats cleared — re-run <strong>Auto-place</strong> on the layout
              to reseat them.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onApplied}
                className="h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12px] tracking-[0.08em] uppercase font-medium hover:bg-[var(--cinnabar-deep)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {/* ERROR */}
        {stage === "error" ? (
          <div className="px-5 py-6">
            <div className="text-[13px] text-[var(--cinnabar-deep)]">
              {errorMsg ?? "Something went wrong."}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setStage(preview ? "review" : "upload");
                }}
                className="h-9 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] hover:bg-[var(--paper-deep)]/40 transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function SummaryChip({
  n,
  label,
  tone = "neutral",
}: {
  n: number;
  label: string;
  tone?: "neutral" | "good" | "warn";
}) {
  if (n === 0) return null;
  const cls =
    tone === "warn"
      ? "border-[var(--gold)]/45 bg-[var(--gold-soft)] text-[var(--gold-deep)]"
      : tone === "good"
        ? "border-[var(--cinnabar)]/35 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)]";
  return (
    <span
      className={`inline-flex items-center h-[20px] px-2 rounded-[var(--radius-pill)] border text-[11px] tabular-nums ${cls}`}
    >
      {n} {label}
    </span>
  );
}

function DiffBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)]/50 px-3 py-2">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-[var(--ink-faint)] mb-1">
        {title}
      </div>
      <div className="space-y-0.5 max-h-[160px] overflow-y-auto">{children}</div>
    </div>
  );
}

function SummaryLine({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums font-medium text-[var(--ink)]">{n}</span>
    </div>
  );
}
