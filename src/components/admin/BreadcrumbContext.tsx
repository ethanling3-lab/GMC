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
  useEffect(() => {
    if (!ctx) return;
    if (!segment || !label) return;
    ctx.setLabel(segment, label);
    return () => ctx.clearLabel(segment);
  }, [ctx, segment, label]);
  return null;
}
