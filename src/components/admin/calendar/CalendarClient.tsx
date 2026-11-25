"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { STATUS_LABEL, TYPE_LABEL, type EventType } from "@/lib/events-shared";
import { HolidaysPanel } from "./HolidaysPanel";
import {
  holidayRegionInfo,
  holidayRegionTag,
  sortHolidayRegions,
  TYPE_COLOUR,
  type CalendarHoliday,
  type CalendarSession,
  type HolidayRegion,
} from "@/lib/calendar/types";

// Public holidays read as red days, the way printed calendars mark them.
// Same red as the admin's existing warnings (GroupsClient 未编桌 chip).
const HOLIDAY_RED = "#B91C1C";
const HOLIDAY_WASH = "rgba(185, 28, 28, 0.05)";
const REGION_STORE_KEY = "gmc.calendar.hiddenHolidayRegions";

type HolidayIndex = Map<string, CalendarHoliday[]>;

function regionTags(h: CalendarHoliday, hidden: Set<HolidayRegion>): string {
  return h.regions
    .filter((r) => !hidden.has(r))
    .map(holidayRegionTag)
    .join(" ");
}

// Every shown holiday falling inside a session's dates.
function holidaysIn(s: { start_date: string | null; end_date: string | null }, index: HolidayIndex): CalendarHoliday[] {
  if (!s.start_date) return [];
  const end = s.end_date && s.end_date > s.start_date ? s.end_date : s.start_date;
  const out: CalendarHoliday[] = [];
  const d = new Date(`${s.start_date}T00:00:00Z`);
  for (let i = 0; i < 62; i += 1) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    out.push(...(index.get(iso) ?? []));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function holidayLabel(h: CalendarHoliday): string {
  return h.name_cn ? `${h.name_cn} ${h.name_en}` : h.name_en;
}

function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_EN[Number(iso.slice(5, 7)) - 1]}`;
}

// Year calendar (Phase 1). Year view = 12 month panels listing sessions;
// month view = a Mon–Sun grid. Colour = event type. Status reads from the
// mark: planned = hollow ring + dashed edge, open = solid, closed = muted,
// draft = faint (Super Admin only).

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  year: number;
  month: number;
  view: "year" | "month";
  today: string;
  sessions: CalendarSession[];
  holidays: CalendarHoliday[];
  canPlan: boolean;
};

export function CalendarClient({ year, month, view, today, sessions, holidays, canPlan }: Props) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenRegions, setHiddenRegions] = useState<Set<HolidayRegion>>(new Set());

  // Per-viewer convenience only; the page works without storage.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REGION_STORE_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(list)) {
        setHiddenRegions(new Set(list.filter((r): r is HolidayRegion => typeof r === "string")));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRegion = (r: HolidayRegion) =>
    setHiddenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      try {
        window.localStorage.setItem(REGION_STORE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  const holidayIndex = useMemo<HolidayIndex>(() => {
    const m: HolidayIndex = new Map();
    for (const h of holidays) {
      if (!h.regions.some((r) => !hiddenRegions.has(r))) continue;
      m.set(h.date, [...(m.get(h.date) ?? []), h]);
    }
    return m;
  }, [holidays, hiddenRegions]);
  const [showDrafts, setShowDrafts] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [managingHolidays, setManagingHolidays] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usedTypes = useMemo(
    () => new Set<EventType>(sessions.map((s) => s.type)),
    [sessions],
  );
  const visible = sessions.filter(
    (s) => !hidden.has(s.type) && (showDrafts || s.status !== "draft"),
  );

  const go = (p: { year?: number; view?: string; month?: number }) => {
    const q = new URLSearchParams({
      year: String(p.year ?? year),
      view: p.view ?? view,
      month: String(p.month ?? month),
    });
    router.push(`/admin/calendar?${q.toString()}`);
  };

  const toggleType = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function duplicate() {
    if (!window.confirm(`Copy every ${year} event into ${year + 1} as planned (dates TBC)? Events already copied are skipped.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/calendar/duplicate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_year: year }),
      });
      const j = (await res.json().catch(() => ({}))) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
      setNotice(`✓ Copied ${j.created ?? 0} session${j.created === 1 ? "" : "s"} into ${year + 1}${j.skipped ? ` · ${j.skipped} already there` : ""}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Planning · 年历
          </div>
          <h1 className="mt-4 font-display text-[36px] md:text-[40px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            Calendar.
          </h1>
          <p className="mt-4 max-w-[62ch] text-[14.5px] leading-[1.7] text-[var(--ink-soft)]">
            Every event for the year. Plan events early — they stay closed to registration
            until you open them in the event editor.
          </p>
        </div>
        {canPlan ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setManagingHolidays((v) => !v)}
              aria-expanded={managingHolidays}
              className="inline-flex items-center h-10 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[border-color,color,transform] duration-[var(--dur-fast)]"
            >
              {managingHolidays ? "Close holidays" : "Holidays · 假期"}
            </button>
            <button
              type="button"
              onClick={duplicate}
              disabled={busy}
              className="inline-flex items-center h-10 px-4 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12.5px] text-[var(--ink)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[border-color,color,transform] duration-[var(--dur-fast)]"
            >
              Copy {year} → {year + 1}
            </button>
            <button
              type="button"
              onClick={() => setPlanning((v) => !v)}
              aria-expanded={planning}
              className="inline-flex items-center h-10 px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.04em] uppercase hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,transform] duration-[var(--dur-fast)]"
              style={{ color: "var(--paper-warm)" }}
            >
              {planning ? "Close" : "+ Plan event"}
            </button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] px-4 py-2.5 text-[12.5px] text-[var(--ink-soft)]">
          {notice}
        </div>
      ) : null}

      {planning && canPlan ? (
        <PlanSessionPanel
          holidayIndex={holidayIndex}
          hiddenRegions={hiddenRegions}
          defaultDate={`${year}-${String(month).padStart(2, "0")}-01`}
          onDone={(msg) => {
            setNotice(msg);
            setPlanning(false);
            router.refresh();
          }}
        />
      ) : null}

      {managingHolidays && canPlan ? (
        <HolidaysPanel
          year={year}
          holidays={holidays.filter((h) => h.date.startsWith(`${year}-`))}
          onChanged={(msg) => {
            if (msg) setNotice(msg);
            router.refresh();
          }}
        />
      ) : null}

      {/* Toolbar: year nav, view toggle, type legend */}
      <div className="mt-8 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <NavButton label="Previous" onClick={() => (view === "year" ? go({ year: year - 1 }) : month === 1 ? go({ year: year - 1, month: 12 }) : go({ month: month - 1 }))}>‹</NavButton>
          <div className="font-display text-[26px] tracking-[-0.01em] text-[var(--ink)] tabular-nums min-w-[7ch] text-center">
            {view === "year" ? year : `${MONTHS_EN[month - 1]} ${year}`}
          </div>
          <NavButton label="Next" onClick={() => (view === "year" ? go({ year: year + 1 }) : month === 12 ? go({ year: year + 1, month: 1 }) : go({ month: month + 1 }))}>›</NavButton>
          <div role="group" aria-label="View" className="ml-2 inline-flex rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] p-0.5">
            {(["year", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => go({ view: v })}
                className={`h-8 px-3 whitespace-nowrap rounded-[var(--radius-pill)] text-[12px] focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,color] duration-[var(--dur-fast)] ${
                  view === v ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]" : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
                }`}
              >
                {v === "year" ? "Year · 年" : "Month · 月"}
              </button>
            ))}
          </div>
        </div>
        <Legend
          types={(Object.keys(TYPE_COLOUR) as EventType[]).filter((t) => usedTypes.has(t))}
          hidden={hidden}
          onToggle={toggleType}
          canPlan={canPlan}
          showDrafts={showDrafts}
          setShowDrafts={setShowDrafts}
        />
      </div>

      <div className="mt-3 flex items-center gap-x-3 gap-y-2 flex-wrap text-[11.5px] text-[var(--ink-mute)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[2px]" style={{ background: HOLIDAY_RED }} aria-hidden="true" />
          Public holidays · 公共假期
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {sortHolidayRegions(holidays.filter((h) => h.date.startsWith(`${year}-`)).flatMap((h) => h.regions)).map((r) => {
            const off = hiddenRegions.has(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={!off}
                onClick={() => toggleRegion(r)}
                title={off ? "Show these holidays" : "Hide these holidays"}
                className={`inline-flex items-center h-7 px-2.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] text-[11.5px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.97] transition-[opacity,transform] duration-[var(--dur-fast)] ${
                  off ? "opacity-45 line-through" : "bg-[var(--paper)] text-[var(--ink)]"
                }`}
              >
                {holidayRegionInfo(r).en} · {holidayRegionInfo(r).cn}
              </button>
            );
          })}
        </div>
        {canPlan && !holidays.some((h) => h.date.startsWith(`${year}-`)) ? (
          <button
            type="button"
            onClick={() => setManagingHolidays(true)}
            className="text-[11.5px] underline underline-offset-2 rounded-[var(--radius-sm)] focus-visible:shadow-[var(--shadow-focus)]"
            style={{ color: HOLIDAY_RED }}
          >
            No holidays for {year} yet — add them
          </button>
        ) : (
          <span className="text-[11px] text-[var(--ink-faint)]">
            ≈ Islamic-calendar dates are estimates — confirm against the official gazette.
          </span>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper)]/50 px-6 py-12 text-center">
          <p className="text-[14px] text-[var(--ink-soft)]">Nothing scheduled in {year} yet.</p>
          {canPlan ? (
            <p className="mt-2 text-[12.5px] text-[var(--ink-mute)]">
              Use “+ Plan event”, or copy last year with “Copy {year - 1} → {year}” from {year - 1}.
            </p>
          ) : null}
        </div>
      ) : null}
      {view === "year" ? (
        <YearGrid year={year} today={today} sessions={visible} canOpen={canPlan} holidayIndex={holidayIndex} hiddenRegions={hiddenRegions} onMonth={(m) => go({ view: "month", month: m })} />
      ) : (
        <MonthGrid year={year} month={month} today={today} sessions={visible} canOpen={canPlan} holidayIndex={holidayIndex} hiddenRegions={hiddenRegions} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper)] text-[18px] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-95 transition-[border-color,color,transform] duration-[var(--dur-fast)]"
    >
      {children}
    </button>
  );
}

function Legend({
  types,
  hidden,
  onToggle,
  canPlan,
  showDrafts,
  setShowDrafts,
}: {
  types: EventType[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  canPlan: boolean;
  showDrafts: boolean;
  setShowDrafts: (v: boolean) => void;
}) {
  const chip = (id: string, colour: string, label: string) => {
    const off = hidden.has(id);
    return (
      <button
        key={id}
        type="button"
        aria-pressed={!off}
        onClick={() => onToggle(id)}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--radius-pill)] border text-[11.5px] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.97] transition-[opacity,border-color,transform] duration-[var(--dur-fast)] ${
          off ? "opacity-45 border-[var(--paper-shadow)]" : "border-[var(--paper-shadow)] bg-[var(--paper)]"
        }`}
        title={off ? "Show" : "Hide"}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: colour }} aria-hidden="true" />
        {label}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {types.map((t) => chip(t, TYPE_COLOUR[t], `${TYPE_LABEL[t].en} · ${TYPE_LABEL[t].zh}`))}
      <span className="mx-1 h-4 w-px bg-[var(--paper-shadow)]" aria-hidden="true" />
      <StatusKey />
      {canPlan ? (
        <label className="ml-1 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--ink-mute)] select-none">
          <input type="checkbox" checked={showDrafts} onChange={(e) => setShowDrafts(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--cinnabar)]" />
          Drafts
        </label>
      ) : null}
    </div>
  );
}

