"use client";

import { useEffect, useState } from "react";
import { downloadBlob, exportFloorPlanPng } from "@/lib/floor-plan/export-png";
import type { EventMeta } from "@/lib/floor-plan/export-pdf";
import type { GroupRoster } from "./types";
import { ExportDialog, type ExportFormat as DialogFormat, type ExportQuality } from "./ExportDialog";

// Bottom-right floating chip — sits opposite the background chip. Surfaces
// direct PNG / PDF / PPT buttons for fast common-case exports plus an
// "Options…" trigger that opens a full dialog with format / page size /
// reveal / quality / cover toggles for finer control.

type Props = {
  // Resolves the live <svg> at click time. The canvas only populates its
  // export ref after mount, so a snapshot at parent-render time would be
  // null on the first paint.
  getSvg: () => SVGSVGElement | null;
  // Event meta used by the PDF cover page.
  eventMeta: EventMeta;
  // Group rosters used by the PDF / PPT roster pages.
  groups: GroupRoster[];
  // Reveal mode, captured into the filename so admins know which version
  // they downloaded ("names" vs "region-ids").
  revealNames: boolean;
  // Lets the dialog flip the canvas reveal state to keep the export in
  // sync with what the canvas displays.
  onRevealChange: (next: boolean) => void;
  // Fires after a successful export so the parent can ping the audit
  // endpoint (kept here as a prop so this component stays presentational).
  onExported: (format: "png" | "pdf" | "pptx") => void;
};

type ExportFormat = DialogFormat;

type Quality = ExportQuality;

// pixelScale = multiplier on the source viewBox (300×180). The PNG render
// is the dominant cost, so this dial drives both PNG and PDF output:
//   std  →  3600 × 2160 ≈ 225 dpi @ A3   — fast share / screen
//   high →  7200 × 4320 ≈ 460 dpi @ A3   — print-quality (default)
//   max  →  9600 × 5760 ≈ 615 dpi @ A3   — poster-grade, heavy + slow
const PIXEL_SCALE: Record<Quality, number> = {
  std: 12,
  high: 24,
  max: 32,
};

const QUALITY_LABEL: Record<Quality, string> = {
  std: "STD",
  high: "HIGH",
  max: "MAX",
};

const QUALITY_TITLE: Record<Quality, string> = {
  std: "Standard · ~225 dpi A3 · fastest, smallest file",
  high: "High · ~460 dpi A3 · print-quality (default)",
  max: "Max · ~615 dpi A3 · poster-grade, slow + heavy",
};

type ExportState =
  | { phase: "idle" }
  | { phase: "busy"; format: ExportFormat }
  | { phase: "error"; message: string };

function readInitialQuality(eventId: string): Quality {
  if (typeof window === "undefined") return "high";
  try {
    const v = window.sessionStorage.getItem(`gmc-export-quality:${eventId}`);
    if (v === "std" || v === "high" || v === "max") return v;
  } catch {
    /* ignore */
  }
  return "high";
}

