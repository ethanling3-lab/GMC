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
import { VB_H, VB_W, isSeatedKind, mapDetectedCandidate } from "./types";
import type {
  DetectedCandidate,
  FloorPlanAsset,
  GroupRoster,
  Shape,
} from "./types";

type Props = {
  shapes: Shape[];
  // Primary selection — drives the inspector. Always either null or a
  // member of selectedIds.
  selectedId: string | null;
  // Full multi-select set — drives ring rendering + group move + marquee
  // additive behavior. Size 0 = nothing selected.
  selectedIds: ReadonlySet<string>;
  // Click on a shape: replace replaces selection with this id; toggle adds
  // or removes from selection without affecting other members. Click on
  // empty canvas: id=null + mode=replace clears selection.
  onSelect: (id: string | null, mode: "replace" | "toggle") => void;
  // Marquee result: replace replaces selection with these ids; additive
  // unions them in.
  onSelectMany: (ids: string[], additive: boolean) => void;
  onUpdate: (id: string, patch: Partial<Shape>) => void;
  canEdit: boolean;
  revealNames: boolean;
  // When true, drag positions snap to a 5-unit grid AND to other shapes'
  // edge / center alignments within a tolerance (smart guides).
  gridSnap: boolean;
  // Optional background floor-plan image rendered under the shapes layer.
  // Null = no upload yet. The url is a fresh signed URL from the page
  // loader (1h TTL).
  asset: FloorPlanAsset | null;
  // Image natural dimensions — used for letterbox-aware mapping of vision
  // candidates into user-space. Null until the image finishes loading.
  imageNatural: { w: number; h: number } | null;
  // Vision-detected candidates from the auto-detect route. Null = no
  // detection run yet; empty array = run completed with zero results.
  candidates: DetectedCandidate[] | null;
  onAcceptCandidate: (c: DetectedCandidate) => void;
  onRejectCandidate: (id: string) => void;
  groupsById: Map<string, GroupRoster>;
  // View is lifted so the LayoutEditor toolbar can show + adjust the scale.
  view: View;
  onViewChange: (v: View) => void;
  // Optional external ref the editor uses to grab the live <svg> for PNG/PDF/PPT
  // export. Mirrors the internal svgRef each render so callers always see the
  // current node.
  exportSvgRef?: { current: SVGSVGElement | null };
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
      // Anchor shape — the one the pointer is dragging directly.
      anchorId: string;
      dx: number;
      dy: number;
      // Other selected shapes that move with the anchor. relX/relY are the
      // signed offsets from the anchor's start position; we re-apply them
      // to the anchor's current position each pointer move.
      others: Array<{ id: string; relX: number; relY: number }>;
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
    }
  | {
      kind: "marquee";
      // User-space anchor and current corner. We render a rect between
      // them; on pointer up we compute hits.
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      additive: boolean;
      // Movement threshold tracking — clicks that don't move past 4px in
      // client space are treated as plain background clicks (selection
      // clear or no-op).
      startClientX: number;
      startClientY: number;
      moved: boolean;
    }
  | {
      // Multi-select group resize — drag any of the 4 bbox corner handles
      // to scale every selected shape together. Anchor stays put; the
      // member array captures each shape's start position + size so we
      // can rebuild positions independently of the running setShapes
      // state.
      kind: "multi_resize";
      anchorX: number;
      anchorY: number;
      bboxW0: number;
      bboxH0: number;
      uniform: boolean;
      members: Array<{
        id: string;
        x0: number;
        y0: number;
        w0: number;
        h0: number;
      }>;
    };

