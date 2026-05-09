"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { downloadBlob, exportFloorPlanPng } from "@/lib/floor-plan/export-png";
import type { EventMeta } from "@/lib/floor-plan/export-pdf";
import type { GroupRoster } from "./types";

// Export dialog — the deeper-controls modal behind the chip's "Options…"
// button. Lets admins pick format / page size (PDF only) / quality / reveal
// mode / cover toggle / per-group rosters toggle (PPT) before firing the
// download. The chip's direct PNG / PDF / PPT buttons stay for fast
// common-case exports; this dialog is for when you want to tune the output.
//
// Reveal: changing the dialog's reveal setting flips the canvas's reveal
// state too (via onRevealChange) — the export captures whatever the canvas
// currently shows, so the two have to stay in sync.

export type ExportFormat = "png" | "pdf" | "pptx";
export type ExportQuality = "std" | "high" | "max";
export type ExportPageSize = "a3" | "a4";

const PIXEL_SCALE: Record<ExportQuality, number> = {
  std: 12,
  high: 24,
  max: 32,
};

const QUALITY_HINT: Record<ExportQuality, string> = {
  std: "Standard · ~225 dpi A3 · fastest",
  high: "High · ~460 dpi A3 · print-quality",
  max: "Max · ~615 dpi A3 · poster-grade · slow + heavy",
};

type Props = {
  open: boolean;
  onClose: () => void;
  getSvg: () => SVGSVGElement | null;
  eventMeta: EventMeta;
  groups: GroupRoster[];
  initialFormat: ExportFormat;
  initialQuality: ExportQuality;
  initialReveal: boolean;
  // Reveal change must mirror to the canvas so the export captures the
  // right state. Provided by LayoutEditor (it owns `revealNames`).
  onRevealChange: (next: boolean) => void;
  onExported: (format: ExportFormat) => void;
  // Persists the chosen quality back into the chip's sessionStorage key
  // so the next direct-button click defaults to whatever the dialog used.
  onQualityChange: (next: ExportQuality) => void;
};