export function FloatingExportChip({
  getSvg,
  eventMeta,
  groups,
  revealNames,
  onRevealChange,
  onExported,
}: Props) {
  const [state, setState] = useState<ExportState>({ phase: "idle" });
  // Default to "high" on SSR + first client render so hydration matches.
  // Saved preference (if any) is read in a post-mount effect.
  const [quality, setQualityState] = useState<Quality>("high");
  useEffect(() => {
    const v = readInitialQuality(eventMeta.slug);
    if (v !== "high") setQualityState(v);
  }, [eventMeta.slug]);

  // Last format the admin clicked (or last format used in the dialog).
  // Drives the dialog's initialFormat so reopening keeps continuity.
  const [lastFormat, setLastFormat] = useState<ExportFormat>("pdf");
  // Dialog open state.
  const [dialogOpen, setDialogOpen] = useState(false);

  function setQuality(next: Quality) {
    setQualityState(next);
    try {
      window.sessionStorage.setItem(`gmc-export-quality:${eventMeta.slug}`, next);
    } catch {
      /* ignore */
    }
  }

  async function runExport(format: ExportFormat) {
    const svg = getSvg();
    if (!svg) {
      setState({ phase: "error", message: "Canvas not ready" });
      return;
    }
    setState({ phase: "busy", format });
    try {
      const tag = revealNames ? "names" : "region-ids";
      const pixelScale = PIXEL_SCALE[quality];
      if (format === "png") {
        const blob = await exportFloorPlanPng(svg, { pixelScale });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.png`);
      } else if (format === "pdf") {
        // Dynamic import — keeps jsPDF off the editor's first paint bundle.
        const { exportFloorPlanPdf } = await import("@/lib/floor-plan/export-pdf");
        const blob = await exportFloorPlanPdf(svg, eventMeta, groups, {
          pixelScale,
        });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.pdf`);
      } else {
        // Dynamic import — keeps pptxgenjs (~150 KB gzipped) + JSZip off
        // the editor's first paint bundle.
        const { exportFloorPlanPptx } = await import("@/lib/floor-plan/export-pptx");
        const blob = await exportFloorPlanPptx(svg, eventMeta, groups, {
          pixelScale,
        });
        downloadBlob(blob, `${eventMeta.slug}-floor-plan-${tag}-${quality}.pptx`);
      }
      setState({ phase: "idle" });
      setLastFormat(format);
      onExported(format);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setState({ phase: "error", message: msg });
    }
  }

  const busy = state.phase === "busy";

  return (
    <div className="gmc-print-hide absolute right-3 bottom-3 z-10 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] px-2 py-1.5 whitespace-nowrap">
      {/* Quality picker — three pills, one selected. */}
      <span
        className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60 p-0.5"
        role="radiogroup"
        aria-label="Export quality"
      >
        {(["std", "high", "max"] as const).map((q) => {
          const active = quality === q;
          return (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setQuality(q)}
              disabled={busy}
              title={QUALITY_TITLE[q]}
              className={
                "px-1.5 py-0.5 rounded-[var(--radius-pill)] text-[9.5px] tracking-[0.16em] uppercase transition-colors disabled:opacity-60 "
                + (active
                  ? "bg-[var(--paper-warm)] text-[var(--cinnabar-deep)] shadow-[var(--shadow-paper-1)]"
                  : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]")
              }
            >
              {QUALITY_LABEL[q]}
            </button>
          );
        })}
      </span>

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      <button
        type="button"
        onClick={() => runExport("png")}
        disabled={busy}
        className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors"
        title={`Export floor plan as PNG · ${QUALITY_TITLE[quality]}`}
      >
        {busy && state.format === "png" ? "Rendering…" : "PNG"}
      </button>

      <button
        type="button"
        onClick={() => runExport("pdf")}
        disabled={busy}
        className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors"
        title={`Export floor plan as PDF (cover + plan) · ${QUALITY_TITLE[quality]}`}
      >
        {busy && state.format === "pdf" ? "Rendering…" : "PDF"}
      </button>

      <button
        type="button"
        onClick={() => runExport("pptx")}
        disabled={busy}
        className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors"
        title={`Export as PPT (cover + plan + class summary + per-group rosters) · ${QUALITY_TITLE[quality]}`}
      >
        {busy && state.format === "pptx" ? "Rendering…" : "PPT"}
      </button>

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={busy}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-faint)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] disabled:opacity-60 transition-colors text-[14px] leading-none"
        title="Export options · 选项"
        aria-label="Open export options dialog"
      >
        ⚙
      </button>

      {state.phase === "error" ? (
        <>
          <span className="w-px h-4 bg-[var(--paper-shadow)]" />
          <span
            className="text-[10px] tracking-[0.16em] uppercase"
            style={{ color: "#B91C1C" }}
            title={state.message}
          >
            Failed
          </span>
        </>
      ) : null}

      <ExportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        getSvg={getSvg}
        eventMeta={eventMeta}
        groups={groups}
        initialFormat={lastFormat}
        initialQuality={quality}
        initialReveal={revealNames}
        onRevealChange={onRevealChange}
        onQualityChange={setQuality}
        onExported={(f) => {
          setLastFormat(f);
          onExported(f);
        }}
      />
    </div>
  );
}
