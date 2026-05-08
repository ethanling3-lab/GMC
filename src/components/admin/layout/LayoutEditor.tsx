"use client";

// LayoutEditor — top-level orchestrator for the M6.4 floor-plan editor.
//
// Owns:
//   * shape state (`shapes`)
//   * selection (single shape for v1; multi-select lands in M6.4b)
//   * persistence (debounced bulk POST to /api/admin/events/[id]/layout/shapes)
//   * keyboard (Backspace/Delete to remove selected; Esc clears selection)
//   * Miro-style view state {x, y, scale} — pan + cursor-centered zoom live
//     inside FloorPlanCanvas; we just hold the state up here so the toolbar
//     can offer Fit / Reset shortcuts.
//   * reveal toggle (names vs region IDs) — persists per-event in
//     sessionStorage; query param ?reveal=0|1 overrides for URL-driven exports
//
// Renders three panes in a desktop grid: ShapePalette (left, narrow),
// FloorPlanCanvas (center, dominant), ShapeInspector (right, narrow).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShapePalette } from "./ShapePalette";
import { FIT_VIEW, FloorPlanCanvas } from "./FloorPlanCanvas";
import type { View } from "./FloorPlanCanvas";
import { ShapeInspector } from "./ShapeInspector";
import {
  clampShape,
  defaultsForKind,
  mapDetectedCandidate,
  paletteForMode,
  VB_H,
  VB_W,
} from "./types";
import type {
  DetectedCandidate,
  FloorPlanAsset,
  GroupRoster,
  LayoutEditorProps,
  Shape,
  ShapeKind,
} from "./types";

type SaveState = "idle" | "dirty" | "saving" | "error";

// Lightweight uuid-v4 fallback. crypto.randomUUID is available in modern
// browsers — this is a defensive shim for older targets / SSR-leak paranoia.
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "x-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readInitialReveal(eventId: string): boolean {
  if (typeof window === "undefined") return true;
  // Query-param override so `?reveal=0|1` in the URL wins (foundation for
  // M6.7 export pipeline driving printouts via headless puppeteer).
  const search = new URLSearchParams(window.location.search);
  const q = search.get("reveal");
  if (q === "0") return false;
  if (q === "1") return true;
  try {
    const v = window.sessionStorage.getItem(`gmc-reveal:${eventId}`);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    // private mode etc — fall through
  }
  return true;
}

