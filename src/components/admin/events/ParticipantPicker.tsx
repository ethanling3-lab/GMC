"use client";

import { useEffect, useRef, useState } from "react";

export type ParticipantHit = {
  id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
  is_old_student: boolean | null;
};

type Props = {
  /** Currently picked participant — when set the picker collapses to a chip. */
  value: ParticipantHit | null;
  onPick: (p: ParticipantHit | null) => void;
  /** Optional initial query so the picker pre-loads results. */
  initialQ?: string;
  disabled?: boolean;
  /** Extra query params appended to the search URL (e.g. exclude_status=lead). */
  extraSearchParams?: Record<string, string>;
};

export function ParticipantPicker({
  value,
  onPick,
  initialQ = "",
  disabled,
  extraSearchParams,
}: Props) {
  const [q, setQ] = useState(initialQ);
  const [rows, setRows] = useState<ParticipantHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Stable dep for the effect below — parents can pass a fresh object literal
  // every render without restarting the debounce timer.
  const extraParamsKey = extraSearchParams ? JSON.stringify(extraSearchParams) : "";

  // Debounced fetch.
  useEffect(() => {
    if (value) return; // collapsed when picked
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({ q: trimmed });
        if (extraSearchParams) {
          for (const [k, v] of Object.entries(extraSearchParams)) {
            if (v) sp.set(k, v);
          }
        }
        const res = await fetch(
          `/api/admin/participants/search?${sp.toString()}`,
          { signal: ctrl.signal },
        );
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error ?? `search failed (${res.status})`);
        }
        setRows((payload.rows ?? []) as ParticipantHit[]);
        setActiveIdx(0);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "search failed");
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, value, extraParamsKey]);

  if (value) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-[16px] text-[var(--ink)] truncate">
              {participantLabel(value)}
            </span>
            {value.is_old_student ? <OldChip /> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--ink-mute)] font-mono">
            <span>{value.region_id ?? "—"}</span>
            {value.email ? <span>{value.email}</span> : null}
            {value.phone ? <span>{value.phone}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setQ("");
          }}
          disabled={disabled}
          className="text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 h-10 px-3.5 rounded-[var(--radius-pill)]
                      border border-[var(--paper-shadow)] bg-[var(--paper)]
                      focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)]
                      transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="text-[var(--ink-faint)] flex-none">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (rows.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = rows[activeIdx];
              if (pick) onPick(pick);
            }
          }}
          disabled={disabled}
          placeholder="Search by name, student ID, email, or phone…"
          aria-label="Search participants"
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] disabled:opacity-50"
        />
        {loading ? (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin text-[var(--ink-mute)]">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
            <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : null}
      </div>

      {error ? (
        <div className="mt-2 text-[12px] text-[var(--cinnabar-deep)]">{error}</div>
      ) : null}

      {q.trim().length >= 2 && !loading && rows.length === 0 && !error ? (
        <div className="mt-3 text-[12.5px] text-[var(--ink-mute)] italic">
          No participant found. Use the &ldquo;Add new&rdquo; option below to create one.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Participant matches"
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] overflow-hidden divide-y divide-[var(--paper-shadow)]/60"
        >
          {rows.map((r, i) => {
            const active = i === activeIdx;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => onPick(r)}
                  className={`w-full text-left px-4 py-3 flex items-start justify-between gap-3
                              transition-colors duration-[var(--dur-fast)]
                              ${active ? "bg-[var(--cinnabar-wash)]/60" : "hover:bg-[var(--paper-deep)]/55"}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-[var(--ink)] truncate">
                        {participantLabel(r)}
                      </span>
                      {r.is_old_student ? <OldChip /> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--ink-mute)] font-mono">
                      <span>{r.region_id ?? "—"}</span>
                      {r.region ? <span>{r.region}</span> : null}
                      {r.email ? <span>{r.email}</span> : null}
                      {r.phone ? <span>{r.phone}</span> : null}
                    </div>
                  </div>
                  <span className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-faint)] mt-0.5">
                    Pick
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function participantLabel(p: ParticipantHit): string {
  const en = p.name_en?.trim();
  const cn = p.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

function OldChip() {
  return (
    <span
      title="Returning participant · 老学员"
      className="inline-flex items-center gap-1 h-4 px-1.5 rounded-full
                 border border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]
                 text-[9px] tracking-[0.2em] uppercase text-[var(--cinnabar-deep)]"
    >
      <span className="w-1 h-1 rounded-full bg-[var(--cinnabar)]" aria-hidden="true" />
      Old
    </span>
  );
}
