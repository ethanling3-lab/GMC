"use client";

import { useEffect, useRef, useState } from "react";
import {
  HOLIDAY_REGION_CATALOGUE,
  holidayRegionInfo,
  sortHolidayRegions,
  type CalendarHoliday,
  type HolidayRegion,
} from "@/lib/calendar/types";

// Super Admin's holiday list for one year (calendar_holidays, migration
// 076). Entered by hand — add, edit, delete; any region from the catalogue.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLIDAY_RED = "#B91C1C";

type Draft = { date: string; name_en: string; name_cn: string; regions: HolidayRegion[]; estimated: boolean };

const input =
  "h-9 w-full px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";
const smallBtn =
  "inline-flex items-center h-8 px-3 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[border-color,color,transform] duration-[var(--dur-fast)]";
const primaryBtn =
  "inline-flex items-center h-9 px-4 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]";

async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(j.detail ?? j.error ?? `Failed (${res.status})`));
  return j;
}

// Multi-select dropdown: countries first, then Malaysian states. Type to
// filter. Regions come from HOLIDAY_REGION_CATALOGUE (types.ts).
function RegionPicks({ value, onChange }: { value: HolidayRegion[]; onChange: (v: HolidayRegion[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (code: string) =>
    onChange(sortHolidayRegions(value.includes(code) ? value.filter((x) => x !== code) : [...value, code]));

  const needle = q.trim().toLowerCase();
  const matches = HOLIDAY_REGION_CATALOGUE.filter(
    (r) => !needle || r.en.toLowerCase().includes(needle) || r.cn.includes(needle) || r.code.toLowerCase() === needle,
  );
  const groups: Array<[string, typeof matches]> = [
    ["Countries · 国家", matches.filter((r) => r.group === "country")],
    ["Malaysian states · 马来西亚州属", matches.filter((r) => r.group === "my_state")],
  ];
  const label = value.length === 0 ? "Pick regions" : value.map((c) => holidayRegionInfo(c).en).join(", ");

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Regions"
        onClick={() => setOpen((v) => !v)}
        className={`${input} flex items-center justify-between gap-2 text-left ${value.length === 0 ? "text-[var(--ink-faint)]" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="flex-none text-[10px] text-[var(--ink-mute)]">
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[280px] max-w-[calc(100vw-48px)] rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-3)] p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search · 搜索"
            aria-label="Search regions"
            className={`${input} h-8 mb-1.5`}
          />
          <div role="listbox" aria-multiselectable="true" className="max-h-[260px] overflow-y-auto">
            {groups.map(([title, list]) =>
              list.length === 0 ? null : (
                <div key={title} className="py-1">
                  <div className="px-2 pb-1 text-[10px] tracking-[0.16em] uppercase text-[var(--ink-faint)]">{title}</div>
                  {list.map((r) => (
                    <label
                      key={r.code}
                      role="option"
                      aria-selected={value.includes(r.code)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] text-[12.5px] text-[var(--ink)] hover:bg-[var(--paper-deep)]/60 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={value.includes(r.code)}
                        onChange={() => toggle(r.code)}
                        className="h-3.5 w-3.5 accent-[var(--cinnabar)]"
                      />
                      <span className="flex-1">{r.en}</span>
                      <span className="text-[11.5px] text-[var(--ink-mute)]">{r.cn}</span>
                    </label>
                  ))}
                </div>
              ),
            )}
            {matches.length === 0 ? <p className="px-2 py-3 text-[12px] text-[var(--ink-mute)]">No region matches “{q}”.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DraftFields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
  return (
    <>
      <input type="date" aria-label="Date" className={`${input} font-mono text-[12.5px]`} value={d.date} onChange={(e) => set({ ...d, date: e.target.value })} />
      <input aria-label="Chinese name" className={input} value={d.name_cn} placeholder="中文名称" onChange={(e) => set({ ...d, name_cn: e.target.value })} />
      <input aria-label="English name" className={input} value={d.name_en} placeholder="English name" onChange={(e) => set({ ...d, name_en: e.target.value })} />
      <RegionPicks value={d.regions} onChange={(regions) => set({ ...d, regions })} />
      <label className="inline-flex items-center gap-1 text-[12px] text-[var(--ink-soft)] select-none" title="Islamic-calendar date that may move a day">
        <input type="checkbox" checked={d.estimated} onChange={(e) => set({ ...d, estimated: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--cinnabar)]" />
        ≈ Estimated
      </label>
    </>
  );
}

export function HolidaysPanel({
  year,
  holidays,
  onChanged,
}: {
  year: number;
  holidays: CalendarHoliday[]; // this year's rows
  onChanged: (msg?: string) => void;
}) {
  const blank: Draft = { date: `${year}-01-01`, name_en: "", name_cn: "", regions: ["MY"], estimated: false };
  const [adding, setAdding] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<string | undefined>) {
    setBusy(true);
    setError(null);
    try {
      const msg = await fn();
      onChanged(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      await call("/api/admin/calendar/holidays", "POST", { ...adding, name_cn: adding.name_cn || null });
      setAdding({ ...blank, date: adding.date });
      return `✓ Added ${adding.name_cn || adding.name_en}.`;
    });

  const save = () =>
    editing &&
    run(async () => {
      await call(`/api/admin/calendar/holidays/${editing.id}`, "PATCH", { ...editing.d, name_cn: editing.d.name_cn || null });
      setEditing(null);
      return "✓ Holiday updated.";
    });

  const remove = (h: CalendarHoliday) => {
    if (!window.confirm(`Delete ${h.name_cn || h.name_en} (${h.date})?`)) return;
    void run(async () => {
      await call(`/api/admin/calendar/holidays/${h.id}`, "DELETE");
      return `✓ Deleted ${h.name_cn || h.name_en}.`;
    });
  };

  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-[22px] tracking-[-0.01em] text-[var(--ink)]">
            Public holidays {year} <span className="text-[15px] text-[var(--ink-mute)]">· 公共假期</span>
          </h2>
          <p className="mt-1 max-w-[64ch] text-[12.5px] leading-[1.6] text-[var(--ink-mute)]">
            Add each public holiday for {year}: date, name and the regions it applies to. Tick “≈ Estimated” for dates
            that may still move, such as Islamic-calendar holidays.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-[150px_1fr_1fr] xl:grid-cols-[150px_1fr_1fr_220px_auto] gap-x-3 gap-y-2 items-center">
        <DraftFields d={adding} set={setAdding} />
        <div className="md:col-span-3 xl:col-span-5 flex justify-end">
          <button type="button" onClick={add} disabled={busy || !adding.name_en.trim()} className={primaryBtn} style={{ color: "var(--paper-warm)" }}>
            + Add holiday
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p> : null}

      <div className="mt-5 border-t border-[var(--paper-shadow)]">
        {holidays.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[var(--ink-mute)]">
            No holidays for {year} yet — add the first one above.
          </p>
        ) : (
          <ul>
            {holidays.map((h) =>
              editing?.id === h.id ? (
                <li key={h.id} className="py-3 border-b border-[var(--paper-shadow)]/70 grid grid-cols-1 md:grid-cols-[150px_1fr_1fr] xl:grid-cols-[150px_1fr_1fr_220px_auto] gap-x-3 gap-y-2 items-center">
                  <DraftFields d={editing.d} set={(d) => setEditing({ id: h.id, d })} />
                  <div className="md:col-span-3 xl:col-span-5 flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(null)} disabled={busy} className={smallBtn}>
                      Cancel
                    </button>
                    <button type="button" onClick={save} disabled={busy || !editing.d.name_en.trim()} className={smallBtn}>
                      Save
                    </button>
                  </div>
                </li>
              ) : (
                <li key={h.id} className="py-2 border-b border-[var(--paper-shadow)]/70 flex items-center gap-3 flex-wrap">
                  <span className="w-[64px] flex-none text-[12.5px] tabular-nums" style={{ color: HOLIDAY_RED }}>
                    {h.estimated ? "≈" : ""}
                    {Number(h.date.slice(8, 10))} {MONTHS[Number(h.date.slice(5, 7)) - 1]}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-[var(--ink)]">
                    {h.name_cn ? `${h.name_cn} · ` : ""}
                    <span className="text-[var(--ink-soft)]">{h.name_en}</span>
                    <span className="ml-2 text-[11px] text-[var(--ink-faint)]">
                      {h.regions.map((r) => holidayRegionInfo(r).en).join(" · ")}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      className={smallBtn}
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          id: h.id,
                          d: { date: h.date, name_en: h.name_en, name_cn: h.name_cn ?? "", regions: h.regions, estimated: h.estimated },
                        })
                      }
                    >
                      Edit
                    </button>
                    <button type="button" className={smallBtn} disabled={busy} onClick={() => remove(h)}>
                      Delete
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