function readInitialGridSnap(eventId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.sessionStorage.getItem(`gmc-grid-snap:${eventId}`);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function LayoutEditor({
  event,
  initialShapes,
  groups,
  canEdit,
  initialAsset,
}: LayoutEditorProps) {
  const [shapes, setShapes] = useState<Shape[]>(initialShapes);
  // Selection state — selectedId is the primary (last-clicked) shape that
  // drives the inspector; selectedIds is the full set used by group move +
  // batch keyboard ops. Invariant: when selectedId is non-null it is also
  // in selectedIds. When selectedIds.size === 0, selectedId is null.
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<View>(FIT_VIEW);
  // Both default to true so SSR + first-client render agree. The actual
  // saved values from sessionStorage / URL params get read in a useEffect
  // after mount — a brief flicker (one render) is preferable to a
  // hydration-mismatch warning when the saved value disagrees with the
  // SSR default.
  const [revealNames, setRevealNamesState] = useState<boolean>(true);
  const [gridSnap, setGridSnapState] = useState<boolean>(true);
  useEffect(() => {
    const r = readInitialReveal(event.id);
    if (r !== true) setRevealNamesState(r);
    const g = readInitialGridSnap(event.id);
    if (g !== true) setGridSnapState(g);
  }, [event.id]);

  // Background floor-plan asset — uploaded once per event, rendered under
  // the shapes layer at adjustable opacity. Null when nothing is uploaded.
  const [asset, setAsset] = useState<FloorPlanAsset | null>(initialAsset);
  const [assetBusy, setAssetBusy] = useState<
    null | "uploading" | "saving" | "removing"
  >(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  // Debounce opacity PATCH so dragging the slider doesn't fire 30 requests.
  const opacitySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Image natural dimensions — needed to undo the xMidYMid meet letterbox
  // when mapping vision-detected candidates into user-space. Loaded via an
  // off-DOM Image() because SVGImageElement doesn't expose natural sizes.
  const [imageNatural, setImageNatural] = useState<
    null | { w: number; h: number }
  >(null);
  useEffect(() => {
    if (!asset) {
      setImageNatural(null);
      return;
    }
    const img = new window.Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) {
        setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setImageNatural(null);
    };
    img.src = asset.url;
    return () => {
      cancelled = true;
    };
  }, [asset]);

  // Vision auto-detect — candidate boxes returned by Opus 4.7. Each carries
  // normalized image-relative coords; render time we map to user-space via
  // mapDetectedCandidate(imageNatural).
  const [candidates, setCandidates] = useState<DetectedCandidate[] | null>(
    null,
  );
  const [detectionBusy, setDetectionBusy] = useState<boolean>(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Auto-place / auto-seat — bulk pairs un-locked groups with tables and
  // assigns seat_no around each table's rim. Result message lives here so
  // the chip can show a toast after the run.
  const [autoPlaceBusy, setAutoPlaceBusy] = useState<boolean>(false);
  const [autoPlaceMessage, setAutoPlaceMessage] = useState<
    null | { tone: "ok" | "error"; text: string }
  >(null);

  const setRevealNames = useCallback(
    (next: boolean) => {
      setRevealNamesState(next);
      try {
        window.sessionStorage.setItem(
          `gmc-reveal:${event.id}`,
          next ? "1" : "0",
        );
      } catch {
        // private mode etc — ignore
      }
    },
    [event.id],
  );

  const setGridSnap = useCallback(
    (next: boolean) => {
      setGridSnapState(next);
      try {
        window.sessionStorage.setItem(
          `gmc-grid-snap:${event.id}`,
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
    },
    [event.id],
  );

  const uploadAsset = useCallback(
    async (file: File) => {
      if (!canEdit) return;
      setAssetError(null);
      setAssetBusy("uploading");
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (asset) fd.append("opacity", String(asset.opacity));
        const res = await fetch(
          `/api/admin/events/${event.id}/floor-plan-asset`,
          { method: "POST", body: fd },
        );
        const json = (await res.json().catch(() => ({}))) as {
          asset?: FloorPlanAsset;
          error?: string;
          detail?: string;
        };
        if (!res.ok) {
          throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
        }
        if (json.asset) setAsset(json.asset);
      } catch (err) {
        setAssetError(err instanceof Error ? err.message : "upload failed");
      } finally {
        setAssetBusy(null);
      }
    },
    [canEdit, event.id, asset],
  );

  const setAssetOpacity = useCallback(
    (next: number) => {
      if (!canEdit || !asset) return;
      const clamped = Math.max(0.05, Math.min(1, next));
      // Optimistic local update so the slider feels live.
      setAsset((prev) => (prev ? { ...prev, opacity: clamped } : prev));
      if (opacitySaveTimerRef.current) {
        clearTimeout(opacitySaveTimerRef.current);
      }
      opacitySaveTimerRef.current = setTimeout(() => {
        void (async () => {
          setAssetBusy("saving");
          try {
            const res = await fetch(
              `/api/admin/events/${event.id}/floor-plan-asset`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ opacity: clamped }),
              },
            );
            if (!res.ok) {
              const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                detail?: string;
              };
              throw new Error(
                json.detail ?? json.error ?? `HTTP ${res.status}`,
              );
            }
          } catch (err) {
            setAssetError(err instanceof Error ? err.message : "save failed");
          } finally {
            setAssetBusy(null);
          }
        })();
      }, 350);
    },
    [canEdit, asset, event.id],
  );

  const removeAsset = useCallback(async () => {
    if (!canEdit || !asset) return;
    if (!window.confirm("Remove the background floor plan image?")) return;
    setAssetError(null);
    setAssetBusy("removing");
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/floor-plan-asset`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      }
      setAsset(null);
      // Drop any candidates from a prior detection — they refer to coords
      // on the now-removed image.
      setCandidates(null);
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : "remove failed");
    } finally {
      setAssetBusy(null);
    }
  }, [canEdit, asset, event.id]);

  const runAutoDetect = useCallback(async () => {
    if (!canEdit || !asset || detectionBusy) return;
    setDetectionError(null);
    setDetectionBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/floor-plan-asset/auto-detect`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        candidates?: Array<Omit<DetectedCandidate, "id">>;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      }
      const stamped: DetectedCandidate[] = (json.candidates ?? []).map(
        (c, i) => ({ ...c, id: `cand-${Date.now()}-${i}` }),
      );
      setCandidates(stamped);
      if (stamped.length === 0) {
        setDetectionError("No tables detected in this image.");
      }
    } catch (err) {
      setDetectionError(err instanceof Error ? err.message : "detect failed");
    } finally {
      setDetectionBusy(false);
    }
  }, [canEdit, asset, event.id, detectionBusy]);

  const rejectCandidate = useCallback((id: string) => {
    setCandidates((prev) =>
      prev ? prev.filter((c) => c.id !== id) : prev,
    );
  }, []);

  const clearCandidates = useCallback(() => {
    setCandidates(null);
  }, []);

  // (acceptCandidate / acceptAllCandidates defined below the persistence
  // helpers, since they need maybePushHistory + scheduleSave + dirtyRef.)

  // Track which shapes need to be sent to the server. Cleared on save.
  const dirtyRef = useRef<Set<string>>(new Set());
  // Track shapes deleted client-side that need a server-side delete.
  const deletedRef = useRef<Set<string>>(new Set());
  // Pending save timer.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest shapes — read by flushSave so its closure stays stable.
  const shapesRef = useRef<Shape[]>(shapes);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // ---------------------------------------------------------------------------
  // History — undo/redo. Snapshots Shape[] before each mutation. Rapid
  // streams of updates within COALESCE_MS collapse into one entry, so a
  // continuous drag is one undo step. Capped at HISTORY_LIMIT entries.
  // ---------------------------------------------------------------------------
  const HISTORY_LIMIT = 50;
  const COALESCE_MS = 300;
  const historyPastRef = useRef<Shape[][]>([]);
  const historyFutureRef = useRef<Shape[][]>([]);
  const lastTouchAtRef = useRef<number>(0);

  const maybePushHistory = useCallback(() => {
    const now = Date.now();
    if (now - lastTouchAtRef.current > COALESCE_MS) {
      historyPastRef.current.push(shapesRef.current);
      if (historyPastRef.current.length > HISTORY_LIMIT) {
        historyPastRef.current.shift();
      }
      historyFutureRef.current = [];
    }
    lastTouchAtRef.current = now;
  }, []);

  // Reconcile dirty + deleted refs after a swap to a different shape state.
  // We compare prevShapes (what was on screen) → nextShapes (what's about
  // to be on screen): added shapes go to deleted, removed shapes come back
  // as dirty, mutated shapes are dirty. Server delete is idempotent so it
  // is safe to send a delete for a shape that was never persisted.
  const reconcileAfterTimeTravel = useCallback(
    (prevShapes: Shape[], nextShapes: Shape[]) => {
      const prevById = new Map(prevShapes.map((s) => [s.id, s]));
      const nextById = new Map(nextShapes.map((s) => [s.id, s]));
      for (const id of prevById.keys()) {
        if (!nextById.has(id)) {
          // Shape disappeared — remove from dirty, queue for server delete.
          dirtyRef.current.delete(id);
          deletedRef.current.add(id);
        }
      }
      for (const [id, s] of nextById) {
        if (!prevById.has(id)) {
          // Shape reappeared — undo a delete or redo an add.
          deletedRef.current.delete(id);
          dirtyRef.current.add(id);
        } else if (prevById.get(id) !== s) {
          // Same id, content shifted (object identity differs) → dirty.
          dirtyRef.current.add(id);
        }
      }
    },
    [],
  );

  const selected = useMemo(
    () => shapes.find((s) => s.id === selectedId) ?? null,
    [shapes, selectedId],
  );

  // Selection helpers — keep selectedId + selectedIds in sync.
  const selectOnly = useCallback((id: string | null) => {
    setSelectedIdRaw(id);
    setSelectedIds(id ? new Set([id]) : new Set());
  }, []);

  const selectToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // If we removed the primary, fall back to any remaining selection.
        setSelectedIdRaw((cur) => {
          if (cur !== id) return cur;
          const fallback = next.values().next().value;
          return fallback ?? null;
        });
      } else {
        next.add(id);
        setSelectedIdRaw(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(shapesRef.current.map((s) => s.id)));
    setSelectedIdRaw((cur) => {
      if (cur && shapesRef.current.some((s) => s.id === cur)) return cur;
      return shapesRef.current[0]?.id ?? null;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIdRaw(null);
    setSelectedIds(new Set());
  }, []);

  const selectMany = useCallback(
    (ids: string[], additive: boolean) => {
      setSelectedIds((prev) => {
        const next = additive ? new Set(prev) : new Set<string>();
        for (const id of ids) next.add(id);
        return next;
      });
      const last = ids[ids.length - 1] ?? null;
      if (last) setSelectedIdRaw(last);
      else if (!additive) setSelectedIdRaw(null);
    },
    [],
  );

  // Canvas-facing onSelect — translates a (id, mode) pair into the right
  // selection helper. The canvas calls this on shape click + on background
  // click.
  const onCanvasSelect = useCallback(
    (id: string | null, mode: "replace" | "toggle") => {
      if (id === null) {
        clearSelection();
        return;
      }
      if (mode === "toggle") selectToggle(id);
      else selectOnly(id);
    },
    [clearSelection, selectOnly, selectToggle],
  );

  const palette = useMemo(
    () => paletteForMode(event.seating_mode),
    [event.seating_mode],
  );

  // Index groups by id for O(1) lookup when ShapeNode rendering resolves
  // shape.group_id → roster.
  const groupsById = useMemo(() => {
    const m = new Map<string, GroupRoster>();
    for (const g of groups) m.set(g.id, g);
    return m;
  }, [groups]);

  const selectedRoster = useMemo<GroupRoster | null>(() => {
    if (!selected || !selected.group_id) return null;
    return groupsById.get(selected.group_id) ?? null;
  }, [selected, groupsById]);

  // ---------------------------------------------------------------------------
  // Persistence — debounced bulk save.
  // ---------------------------------------------------------------------------

  const flushSave = useCallback(async () => {
    if (!canEdit) return;
    if (dirtyRef.current.size === 0 && deletedRef.current.size === 0) {
      setSaveState("idle");
      return;
    }
    const dirtyIds = Array.from(dirtyRef.current);
    const deleted = Array.from(deletedRef.current);
    const upserts = shapesRef.current.filter((s) => dirtyIds.includes(s.id));
    setSaveState("saving");
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/layout/shapes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upserts, deletes: deleted }),
        },
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error ?? `HTTP ${res.status}`);
      }
      dirtyRef.current.clear();
      deletedRef.current.clear();
      setSaveState("idle");
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "save failed");
    }
  }, [event.id, canEdit]);

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("dirty");
    setSaveError(null);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, 400);
  }, [canEdit, flushSave]);

  // Flush on unmount so navigation doesn't drop pending edits. Uses
  // sendBeacon for a best-effort sync flush.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (
        typeof navigator !== "undefined"
        && (dirtyRef.current.size > 0 || deletedRef.current.size > 0)
      ) {
        const dirtyIds = Array.from(dirtyRef.current);
        const deleted = Array.from(deletedRef.current);
        const upserts = shapesRef.current.filter((s) =>
          dirtyIds.includes(s.id),
        );
        const blob = new Blob(
          [JSON.stringify({ upserts, deletes: deleted })],
          { type: "application/json" },
        );
        try {
          navigator.sendBeacon(
            `/api/admin/events/${event.id}/layout/shapes`,
            blob,
          );
        } catch {
          // ignore — best-effort
        }
      }
    };
  }, [event.id]);

  // ---------------------------------------------------------------------------
  // Mutations.
  // ---------------------------------------------------------------------------

  const spawnShape = useCallback(
    (kind: ShapeKind) => {
      if (!canEdit) return;
      maybePushHistory();
      const d = defaultsForKind(kind);
      // Spawn near canvas center with a small randomized offset so successive
      // spawns don't stack on the exact same point.
      const jx = (Math.random() - 0.5) * 6;
      const jy = (Math.random() - 0.5) * 4;
      const id = uuid();
      const z =
        shapes.length === 0
          ? 0
          : Math.max(...shapes.map((s) => s.z_order)) + 1;
      const shape: Shape = clampShape({
        id,
        kind,
        x_pct: VB_W / 2 - d.width_pct / 2 + jx,
        y_pct: VB_H / 2 - d.height_pct / 2 + jy,
        width_pct: d.width_pct,
        height_pct: d.height_pct,
        rotation_deg: 0,
        seat_count: d.seat_count,
        seats_per_side: d.seats_per_side,
        label_en: d.label_en,
        label_cn: d.label_cn,
        group_id: null,
        locked: false,
        z_order: z,
      });
      setShapes((prev) => [...prev, shape]);
      selectOnly(id);
      dirtyRef.current.add(id);
      scheduleSave();
    },
    [canEdit, shapes, scheduleSave, maybePushHistory, selectOnly],
  );

  // Accept a vision candidate by spawning a real shape with its mapped
  // geometry. Mirrors spawnShape but takes geometry from the candidate
  // instead of the kind defaults; pulls seat_count from the candidate
  // when provided, else from kind defaults.
  const acceptCandidate = useCallback(
    (candidate: DetectedCandidate) => {
      if (!canEdit) return;
      maybePushHistory();
      const mapped = mapDetectedCandidate(candidate, imageNatural);
      const d = defaultsForKind(candidate.kind);
      const id = uuid();
      const z =
        shapesRef.current.length === 0
          ? 0
          : Math.max(...shapesRef.current.map((s) => s.z_order)) + 1;
      const seatCount =
        candidate.seat_count !== null && candidate.seat_count > 0
          ? candidate.seat_count
          : d.seat_count;
      // Vision tends to draw the bounding box right at the chair perimeter,
      // so accepted candidates end up rim-to-rim with their neighbors. Shrink
      // around the candidate's center so seat-name labels have breathing
      // room when a group is assigned. Center matches the floor plan; rim
      // is tighter so adjacent tables get a natural gap. At 0.55 the gap
      // between centers-2R-apart neighbors works out to a full table-
      // diameter of empty space around each table — enough headroom for
      // labels to render outside the rim without colliding with neighbors.
      const ACCEPT_SHRINK = 0.55;
      const cx = mapped.x + mapped.width / 2;
      const cy = mapped.y + mapped.height / 2;
      const w = Math.max(2, mapped.width * ACCEPT_SHRINK);
      const h = Math.max(2, mapped.height * ACCEPT_SHRINK);
      const shape: Shape = clampShape({
        id,
        kind: candidate.kind,
        x_pct: cx - w / 2,
        y_pct: cy - h / 2,
        width_pct: w,
        height_pct: h,
        rotation_deg: 0,
        seat_count: seatCount,
        seats_per_side: d.seats_per_side,
        label_en: candidate.label,
        label_cn: null,
        group_id: null,
        locked: false,
        z_order: z,
      });
      setShapes((prev) => [...prev, shape]);
      // Don't steal selection during a bulk-accept run — admin may still
      // be reviewing other candidates. Just persist the new shape.
      dirtyRef.current.add(id);
      scheduleSave();
      // Drop the candidate from the review list.
      setCandidates((prev) =>
        prev ? prev.filter((c) => c.id !== candidate.id) : prev,
      );
    },
    [canEdit, imageNatural, maybePushHistory, scheduleSave],
  );

  const acceptAllCandidates = useCallback(() => {
    if (!candidates || candidates.length === 0) return;
    for (const c of candidates) acceptCandidate(c);
  }, [candidates, acceptCandidate]);

  const runAutoPlace = useCallback(async () => {
    if (!canEdit || autoPlaceBusy) return;
    if (
      !window.confirm(
        "Auto-place every group onto a table? Locked groups stay put; unlocked groups get reshuffled.",
      )
    ) {
      return;
    }
    setAutoPlaceMessage(null);
    setAutoPlaceBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/layout/auto-place`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        placements?: Array<unknown>;
        unplaced_groups?: Array<{ reason: string }>;
        seat_writes?: number;
        unused_tables?: number;
        preserved_locked?: number;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      }
      const placed = json.placements?.length ?? 0;
      const unplaced =
        json.unplaced_groups?.filter((u) => u.reason !== "locked_kept").length
        ?? 0;
      const seats = json.seat_writes ?? 0;
      const parts = [
        `${placed} group${placed === 1 ? "" : "s"} placed`,
        `${seats} seat${seats === 1 ? "" : "s"} written`,
      ];
      if (unplaced > 0) parts.push(`${unplaced} unplaced`);
      setAutoPlaceMessage({ tone: "ok", text: parts.join(" · ") });
      // Full reload so the server loader re-pulls groups + assignments
      // and the canvas re-renders the new seat names. Slight delay so
      // admin sees the success message first.
      window.setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (err) {
      setAutoPlaceMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "auto-place failed",
      });
    } finally {
      setAutoPlaceBusy(false);
    }
  }, [canEdit, event.id, autoPlaceBusy]);

  const updateShape = useCallback(
    (id: string, patch: Partial<Shape>) => {
      if (!canEdit) return;
      maybePushHistory();
      setShapes((prev) =>
        prev.map((s) => (s.id === id ? clampShape({ ...s, ...patch }) : s)),
      );
      dirtyRef.current.add(id);
      scheduleSave();
    },
    [canEdit, scheduleSave, maybePushHistory],
  );

  const deleteShape = useCallback(
    (id: string) => {
      if (!canEdit) return;
      maybePushHistory();
      setShapes((prev) => prev.filter((s) => s.id !== id));
      dirtyRef.current.delete(id);
      deletedRef.current.add(id);
      // Drop from selection set; promote primary if needed.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedIdRaw((cur) => {
        if (cur !== id) return cur;
        return null;
      });
      scheduleSave();
    },
    [canEdit, scheduleSave, maybePushHistory],
  );

  const bumpZ = useCallback(
    (id: string, dir: "up" | "down") => {
      if (!canEdit) return;
      maybePushHistory();
      setShapes((prev) => {
        const target = prev.find((s) => s.id === id);
        if (!target) return prev;
        const next = prev.map((s) => {
          if (s.id !== id) return s;
          const newZ =
            dir === "up" ? target.z_order + 1 : target.z_order - 1;
          return { ...s, z_order: newZ };
        });
        return [...next].sort((a, b) => a.z_order - b.z_order);
      });
      dirtyRef.current.add(id);
      scheduleSave();
    },
    [canEdit, scheduleSave, maybePushHistory],
  );

  // ---------------------------------------------------------------------------
  // Undo / redo + keyboard ops.
  // ---------------------------------------------------------------------------

  // Prune selection refs against the new shape set after a time-travel,
  // so dangling ids in selectedIds (shape no longer exists) get dropped.
  const pruneSelectionAgainst = useCallback((nextShapes: Shape[]) => {
    const ids = new Set(nextShapes.map((s) => s.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setSelectedIdRaw((cur) => (cur && ids.has(cur) ? cur : null));
  }, []);

  const undo = useCallback(() => {
    if (!canEdit) return;
    const prev = historyPastRef.current.pop();
    if (!prev) return;
    const current = shapesRef.current;
    historyFutureRef.current.push(current);
    setShapes(prev);
    reconcileAfterTimeTravel(current, prev);
    pruneSelectionAgainst(prev);
    // Reset coalesce window so the next user mutation starts a new entry.
    lastTouchAtRef.current = 0;
    scheduleSave();
  }, [canEdit, scheduleSave, reconcileAfterTimeTravel, pruneSelectionAgainst]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    const next = historyFutureRef.current.pop();
    if (!next) return;
    const current = shapesRef.current;
    historyPastRef.current.push(current);
    if (historyPastRef.current.length > HISTORY_LIMIT) {
      historyPastRef.current.shift();
    }
    setShapes(next);
    reconcileAfterTimeTravel(current, next);
    pruneSelectionAgainst(next);
    lastTouchAtRef.current = 0;
    scheduleSave();
  }, [canEdit, scheduleSave, reconcileAfterTimeTravel, pruneSelectionAgainst]);

  const duplicateSelected = useCallback(() => {
    if (!canEdit || selectedIds.size === 0) return;
    const sources = shapesRef.current.filter((s) => selectedIds.has(s.id));
    if (sources.length === 0) return;
    maybePushHistory();
    const baseZ = Math.max(...shapesRef.current.map((s) => s.z_order), -1);
    const copies: Shape[] = sources.map((src, i) => {
      const id = uuid();
      return clampShape({
        ...src,
        id,
        x_pct: src.x_pct + 4,
        y_pct: src.y_pct + 4,
        group_id: null, // never duplicate a group binding
        locked: false,
        z_order: baseZ + 1 + i,
      });
    });
    setShapes((prev) => [...prev, ...copies]);
    // Select the new copies, primary = last.
    const newIds = copies.map((c) => c.id);
    setSelectedIds(new Set(newIds));
    setSelectedIdRaw(newIds[newIds.length - 1] ?? null);
    for (const c of copies) dirtyRef.current.add(c.id);
    scheduleSave();
  }, [canEdit, selectedIds, scheduleSave, maybePushHistory]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!canEdit || selectedIds.size === 0) return;
      // updateShape coalesces consecutive nudges (typematic repeat) into a
      // single undo entry — works for batch the same way.
      const movable = shapesRef.current.filter(
        (s) => selectedIds.has(s.id) && !s.locked,
      );
      for (const s of movable) {
        updateShape(s.id, {
          x_pct: s.x_pct + dx,
          y_pct: s.y_pct + dy,
        });
      }
    },
    [canEdit, selectedIds, updateShape],
  );

  const deleteSelected = useCallback(() => {
    if (!canEdit || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 1) {
      deleteShape(ids[0]);
      return;
    }
    maybePushHistory();
    const idSet = new Set(ids);
    setShapes((prev) => prev.filter((s) => !idSet.has(s.id)));
    for (const id of ids) {
      dirtyRef.current.delete(id);
      deletedRef.current.add(id);
    }
    setSelectedIds(new Set());
    setSelectedIdRaw(null);
    scheduleSave();
  }, [canEdit, selectedIds, deleteShape, maybePushHistory, scheduleSave]);

  const toggleLockSelected = useCallback(() => {
    if (!canEdit || selectedIds.size === 0) return;
    const targets = shapesRef.current.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) return;
    // If any selected is unlocked, the action locks all (the more
    // conservative bulk action). Else unlock all.
    const nextLocked = targets.some((s) => !s.locked);
    for (const s of targets) {
      if (s.locked !== nextLocked) {
        updateShape(s.id, { locked: nextLocked });
      }
    }
  }, [canEdit, selectedIds, updateShape]);

  // ---------------------------------------------------------------------------
  // Keyboard.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Don't hijack typing in form fields.
      if (
        t
        && (t.tagName === "INPUT"
          || t.tagName === "TEXTAREA"
          || t.tagName === "SELECT"
          || t.isContentEditable)
      ) {
        return;
      }

      const cmd = e.metaKey || e.ctrlKey;

      // Undo / redo. Cmd+Z = undo, Cmd+Shift+Z or Cmd+Y = redo.
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      // Duplicate.
      if (cmd && e.key.toLowerCase() === "d") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          duplicateSelected();
        }
        return;
      }

      // Select all.
      if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }

      // Bare keys below — ignore when any modifier is held so we don't
      // collide with browser shortcuts.
      if (cmd || e.altKey) return;

      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.key === "l" || e.key === "L") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          toggleLockSelected();
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setGridSnap(!gridSnap);
        return;
      }

      // Arrow nudge — 1 unit, Shift+arrow = 10 units.
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowUp") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          nudgeSelected(0, -step);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          nudgeSelected(0, step);
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          nudgeSelected(-step, 0);
        }
        return;
      }
      if (e.key === "ArrowRight") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          nudgeSelected(step, 0);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    canEdit,
    selectedIds,
    clearSelection,
    deleteSelected,
    duplicateSelected,
    gridSnap,
    nudgeSelected,
    redo,
    selectAll,
    setGridSnap,
    toggleLockSelected,
    undo,
  ]);

  // ---------------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------------

  const eventTitle =
    event.title_en && event.title_cn
      ? `${event.title_en} · ${event.title_cn}`
      : event.title_en ?? event.title_cn ?? event.slug;

  return (
    <div className="gmc-print-layout">
      {/* Print-only header — shows only when Cmd+P. */}
      <div className="gmc-print-only">
        <PrintHeader
          eventTitle={eventTitle}
          slug={event.slug}
          reveal={revealNames}
        />
      </div>

      {/* Canvas + floating overlays. The relative wrapper anchors all
          absolutely-positioned overlays to the canvas card's bounding
          rectangle. */}
      <div className="relative">
        <FloorPlanCanvas
          shapes={shapes}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onCanvasSelect}
          onSelectMany={selectMany}
          onUpdate={updateShape}
          canEdit={canEdit}
          revealNames={revealNames}
          gridSnap={gridSnap}
          asset={asset}
          imageNatural={imageNatural}
          candidates={candidates}
          onAcceptCandidate={acceptCandidate}
          onRejectCandidate={rejectCandidate}
          groupsById={groupsById}
          view={view}
          onViewChange={setView}
        />

        <FloatingPageChip
          eventId={event.id}
          eventTitle={eventTitle}
          slug={event.slug}
          shapesCount={shapes.length}
          groupsCount={groups.length}
          mode={event.seating_mode}
        />

        <ShapePalette
          kinds={palette}
          onSpawn={spawnShape}
          disabled={!canEdit}
        />

        <FloatingTopChip
          saveState={saveState}
          saveError={saveError}
          view={view}
          onViewChange={setView}
          revealNames={revealNames}
          onRevealChange={setRevealNames}
          gridSnap={gridSnap}
          onGridSnapChange={setGridSnap}
          canEdit={canEdit}
          seatingMode={event.seating_mode}
          autoPlaceBusy={autoPlaceBusy}
          autoPlaceMessage={autoPlaceMessage}
          onAutoPlace={runAutoPlace}
        />

        <FloatingBackgroundChip
          asset={asset}
          busy={assetBusy}
          error={assetError}
          canEdit={canEdit}
          onUpload={uploadAsset}
          onOpacityChange={setAssetOpacity}
          onRemove={removeAsset}
          onDetect={runAutoDetect}
          detectionBusy={detectionBusy}
          detectionError={detectionError}
          candidateCount={candidates?.length ?? 0}
          onAcceptAll={acceptAllCandidates}
          onClearCandidates={clearCandidates}
        />

        <ShapeInspector
          shape={selected}
          roster={selectedRoster}
          allGroups={groups}
          seatingMode={event.seating_mode}
          canEdit={canEdit}
          selectedCount={selectedIds.size}
          onUpdate={(patch) => selected && updateShape(selected.id, patch)}
          onDelete={() => selected && deleteShape(selected.id)}
          onBumpZ={(dir) => selected && bumpZ(selected.id, dir)}
          onDeleteAll={deleteSelected}
          onToggleLockAll={toggleLockSelected}
          onDuplicateAll={duplicateSelected}
          onClose={clearSelection}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents.
// ---------------------------------------------------------------------------

function SaveStateBadge({
  state,
  error,
}: {
  state: SaveState;
  error: string | null;
}) {
  if (state === "idle") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--jade)]" />
        Saved
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.18em] uppercase text-[var(--gold)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" />
        Pending
      </span>
    );
  }
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.18em] uppercase text-[var(--cinnabar)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)] animate-pulse" />
        Saving…
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.18em] uppercase"
      style={{ color: "#B91C1C" }}
      title={error ?? undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#B91C1C" }} />
      Save failed — {error ?? "retry"}
    </span>
  );
}

// FloatingTopChip — Pass 4 single floating chip top-right inside the canvas.
// Combines save badge + zoom controls + reveal toggle + Fit / 100% in one
// rounded card. Replaces the standalone widgets that used to live in the
// action bar above the canvas.
function FloatingTopChip({
  saveState,
  saveError,
  view,
  onViewChange,
  revealNames,
  onRevealChange,
  gridSnap,
  onGridSnapChange,
  canEdit,
  seatingMode,
  autoPlaceBusy,
  autoPlaceMessage,
  onAutoPlace,
}: {
  saveState: SaveState;
  saveError: string | null;
  view: View;
  onViewChange: (v: View) => void;
  revealNames: boolean;
  onRevealChange: (n: boolean) => void;
  gridSnap: boolean;
  onGridSnapChange: (n: boolean) => void;
  canEdit: boolean;
  seatingMode: "tables" | "cushions";
  autoPlaceBusy: boolean;
  autoPlaceMessage: null | { tone: "ok" | "error"; text: string };
  onAutoPlace: () => void;
}) {
  function zoomBy(factor: number) {
    const next = Math.max(0.25, Math.min(6, view.scale * factor));
    onViewChange({ ...view, scale: next });
  }
  return (
    <div className="gmc-print-hide absolute right-3 top-3 z-10 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] px-2 py-1.5">
      <SaveStateBadge state={saveState} error={saveError} />

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      <button
        type="button"
        onClick={() => zoomBy(0.8)}
        title="Zoom out · ⌘-"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-faint)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-colors text-[14px] leading-none"
      >
        −
      </button>
      <span
        className="text-[10.5px] tracking-[0.16em] uppercase tabular-nums text-[var(--ink-soft)] min-w-[44px] text-center cursor-default"
        title={`Scale ${Math.round(view.scale * 100)}%`}
      >
        {Math.round(view.scale * 100)}%
      </span>
      <button
        type="button"
        onClick={() => zoomBy(1.25)}
        title="Zoom in · ⌘+"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-faint)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-colors text-[14px] leading-none"
      >
        +
      </button>

      <button
        type="button"
        onClick={() => onViewChange(FIT_VIEW)}
        title="Fit page · ⌘0"
        className="inline-flex items-center px-2 h-6 rounded-full text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)] transition-colors"
      >
        Fit
      </button>

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      {canEdit ? (
        <button
          type="button"
          onClick={() => onGridSnapChange(!gridSnap)}
          aria-pressed={gridSnap}
          title="Snap to grid · G"
          className={`inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[10.5px] tracking-[0.16em] uppercase transition-colors ${
            gridSnap
              ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
              : "text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--paper)]"
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1">
            <path d="M0 4 H12 M0 8 H12 M4 0 V12 M8 0 V12" />
          </svg>
          Grid
        </button>
      ) : null}

      {canEdit && seatingMode === "tables" ? (
        <>
          <span className="w-px h-4 bg-[var(--paper-shadow)]" />
          <button
            type="button"
            onClick={onAutoPlace}
            disabled={autoPlaceBusy}
            title="Auto-pair groups with tables + assign seats"
            className="inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[10.5px] tracking-[0.16em] uppercase text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] disabled:opacity-50 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3.2" />
              <path d="M2 2 L 4 4 M10 2 L 8 4 M2 10 L 4 8 M10 10 L 8 8" />
            </svg>
            {autoPlaceBusy ? "Placing…" : "Auto-place"}
          </button>
          {autoPlaceMessage ? (
            <span
              className="text-[10px] tracking-[0.06em] tabular-nums shrink-0 max-w-[260px] truncate"
              style={{
                color:
                  autoPlaceMessage.tone === "ok"
                    ? "var(--ink-soft)"
                    : "#B91C1C",
              }}
              title={autoPlaceMessage.text}
            >
              {autoPlaceMessage.text}
            </span>
          ) : null}
        </>
      ) : null}

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      <div className="inline-flex items-stretch h-6 border border-[var(--paper-shadow)] rounded-full overflow-hidden text-[9.5px] tracking-[0.18em] uppercase">
        <button
          type="button"
          onClick={() => onRevealChange(true)}
          aria-pressed={revealNames}
          className={`px-2.5 transition-colors ${
            revealNames
              ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
              : "text-[var(--ink-faint)] hover:text-[var(--ink)]"
          }`}
        >
          姓名
        </button>
        <button
          type="button"
          onClick={() => onRevealChange(false)}
          aria-pressed={!revealNames}
          className={`px-2.5 transition-colors border-l border-[var(--paper-shadow)] ${
            !revealNames
              ? "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
              : "text-[var(--ink-faint)] hover:text-[var(--ink)]"
          }`}
        >
          ID
        </button>
      </div>

      {!canEdit ? (
        <>
          <span className="w-px h-4 bg-[var(--paper-shadow)]" />
          <span className="text-[9.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)] pr-1">
            Read-only
          </span>
        </>
      ) : null}
    </div>
  );
}

