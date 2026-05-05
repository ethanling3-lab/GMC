"use client";

import { useEffect, useRef, useState } from "react";

// Self-contained chip + typeahead editor for participant_conflict_pairs.
// Mirrors the family-pair pattern from RelationshipsEditor but lives
// inside EnrichmentEditor's "Grouping signals" section.
//
// Controlled component — parent owns the list state. Saves happen via
// parent's PATCH (conflict_member_ids: string[] in the body); this
// component only nudges that array.

export type ConflictPartner = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
};

type SearchHit = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  email?: string | null;
  phone?: string | null;
};

function partnerLabel(p: { name_en: string | null; name_cn: string | null }): string {
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "—";
}

export function ConflictPairsEditor({
  participantId,
  partners,
  onChange,
}: {
  participantId: string;
  partners: ConflictPartner[];
  onChange: (next: ConflictPartner[]) => void;
}) {
  function add(hit: SearchHit) {
    if (hit.id === participantId) return;
    if (partners.some((p) => p.id === hit.id)) return;
    onChange([
      ...partners,
      {
        id: hit.id,
        region_id: hit.region_id,
        name_en: hit.name_en,
        name_cn: hit.name_cn,
      },
    ]);
  }

  function remove(id: string) {
    onChange(partners.filter((p) => p.id !== id));
  }

  return (
    <div>
      {partners.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {partners.map((p) => (
            <li key={p.id}>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/60 pl-2.5 pr-1 py-1 text-[12px] text-[var(--ink)]">
                {p.region_id ? (
                  <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
                    {p.region_id}
                  </span>
                ) : null}
                <span>{partnerLabel(p)}</span>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--ink-faint)] hover:bg-[var(--paper)]/70 hover:text-[var(--cinnabar-deep)]"
                  aria-label={`Remove ${partnerLabel(p)}`}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3">
        <ConflictSearch
          placeholder="Search to add a conflict pair…"
          excludeIds={[participantId, ...partners.map((p) => p.id)]}
          onPick={add}
        />
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.55] text-[var(--ink-faint)]">
        Algorithm splits conflict pairs across different groups (same hardness as family).
      </p>
    </div>
  );
}

// Read-only chip list for view mode.
export function ConflictPartnersDisplay({
  partners,
}: {
  partners: ConflictPartner[];
}) {
  if (partners.length === 0) {
    return <span className="text-[var(--ink-faint)]">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {partners.map((p) => (
        <a
          key={p.id}
          href={`/admin/participants/${p.id}`}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]"
        >
          {p.region_id ? (
            <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
              {p.region_id}
            </span>
          ) : null}
          <span>{partnerLabel(p)}</span>
        </a>
      ))}
    </span>
  );
}

function ConflictSearch({
  placeholder,
  excludeIds,
  onPick,
}: {
  placeholder: string;
  excludeIds: string[];
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const excludeKey = excludeIds.slice().sort().join(",");

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRows([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const sp = new URLSearchParams({ q: trimmed });
        const res = await fetch(
          `/api/admin/participants/search?${sp.toString()}`,
          { signal: ctrl.signal },
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? "search failed");
        const all = (payload.rows ?? []) as SearchHit[];
        const excludeSet = new Set(excludeKey.split(",").filter(Boolean));
        setRows(all.filter((r) => !excludeSet.has(r.id)));
        setOpen(true);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, excludeKey]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          className="text-[var(--ink-faint)] flex-none"
        >
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => rows.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        {loading ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="animate-spin text-[var(--ink-mute)]"
          >
            <circle
              cx="7"
              cy="7"
              r="5.5"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="1.5"
            />
            <path
              d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </div>
      {open && rows.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] shadow-[var(--shadow-paper-1)] divide-y divide-[var(--paper-shadow)]/60"
        >
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setRows([]);
                  setOpen(false);
                }}
                className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--paper-deep)]/55 transition-colors duration-[var(--dur-fast)]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
                    {r.region_id ?? "—"}
                  </span>
                  <span className="text-[13px] text-[var(--ink)]">
                    {partnerLabel(r)}
                  </span>
                </div>
                {r.email || r.phone ? (
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--ink-mute)] font-mono">
                    {r.email ? <span>{r.email}</span> : null}
                    {r.phone ? <span>{r.phone}</span> : null}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && q.trim().length >= 2 && !loading && rows.length === 0 ? (
        <div className="mt-2 text-[12px] text-[var(--ink-mute)] italic">
          No matches.
        </div>
      ) : null}
    </div>
  );
}