export function FloorPlanCanvas({
  shapes,
  selectedId,
  selectedIds,
  onSelect,
  onSelectMany,
  onUpdate,
  canEdit,
  revealNames,
  gridSnap,
  asset,
  imageNatural,
  candidates,
  onAcceptCandidate,
  onRejectCandidate,
  groupsById,
  view,
  onViewChange,
  exportSvgRef,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const viewRef = useRef<View>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  // Mirror the live SVG node into the parent's export ref every render so the
  // export helpers can serialize it without weaving forwardRef through the
  // entire canvas component.
  useEffect(() => {
    if (exportSvgRef) exportSvgRef.current = svgRef.current;
  });

  // UI-only flags for cursor styling.
  const [dragKind, setDragKind] = useState<
    "move" | "resize" | "rotate" | "pan" | "marquee" | null
  >(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Live marquee state for rendering. Mirrors dragRef when active.
  const [marquee, setMarquee] = useState<
    | null
    | { x: number; y: number; w: number; h: number }
  >(null);

  // Smart-alignment guides surfaced during a move drag. Each guide spans
  // the full canvas in its axis. Rendered above shapes during drag, cleared
  // on endDrag.
  const [guides, setGuides] = useState<
    Array<{ axis: "v" | "h"; coord: number }>
  >([]);

  // Latest selection — read by drag handlers without re-binding callbacks.
  const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Latest gridSnap — same idea.
  const gridSnapRef = useRef<boolean>(gridSnap);
  useEffect(() => {
    gridSnapRef.current = gridSnap;
  }, [gridSnap]);

  // Density tier — drives label visibility via CSS class on the canvas root.
  // Interaction mode: while admin is actively panning / zooming / dragging,
  // we force the "hidden" tier so the browser doesn't repaint hundreds of
  // seat-name text nodes on every frame. Restored 180ms after the last
  // motion event. At 300-pax scale (24+ tables × 12 seats) this is the
  // difference between janky pan and buttery pan.
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const interactingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const bumpInteracting = useCallback(() => {
    setIsInteracting(true);
    if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
    interactingTimerRef.current = setTimeout(() => {
      setIsInteracting(false);
    }, 180);
  }, []);
  useEffect(() => {
    return () => {
      if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
    };
  }, []);

  const baseDensity: "hidden" | "compact" | "detailed" =
    view.scale < 0.6 ? "hidden" : view.scale < 1.25 ? "compact" : "detailed";
  const density = isInteracting ? "hidden" : baseDensity;

  // SVG viewBox is FIXED at the page extents; pan + zoom are applied as
  // a CSS transform on a wrapper <g> instead. Browsers GPU-accelerate the
  // transform, while viewBox changes force a full repaint of every node
  // inside (with 24 tables × 12 seats that's ~600 SVG text repaints per
  // frame). Math is equivalent to the previous viewBox approach — see
  // clientToVB below for the mapping.
  const viewBox = `0 0 ${VB_W} ${VB_H}`;
  const stageTransform = `translate(${-view.x * view.scale} ${-view.y * view.scale}) scale(${view.scale})`;

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
    // RAF-coalesced wheel — trackpads + high-DPI mice fire wheel events at
    // 100+Hz; without coalescing each one would trigger a full React render
    // of the canvas. We accumulate deltas + zoom factors per frame and
    // dispatch a single setView in the RAF callback.
    let pendingPan = { dx: 0, dy: 0 };
    let pendingZoom: { factor: number; clientX: number; clientY: number } | null = null;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      const v = viewRef.current;
      // Apply zoom first (so pan accumulates against the zoomed view).
      if (pendingZoom) {
        zoomAt(pendingZoom.clientX, pendingZoom.clientY, pendingZoom.factor);
        pendingZoom = null;
      }
      if (pendingPan.dx !== 0 || pendingPan.dy !== 0) {
        const rect = el.getBoundingClientRect();
        const cur = viewRef.current; // may have changed via zoomAt
        const userPerPxX = (VB_W / cur.scale) / rect.width;
        const userPerPxY = (VB_H / cur.scale) / rect.height;
        onViewChange({
          x: cur.x + pendingPan.dx * userPerPxX,
          y: cur.y + pendingPan.dy * userPerPxY,
          scale: cur.scale,
        });
        pendingPan = { dx: 0, dy: 0 };
      }
      void v;
    };

    const onWheel = (e: WheelEvent) => {
      // Don't hijack while a shape is being manipulated.
      if (
        dragRef.current
        && dragRef.current.kind !== "pan"
      ) {
        return;
      }
      bumpInteracting();
      // Cmd/Ctrl held = zoom (or trackpad pinch which sets ctrlKey).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Tighter zoom curve so wheel feels responsive but not dizzying.
        const factor = Math.exp(-e.deltaY * 0.0035);
        if (pendingZoom) {
          // Multiply factors so consecutive wheel events compound.
          pendingZoom.factor *= factor;
          pendingZoom.clientX = e.clientX;
          pendingZoom.clientY = e.clientY;
        } else {
          pendingZoom = { factor, clientX: e.clientX, clientY: e.clientY };
        }
      } else {
        e.preventDefault();
        pendingPan.dx += e.deltaX;
        pendingPan.dy += e.deltaY;
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(flush);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [zoomAt, onViewChange, bumpInteracting]);

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
      // Shift-click on a shape toggles it in/out of the multi-selection
      // set. Plain click replaces selection. If shift-clicking a shape
      // that's already selected we just toggle and skip drag — otherwise
      // we'd unselect mid-drag.
      const wasSelected = selectedIdsRef.current.has(id);
      if (e.shiftKey) {
        onSelect(id, "toggle");
        if (wasSelected) {
          // Removing from selection — don't enter drag state.
          return;
        }
      } else if (!wasSelected) {
        // Plain click on an unselected shape → replace selection.
        onSelect(id, "replace");
      }
      // Else: plain click on already-selected shape → preserve selection
      // so a group move can grab any member without losing the others.

      if (target.locked) return;

      if (handle === "body") {
        // Capture the snapshot of every selected shape's position relative
        // to the anchor at drag start so we can move them in lock-step.
        // If only one shape is selected (or the clicked shape is the only
        // one we just selected), `others` is empty.
        const sel = selectedIdsRef.current;
        const others: Array<{ id: string; relX: number; relY: number }> = [];
        if (sel.size > 1 && sel.has(id)) {
          for (const s of shapes) {
            if (s.id === id || !sel.has(s.id) || s.locked) continue;
            others.push({
              id: s.id,
              relX: s.x_pct - target.x_pct,
              relY: s.y_pct - target.y_pct,
            });
          }
        }
        dragRef.current = {
          kind: "move",
          anchorId: id,
          dx: p.x - target.x_pct,
          dy: p.y - target.y_pct,
          others,
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

  // Stable adapter passed to every <ShapeNode> so React.memo's referential
  // prop check actually works. ShapeNode emits the shape id as the third
  // arg; we re-route to the existing startDrag(e, id, handle) signature.
  const shapePointerDown = useCallback(
    (e: React.PointerEvent, handle: DragHandle, shapeId: string) => {
      startDrag(e, shapeId, handle);
    },
    [startDrag],
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

  // Start a multi-select bbox resize. The opposite-corner anchor stays
  // pinned; member positions get rebuilt each pointermove relative to it.
  const startMultiResize = useCallback(
    (
      e: React.PointerEvent,
      handle: "tl" | "tr" | "bl" | "br",
      bbox: { x: number; y: number; width: number; height: number },
    ) => {
      if (!canEdit) return;
      e.stopPropagation();
      const left = bbox.x;
      const top = bbox.y;
      const right = bbox.x + bbox.width;
      const bottom = bbox.y + bbox.height;
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
      const members: Array<{
        id: string;
        x0: number;
        y0: number;
        w0: number;
        h0: number;
      }> = [];
      for (const s of shapes) {
        if (!selectedIdsRef.current.has(s.id)) continue;
        if (s.locked) continue;
        members.push({
          id: s.id,
          x0: s.x_pct,
          y0: s.y_pct,
          w0: s.width_pct,
          h0: s.height_pct,
        });
      }
      if (members.length === 0) return;
      // If any selected shape is a round_table, lock to uniform scaling so
      // circles don't get stretched into ovals. Shift held = uniform too.
      const hasRound = shapes.some(
        (s) => selectedIdsRef.current.has(s.id) && s.kind === "round_table",
      );
      dragRef.current = {
        kind: "multi_resize",
        anchorX,
        anchorY,
        bboxW0: Math.max(0.001, bbox.width),
        bboxH0: Math.max(0.001, bbox.height),
        uniform: hasRound || e.shiftKey,
        members,
      };
      setDragKind("resize");
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [canEdit, shapes],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Mark interaction so the canvas can drop seat labels (CSS density)
      // until 180ms after motion stops. Cheap — just a setState + timer.
      bumpInteracting();

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

      if (drag.kind === "marquee") {
        const p = clientToVB(e.clientX, e.clientY);
        if (!p) return;
        const dxC = e.clientX - drag.startClientX;
        const dyC = e.clientY - drag.startClientY;
        if (!drag.moved && Math.abs(dxC) + Math.abs(dyC) >= 4) {
          drag.moved = true;
        }
        drag.currentX = p.x;
        drag.currentY = p.y;
        if (drag.moved) {
          setMarquee({
            x: Math.min(drag.startX, drag.currentX),
            y: Math.min(drag.startY, drag.currentY),
            w: Math.abs(drag.currentX - drag.startX),
            h: Math.abs(drag.currentY - drag.startY),
          });
        }
        return;
      }

      const p = clientToVB(e.clientX, e.clientY);
      if (!p) return;

      if (drag.kind === "move") {
        const target = shapes.find((s) => s.id === drag.anchorId);
        if (!target) return;
        const proposedX = p.x - drag.dx;
        const proposedY = p.y - drag.dy;
        // Snap the anchor (using its own bounding box). Guide lines are
        // recorded against page coords for render. Group members follow at
        // exact relative offsets — they may not individually snap, but the
        // group preserves its internal spacing, which is what admins want.
        const movingIds = new Set<string>([drag.anchorId]);
        for (const o of drag.others) movingIds.add(o.id);
        const snap = snapMovePosition(
          shapes,
          movingIds,
          proposedX,
          proposedY,
          target.width_pct,
          target.height_pct,
          gridSnapRef.current,
        );
        onUpdate(drag.anchorId, { x_pct: snap.x, y_pct: snap.y });
        for (const o of drag.others) {
          onUpdate(o.id, {
            x_pct: snap.x + o.relX,
            y_pct: snap.y + o.relY,
          });
        }
        setGuides(snap.guides);
        return;
      }

      if (drag.kind === "multi_resize") {
        // Compute new bbox dimensions from the anchor → pointer delta. A
        // minimum size protects against degenerate scale factors when the
        // pointer crosses the anchor.
        const minSize = 1;
        const newW = Math.max(minSize, Math.abs(p.x - drag.anchorX));
        const newH = Math.max(minSize, Math.abs(p.y - drag.anchorY));
        let scaleX = newW / drag.bboxW0;
        let scaleY = newH / drag.bboxH0;
        if (drag.uniform || e.shiftKey) {
          const m = Math.min(scaleX, scaleY);
          scaleX = m;
          scaleY = m;
        }
        for (const member of drag.members) {
          const relX = member.x0 - drag.anchorX;
          const relY = member.y0 - drag.anchorY;
          onUpdate(member.id, {
            x_pct: drag.anchorX + relX * scaleX,
            y_pct: drag.anchorY + relY * scaleY,
            width_pct: Math.max(minSize, member.w0 * scaleX),
            height_pct: Math.max(minSize, member.h0 * scaleY),
          });
        }
        return;
      }

      const target = shapes.find((s) => s.id === drag.id);
      if (!target) return;

      if (drag.kind === "resize") {
        const minSize = 1;
        // Snap the moving edge (the pointer-side, not the anchor) to the
        // grid + alignment targets. The anchor is the opposite corner so
        // it stays put; the new edge's coords are the snap surface.
        const snapped = snapResizeEdges(
          shapes,
          drag.id,
          drag.anchorX,
          drag.anchorY,
          p.x,
          p.y,
          gridSnapRef.current,
        );
        let w = Math.max(minSize, Math.abs(snapped.x - drag.anchorX));
        let h = Math.max(minSize, Math.abs(snapped.y - drag.anchorY));
        if (drag.uniform) {
          const m = Math.max(w, h);
          w = m;
          h = m;
        }
        const x = Math.min(snapped.x, drag.anchorX);
        const y = Math.min(snapped.y, drag.anchorY);
        onUpdate(drag.id, {
          x_pct: x,
          y_pct: y,
          width_pct: w,
          height_pct: h,
        });
        setGuides(snapped.guides);
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
    [shapes, clientToVB, onUpdate, onViewChange, bumpInteracting],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Marquee: compute hits OR treat as plain click on empty canvas.
      if (drag.kind === "marquee") {
        if (!drag.moved) {
          // Plain click on empty canvas. Shift = no-op (keep selection),
          // bare click = clear.
          if (!drag.additive) onSelect(null, "replace");
        } else {
          const x0 = Math.min(drag.startX, drag.currentX);
          const y0 = Math.min(drag.startY, drag.currentY);
          const x1 = Math.max(drag.startX, drag.currentX);
          const y1 = Math.max(drag.startY, drag.currentY);
          const hits: string[] = [];
          for (const s of shapes) {
            // Bounding-box overlap test (any intersection counts). Don't
            // include rotation in the hit test — close enough for now and
            // matches the visual.
            const sx1 = s.x_pct + s.width_pct;
            const sy1 = s.y_pct + s.height_pct;
            if (s.x_pct < x1 && sx1 > x0 && s.y_pct < y1 && sy1 > y0) {
              hits.push(s.id);
            }
          }
          onSelectMany(hits, drag.additive);
        }
        setMarquee(null);
      }

      dragRef.current = null;
      setDragKind(null);
      setGuides([]);
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [shapes, onSelect, onSelectMany],
  );

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

      // Start a marquee. If the user just clicks (no drag), endDrag treats
      // it as a selection clear (or no-op on shift). Marquee threshold is
      // checked in onPointerMove.
      const p = clientToVB(e.clientX, e.clientY);
      if (!p) {
        // Fallback to legacy clear-selection behavior.
        if (!e.shiftKey) onSelect(null, "replace");
        return;
      }
      dragRef.current = {
        kind: "marquee",
        startX: p.x,
        startY: p.y,
        currentX: p.x,
        currentY: p.y,
        additive: e.shiftKey,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      };
      setDragKind("marquee");
      try {
        svgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [onSelect, spaceHeld, startPan, clientToVB],
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
        setMarquee(null);
        setGuides([]);
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

  // Multi-select bounding box — union of every selected shape's bounding
  // rect. Drives the dashed selection rect + 4 corner handles when the
  // selection size is 2+. Returns null for single (or empty) selections;
  // single-shape selection keeps its per-shape handles inside ShapeNode.
  const selectionBBox = useMemo<
    null | { x: number; y: number; width: number; height: number }
  >(() => {
    if (selectedIds.size < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      if (!selectedIds.has(s.id)) continue;
      if (s.x_pct < minX) minX = s.x_pct;
      if (s.y_pct < minY) minY = s.y_pct;
      const right = s.x_pct + s.width_pct;
      const bottom = s.y_pct + s.height_pct;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    if (!Number.isFinite(minX)) return null;
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [shapes, selectedIds]);

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
      : dragKind === "marquee"
      ? "crosshair"
      : "default";

  return (
    <div
      className={`relative rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden gmc-density-${density}`}
      style={{
        // Full-bleed canvas sized to fit the viewport with no scroll. Reserves
        // AdminShell's TopBar (h-16 = 64px) + main py-10 (40 + 40 = 80px) so
        // the card hugs the bottom of the viewport exactly. Floating overlays
        // (palette, inspector, top + background chips) sit on top inside this
        // card.
        height: "calc(100dvh - 144px)",
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

        {/* Stage — a single transformed <g> wraps every visible piece so
            pan/zoom is one GPU-accelerated transform update instead of
            forcing the browser to repaint every shape, seat, and label
            on every frame. willChange hints the compositor to promote
            this layer. */}
        <g
          data-export-stage="true"
          transform={stageTransform}
          style={{ willChange: "transform" }}
        >

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
          className="gmc-floor-grid-fill"
        />
        <rect
          x={-padX}
          y={-padY}
          width={padX * 2 + VB_W}
          height={padY * 2 + VB_H}
          fill="url(#gmc-floor-grid-strong)"
          className="gmc-floor-grid-fill"
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

        {/* Background floor-plan asset — rendered between the page tint and
            the printable boundary stroke so the page outline stays visible.
            preserveAspectRatio="xMidYMid meet" stretches the image to fit
            within the page bounding box without distortion. pointer-events
            disabled so it never intercepts shape clicks. */}
        {asset ? (
          <image
            href={asset.url}
            x={0}
            y={0}
            width={VB_W}
            height={VB_H}
            opacity={asset.opacity}
            preserveAspectRatio="xMidYMid meet"
            pointerEvents="none"
            className="gmc-floor-bg-asset"
          />
        ) : null}

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
          // Selected = anywhere in the multi-set; primary = the one whose
          // resize/rotate handles + inspector edits target. Only the
          // primary gets handles to avoid 50 handle rings on Cmd+A.
          const isSelected = selectedIds.has(s.id);
          const isPrimary = s.id === selectedId;
          // When N>1 selected we surface bbox handles instead of per-shape
          // handles, so admin sees one transform target for the whole group.
          const singleSelected = selectedIds.size === 1;
          return (
            <ShapeNode
              key={s.id}
              shape={s}
              roster={roster}
              revealNames={revealNames}
              selected={isSelected}
              canEdit={canEdit}
              onPointerDownHandle={shapePointerDown}
              showResizeHandles={
                isPrimary
                && singleSelected
                && (isSeatedKind(s.kind) || nonSeatedResizable(s.kind))
              }
              showRotateHandle={
                isPrimary && singleSelected && rotatableKind(s.kind)
              }
            />
          );
        })}

        {/* Multi-select bbox + corner resize handles — drawn whenever 2+
            shapes are selected. Renders above shapes so admins can grab
            handles without the underlying shape stealing the pointer. */}
        {selectionBBox && canEdit ? (
          <g pointerEvents="none">
            <rect
              x={selectionBBox.x}
              y={selectionBBox.y}
              width={selectionBBox.width}
              height={selectionBBox.height}
              fill="none"
              stroke="var(--cinnabar)"
              strokeWidth={0.32 / view.scale}
              strokeDasharray={`${1.2 / view.scale} ${0.7 / view.scale}`}
            />
          </g>
        ) : null}
        {selectionBBox && canEdit ? (
          <>
            <BBoxHandle
              x={selectionBBox.x}
              y={selectionBBox.y}
              viewScale={view.scale}
              cursor="nwse-resize"
              onDown={(e) => startMultiResize(e, "tl", selectionBBox)}
            />
            <BBoxHandle
              x={selectionBBox.x + selectionBBox.width}
              y={selectionBBox.y}
              viewScale={view.scale}
              cursor="nesw-resize"
              onDown={(e) => startMultiResize(e, "tr", selectionBBox)}
            />
            <BBoxHandle
              x={selectionBBox.x}
              y={selectionBBox.y + selectionBBox.height}
              viewScale={view.scale}
              cursor="nesw-resize"
              onDown={(e) => startMultiResize(e, "bl", selectionBBox)}
            />
            <BBoxHandle
              x={selectionBBox.x + selectionBBox.width}
              y={selectionBBox.y + selectionBBox.height}
              viewScale={view.scale}
              cursor="nwse-resize"
              onDown={(e) => startMultiResize(e, "br", selectionBBox)}
            />
          </>
        ) : null}

        {/* Marquee rect — drawn during drag-rect selection. */}
        {marquee ? (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill="var(--cinnabar)"
            fillOpacity="0.07"
            stroke="var(--cinnabar)"
            strokeWidth={0.4 / view.scale}
            strokeDasharray={`${1.2 / view.scale} ${0.8 / view.scale}`}
            pointerEvents="none"
          />
        ) : null}

        {/* Vision-detected candidates — dashed cinnabar overlays with
            inline accept ✓ / reject ✕ buttons. Each candidate's coords are
            mapped from normalized image-relative space into user-space via
            the imageNatural letterbox math. Always above shapes so admin
            can act on them; below guides so a drag-snap line still wins
            visually. */}
        {candidates && candidates.length > 0
          ? candidates.map((c) => (
              <CandidateNode
                key={c.id}
                candidate={c}
                imageNatural={imageNatural}
                viewScale={view.scale}
                canEdit={canEdit}
                onAccept={() => onAcceptCandidate(c)}
                onReject={() => onRejectCandidate(c.id)}
              />
            ))
          : null}

        {/* Smart-alignment guides — gold hairlines across the full
            pannable area, only visible while a snap is active. */}
        {guides.length > 0
          ? guides.map((g, i) =>
              g.axis === "v" ? (
                <line
                  key={`g-${i}-${g.axis}-${g.coord}`}
                  x1={g.coord}
                  y1={-padY}
                  x2={g.coord}
                  y2={padY * 2 + VB_H}
                  stroke="var(--gold, #B8860B)"
                  strokeWidth={0.18 / view.scale}
                  strokeOpacity="0.75"
                  pointerEvents="none"
                />
              ) : (
                <line
                  key={`g-${i}-${g.axis}-${g.coord}`}
                  x1={-padX}
                  y1={g.coord}
                  x2={padX * 2 + VB_W}
                  y2={g.coord}
                  stroke="var(--gold, #B8860B)"
                  strokeWidth={0.18 / view.scale}
                  strokeOpacity="0.75"
                  pointerEvents="none"
                />
              ),
            )
          : null}
        </g>
      </svg>

    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Small square handle for the multi-select bounding box. Sized in user-
// space but the visible footprint scales with the inverse of view.scale
// so it always reads as ~6px on screen regardless of zoom. Cinnabar fill
// matches the dashed bbox stroke.
function BBoxHandle({
  x,
  y,
  viewScale,
  cursor,
  onDown,
}: {
  x: number;
  y: number;
  viewScale: number;
  cursor: string;
  onDown: (e: React.PointerEvent) => void;
}) {
  const half = 0.85 / viewScale;
  const stroke = 0.18 / viewScale;
  return (
    <rect
      x={x - half}
      y={y - half}
      width={half * 2}
      height={half * 2}
      fill="var(--paper)"
      stroke="var(--cinnabar)"
      strokeWidth={stroke}
      style={{ cursor }}
      onPointerDown={onDown}
    />
  );
}

// Single vision-detected candidate — dashed bounding box with inline
// accept ✓ / reject ✕ controls. round_table candidates render with a
// circle inset; square_table renders the rect outline. Accept button
// nudges adoption (cinnabar-filled), reject is the X to dismiss.
function CandidateNode({
  candidate,
  imageNatural,
  viewScale,
  canEdit,
  onAccept,
  onReject,
}: {
  candidate: DetectedCandidate;
  imageNatural: { w: number; h: number } | null;
  viewScale: number;
  canEdit: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const m = mapDetectedCandidate(candidate, imageNatural);
  const stroke = 0.32 / viewScale;
  const dash = `${1.6 / viewScale} ${1.0 / viewScale}`;
  // Action buttons live just above the candidate; size scales with view so
  // they stay tappable at every zoom.
  const btnY = m.y - 4 / viewScale;
  const btnSize = 3.2 / viewScale;
  return (
    <g>
      {candidate.kind === "round_table" ? (
        <circle
          cx={m.x + m.width / 2}
          cy={m.y + m.height / 2}
          r={Math.max(m.width, m.height) / 2}
          fill="var(--cinnabar-wash)"
          fillOpacity="0.18"
          stroke="var(--cinnabar)"
          strokeWidth={stroke}
          strokeDasharray={dash}
          pointerEvents="none"
        />
      ) : (
        <rect
          x={m.x}
          y={m.y}
          width={m.width}
          height={m.height}
          fill="var(--cinnabar-wash)"
          fillOpacity="0.18"
          stroke="var(--cinnabar)"
          strokeWidth={stroke}
          strokeDasharray={dash}
          pointerEvents="none"
        />
      )}
      {candidate.label ? (
        <text
          x={m.x + m.width / 2}
          y={m.y + m.height / 2 + 0.6}
          fontSize={Math.max(2.4, Math.min(m.width, m.height) * 0.32)}
          textAnchor="middle"
          fill="var(--cinnabar-deep)"
          fontFamily="var(--font-display), serif"
          pointerEvents="none"
        >
          {candidate.label}
        </text>
      ) : null}
      {canEdit ? (
        <>
          {/* Accept ✓ — cinnabar pill, sits to the LEFT of the box top edge */}
          <g
            onClick={onAccept}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label="Accept candidate"
          >
            <rect
              x={m.x}
              y={btnY}
              width={btnSize}
              height={btnSize}
              rx={btnSize * 0.2}
              fill="var(--cinnabar)"
              stroke="var(--cinnabar-deep)"
              strokeWidth={stroke}
            />
            <path
              d={`M ${m.x + btnSize * 0.22} ${btnY + btnSize * 0.55} L ${m.x + btnSize * 0.42} ${btnY + btnSize * 0.75} L ${m.x + btnSize * 0.78} ${btnY + btnSize * 0.3}`}
              fill="none"
              stroke="var(--paper)"
              strokeWidth={stroke * 2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          {/* Reject ✕ — paper pill, sits to the RIGHT of accept */}
          <g
            onClick={onReject}
            style={{ cursor: "pointer" }}
            role="button"
            aria-label="Reject candidate"
            transform={`translate(${btnSize * 1.2} 0)`}
          >
            <rect
              x={m.x}
              y={btnY}
              width={btnSize}
              height={btnSize}
              rx={btnSize * 0.2}
              fill="var(--paper)"
              stroke="var(--paper-shadow)"
              strokeWidth={stroke}
            />
            <path
              d={`M ${m.x + btnSize * 0.28} ${btnY + btnSize * 0.28} L ${m.x + btnSize * 0.72} ${btnY + btnSize * 0.72} M ${m.x + btnSize * 0.72} ${btnY + btnSize * 0.28} L ${m.x + btnSize * 0.28} ${btnY + btnSize * 0.72}`}
              fill="none"
              stroke="var(--ink-soft)"
              strokeWidth={stroke * 2.2}
              strokeLinecap="round"
            />
          </g>
        </>
      ) : null}
    </g>
  );
}

// Snap math — applies during a body drag. When `gridSnap` is on, look for
// a smart-guide alignment first (left / center / right edges of the moving
// shape against any non-moving shape's edges or the page boundary), then
// fall back to a 5-unit grid. Threshold is in user-space units.
const SNAP_GRID = 5;
const SNAP_THRESHOLD = 1.0;

function snapMovePosition(
  shapes: Shape[],
  movingIds: ReadonlySet<string>,
  proposedX: number,
  proposedY: number,
  width: number,
  height: number,
  gridSnap: boolean,
): {
  x: number;
  y: number;
  guides: Array<{ axis: "v" | "h"; coord: number }>;
} {
  if (!gridSnap) {
    return { x: proposedX, y: proposedY, guides: [] };
  }

  // Build candidate target arrays. Page boundaries + center are always
  // candidates; other shapes contribute their three edges per axis.
  const xTargets: number[] = [0, VB_W / 2, VB_W];
  const yTargets: number[] = [0, VB_H / 2, VB_H];
  for (const s of shapes) {
    if (movingIds.has(s.id)) continue;
    xTargets.push(s.x_pct, s.x_pct + s.width_pct / 2, s.x_pct + s.width_pct);
    yTargets.push(s.y_pct, s.y_pct + s.height_pct / 2, s.y_pct + s.height_pct);
  }

  const movingXs = [proposedX, proposedX + width / 2, proposedX + width];
  const movingYs = [proposedY, proposedY + height / 2, proposedY + height];

  const xSnap = nearestTarget(movingXs, xTargets, SNAP_THRESHOLD);
  const ySnap = nearestTarget(movingYs, yTargets, SNAP_THRESHOLD);

  let x = proposedX;
  let y = proposedY;
  const guides: Array<{ axis: "v" | "h"; coord: number }> = [];

  if (xSnap) {
    x = proposedX + xSnap.delta;
    guides.push({ axis: "v", coord: xSnap.target });
  } else {
    // Fall back to grid-multiples on the left edge.
    x = Math.round(proposedX / SNAP_GRID) * SNAP_GRID;
  }
  if (ySnap) {
    y = proposedY + ySnap.delta;
    guides.push({ axis: "h", coord: ySnap.target });
  } else {
    y = Math.round(proposedY / SNAP_GRID) * SNAP_GRID;
  }

  return { x, y, guides };
}

// Resize variant — only the moving (pointer-side) corner snaps. Anchor
// stays put. Returns the new x/y for the moving corner + guide specs.
function snapResizeEdges(
  shapes: Shape[],
  movingId: string,
  anchorX: number,
  anchorY: number,
  proposedX: number,
  proposedY: number,
  gridSnap: boolean,
): {
  x: number;
  y: number;
  guides: Array<{ axis: "v" | "h"; coord: number }>;
} {
  if (!gridSnap) {
    return { x: proposedX, y: proposedY, guides: [] };
  }
  const xTargets: number[] = [0, VB_W / 2, VB_W];
  const yTargets: number[] = [0, VB_H / 2, VB_H];
  for (const s of shapes) {
    if (s.id === movingId) continue;
    xTargets.push(s.x_pct, s.x_pct + s.width_pct / 2, s.x_pct + s.width_pct);
    yTargets.push(s.y_pct, s.y_pct + s.height_pct / 2, s.y_pct + s.height_pct);
  }

  // The moving corner is a single point in each axis.
  const xSnap = nearestTarget([proposedX], xTargets, SNAP_THRESHOLD);
  const ySnap = nearestTarget([proposedY], yTargets, SNAP_THRESHOLD);

  let x = proposedX;
  let y = proposedY;
  const guides: Array<{ axis: "v" | "h"; coord: number }> = [];
  if (xSnap) {
    x = xSnap.target;
    guides.push({ axis: "v", coord: xSnap.target });
  } else {
    x = Math.round(proposedX / SNAP_GRID) * SNAP_GRID;
  }
  if (ySnap) {
    y = ySnap.target;
    guides.push({ axis: "h", coord: ySnap.target });
  } else {
    y = Math.round(proposedY / SNAP_GRID) * SNAP_GRID;
  }
  // Suppress empty-axis adjustments — anchorX/Y are reference points;
  // when proposed is on the wrong side, the resize math on the caller
  // handles flipping the bounding box. Just pass back the snapped values.
  void anchorX;
  void anchorY;
  return { x, y, guides };
}

function nearestTarget(
  movingValues: number[],
  targetValues: number[],
  threshold: number,
): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  let bestAbs = threshold;
  for (const m of movingValues) {
    for (const t of targetValues) {
      const d = t - m;
      const a = Math.abs(d);
      if (a < bestAbs) {
        bestAbs = a;
        best = { delta: d, target: t };
      }
    }
  }
  return best;
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
