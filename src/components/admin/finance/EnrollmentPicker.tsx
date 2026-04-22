"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/finance/finance-query";

// Typeahead that hits /api/admin/finance/search-enrollments. Pops a dropdown
// of candidate enrolments (approved or paid only) as the admin types. Used
// inside TransactionRow to retarget a txn.

export type EnrollmentHit = {
  enrollment_id: string;
  event_id: string;
  event_title: string;
  event_date: string | null;
  currency: string | null;
  price: number | null;
  status: string;
  payment_status: string;
  amount_paid: number | null;
  paid_at: string | null;
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
};

export function EnrollmentPicker({
  onSelect,
}: {
  onSelect: (c: EnrollmentHit) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EnrollmentHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance/search-enrollments?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        const payload = (await res.json()) as { results?: EnrollmentHit[] };
        setResults(payload.results ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q]);

  return (
    <div ref={wrapperRef} className="relative">
      <label
        className="flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)]
                   border border-[var(--paper-shadow)] bg-[var(--paper)]
                   focus-within:border-[var(--cinnabar)]/40
                   focus-within:shadow-[var(--shadow-focus)]
                   transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="text-[var(--ink-faint)]" aria-hidden="true">
          <circle cx="5" cy="5" r="3" />
          <path d="M7.5 7.5L10 10" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name, student ID, email, phone…"
          className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
        />
        {loading ? (
          <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            …
          </span>
        ) : null}
      </label>

      {open && q.trim().length >= 2 ? (
        <div className="absolute z-10 left-0 right-0 mt-1.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] max-h-[280px] overflow-y-auto">
          {results.length === 0 && !loading ? (
            <div className="px-3 py-3 text-[12px] text-[var(--ink-faint)]">
              No matching enrolments.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--paper-shadow)]">
              {results.map((r) => {
                const name = r.name_en ?? r.name_cn ?? "(unnamed)";
                return (
                  <li key={r.enrollment_id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(r);
                        setOpen(false);
                        setQ("");
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-[var(--paper-deep)] transition-colors
                                 focus-visible:bg-[var(--paper-deep)] focus-visible:outline-none"
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-[11.5px] text-[var(--cinnabar-deep)]">
                          {r.region_id ?? "—"}
                        </span>
                        <span className="text-[13px] text-[var(--ink)]">{name}</span>
                        <span className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-faint)]">
                          {r.status}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--ink-mute)] truncate">
                        {r.event_title}
                        {r.price != null ? (
                          <span className="ml-2 tabular-nums">
                            · {formatMoney(r.price, r.currency)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
