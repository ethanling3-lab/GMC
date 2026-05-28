"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSelection } from "./SelectionContext";
import { runBulk } from "./bulk-runner";
import { KeyboardCheatsheet } from "./KeyboardCheatsheet";

// Global keyboard listener mounted at inbox/layout.tsx. Handles triage
// shortcuts on the conversation list:
//
//   j / ↓        Next row (focus, scroll into view)
//   k / ↑        Previous row
//   Enter        Open focused row in thread pane
//   x / Space    Toggle selection on focused row
//   ⌘/⌃ A        Select all visible
//   e            Mark read (selected if any, else focused)
//   c            Close (selected if any, else focused)
//   m            Assign to me (selected if any, else focused)
//   Esc          Clear selection / close cheatsheet
//   ?            Toggle cheatsheet
//
// All shortcuts auto-suspend when focus is in any text-entry element
// (input, textarea, contenteditable, role=textbox, role=combobox) so the
// composer's Enter-to-send + slash menu keep working.

const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (TEXT_INPUT_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox") return true;
  return false;
}

function scrollRowIntoView(id: string) {
  const node = document.querySelector(`[data-inbox-row-id="${CSS.escape(id)}"]`);
  if (node instanceof HTMLElement) {
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

export function InboxKeyboardHost() {
  const router = useRouter();
  const {
    rowIds,
    selected,
    focusedId,
    toggle,
    toggleAll,
    clear,
    focusNext,
    focusPrev,
  } = useSelection();
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  // Refs let the listener stay stable while reading live state, so we
  // don't tear down + re-attach the window listener on every state tick.
  const rowIdsRef = useRef(rowIds);
  rowIdsRef.current = rowIds;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

  const markReadIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await runBulk(
      ids,
      async (id) => {
        const res = await fetch(`/api/admin/inbox/${id}/read`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      { concurrency: 6 },
    );
    router.refresh();
  }, [router]);

  const closeIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await runBulk(
      ids,
      async (id) => {
        const res = await fetch(`/api/admin/inbox/${id}/status`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "closed" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      { concurrency: 6 },
    );
    router.refresh();
  }, [router]);

  const assignToMeIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await runBulk(
      ids,
      async (id) => {
        const res = await fetch(`/api/admin/inbox/${id}/assign`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ admin_id: "self" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      },
      { concurrency: 6 },
    );
    router.refresh();
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Bail on browser/OS combos (Cmd+R, Cmd+T, etc.) — only intercept
      // Cmd/Ctrl + A for "select all" inside the inbox.
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const onlyCmdOrCtrl = isCmdOrCtrl && !e.altKey && !e.shiftKey;

      if (isCmdOrCtrl) {
        if (onlyCmdOrCtrl && e.key.toLowerCase() === "a") {
          // Suspend in text-entry — let the browser do native select-all
          if (isTextEntry(e.target)) return;
          if (rowIdsRef.current.length === 0) return;
          e.preventDefault();
          toggleAll();
          return;
        }
        return;
      }
      if (e.altKey) return;
      if (isTextEntry(e.target)) return;

      const key = e.key;

      // ? — open cheatsheet (Shift+/ on most US layouts)
      if (key === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
        return;
      }

      // Escape — close cheatsheet first, else clear selection
      if (key === "Escape") {
        if (cheatsheetOpen) {
          setCheatsheetOpen(false);
          return;
        }
        if (selectedRef.current.size > 0) {
          e.preventDefault();
          clear();
        }
        return;
      }

      if (key === "j" || key === "ArrowDown") {
        e.preventDefault();
        const id = focusNext();
        if (id) scrollRowIntoView(id);
        return;
      }
      if (key === "k" || key === "ArrowUp") {
        e.preventDefault();
        const id = focusPrev();
        if (id) scrollRowIntoView(id);
        return;
      }
      if (key === "Enter") {
        const id = focusedRef.current;
        if (id) {
          e.preventDefault();
          router.push(`/admin/inbox/${id}`);
        }
        return;
      }
      if (key === "x" || key === " ") {
        const id = focusedRef.current;
        if (id) {
          e.preventDefault();
          toggle(id);
        }
        return;
      }
      if (key === "e") {
        const sel = selectedRef.current;
        const ids = sel.size > 0 ? Array.from(sel) : focusedRef.current ? [focusedRef.current] : [];
        if (ids.length > 0) {
          e.preventDefault();
          void markReadIds(ids);
        }
        return;
      }
      if (key === "c") {
        const sel = selectedRef.current;
        const ids = sel.size > 0 ? Array.from(sel) : focusedRef.current ? [focusedRef.current] : [];
        if (ids.length > 0) {
          e.preventDefault();
          void closeIds(ids);
        }
        return;
      }
      if (key === "m") {
        const sel = selectedRef.current;
        const ids = sel.size > 0 ? Array.from(sel) : focusedRef.current ? [focusedRef.current] : [];
        if (ids.length > 0) {
          e.preventDefault();
          void assignToMeIds(ids);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    assignToMeIds,
    cheatsheetOpen,
    clear,
    closeIds,
    focusNext,
    focusPrev,
    markReadIds,
    router,
    toggle,
    toggleAll,
  ]);

  return cheatsheetOpen ? (
    <KeyboardCheatsheet onClose={() => setCheatsheetOpen(false)} />
  ) : null;
}
