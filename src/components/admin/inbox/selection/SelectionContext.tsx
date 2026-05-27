"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Inbox bulk-selection + keyboard-focus state. Lives at the inbox layout
// (so it survives soft-nav between threads). Selection is intentionally
// ephemeral — no URL persistence — and prunes to the visible row set
// whenever filters change.

type SelectionState = {
  /** Visible row ids in display order, registered by the list view. */
  rowIds: string[];
  /** Currently selected conversation ids (subset of rowIds + possibly stale). */
  selected: ReadonlySet<string>;
  /** Keyboard-focused row id (for j/k nav). Null until first nav key. */
  focusedId: string | null;
  /** True when last interaction was a keyboard nav key (drives focus ring). */
  keyboardMode: boolean;

  setRowIds: (ids: string[]) => void;
  toggle: (id: string) => void;
  selectMany: (ids: string[]) => void;
  toggleAll: () => void;
  clear: () => void;
  setFocused: (id: string | null) => void;
  focusNext: () => string | null;
  focusPrev: () => string | null;
  setKeyboardMode: (on: boolean) => void;
};

const SelectionCtx = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [rowIds, setRowIdsRaw] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedIdRaw] = useState<string | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);

  const rowIdsRef = useRef(rowIds);
  rowIdsRef.current = rowIds;
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

  const setRowIds = useCallback((ids: string[]) => {
    setRowIdsRaw(ids);
    const visible = new Set(ids);
    setSelected((prev) => {
      let needsPrune = false;
      for (const id of prev) {
        if (!visible.has(id)) {
          needsPrune = true;
          break;
        }
      }
      if (!needsPrune) return prev;
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
    setFocusedIdRaw((prev) => (prev && !visible.has(prev) ? null : prev));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectMany = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === rowIdsRef.current.length && prev.size > 0) {
        return new Set();
      }
      return new Set(rowIdsRef.current);
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const setFocused = useCallback((id: string | null) => {
    setFocusedIdRaw(id);
  }, []);

  const focusNext = useCallback(() => {
    const ids = rowIdsRef.current;
    if (ids.length === 0) return null;
    const cur = focusedRef.current;
    const idx = cur ? ids.indexOf(cur) : -1;
    const nextId = ids[Math.min(idx + 1, ids.length - 1)] ?? ids[0];
    setFocusedIdRaw(nextId);
    setKeyboardMode(true);
    return nextId;
  }, []);

  const focusPrev = useCallback(() => {
    const ids = rowIdsRef.current;
    if (ids.length === 0) return null;
    const cur = focusedRef.current;
    const idx = cur ? ids.indexOf(cur) : ids.length;
    const nextId = ids[Math.max(idx - 1, 0)] ?? ids[0];
    setFocusedIdRaw(nextId);
    setKeyboardMode(true);
    return nextId;
  }, []);

  // Pointer movement returns us to mouse mode (drops the focus ring so the
  // hover affordance stays clean).
  useEffect(() => {
    if (!keyboardMode) return;
    const onMove = () => setKeyboardMode(false);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [keyboardMode]);

  const value = useMemo<SelectionState>(
    () => ({
      rowIds,
      selected,
      focusedId,
      keyboardMode,
      setRowIds,
      toggle,
      selectMany,
      toggleAll,
      clear,
      setFocused,
      focusNext,
      focusPrev,
      setKeyboardMode,
    }),
    [
      rowIds,
      selected,
      focusedId,
      keyboardMode,
      setRowIds,
      toggle,
      selectMany,
      toggleAll,
      clear,
      setFocused,
      focusNext,
      focusPrev,
    ],
  );

  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): SelectionState {
  const ctx = useContext(SelectionCtx);
  if (!ctx) {
    throw new Error("useSelection must be used inside <SelectionProvider>.");
  }
  return ctx;
}

// Soft-read variant that returns null when no provider is mounted. Used by
// InboxListItem so the component still renders cleanly outside the inbox
// (e.g. in a future detached preview).
export function useSelectionOptional(): SelectionState | null {
  return useContext(SelectionCtx);
}
