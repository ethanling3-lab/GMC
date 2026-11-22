"use client";

import { useEffect, useRef } from "react";

// On phones the day pills and the mode bar are horizontal scroll rows; the
// selected item (today, the live mode) is usually near the end, off-screen.
// Scroll the row — not the page — so it's centred. Re-runs when `key` changes.
export function useCenterSelected<T extends HTMLElement>(selector: string, key: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const row = ref.current;
    const el = row?.querySelector<HTMLElement>(selector);
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = el.offsetLeft - row.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [selector, key]);
  return ref;
}
