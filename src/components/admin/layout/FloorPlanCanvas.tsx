"use client";

// FloorPlanCanvas — Miro-style SVG host for the floor-plan editor.
//
// View state:
//   { x, y, scale } — top-left of the visible viewBox in user-space, plus
//   a scale factor where scale = 1.0 means "the 200×120 page fills the
//   container exactly" (Fit). scale > 1 zooms in; scale < 1 zooms out.
//
// Interaction:
//   * Cmd/Ctrl + wheel  → cursor-centered zoom (also fired by trackpad
//                          pinch on macOS, which sends ctrlKey wheel events).
//   * Bare wheel / 2-finger swipe → 2D pan in user-space.
//   * Space + drag, or middle-click drag → grab-and-pan.
//   * Click empty canvas → clear selection.
//   * PointerDown on a shape → existing move/resize/rotate state machine.
//
// Density tier — `gmc-density-{hidden|compact|detailed}` class on the canvas
// root drives ShapeNode label visibility via globals.css. Print media forces
// `detailed` regardless of zoom so seating charts always print fully named.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShapeNode } from "./ShapeNode";
import { VB_H, VB_W, isSeatedKind } from "./types";
import type { GroupRoster, Shape } from "./types";

type Props = {
  shapes: Shape[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Shape>) => void;
  canEdit: boolean;
  revealNames: boolean;
  groupsById: Map<string, GroupRoster>;
  // View is lifted so the LayoutEditor toolbar can show + adjust the scale.
  view: View;
  onViewChange: (v: View) => void;
};

export type View = { x: number; y: number; scale: number };

export const FIT_VIEW: View = { x: 0, y: 0, scale: 1 };
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 6;

export type DragHandle = "body" | "rotate" | "br" | "tr" | "bl" | "tl";

type DragState =
  | null
  | {
      kind: "move";
      id: string;
      dx: number;
      dy: number;
    }
  | {
      kind: "resize";
      id: string;
      anchorX: number;
      anchorY: number;
      uniform: boolean;
    }
  | {
      kind: "rotate";
      id: string;
      cx: number;
      cy: number;
      startAngle: number;
      startRotation: number;
    }
  | {
      kind: "pan";
      startClientX: number;
      startClientY: number;
      startViewX: number;
      startViewY: number;
    };