// FloatingBackgroundChip — M6.5 surface for the per-event background floor
// plan asset. Sits at the bottom-left of the canvas as a small Miro-style
// pill. Empty state = "Upload background plan" CTA. Loaded state = thumbnail
// + opacity slider + Replace / Remove. Hidden when canEdit is false (no
// affordance to upload, but the asset still renders as the canvas background).
function FloatingBackgroundChip({
  asset,
  busy,
  error,
  canEdit,
  onUpload,
  onOpacityChange,
  onRemove,
  onDetect,
  detectionBusy,
  detectionError,
  candidateCount,
  onAcceptAll,
  onClearCandidates,
}: {
  asset: FloorPlanAsset | null;
  busy: null | "uploading" | "saving" | "removing";
  error: string | null;
  canEdit: boolean;
  onUpload: (file: File) => void;
  onOpacityChange: (opacity: number) => void;
  onRemove: () => void;
  onDetect: () => void;
  detectionBusy: boolean;
  detectionError: string | null;
  candidateCount: number;
  onAcceptAll: () => void;
  onClearCandidates: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onUpload(f);
    // Reset so re-picking the same file fires another change.
    e.target.value = "";
  }

  if (!canEdit && !asset) return null;

  return (
    <div className="gmc-print-hide absolute left-3 bottom-3 z-10 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] pl-2 pr-3 py-1.5 whitespace-nowrap max-w-[calc(100%-1.5rem)]">
      <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)] shrink-0">
        Background · 底图
      </span>

      <span className="w-px h-4 bg-[var(--paper-shadow)]" />

      {asset ? (
        <>
          {/* Thumbnail. <img> not <Image> — the URL is signed + per-event,
              not amenable to Next's optimizer. */}
          <span className="inline-flex items-center justify-center shrink-0 w-7 h-7 rounded-[var(--radius-sm)] overflow-hidden border border-[var(--paper-shadow)] bg-[var(--paper)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.url}
              alt=""
              className="w-full h-full object-cover"
            />
          </span>

          <span
            className="text-[11px] text-[var(--ink-soft)] truncate max-w-[120px]"
            title={asset.original_filename ?? "background plan"}
          >
            {asset.original_filename ?? "uploaded plan"}
          </span>

          {canEdit ? (
            <>
              <span className="w-px h-4 bg-[var(--paper-shadow)]" />
              <label
                className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)] shrink-0"
                title="Background opacity"
              >
                <span>透</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round(asset.opacity * 100)}
                  onChange={(e) =>
                    onOpacityChange(Number(e.target.value) / 100)
                  }
                  className="accent-[var(--cinnabar)] w-[88px] h-1"
                />
                <span className="tabular-nums w-[28px] text-right text-[var(--ink-soft)]">
                  {Math.round(asset.opacity * 100)}%
                </span>
              </label>

              <span className="w-px h-4 bg-[var(--paper-shadow)]" />

              <button
                type="button"
                onClick={pickFile}
                disabled={busy !== null}
                className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={busy !== null}
                className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
              >
                Remove
              </button>

              <span className="w-px h-4 bg-[var(--paper-shadow)]" />

              {candidateCount > 0 ? (
                <>
                  <span
                    className="inline-flex items-center gap-1 text-[10.5px] tracking-[0.16em] uppercase text-[var(--cinnabar-deep)] tabular-nums"
                    title={`${candidateCount} table candidate${candidateCount === 1 ? "" : "s"} from vision`}
                  >
                    {candidateCount} found
                  </span>
                  <button
                    type="button"
                    onClick={onAcceptAll}
                    disabled={busy !== null}
                    className="px-2 h-6 rounded-full text-[10.5px] tracking-[0.16em] uppercase text-[var(--paper)] bg-[var(--cinnabar)] hover:bg-[var(--cinnabar-deep)] disabled:opacity-50 transition-colors"
                  >
                    Accept all
                  </button>
                  <button
                    type="button"
                    onClick={onClearCandidates}
                    className="text-[10.5px] tracking-[0.16em] uppercase text-[var(--ink-faint)] hover:text-[var(--cinnabar-deep)] transition-colors"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onDetect}
                  disabled={busy !== null || detectionBusy}
                  title="Use Claude vision to detect tables"
                  className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-[10.5px] tracking-[0.16em] uppercase text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] disabled:opacity-50 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="5" r="3" />
                    <path d="M7.2 7.2 L 10 10" />
                  </svg>
                  Detect tables
                </button>
              )}

              {detectionBusy ? (
                <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--cinnabar)] shrink-0">
                  Detecting…
                </span>
              ) : null}
              {detectionError && !detectionBusy ? (
                <span
                  className="text-[10px] tracking-[0.04em] shrink-0"
                  style={{ color: "#B91C1C" }}
                  title={detectionError}
                >
                  {detectionError.length > 32
                    ? detectionError.slice(0, 32) + "…"
                    : detectionError}
                </span>
              ) : null}
            </>
          ) : null}
        </>
      ) : canEdit ? (
        <button
          type="button"
          onClick={pickFile}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.16em] uppercase text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] disabled:opacity-50 transition-colors px-1.5 h-6 rounded-full"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M6 2 V10 M2 6 H10" />
          </svg>
          Upload plan
        </button>
      ) : null}

      {busy ? (
        <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--cinnabar)] shrink-0">
          {busy === "uploading"
            ? "Uploading…"
            : busy === "saving"
              ? "Saving…"
              : "Removing…"}
        </span>
      ) : null}

      {error ? (
        <span
          className="text-[10px] tracking-[0.04em] shrink-0"
          style={{ color: "#B91C1C" }}
          title={error}
        >
          {error.length > 36 ? error.slice(0, 36) + "…" : error}
        </span>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}

// FloatingPageChip — Pass 4 small chip top-left inside the canvas. Replaces
// the page chrome that used to live above the editor (eyebrow + H1 + meta).
// Provides a back link to the event detail and a compact identity readout.
function FloatingPageChip({
  eventId,
  eventTitle,
  slug,
  shapesCount,
  groupsCount,
  mode,
}: {
  eventId: string;
  eventTitle: string;
  slug: string;
  shapesCount: number;
  groupsCount: number;
  mode: "tables" | "cushions";
}) {
  return (
    <div className="gmc-print-hide absolute left-3 top-3 z-10 inline-flex items-center gap-2.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]/95 backdrop-blur-sm shadow-[var(--shadow-paper-2)] pl-2 pr-3 py-1.5 max-w-[44vw]">
      <Link
        href={`/admin/events/${eventId}`}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar-wash)] transition-colors"
        title="Back to event"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 3 L 4 6 L 7.5 9" />
        </svg>
      </Link>
      <span className="w-px h-5 bg-[var(--paper-shadow)]" />
      <div className="flex flex-col leading-tight min-w-0">
        <span
          className="text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]"
        >
          Floor plan · 平面布置
        </span>
        <span
          className="font-display text-[14px] tracking-[-0.01em] text-[var(--ink)] truncate"
          title={eventTitle}
        >
          {eventTitle}
        </span>
      </div>
      <span className="w-px h-5 bg-[var(--paper-shadow)]" />
      <div className="hidden md:inline-flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase text-[var(--ink-faint)] tabular-nums">
        <span title="Shapes">⬚ {shapesCount}</span>
        <span title="Groups">⌒ {groupsCount}</span>
        <span title="Mode" className="text-[var(--ink-mute)]">
          {mode === "tables" ? "桌" : "蒲"}
        </span>
        <span title="Slug" className="text-[var(--paper-shadow)]">·</span>
        <span title="Slug" className="font-mono normal-case tracking-normal text-[var(--ink-faint)]">
          {slug}
        </span>
      </div>
    </div>
  );
}