export function ExportDialog({
  open,
  onClose,
  getSvg,
  eventMeta,
  groups,
  initialFormat,
  initialQuality,
  initialReveal,
  onRevealChange,
  onExported,
  onQualityChange,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [quality, setQuality] = useState<ExportQuality>(initialQuality);
  const [reveal, setReveal] = useState<boolean>(initialReveal);
  const [pageSize, setPageSize] = useState<ExportPageSize>("a3");
  const [includeCover, setIncludeCover] = useState(true);
  const [includeRosters, setIncludeRosters] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local state with caller's initials each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFormat(initialFormat);
    setQuality(initialQuality);
    setReveal(initialReveal);
    setError(null);
    setBusy(false);
  }, [open, initialFormat, initialQuality, initialReveal]);

  // Esc to close (when not exporting).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function pickReveal(next: boolean) {
    setReveal(next);
    onRevealChange(next);
  }

  function pickQuality(next: ExportQuality) {
    setQuality(next);
    onQualityChange(next);
  }

  async function runExport() {
    const svg = getSvg();
    if (!svg) {
      setError("Canvas not ready");
      return;
    }
    setBusy(true);
    setError(null);
    const tag = reveal ? "names" : "region-ids";
    const pixelScale = PIXEL_SCALE[quality];
    try {
      if (format === "png") {
        const blob = await exportFloorPlanPng(svg, { pixelScale });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.png`);
      } else if (format === "pdf") {
        const { exportFloorPlanPdf } = await import("@/lib/floor-plan/export-pdf");
        const blob = await exportFloorPlanPdf(svg, eventMeta, groups, {
          pixelScale,
          pageSize,
          includeCover,
        });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.pdf`);
      } else {
        const { exportFloorPlanPptx } = await import("@/lib/floor-plan/export-pptx");
        const blob = await exportFloorPlanPptx(svg, eventMeta, groups, {
          pixelScale,
          includeCover,
          includeRosters,
        });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.pptx`);
      }
      onExported(format);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  const formatLabel: Record<ExportFormat, string> = {
    png: "PNG",
    pdf: "PDF",
    pptx: "PPT",
  };

  // Portal to document.body so the dialog's `position: fixed` is anchored
  // to the viewport instead of being contained by the canvas overlay tree
  // (which has GPU-promoted transforms / will-change ancestors that
  // otherwise re-anchor `fixed` children).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <div
        className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-[1px]"
        onClick={() => !busy && onClose()}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[520px] rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-[var(--paper-shadow)]">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-4 h-px bg-current" />
            Export · 导出
          </div>
          <h2
            id="export-dialog-title"
            className="mt-2 font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-[var(--ink)]"
          >
            Export floor plan
          </h2>
          <p className="mt-1 text-[11.5px] text-[var(--ink-mute)] leading-[1.5]">
            Pick format, quality, and what to include. Settings persist to your
            next direct-export click on the chip.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Format */}
          <Section label="Format · 格式">
            <PillRow>
              {(["png", "pdf", "pptx"] as const).map((f) => (
                <Pill
                  key={f}
                  active={format === f}
                  onClick={() => setFormat(f)}
                  disabled={busy}
                >
                  {formatLabel[f]}
                </Pill>
              ))}
            </PillRow>
            <Hint>
              {format === "png"
                ? "Single PNG of the canvas — no cover, no rosters."
                : format === "pdf"
                  ? "Cover (optional) + plan page. Print-ready A3/A4 landscape."
                  : "Cover (optional) + plan + class summary + per-group rosters (optional). Editable in PowerPoint."}
            </Hint>
          </Section>

          {/* Page size — PDF only */}
          {format === "pdf" ? (
            <Section label="Page size · 页面">
              <PillRow>
                {(["a3", "a4"] as const).map((p) => (
                  <Pill
                    key={p}
                    active={pageSize === p}
                    onClick={() => setPageSize(p)}
                    disabled={busy}
                  >
                    {p.toUpperCase()} landscape
                  </Pill>
                ))}
              </PillRow>
            </Section>
          ) : null}

          {/* Quality */}
          <Section label="Quality · 画质">
            <PillRow>
              {(["std", "high", "max"] as const).map((q) => (
                <Pill
                  key={q}
                  active={quality === q}
                  onClick={() => pickQuality(q)}
                  disabled={busy}
                  title={QUALITY_HINT[q]}
                >
                  {q.toUpperCase()}
                </Pill>
              ))}
            </PillRow>
            <Hint>{QUALITY_HINT[quality]}</Hint>
          </Section>

          {/* Reveal */}
          <Section label="Reveal · 显示">
            <PillRow>
              <Pill
                active={reveal === true}
                onClick={() => pickReveal(true)}
                disabled={busy}
              >
                Names · 姓名
              </Pill>
              <Pill
                active={reveal === false}
                onClick={() => pickReveal(false)}
                disabled={busy}
              >
                Region IDs
              </Pill>
            </PillRow>
            <Hint>
              {reveal
                ? "Bilingual seat names render around each table."
                : "Region IDs render in place of names — useful for pre-event proofs."}
            </Hint>
          </Section>

          {/* Includes — PDF + PPT only */}
          {format !== "png" ? (
            <Section label="Includes · 内容">
              <CheckRow
                checked={includeCover}
                onChange={setIncludeCover}
                disabled={busy}
                label="Cover sheet"
                labelCn="封面"
              />
              {format === "pptx" ? (
                <CheckRow
                  checked={includeRosters}
                  onChange={setIncludeRosters}
                  disabled={busy}
                  label="Per-group rosters"
                  labelCn="分组名册"
                />
              ) : null}
            </Section>
          ) : null}

          {/* Error */}
          {error ? (
            <div
              className="px-3 py-2 rounded-[var(--radius-sm)] text-[11.5px] leading-[1.5]"
              style={{ background: "rgba(185,28,28,0.06)", color: "#B91C1C" }}
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--paper-shadow)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.1em] uppercase text-[var(--ink-mute)] hover:text-[var(--ink-soft)] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runExport}
            disabled={busy}
            className="h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] disabled:opacity-60 text-[var(--paper-warm)] text-[12px] tracking-[0.1em] uppercase font-medium transition-colors"
          >
            {busy ? "Rendering…" : `Export ${formatLabel[format]} →`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- Sub-components ---------------------------------------------------------

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
        {label}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function PillRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60 p-0.5 self-start">
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "px-2.5 py-1 rounded-[var(--radius-pill)] text-[11px] tracking-[0.12em] uppercase transition-colors disabled:opacity-60 "
        + (active
          ? "bg-[var(--paper-warm)] text-[var(--cinnabar-deep)] shadow-[var(--shadow-paper-1)]"
          : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]")
      }
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-[var(--ink-mute)] leading-[1.5]">
      {children}
    </p>
  );
}

function CheckRow({
  checked,
  onChange,
  disabled,
  label,
  labelCn,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  labelCn: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[12px] text-[var(--ink-soft)] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-[var(--cinnabar)] w-3.5 h-3.5"
      />
      <span>
        {label}
        <span className="text-[var(--ink-faint)]"> · {labelCn}</span>
      </span>
    </label>
  );
}