export function FloorPlanCanvas({
  shapes,
  selectedId,
  onSelect,
  onUpdate,
  canEdit,
  revealNames,
  groupsById,
  view,
  onViewChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const viewRef = useRef<View>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // UI-only flags for cursor styling.
  const [dragKind, setDragKind] = useState<
    "move" | "resize" | "rotate" | "pan" | null
  >(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Density tier — drives label visibility via CSS class on the canvas root.
  const density: "hidden" | "compact" | "detailed" =
    view.scale < 0.6 ? "hidden" : view.scale < 1.25 ? "compact" : "detailed";

  // ViewBox derives directly from view state.
  const vbw = VB_W / view.scale;
  const vbh = VB_H / view.scale;
  const viewBox = `${view.x} ${view.y} ${vbw} ${vbh}`;

  // ---------------------------------------------------------------------------
  // Coord helpers — client coords → user-space, accounting for current view.
  // ---------------------------------------------------------------------------

  const clientToVB = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const v = viewRef.current;
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      return {
        x: v.x + fx * (VB_W / v.scale),
        y: v.y + fy * (VB_H / v.scale),
      };
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Zoom — cursor-centered. Adjusts both scale and view.x/y so the user-space
  // point under the cursor stays under the cursor.
  // ---------------------------------------------------------------------------

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const v = viewRef.current;
      const next = clamp(v.scale * factor, ZOOM_MIN, ZOOM_MAX);
      if (next === v.scale) return;
      const p = clientToVB(clientX, clientY);
      if (!p) return;
      // We want clientToVB(client) to return p with the new scale, so:
      //   p.x = newView.x + fx * (VB_W / next)   →   newView.x = p.x - fx * (VB_W / next)
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      onViewChange({
        x: p.x - fx * (VB_W / next),
        y: p.y - fy * (VB_H / next),
        scale: next,
      });
    },
    [clientToVB, onViewChange],
  );

  // ---------------------------------------------------------------------------
  // Wheel — passive: false attached via useEffect so we can preventDefault.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Don't hijack while a shape is being manipulated.
      if (
        dragRef.current
        && dragRef.current.kind !== "pan"
      ) {
        return;
      }
      // Cmd/Ctrl held = zoom (or trackpad pinch which sets ctrlKey).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Tighter zoom curve so wheel feels responsive but not dizzying.
        const factor = Math.exp(-e.deltaY * 0.0035);
        zoomAt(e.clientX, e.clientY, factor);
        return;
      }
      // Bare wheel / two-finger trackpad swipe → 2D pan.
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      const userPerPxX = (VB_W / v.scale) / rect.width;
      const userPerPxY = (VB_H / v.scale) / rect.height;
      onViewChange({
        x: v.x + e.deltaX * userPerPxX,
        y: v.y + e.deltaY * userPerPxY,
        scale: v.scale,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, onViewChange]);

  // ---------------------------------------------------------------------------
  // Pointer state machine — shape drag (move / resize / rotate) + canvas pan.
  // ---------------------------------------------------------------------------

  const startDrag = useCallback(
    (e: React.PointerEvent, id: string, handle: DragHandle) => {
      if (!canEdit) return;
      const target = shapes.find((s) => s.id === id);
      if (!target) return;
      // While space is held, swallow shape clicks → pan instead.
      if (spaceHeld) return;

      const p = clientToVB(e.clientX, e.clientY);
      if (!p) return;

      e.stopPropagation();
      // Selection happens regardless of lock state so admin can reach the
      // inspector to unlock the shape. Drag-state setup below is gated.
      onSelect(id);

      if (target.locked) return;

      if (handle === "body") {
        dragRef.current = {
          kind: "move",
          id,
          dx: p.x - target.x_pct,
          dy: p.y - target.y_pct,
        };
        setDragKind("move");
      } else if (handle === "rotate") {
        const cx = target.x_pct + target.width_pct / 2;
        const cy = target.y_pct + target.height_pct / 2;
        const start = Math.atan2(p.y - cy, p.x - cx) * (180 / Math.PI);
        dragRef.current = {
          kind: "rotate",
          id,
          cx,
          cy,
          startAngle: start,
          startRotation: target.rotation_deg,
        };
        setDragKind("rotate");
      } else {
        const left = target.x_pct;
        const top = target.y_pct;
        const right = target.x_pct + target.width_pct;
        const bottom = target.y_pct + target.height_pct;
        let anchorX = left;
        let anchorY = top;
        if (handle === "br") {
          anchorX = left;
          anchorY = top;
        } else if (handle === "tr") {
          anchorX = left;
          anchorY = bottom;
        } else if (handle === "bl") {
          anchorX = right;
          anchorY = top;
        } else if (handle === "tl") {
          anchorX = right;
          anchorY = bottom;
        }
        dragRef.current = {
          kind: "resize",
          id,
          anchorX,
          anchorY,
          uniform: target.kind === "round_table",
        };
        setDragKind("resize");
      }

      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [canEdit, shapes, spaceHeld, clientToVB, onSelect],
  );

  const startPan = useCallback((e: React.PointerEvent) => {
    const v = viewRef.current;
    dragRef.current = {
      kind: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startViewX: v.x,
      startViewY: v.y,
    };
    setDragKind("pan");
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === "pan") {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const v = viewRef.current;
        const userPerPxX = (VB_W / v.scale) / rect.width;
        const userPerPxY = (VB_H / v.scale) / rect.height;
        onViewChange({
          x: drag.startViewX - (e.clientX - drag.startClientX) * userPerPxX,
          y: drag.startViewY - (e.clientY - drag.startClientY) * userPerPxY,
          scale: v.scale,
        });
        return;
      }

      const p = clientToVB(e.clientX, e.clientY);
      if (!p) return;
      const target = shapes.find((s) => s.id === drag.id);
      if (!target) return;

      if (drag.kind === "move") {
        onUpdate(drag.id, {
          x_pct: p.x - drag.dx,
          y_pct: p.y - drag.dy,
        });
        return;
      }

      if (drag.kind === "resize") {
        const minSize = 1;
        let w = Math.max(minSize, Math.abs(p.x - drag.anchorX));
        let h = Math.max(minSize, Math.abs(p.y - drag.anchorY));
        if (drag.uniform) {
          const m = Math.max(w, h);
          w = m;
          h = m;
        }
        const x = Math.min(p.x, drag.anchorX);
        const y = Math.min(p.y, drag.anchorY);
        onUpdate(drag.id, {
          x_pct: x,
          y_pct: y,
          width_pct: w,
          height_pct: h,
        });
        return;
      }

      if (drag.kind === "rotate") {
        const angle =
          Math.atan2(p.y - drag.cy, p.x - drag.cx) * (180 / Math.PI);
        let next = drag.startRotation + (angle - drag.startAngle);
        next = ((next + 540) % 360) - 180;
        if (e.shiftKey) {
          next = Math.round(next / 15) * 15;
        }
        onUpdate(drag.id, { rotation_deg: next });
      }
    },
    [shapes, clientToVB, onUpdate, onViewChange],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragKind(null);
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Background pointerdown — clears selection OR enters pan mode.
  // ---------------------------------------------------------------------------

  const onBackgroundDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget) return;
      // Middle-click OR space-held → pan
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        e.preventDefault();
        startPan(e);
        return;
      }
      if (e.button !== 0) return;
      onSelect(null);
    },
    [onSelect, spaceHeld, startPan],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts. Cmd/Ctrl + 0 = Fit · 1 = 100% · = / + zoom in · - zoom out.
  // Space (held) → pan mode.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Don't hijack typing in form fields.
      const t = ev.target as HTMLElement | null;
      if (
        t
        && (t.tagName === "INPUT"
          || t.tagName === "TEXTAREA"
          || t.tagName === "SELECT"
          || t.isContentEditable)
      ) {
        return;
      }

      if (ev.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        setDragKind(null);
        return;
      }

      if (ev.code === "Space") {
        if (!spaceHeld) setSpaceHeld(true);
        // Stop the default scroll-on-space behavior.
        if (ev.target === document.body || ev.target === null) {
          ev.preventDefault();
        }
        return;
      }

      if (ev.metaKey || ev.ctrlKey) {
        if (ev.key === "0") {
          ev.preventDefault();
          onViewChange(FIT_VIEW);
          return;
        }
        if (ev.key === "1") {
          ev.preventDefault();
          onViewChange({ ...FIT_VIEW, scale: 1 });
          return;
        }
        if (ev.key === "=" || ev.key === "+") {
          ev.preventDefault();
          // Zoom centered on canvas mid.
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
          return;
        }
        if (ev.key === "-") {
          ev.preventDefault();
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
          return;
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === "Space") {
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [spaceHeld, onViewChange, zoomAt]);

  // ---------------------------------------------------------------------------
  // Print — snap to fit-view so the printable page is centered, regardless
  // of admin's current pan/zoom. Restored after print.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onBeforePrint = () => {
      // Save current view, switch to fit so the SVG viewBox = the printable
      // 200×120 page (off-page scratch shapes won't appear in print).
      const restored = viewRef.current;
      onViewChange(FIT_VIEW);
      const onAfter = () => {
        onViewChange(restored);
        window.removeEventListener("afterprint", onAfter);
      };
      window.addEventListener("afterprint", onAfter);
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [onViewChange]);

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------

  // Sort by z_order ascending so later z renders on top.
  const sorted = useMemo(
    () => [...shapes].sort((a, b) => a.z_order - b.z_order),
    [shapes],
  );

  // Background grid pad — extend the dotted/grid pattern past the page so
  // panning around shows context, not a void.
  const padX = VB_W * 1.5;
  const padY = VB_H * 1.5;

  const cursor =
    dragKind === "pan" || (spaceHeld && !dragKind)
      ? "grab"
      : dragKind === "move"
      ? "grabbing"
      : dragKind === "rotate"
      ? "alias"
      : dragKind === "resize"
      ? "nwse-resize"
      : "default";

  return (
    <div
      className={`relative rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden gmc-density-${density}`}
      style={{
        // Pass 4 — full-bleed canvas. Reserves only enough for AdminShell's
        // py-10 (~40px top) + a small bottom margin. Floating overlays
        // (palette, inspector, top chip) sit on top inside this card.
        height: "calc(100vh - 80px)",
        minHeight: "560px",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        className="block w-full h-full select-none touch-none"
        style={{ cursor }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern
            id="gmc-floor-grid"
            x="0"
            y="0"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 5 0 L 0 0 L 0 5"
              fill="none"
              stroke="var(--paper-shadow)"
              strokeWidth="0.08"
            />
          </pattern>
          <pattern
            id="gmc-floor-grid-strong"
            x="0"
            y="0"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 10 0 L 0 0 L 0 10"
              fill="none"
              stroke="var(--paper-shadow)"
              strokeWidth="0.18"
            />
          </pattern>
        </defs>

        {/* Off-page background — paper-warm tint, grid pattern fills the
            full pannable area so the canvas feels infinite. */}
        <rect
          x={-padX}
          y={-padY}
          width={padX * 2 + VB_W}
          height={padY * 2 + VB_H}
          fill="var(--paper-warm)"
        />
        <rect
          x={-padX}
          y={-padY}
          width={padX * 2 + VB_W}
          height={padY * 2 + VB_H}
          fill="url(#gmc-floor-grid)"
        />
        <rect
          x={-padX}
          y={-padY}
          width={padX * 2 + VB_W}
          height={padY * 2 + VB_H}
          fill="url(#gmc-floor-grid-strong)"
        />

        {/* Page (printable area) — slight paper tint over the grid so the
            printable boundary still reads as distinct. */}
        <rect
          x="0"
          y="0"
          width={VB_W}
          height={VB_H}
          fill="var(--paper)"
          opacity="0.5"
          pointerEvents="none"
        />
        <rect
          x="0.2"
          y="0.2"
          width={VB_W - 0.4}
          height={VB_H - 0.4}
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth="0.32"
          pointerEvents="none"
        />

        {/* Shapes. */}
        {sorted.map((s) => {
          const roster =
            s.group_id ? groupsById.get(s.group_id) ?? null : null;
          return (
            <ShapeNode
              key={s.id}
              shape={s}
              roster={roster}
              revealNames={revealNames}
              selected={s.id === selectedId}
              canEdit={canEdit}
              onPointerDownHandle={(e, handle) => startDrag(e, s.id, handle)}
              showResizeHandles={
                isSeatedKind(s.kind) || nonSeatedResizable(s.kind)
              }
              showRotateHandle={rotatableKind(s.kind)}
            />
          );
        })}
      </svg>

    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function nonSeatedResizable(kind: Shape["kind"]): boolean {
  return (
    kind === "stage"
    || kind === "podium"
    || kind === "text_label"
    || kind === "door"
    || kind === "wall"
  );
}

function rotatableKind(kind: Shape["kind"]): boolean {
  return (
    kind === "round_table"
    || kind === "square_table"
    || kind === "stage"
    || kind === "podium"
    || kind === "text_label"
    || kind === "wall"
  );
}
