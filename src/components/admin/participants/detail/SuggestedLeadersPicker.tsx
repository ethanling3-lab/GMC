"use client";

import { useEffect, useRef, useState } from "react";
import {
  GROWTH_DIMENSION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  type GrowthDimension,
  type ZuZhangTier,
} from "@/lib/grouping/types";

// Suggested 组长 · 建议在谁的小组 (migration 072). CS picks group leaders
// from the CRM instead of typing names. Ordered — first = preferred, max 2.
// Searches /api/admin/participants/leaders/search, which only returns
// people with a 组长 tier, across the whole CRM.
//
// Controlled: the parent owns the list and saves it as
// `suggested_leader_ids` through the participant PATCH.

export const MAX_SUGGESTED_LEADERS = 2;

export type SuggestedLeader = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  zu_zhang_tier: ZuZhangTier | null;
  zu_zhang_dimensions: GrowthDimension[] | null;
};

function leaderName(l: { name_en: string | null; name_cn: string | null }): string {
  const cn = l.name_cn?.trim();
  const en = l.name_en?.trim();
  if (cn && en) return `${cn} · ${en}`;
  return cn || en || "—";
}

function strengths(l: SuggestedLeader): string {
  return (l.zu_zhang_dimensions ?? [])
    .map((d) => `${GROWTH_DIMENSION_LABEL[d].icon}${GROWTH_DIMENSION_LABEL[d].cn}`)
    .join(" ");
}

export function SuggestedLeadersPicker({
  participantId,
  leaders,
  onChange,
}: {
  participantId: string;
  leaders: SuggestedLeader[];
  onChange: (next: SuggestedLeader[]) => void;
}) {
  const full = leaders.length >= MAX_SUGGESTED_LEADERS;

  return (
    <div>
      {leaders.length > 0 ? (
        <ol className="flex flex-wrap gap-2">
          {leaders.map((l, i) => (
            <li key={l.id}>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/60 pl-2.5 pr-1 py-1 text-[12px] text-[var(--ink)]">
                <span className="text-[10px] tabular-nums text-[var(--cinnabar-deep)]">
                  {i === 0 ? "1 · 首选" : `${i + 1}`}
                </span>
                <span>{leaderName(l)}</span>
                {l.zu_zhang_tier ? (
                  <span className="text-[10.5px] text-[var(--ink-mute)]">
                    {ZU_ZHANG_TIER_LABEL[l.zu_zhang_tier].cn}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(leaders.filter((x) => x.id !== l.id))}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--ink-faint)] hover:bg-[var(--paper)]/70 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[background-color,color,transform] duration-[var(--dur-fast)]"
                  aria-label={`Remove ${leaderName(l)}`}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {full ? (
        <p className="mt-2 text-[11.5px] text-[var(--ink-faint)]">
          Up to {MAX_SUGGESTED_LEADERS} suggestions. Remove one to change it.
        </p>
      ) : (
        <div className={leaders.length > 0 ? "mt-2" : ""}>
          <LeaderSearch
            excludeIds={[participantId, ...leaders.map((l) => l.id)]}
            onPick={(hit) => onChange([...leaders, hit])}
          />
        </div>
      )}
    </div>
  );
}

// Read-only display for view mode.
export function SuggestedLeadersDisplay({ leaders }: { leaders: SuggestedLeader[] }) {
  if (leaders.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {leaders.map((l, i) => (
        <a
          key={l.id}
          href={`/admin/participants/${l.id}`}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] transition-[border-color,color] duration-[var(--dur-fast)]"
        >
          {i === 0 && leaders.length > 1 ? (
            <span className="text-[10px] text-[var(--cinnabar-deep)]">首选</span>
          ) : null}
          <span>{leaderName(l)}</span>
          {l.zu_zhang_tier ? (
            <span className="text-[10.5px] text-[var(--ink-mute)]">
              {ZU_ZHANG_TIER_LABEL[l.zu_zhang_tier].cn}
            </span>
          ) : null}
        </a>
      ))}
    </span>
  );
}

function LeaderSearch({
  excludeIds,
  onPick,
}: {
  excludeIds: string[];
  onPick: (hit: SuggestedLeader) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SuggestedLeader[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const excludeKey = excludeIds.join(",");

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setRows([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setErr(null);
      try {
        const sp = new URLSearchParams({ q: trimmed });
        const res = await fetch(
          `/api/admin/participants/leaders/search?${sp.toString()}`,
          { signal: ctrl.signal },
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "Search failed");
        const exclude = new Set(excludeKey.split(",").filter(Boolean));
        setRows(((payload.rows ?? []) as SuggestedLeader[]).filter((r) => !exclude.has(r.id)));
        setOpen(true);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, excludeKey]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="text-[var(--ink-faint)] flex-none">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => rows.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search group leaders · 搜索组长"
          aria-label="Search group leaders"
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        {loading ? <span className="text-[11px] text-[var(--ink-faint)]">…</span> : null}
      </div>
      {open && rows.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] shadow-[var(--shadow-paper-2)] divide-y divide-[var(--paper-shadow)]/60"
        >
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setRows([]);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-[var(--paper-deep)]/55 focus-visible:bg-[var(--paper-deep)]/55 focus-visible:outline-none active:bg-[var(--paper-deep)] transition-colors duration-[var(--dur-fast)]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">{r.region_id ?? "—"}</span>
                  <span className="text-[13px] text-[var(--ink)]">{leaderName(r)}</span>
                  {r.zu_zhang_tier ? (
                    <span className="text-[11px] text-[var(--ink-mute)]">{ZU_ZHANG_TIER_LABEL[r.zu_zhang_tier].cn}</span>
                  ) : null}
                </div>
                {strengths(r) ? (
                  <div className="mt-0.5 text-[11px] text-[var(--ink-mute)]">{strengths(r)}</div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && q.trim().length >= 1 && !loading && rows.length === 0 && !err ? (
        <div className="mt-1.5 text-[12px] text-[var(--ink-mute)]">
          No group leader matches. Only people switched on as 组长 can be suggested.
        </div>
      ) : null}
      {err ? <div className="mt-1.5 text-[12px] text-[var(--cinnabar-deep)]">{err}</div> : null}
    </div>
  );
}
