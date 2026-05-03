"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Lets detail pages override the displayed label for a URL segment in the
// TopBar breadcrumb. The default behavior in TopBar truncates UUIDs to 8
// chars — fine as a fallback, but useless when the page knows what the
// entity is actually called.
//
// Usage from a detail page:
//   <CrumbLabel segment={eventId} label="The Golden Principles" />
// (Place anywhere in the page tree below AdminShell — registration runs
// in useEffect on the client.)

type LabelMap = Record<string, string>;

type Ctx = {
  labels: LabelMap;
  setLabel: (segment: string, label: string) => void;
  clearLabel: (segment: string) => void;
};

const BreadcrumbCtx = createContext<Ctx | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<LabelMap>({});

  const setLabel = useCallback((segment: string, label: string) => {
    setLabels((prev) => {
      if (prev[segment] === label) return prev;
      return { ...prev, [segment]: label };
    });
  }, []);

  const clearLabel = useCallback((segment: string) => {
    setLabels((prev) => {
      if (!(segment in prev)) return prev;
      const next = { ...prev };
      delete next[segment];
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ labels, setLabel, clearLabel }),
    [labels, setLabel, clearLabel],
  );

  return (
    <BreadcrumbCtx.Provider value={value}>{children}</BreadcrumbCtx.Provider>
  );
}

export function useBreadcrumbLabels(): LabelMap {
  const ctx = useContext(BreadcrumbCtx);
  return ctx?.labels ?? {};
}

export function CrumbLabel({
  segment,
  label,
}: {
  segment: string;
  label: string;
}) {
  const ctx = useContext(BreadcrumbCtx);
  // Depend on the STABLE callback references (setLabel + clearLabel are
  // useCallback with empty deps inside the provider), not the whole ctx
  // object. The ctx value's identity changes every time `labels` changes,
  // so depending on `ctx` here creates an infinite loop: setLabel changes
  // labels → ctx identity changes → effect re-runs → cleanup clears →
  // setup sets again → labels changes → ... The loop blocks React's
  // navigation transitions from ever committing (page-level <Link> clicks
  // appear to do nothing).
  const setLabel = ctx?.setLabel;
  const clearLabel = ctx?.clearLabel;
  useEffect(() => {
    if (!setLabel || !clearLabel) return;
    if (!segment || !label) return;
    setLabel(segment, label);
    return () => clearLabel(segment);
  }, [setLabel, clearLabel, segment, label]);
  return null;
}