function StatusKey() {
  return (
    <span className="inline-flex items-center gap-2.5 text-[11px] text-[var(--ink-mute)]">
      <span className="inline-flex items-center gap-1">
        <Mark colour="var(--ink-soft)" status="planned" /> {STATUS_LABEL.planned.zh}
      </span>
      <span className="inline-flex items-center gap-1">
        <Mark colour="var(--ink-soft)" status="open" /> {STATUS_LABEL.open.zh}
      </span>
    </span>
  );
}

function Mark({ colour, status }: { colour: string; status: CalendarSession["status"] }) {
  if (status === "planned") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px]" style={{ borderColor: colour }} aria-hidden="true" />;
  }
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${status === "closed" ? "opacity-45" : status === "draft" ? "opacity-30" : ""}`}
      style={{ background: colour }}
      aria-hidden="true"
    />
  );
}

function sessionTitle(s: CalendarSession): string {
  return s.title_cn || s.title_en || s.slug;
}

// "8–14" within one month; "31 May – 6 Jun" across months.
function bubbleDates(s: CalendarSession): string {
  if (!s.start_date) return "";
  const a = Number(s.start_date.slice(8, 10));
  const end = s.end_date && s.end_date > s.start_date ? s.end_date : null;
  if (!end) return `${a} ${MONTHS_EN[Number(s.start_date.slice(5, 7)) - 1]}`;
  const b = Number(end.slice(8, 10));
  const ma = MONTHS_EN[Number(s.start_date.slice(5, 7)) - 1];
  const mb = MONTHS_EN[Number(end.slice(5, 7)) - 1];
  return ma === mb ? `${a}–${b} ${ma}` : `${a} ${ma} – ${b} ${mb}`;
}

// Year-view session = a filled bubble tinted with its event-type colour (like a
// Google Calendar event block). Status reads from the edge: planned =
// dashed outline on a lighter tint, open = solid tint, closed = muted,
// draft = faint dashed (Super Admin only).
function SessionRow({
  s,
  canOpen,
  holidayIndex,
}: {
  s: CalendarSession;
  canOpen: boolean;
  holidayIndex: HolidayIndex;
}) {
  const colour = TYPE_COLOUR[s.type] ?? TYPE_COLOUR.other;
  const clash = holidaysIn(s, holidayIndex);
  const dashed = s.status === "planned" || s.status === "draft";
  const style: React.CSSProperties = {
    // 8-digit hex = colour + alpha; TYPE_COLOUR values are #RRGGBB.
    background: `${colour}${s.status === "planned" ? "14" : s.status === "draft" ? "0D" : "24"}`,
    borderColor: `${colour}${dashed ? "A6" : "40"}`,
    borderLeftColor: colour,
  };
  const body = (
    <span
      className={`block rounded-[10px] border border-l-[3px] px-3 py-2 transition-opacity duration-[var(--dur-fast)] ${
        dashed ? "border-dashed" : ""
      } ${canOpen ? "hover:opacity-85" : ""} ${s.status === "draft" ? "opacity-60" : s.status === "closed" ? "opacity-70" : ""}`}
      style={style}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate text-[13px] font-medium leading-[1.35] text-[var(--ink)]">{sessionTitle(s)}</span>
        {clash.length > 0 ? (
          <span
            className="flex-none rounded-[3px] border px-1 text-[9.5px] leading-[1.5]"
            style={{ color: HOLIDAY_RED, borderColor: "rgba(185, 28, 28, 0.4)", background: "#FFFFFFB3" }}
            title={`Overlaps ${clash.map((h) => `${h.name_en} (${shortDate(h.date)})`).join(", ")}`}
          >
            假期 Holiday
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-[11.5px] leading-[1.4] text-[var(--ink-soft)]">
        <span className="tabular-nums">{bubbleDates(s)}</span>
        {s.dates_tentative ? <span className="ml-1 text-[10px] tracking-[0.1em] uppercase text-[var(--cinnabar-deep)]">TBC</span> : null}
        {[s.city, STATUS_LABEL[s.status].zh].filter(Boolean).map((t) => ` · ${t}`).join("")}
      </span>
    </span>
  );
  return canOpen ? (
    <Link href={`/admin/events/${s.id}`} className="block rounded-[10px] focus-visible:shadow-[var(--shadow-focus)]">
      {body}
    </Link>
  ) : (
    body
  );
}

// Consecutive days of one holiday shown as one entry: CNY 6, 7 + 补假 8 →
// "6–8 农历新年". Names lose their "(day 2)" / "(observed)" suffixes.
type HolidayGroup = {
  key: string;
  start: string;
  end: string;
  name_cn: string | null;
  name_en: string;
  regions: HolidayRegion[];
  estimated: boolean;
  parts: CalendarHoliday[];
};

const baseEn = (n: string) => n.replace(/\s*\((day \d+|observed)\)$/i, "").trim();
const baseCn = (n: string | null) => (n ? n.replace(/（[^）]*）$/, "").trim() : null);

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function groupHolidays(list: CalendarHoliday[]): HolidayGroup[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.name_en.localeCompare(b.name_en));
  const out: HolidayGroup[] = [];
  for (const h of sorted) {
    const en = baseEn(h.name_en);
    const g = out.find((x) => x.name_en === en && (x.end === h.date || nextDay(x.end) === h.date));
    if (g) {
      g.end = h.date > g.end ? h.date : g.end;
      g.regions = sortHolidayRegions([...g.regions, ...h.regions]);
      g.estimated ||= h.estimated;
      g.parts.push(h);
    } else {
      out.push({ key: `${h.date}-${en}`, start: h.date, end: h.date, name_cn: baseCn(h.name_cn), name_en: en, regions: [...h.regions], estimated: h.estimated, parts: [h] });
    }
  }
  return out;
}


function HolidayRow({ g, hiddenRegions }: { g: HolidayGroup; hiddenRegions: Set<HolidayRegion> }) {
  const a = Number(g.start.slice(8, 10));
  const b = Number(g.end.slice(8, 10));
  const regions = g.regions.filter((r) => !hiddenRegions.has(r));
  return (
    <div
      className="flex items-center gap-2.5 px-1 py-1"
      title={g.parts.map((p) => `${shortDate(p.date)} · ${p.name_cn ? `${p.name_cn} · ` : ""}${p.name_en}`).join("\n") + (g.estimated ? "\n≈ estimated date (Islamic calendar)" : "")}
    >
      <span
        className="flex-none inline-flex items-center justify-center w-[56px] h-[26px] px-1 rounded-[7px] text-[12px] font-medium tabular-nums"
        style={{ color: HOLIDAY_RED, background: "rgba(185, 28, 28, 0.08)" }}
      >
        {g.estimated ? <span className="mr-px opacity-70">≈</span> : null}
        {a === b ? a : `${a}–${b}`}
      </span>
      <span className="min-w-0 flex-1 leading-[1.3]">
        <span className="block truncate text-[12.5px] text-[var(--ink-soft)]">{g.name_cn || g.name_en}</span>
        {g.name_cn ? <span className="block truncate text-[11px] text-[var(--ink-faint)]">{g.name_en}</span> : null}
      </span>
      <span className="flex-none flex gap-1">
        {regions.map((r) => (
          <span
            key={r}
            className="rounded-full border border-[var(--paper-shadow)] px-1.5 text-[9.5px] leading-[1.6] tracking-[0.04em] text-[var(--ink-mute)]"
            title={holidayRegionInfo(r).en}
          >
            {holidayRegionTag(r)}
          </span>
        ))}
      </span>
    </div>
  );
}

// Which months a session touches (multi-month sessions show in each).
function monthsOf(s: CalendarSession, year: number): number[] {
  if (!s.start_date) return [];
  const startY = Number(s.start_date.slice(0, 4));
  const endIso = s.end_date ?? s.start_date;
  const endY = Number(endIso.slice(0, 4));
  const from = startY < year ? 1 : Number(s.start_date.slice(5, 7));
  const to = endY > year ? 12 : Number(endIso.slice(5, 7));
  const out: number[] = [];
  for (let m = from; m <= to; m += 1) out.push(m);
  return out;
}

function YearGrid({
  year,
  today,
  sessions,
  canOpen,
  holidayIndex,
  hiddenRegions,
  onMonth,
}: {
  year: number;
  today: string;
  sessions: CalendarSession[];
  canOpen: boolean;
  holidayIndex: HolidayIndex;
  hiddenRegions: Set<HolidayRegion>;
  onMonth: (m: number) => void;
}) {
  const byMonth = new Map<number, CalendarSession[]>();
  for (const s of sessions) for (const m of monthsOf(s, year)) byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  const holidaysByMonth = new Map<number, CalendarHoliday[]>();
  for (const [iso, list] of holidayIndex) {
    if (iso.slice(0, 4) !== String(year)) continue;
    const m = Number(iso.slice(5, 7));
    holidaysByMonth.set(m, [...(holidaysByMonth.get(m) ?? []), ...list]);
  }
  const currentMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) : null;

  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {MONTHS_EN.map((name, i) => {
        const m = i + 1;
        const list = byMonth.get(m) ?? [];
        const hols = holidaysByMonth.get(m) ?? [];
        // Sessions and holidays in one date-ordered list.
        const items: Array<{ key: string; date: string; s?: CalendarSession; h?: HolidayGroup }> = [
          ...list.map((s) => ({
            key: `s-${s.id}`,
            // A session carried in from last month sorts first.
            date: s.start_date && Number(s.start_date.slice(5, 7)) === m && s.start_date.startsWith(String(year)) ? s.start_date : "",
            s,
          })),
          ...groupHolidays(hols).map((h) => ({ key: `h-${h.key}`, date: h.start, s: undefined, h })),
        ].sort((a, b) => a.date.localeCompare(b.date) || (a.s ? -1 : 1));
        return (
          <section
            key={m}
            aria-label={`${name} ${year}`}
            className={`rounded-[var(--radius-lg)] border bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-4 min-h-[148px] ${
              m === currentMonth ? "border-[var(--cinnabar)]/45" : "border-[var(--paper-shadow)]"
            }`}
          >
            <button
              type="button"
              onClick={() => onMonth(m)}
              className="w-full flex items-baseline justify-between mb-2 rounded-[var(--radius-sm)] focus-visible:shadow-[var(--shadow-focus)] group"
              title="Open month"
            >
              <span className="font-display text-[19px] tracking-[-0.01em] text-[var(--ink)] group-hover:text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]">
                {name} <span className="text-[13px] text-[var(--ink-mute)]">{m}月</span>
              </span>
              <span className="text-[11px] tabular-nums text-[var(--ink-faint)]">{list.length || ""}</span>
            </button>
            {items.length === 0 ? (
              <p className="text-[11.5px] text-[var(--ink-faint)]">—</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {items.map((it) =>
                  it.s ? (
                    <SessionRow key={it.key} s={it.s} canOpen={canOpen} holidayIndex={holidayIndex} />
                  ) : it.h ? (
                    <HolidayRow key={it.key} g={it.h} hiddenRegions={hiddenRegions} />
                  ) : null,
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  year,
  month,
  today,
  sessions,
  canOpen,
  holidayIndex,
  hiddenRegions,
}: {
  year: number;
  month: number;
  today: string;
  sessions: CalendarSession[];
  canOpen: boolean;
  holidayIndex: HolidayIndex;
  hiddenRegions: Set<HolidayRegion>;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const on = (iso: string) =>
    sessions.filter((s) => s.start_date && s.start_date <= iso && (s.end_date ?? s.start_date) >= iso);

  return (
    <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-[var(--paper-shadow)]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2.5 py-2 text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((iso, i) => {
          const list = iso ? on(iso) : [];
          const hols = iso ? (holidayIndex.get(iso) ?? []) : [];
          return (
            <div
              key={i}
              className={`min-h-[104px] border-b border-r border-[var(--paper-shadow)]/70 p-1.5 ${iso ? "" : "bg-[var(--paper-deep)]/30"}`}
              style={hols.length > 0 ? { background: HOLIDAY_WASH } : undefined}
            >
              {iso ? (
                <div
                  className={`mb-1 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11.5px] tabular-nums ${
                    iso === today ? "bg-[var(--cinnabar)] text-[var(--paper-warm)]" : hols.length > 0 ? "font-medium" : "text-[var(--ink-mute)]"
                  }`}
                  style={iso !== today && hols.length > 0 ? { color: HOLIDAY_RED } : undefined}
                >
                  {Number(iso.slice(8, 10))}
                </div>
              ) : null}
              {hols.map((h) => (
                <div
                  key={h.name_en}
                  className="mb-1 truncate text-[10.5px] leading-[1.35]"
                  style={{ color: HOLIDAY_RED }}
                  title={`${holidayLabel(h)} · ${regionTags(h, hiddenRegions)}${h.estimated ? " · estimated date" : ""}`}
                >
                  {h.estimated ? "≈ " : ""}
                  {h.name_cn || h.name_en}
                  {h.name_cn ? <span className="hidden md:inline opacity-75"> · {h.name_en}</span> : null}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                {list.map((s) => {
                  const colour = TYPE_COLOUR[s.type] ?? TYPE_COLOUR.other;
                  const chip = (
                    <span
                      className={`block truncate rounded-[4px] px-1.5 py-0.5 text-[11px] leading-[1.35] ${
                        s.status === "planned" ? "border border-dashed bg-[var(--paper)]" : "text-white"
                      } ${s.status === "draft" ? "opacity-45" : s.status === "closed" ? "opacity-65" : ""}`}
                      style={s.status === "planned" ? { borderColor: colour, color: colour } : { background: colour }}
                      title={`${sessionTitle(s)} · ${STATUS_LABEL[s.status].en}${s.dates_tentative ? " · dates TBC" : ""}`}
                    >
                      {sessionTitle(s)}
                      {s.dates_tentative ? " · TBC" : ""}
                    </span>
                  );
                  return canOpen ? (
                    <Link key={s.id} href={`/admin/events/${s.id}`} className="block rounded-[4px] focus-visible:shadow-[var(--shadow-focus)] hover:opacity-85 transition-opacity duration-[var(--dur-fast)]">
                      {chip}
                    </Link>
                  ) : (
                    <span key={s.id}>{chip}</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanSessionPanel({
  holidayIndex,
  hiddenRegions,
  defaultDate,
  onDone,
}: {
  holidayIndex: HolidayIndex;
  hiddenRegions: Set<HolidayRegion>;
  defaultDate: string;
  onDone: (msg: string) => void;
}) {
  const [titleCn, setTitleCn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [type, setType] = useState<EventType>("course");
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(defaultDate);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [tbc, setTbc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "h-10 w-full px-3 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[13px] text-[var(--ink)] focus:border-[var(--cinnabar)]/50 focus:outline-none focus:shadow-[var(--shadow-focus)] transition-[border-color,box-shadow] duration-[var(--dur-fast)]";

  async function save() {
    setError(null);
    if (!titleCn.trim() || !start) {
      setError("Enter a Chinese title and a start date.");
      return;
    }
    if (end && end < start) {
      setError("End date is before start date.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/calendar/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title_cn: titleCn.trim(),
          title_en: titleEn.trim() || null,
          type,
          start_date: start,
          end_date: end || null,
          city: city.trim() || null,
          country: country.trim() || null,
          dates_tentative: tbc,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `Failed (${res.status})`);
      onDone(`✓ Planned ${titleCn.trim()} on ${start}${tbc ? " (TBC)" : ""}. Open it from the calendar to add pricing and open registration.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-1)] p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">Title (CN) · 中文名称</span>
          <input className={input} value={titleCn} onChange={(e) => setTitleCn(e.target.value)} placeholder="永不落空的力量" />
        </label>
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">Title (EN) · 英文名称</span>
          <input className={input} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="The Infallible Power" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">Type · 类型</span>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as EventType)}>
            {(Object.keys(TYPE_COLOUR) as EventType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t].en} · {TYPE_LABEL[t].zh}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">Start · 开始</span>
          <input
            type="date"
            className={`${input} font-mono text-[12.5px]`}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (!end || end < e.target.value) setEnd(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">End · 结束</span>
          <input type="date" className={`${input} font-mono text-[12.5px]`} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">City · 城市</span>
          <input className={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Johor Bahru" />
        </label>
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">Country · 国家</span>
          <input className={input} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Malaysia" />
        </label>
        <label className="inline-flex items-center gap-2 h-10 text-[13px] text-[var(--ink-soft)] select-none">
          <input type="checkbox" checked={tbc} onChange={(e) => setTbc(e.target.checked)} className="h-4 w-4 accent-[var(--cinnabar)]" />
          Dates TBC · 日期待定
        </label>
        <div className="lg:col-span-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center h-10 px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12.5px] tracking-[0.04em] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] disabled:opacity-50 transition-[background-color,transform] duration-[var(--dur-fast)]"
            style={{ color: "var(--paper-warm)" }}
          >
            {saving ? "Planning…" : "Plan event"}
          </button>
        </div>
      </div>
      {(() => {
        const clash = start && (!end || end >= start) ? holidaysIn({ start_date: start, end_date: end || null }, holidayIndex) : [];
        return clash.length > 0 ? (
          <p className="mt-3 text-[12.5px]" style={{ color: HOLIDAY_RED }}>
            Overlaps a public holiday:{" "}
            {clash
              .map((h) => `${holidayLabel(h)} (${regionTags(h, hiddenRegions)}, ${shortDate(h.date)}${h.estimated ? ", estimated" : ""})`)
              .join(" · ")}
            . You can still plan it.
          </p>
        ) : null;
      })()}
      {error ? <p className="mt-3 text-[12.5px] text-[var(--cinnabar-deep)]">{error}</p> : null}
      <p className="mt-3 text-[11.5px] text-[var(--ink-faint)]">
        Creates a planned event — visible on the calendar, closed to registration until you set it to Open in the event editor.
      </p>
    </section>
  );
}
