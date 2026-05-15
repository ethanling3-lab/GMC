"use client";

import type { CheckInAbsentRow } from "@/lib/check-in/types";

// One row in the "Not yet here · 未到场" chase list. Pulls phone for a
// tel: tap-to-call CTA so door staff can phone late arrivals directly
// from their tablet/phone.

type Props = {
  row: CheckInAbsentRow;
};

function sanitisedTel(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

export function AbsenteeRow({ row }: Props) {
  const name = row.name_cn ?? row.name_en ?? "(unnamed)";
  const telHref = row.phone ? `tel:${sanitisedTel(row.phone)}` : null;

  return (
    <li className="px-5 py-2.5 flex items-center gap-3 text-[12.5px] hover:bg-[var(--paper)]/40 transition-colors">
      <span
        className="inline-flex items-center justify-center h-[22px] min-w-[44px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.04em] font-medium text-[var(--ink-mute)] tabular-nums"
        title="Region ID"
      >
        {row.region_id ?? "—"}
      </span>
      <span className="font-medium text-[var(--ink)] flex-1 min-w-0 truncate">
        {name}
      </span>
      {row.group_no !== null ? (
        <span className="text-[var(--ink-soft)] text-[10.5px] tracking-[0.08em] uppercase tabular-nums">
          Group {row.group_no}
        </span>
      ) : (
        <span className="text-[var(--ink-faint)] text-[10.5px] tracking-[0.08em] uppercase">
          No group
        </span>
      )}
      {telHref ? (
        <a
          href={telHref}
          className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)]/10 text-[var(--cinnabar)] text-[11px] tracking-[0.04em] hover:bg-[var(--cinnabar)]/20 transition-colors"
          style={{ color: "var(--cinnabar)" }}
          aria-label={`Call ${name}`}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 4.5C3 3.4 3.9 2.5 5 2.5h1.2c.5 0 .9.3 1 .8L7.7 5c.1.5-.1 1-.5 1.3l-.9.7c1.1 1.9 2.7 3.5 4.6 4.6l.7-.9c.3-.4.8-.6 1.3-.5l1.7.5c.5.1.8.5.8 1V13c0 1.1-.9 2-2 2A11 11 0 0 1 3 4.5Z" />
          </svg>
          {row.phone}
        </a>
      ) : (
        <span className="text-[var(--ink-faint)] text-[10.5px] italic">
          No phone
        </span>
      )}
    </li>
  );
}
