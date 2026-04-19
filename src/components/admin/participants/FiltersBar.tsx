"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const REGIONS = [
  { code: "", label: "All regions" },
  { code: "MY", label: "MY · Malaysia" },
  { code: "SG", label: "SG · Singapore" },
  { code: "TW", label: "TW · Taiwan" },
  { code: "HK", label: "HK · Hong Kong" },
  { code: "CN", label: "CN · Mainland China" },
];

const STATUSES = [
  { code: "", label: "Any status" },
  { code: "new", label: "New" },
  { code: "info_verified", label: "Info verified" },
  { code: "cs_enriched", label: "CS enriched" },
  { code: "active", label: "Active" },
  { code: "inactive", label: "Inactive" },
];

const MOTIVATIONS = [
  { code: "", label: "Any motivation" },
  { code: "clean", label: "Clean · 纯粹" },
  { code: "insurance", label: "Insurance · 保险" },
  { code: "direct_sales", label: "Direct sales · 直销" },
  { code: "spiritual", label: "Spiritual · 灵性" },
  { code: "other", label: "Other · 其他" },
];

const SORTS = [
  { code: "recent", label: "Most recent" },
  { code: "oldest", label: "Oldest first" },
  { code: "region_id", label: "Region ID ↑" },
  { code: "name", label: "Name A–Z" },
  { code: "overall_score", label: "Score · high → low" },
];

type Props = {
  initialQ: string;
  activeCount: number;
  totalCount: number | null;
};

export function FiltersBar({ initialQ, activeCount, totalCount }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const [isPending, startTransition] = useTransition();
  const firstRun = useRef(true);

  const region = sp.get("region") ?? "";
  const status = sp.get("status") ?? "";
  const motivation = sp.get("motivation") ?? "";
  const sort = sp.get("sort") ?? "recent";

  // Debounced push of q → URL
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      update({ q: q || null, page: null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/admin/participants?${qs}` : "/admin/participants");
    });
  }

  function reset() {
    setQ("");
    startTransition(() => {
      router.push("/admin/participants");
    });
  }

  function exportCsv() {
    const next = new URLSearchParams(sp.toString());
    const qs = next.toString();
    const url = qs
      ? `/api/admin/participants/export?${qs}`
      : "/api/admin/participants/export";
    window.location.href = url;
  }

  const anyFilter =
    Boolean(q) || Boolean(region) || Boolean(status) || Boolean(motivation) || sort !== "recent";

  return (
    <div
      className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                 shadow-[var(--shadow-paper-1)] overflow-hidden"
      data-pending={isPending ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {/* Search */}
        <div className="flex-1 min-w-[240px] flex items-center gap-2.5 h-10 px-3.5 rounded-[var(--radius-pill)]
                        border border-[var(--paper-shadow)] bg-[var(--paper)]
                        focus-within:border-[var(--cinnabar)]/50 focus-within:shadow-[var(--shadow-focus)]
                        transition-[border-color,box-shadow] duration-[var(--dur-fast)]">
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
            placeholder="Search name, region ID, email, phone…"
            aria-label="Search participants"
            className="flex-1 bg-transparent outline-none text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors duration-[var(--dur-fast)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          ) : null}
        </div>

        <Select
          label="Region"
          value={region}
          options={REGIONS}
          onChange={(v) => update({ region: v || null, page: null })}
        />
        <Select
          label="Status"
          value={status}
          options={STATUSES}
          onChange={(v) => update({ status: v || null, page: null })}
        />
        <Select
          label="Motivation"
          value={motivation}
          options={MOTIVATIONS}
          onChange={(v) => update({ motivation: v || null, page: null })}
        />
        <Select
          label="Sort"
          value={sort}
          options={SORTS}
          onChange={(v) => update({ sort: v === "recent" ? null : v, page: null })}
          alwaysShowValue
          defaultValue="recent"
        />

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          {anyFilter ? (
            <button
              type="button"
              onClick={reset}
              className="h-9 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em]
                         text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)]
                         focus-visible:shadow-[var(--shadow-focus)]
                         transition-[background-color,color] duration-[var(--dur-fast)]"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                       border border-[var(--paper-shadow)] bg-[var(--paper)]
                       text-[12px] tracking-[0.04em] text-[var(--ink)]
                       hover:border-[var(--cinnabar)]/40 hover:bg-[var(--cinnabar-wash)] hover:text-[var(--cinnabar-deep)]
                       focus-visible:shadow-[var(--shadow-focus)]
                       transition-[background-color,color,border-color] duration-[var(--dur-fast)]"
            aria-label="Export current view as CSV"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 1.5v6M3.5 5L6 7.5 8.5 5" />
              <path d="M2 9.5v0.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-0.5" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Result meta */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--paper-shadow)] bg-[var(--paper)]/50 text-[11px] tracking-[0.14em] uppercase text-[var(--ink-mute)]">
        <span>
          {activeCount.toLocaleString()}{" "}
          {typeof totalCount === "number" && totalCount !== activeCount ? (
            <span className="text-[var(--ink-faint)]">
              · of {totalCount.toLocaleString()}
            </span>
          ) : null}{" "}
          matching
        </span>
        <span className={`transition-opacity duration-[var(--dur-fast)] ${isPending ? "opacity-100" : "opacity-0"}`}>
          <span className="inline-flex items-center gap-1.5 text-[var(--cinnabar)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)] animate-pulse" aria-hidden="true" />
            Refreshing
          </span>
        </span>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  alwaysShowValue = false,
  defaultValue = "",
}: {
  label: string;
  value: string;
  options: { code: string; label: string }[];
  onChange: (v: string) => void;
  alwaysShowValue?: boolean;
  defaultValue?: string;
}) {
  const isDefault = value === defaultValue;
  const current = options.find((o) => o.code === value);
  const displayLabel = alwaysShowValue
    ? `${label} · ${current?.label ?? ""}`
    : isDefault
      ? label
      : current?.label ?? label;

  return (
    <label
      className={`relative inline-flex items-center gap-2 h-9 px-3 pr-8 rounded-[var(--radius-pill)]
                  border text-[12px] tracking-[0.04em]
                  cursor-pointer
                  transition-[background-color,border-color,color] duration-[var(--dur-fast)]
                  ${
                    !isDefault
                      ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                      : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  }`}
    >
      <span className="truncate max-w-[180px]">{displayLabel}</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-60"
      >
        <path d="M2.5 4L5 6.5 7.5 4" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.code || "_"} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
