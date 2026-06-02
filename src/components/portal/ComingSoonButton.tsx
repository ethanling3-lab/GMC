"use client";

import { useState, useEffect } from "react";

// Soft stub for "this is coming" affordances. Click → shows a small toast
// for 2.5s. Used wherever Dr Wu hasn't pinned down the editable set yet
// (Profile fields, Flight info submit, Group reveal, etc).

export function ComingSoonButton({
  label_en = "Edit",
  label_cn = "编辑",
  variant = "dashed",
}: {
  label_en?: string;
  label_cn?: string;
  variant?: "dashed" | "solid";
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(t);
  }, [visible]);

  const cls =
    variant === "dashed"
      ? "border-dashed border-[var(--paper-shadow)] text-[var(--ink-mute)] hover:bg-[var(--paper-deep)]"
      : "border-[var(--paper-shadow)] bg-[var(--paper-warm)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)]";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setVisible(true)}
        className={`inline-flex items-center gap-2 px-3 h-9 rounded-[var(--radius-pill)] border ${cls} text-[11.5px] tracking-[0.1em] uppercase transition-colors`}
      >
        {label_en} · {label_cn} <span className="text-[var(--ink-faint)]">(soon)</span>
      </button>
      {visible ? (
        <div
          role="status"
          className="absolute top-full right-0 mt-2 w-[260px] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-3.5 py-2.5 text-[12px] leading-[1.5] text-[var(--ink-soft)] shadow-[var(--shadow-paper-2)] z-10"
        >
          Coming soon · 即将开放
        </div>
      ) : null}
    </div>
  );
}