function PrintHeader({
  eventTitle,
  slug,
  reveal,
}: {
  eventTitle: string;
  slug: string;
  reveal: boolean;
}) {
  const printedAt = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--paper-shadow)] pb-3">
      <div>
        <div
          className="text-[11px] uppercase"
          style={{
            letterSpacing: "0.32em",
            color: "var(--cinnabar-deep)",
          }}
        >
          实名桌位图 · Named Seating Chart
        </div>
        <h2
          className="mt-1 font-display"
          style={{
            fontSize: "26px",
            lineHeight: 1.05,
            letterSpacing: "-0.012em",
            color: "var(--ink)",
          }}
        >
          {eventTitle}
        </h2>
      </div>
      <div className="text-right text-[11px] text-[var(--ink-mute)]">
        <div>
          <span className="text-[var(--ink-faint)] tracking-[0.18em] uppercase">
            Slug
          </span>{" "}
          {slug}
        </div>
        <div>
          <span className="text-[var(--ink-faint)] tracking-[0.18em] uppercase">
            Printed
          </span>{" "}
          {printedAt}
        </div>
        <div>
          <span className="text-[var(--ink-faint)] tracking-[0.18em] uppercase">
            Mode
          </span>{" "}
          {reveal ? "Names · 姓名" : "Region IDs"}
        </div>
      </div>
    </div>
  );
}
