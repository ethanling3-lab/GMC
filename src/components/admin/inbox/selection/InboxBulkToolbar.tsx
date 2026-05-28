"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSelection } from "./SelectionContext";
import { runBulk } from "./bulk-runner";
import { BulkTagPicker } from "./BulkTagPicker";

// Floating action bar that appears at the top of the inbox list when ≥1
// conversation is selected. v1 actions, all reusing per-conversation
// endpoints that already exist:
//   • Mark read     — POST /api/admin/inbox/:id/read
//   • Apply tag     — POST /api/admin/inbox/:id/tags { slug }
//   • Remove tag    — DELETE /api/admin/inbox/:id/tags/:slug
//   • Close         — POST /api/admin/inbox/:id/status { status: "closed" }
//   • Assign to me  — POST /api/admin/inbox/:id/assign { admin_id: "self" }
//
// Selection state lives in SelectionContext (provided at inbox/layout).
// The toolbar is conditional render — when count is 0, it returns null
// rather than collapsing, so there's zero pushdown on a fresh inbox.

type PickerMode = "apply" | "remove" | null;
type BusyKind = "read" | "close" | "assign" | null;

export function InboxBulkToolbar({ compact }: { compact: boolean }) {
  const { selected, clear } = useSelection();
  const router = useRouter();
  const count = selected.size;
  const [picker, setPicker] = useState<PickerMode>(null);
  const [busyKind, setBusyKind] = useState<BusyKind>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (count === 0) return null;

  const ids = Array.from(selected);

  async function runFanout(
    kind: Exclude<BusyKind, null>,
    worker: (id: string) => Promise<void>,
  ) {
    setBusyKind(kind);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    const result = await runBulk(ids, worker, {
      concurrency: 6,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setBusyKind(null);
    setProgress(null);
    if (result.failed.length > 0) {
      setError(`${result.failed.length} of ${ids.length} failed.`);
    } else {
      router.refresh();
      clear();
    }
  }

  function markRead() {
    return runFanout("read", async (id) => {
      const res = await fetch(`/api/admin/inbox/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  function closeAll() {
    return runFanout("close", async (id) => {
      const res = await fetch(`/api/admin/inbox/${id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  function assignToMe() {
    return runFanout("assign", async (id) => {
      const res = await fetch(`/api/admin/inbox/${id}/assign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_id: "self" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  const wrapperBase =
    "z-20 border-b border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] gmc-toolbar-in";
  const wrapperLayout = compact
    ? "sticky top-0 px-3 py-2"
    : "rounded-[var(--radius-md)] px-4 py-3 mb-3 border";

  // Compact (xl+ persistent 320px column): two-row layout — count + clear
  // on top, action buttons on bottom — so the bilingual labels fit.
  // Non-compact (<xl carded fallback): single row.
  return (
    <div className={[wrapperBase, wrapperLayout].join(" ")}>
      <div className={compact ? "flex flex-col gap-2" : "flex items-center gap-2 flex-wrap"}>
        <div className="flex items-center gap-2">
          <CountChip count={count} />
          {progress && busyKind ? (
            <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--ink-mute)] tabular-nums">
              {progress.done} / {progress.total}
            </span>
          ) : null}
          {error ? (
            <span
              className="text-[11px] text-[var(--cinnabar-deep)] truncate max-w-[160px]"
              title={error}
            >
              {error}
            </span>
          ) : null}
          {compact ? <span aria-hidden="true" className="flex-1" /> : null}
          {compact ? <ClearButton onClick={() => { clear(); setError(null); }} /> : null}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <ActionButton
            icon={<ReadIcon />}
            label="Mark read"
            labelCn="标记已读"
            busy={busyKind === "read"}
            onClick={markRead}
          />
          <ActionButton
            icon={<AssignIcon />}
            label="Assign to me"
            labelCn="分给我"
            busy={busyKind === "assign"}
            onClick={assignToMe}
          />
          <ActionButton
            icon={<CloseIcon />}
            label="Close"
            labelCn="关闭"
            busy={busyKind === "close"}
            onClick={closeAll}
          />
          <div className="relative">
            <ActionButton
              icon={<TagPlusIcon />}
              label="Apply tag"
              labelCn="加标签"
              active={picker === "apply"}
              onClick={() => setPicker(picker === "apply" ? null : "apply")}
            />
            {picker === "apply" ? (
              <BulkTagPicker
                mode="apply"
                ids={ids}
                onClose={() => setPicker(null)}
                onDone={() => {
                  router.refresh();
                  clear();
                }}
              />
            ) : null}
          </div>
          <div className="relative">
            <ActionButton
              icon={<TagMinusIcon />}
              label="Remove tag"
              labelCn="移除"
              active={picker === "remove"}
              onClick={() => setPicker(picker === "remove" ? null : "remove")}
            />
            {picker === "remove" ? (
              <BulkTagPicker
                mode="remove"
                ids={ids}
                onClose={() => setPicker(null)}
                onDone={() => {
                  router.refresh();
                  clear();
                }}
              />
            ) : null}
          </div>
          {!compact ? (
            <>
              <span aria-hidden="true" className="flex-1" />
              <ClearButton onClick={() => { clear(); setError(null); }} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-none inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-pill)] border border-transparent text-[11px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] transition-[background-color,color] duration-[var(--dur-fast)]"
      aria-label="Clear selection"
      title="Clear selection · 取消 (Esc)"
    >
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M2 2l5 5M7 2l-5 5" />
      </svg>
      <span>Clear · 取消</span>
    </button>
  );
}

function CountChip({ count }: { count: number }) {
  // Tight visual: cinnabar dot + numeric in display serif + tiny bilingual
  // postfix. Sits left without crowding out the actions even in the 320px
  // persistent-list column.
  return (
    <span
      className={[
        "flex-none inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5",
        "rounded-[var(--radius-pill)]",
        "bg-[var(--cinnabar)] text-[var(--paper-warm)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="w-4 h-4 rounded-full bg-[var(--paper-warm)]/25 flex items-center justify-center font-display text-[10.5px] leading-none tabular-nums"
      >
        {count}
      </span>
      <span className="text-[9px] tracking-[0.18em] uppercase opacity-90 leading-none">
        selected
      </span>
    </span>
  );
}

function ActionButton({
  icon,
  label,
  labelCn,
  busy,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  labelCn: string;
  compact?: boolean; // kept for callsite compatibility, no longer branches
  busy?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      title={`${label} · ${labelCn}`}
      className={[
        "inline-flex items-center gap-1.5 h-7 px-2.5",
        "rounded-[var(--radius-pill)] border",
        "text-[11px] tracking-[-0.005em] leading-none",
        "transition-[background-color,border-color,color,opacity] duration-[var(--dur-fast)]",
        active
          ? "border-[var(--cinnabar)] bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
          : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:border-[var(--cinnabar)]/30",
        busy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
    >
      <span className="flex-none">{icon}</span>
      <span>{label}</span>
      <span className="text-[10px] text-[var(--ink-faint)]">· {labelCn}</span>
    </button>
  );
}

function ReadIcon() {
  // Open envelope with a check inside — distinct from generic "approved"
  // checkmark. Reads as "mark this as read."
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5l6 4 6-4" />
      <rect x="2" y="3.5" width="12" height="9" rx="1.4" />
      <path d="M6 9.5l1.5 1.5L11 7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function TagPlusIcon() {
  // Clean tag silhouette with a bold + badge in the top-right. Bigger glyph
  // so the + reads at 14px.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8l6-6h4v4l-6 6z" />
      <circle cx="9.2" cy="4.4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="12.5" r="3" fill="var(--paper-warm)" />
      <path d="M12.5 11v3M11 12.5h3" strokeWidth="1.6" />
    </svg>
  );
}

function TagMinusIcon() {
  // Same tag silhouette + bold − badge so the +/− differ at a glance.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8l6-6h4v4l-6 6z" />
      <circle cx="9.2" cy="4.4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="12.5" r="3" fill="var(--paper-warm)" />
      <path d="M11 12.5h3" strokeWidth="1.6" />
    </svg>
  );
}

function AssignIcon() {
  // Person silhouette with a small inward arrow → "assign to me". The
  // arrow points at the avatar to imply ownership transfer.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="5.5" r="2.4" />
      <path d="M5.5 14c0-2.5 2-4.4 4.5-4.4s4.5 1.9 4.5 4.4" />
      <path d="M1.5 6.5h4M3.5 4.5l-2 2 2 2" />
    </svg>
  );
}

function CloseIcon() {
  // Circle-check (door-closed feel) — visually different from the tag
  // remove ✕ + the row-clear ✕ so it doesn't read as "destructive".
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M5 8.2l2.2 2.2L11 6.5" strokeWidth="1.7" />
    </svg>
  );
}
