"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UNGROUPED_GROUP_ID } from "@/lib/check-in/types";
import { EVENT_TZ, dayLabel, shortDate, type DayOption } from "@/lib/check-in/day";
import { SESSIONS, SESSION_LABEL, sessionOf, type Session } from "@/lib/check-in/mode";
import type { CheckInSnapshot } from "@/lib/check-in/check-in-query";
import { GroupCompletionCard } from "./GroupCompletionCard";
import { AbsenteeRow } from "./AbsenteeRow";
import { DeskScanner } from "./DeskScanner";
import { ModeBar } from "./ModeBar";
import { OutOfClassPanel } from "./OutOfClassPanel";
import { CheckInSettings } from "./CheckInSettings";
import { groupNumber } from "@/lib/group-number";
import { useCenterSelected } from "@/lib/check-in/use-center-selected";

// One-stop check-in page for ONE event day: the organizer's mode bar, the
// headcount for both registrations, the desk scanner (camera + manual
// search), then "who's still missing, and in which group" for the session
// being viewed, and the out-of-class log. Badges are pre-sorted into group
// piles, so groups are listed in the order of the number on the pile.
// Every desk runs this same page; it polls every 5s so desks see each
// other's scans and the organizer's mode switches, and refreshes at once
// after its own.

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventTitleCn: string | null;
  /** "8–14 Apr" — shown when desks are locked outside the event dates. */
  eventDatesLabel: string;
  days: DayOption[];
  day: string;
  /** super_admin / regional_lead: may switch mode and change settings. */
  canRun: boolean;
  initial: CheckInSnapshot;
};

const POLL_MS = 5000;

export function CheckInClient({
  eventId,
  eventSlug,
  eventTitle,
  eventTitleCn,
  eventDatesLabel,
  days,
  day,
  canRun,
  initial,
}: Props) {
  const [snap, setSnap] = useState<CheckInSnapshot>(initial);
  const [viewSession, setViewSession] = useState<Session>(initial.session);
  // Follow the desks: when the organizer moves into the other session, the
  // panels follow — unless someone here picked a session by hand.
  const pickedSessionRef = useRef(false);
  const shownModeRef = useRef(initial.desk.mode);
  const dayRowRef = useCenterSelected<HTMLElement>('[aria-current="page"]', day);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const { stats, recent, groups, absent, desk, bySession, outNow, exitTotals } = snap;
  const today = desk.today;

  const refresh = useCallback(
    async (session: Session = viewSession) => {
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/check-in?view=day&day=${day}&session=${session}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as CheckInSnapshot;
        const modeMoved = shownModeRef.current !== json.desk.mode;
        shownModeRef.current = json.desk.mode;
        setSnap(json);
        // Organizer moved into the other session on the live day → follow.
        const live = sessionOf(json.desk.mode);
        if (
          modeMoved &&
          day === json.desk.today &&
          !pickedSessionRef.current &&
          live !== json.session
        ) {
          setViewSession(live);
          void refreshRef.current(live);
        }
      } catch {
        // Silent — next poll retries.
      }
    },
    [eventId, day, viewSession],
  );
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const refreshNow = useCallback(() => void refreshRef.current(), []);

  useEffect(() => {
    const t = window.setInterval(() => void refreshRef.current(), POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  const pickSession = (s: Session) => {
    pickedSessionRef.current = true;
    setViewSession(s);
    setGroupFilter(null);
    void refresh(s);
  };

  const pct =
    stats.total_eligible === 0
      ? 0
      : Math.round((stats.total_checked_in / stats.total_eligible) * 100);
  const remaining = Math.max(0, stats.total_eligible - stats.total_checked_in);
  const isToday = day === today;
  const sessionL = SESSION_LABEL[stats.session ?? viewSession];

  const realGroups = groups.filter((g) => g.group_id !== UNGROUPED_GROUP_ID);
  const groupsComplete = realGroups.filter(
    (g) => g.expected_count > 0 && g.checked_in_count >= g.expected_count,
  ).length;

  const selectedGroup = groups.find((g) => g.group_id === groupFilter) ?? null;
  const visibleAbsent = useMemo(() => {
    const q = query.trim().toLowerCase();
    return absent.filter((r) => {
      if (selectedGroup) {
        const same =
          selectedGroup.group_id === UNGROUPED_GROUP_ID
            ? r.group_no === null
            : r.group_no === selectedGroup.group_no;
        if (!same) return false;
      }
      if (!q) return true;
      return [r.name_cn, r.name_en, r.region_id, r.phone]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [absent, query, selectedGroup]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            <span className="w-5 h-px bg-current" />
            Check-in · 签到 · {eventSlug}
          </div>
          <h1 className="mt-2 font-display text-[30px] md:text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
            {eventTitle}
            {eventTitleCn ? (
              <span className="ml-3 text-[var(--ink-mute)] text-[22px] md:text-[26px]">
                {eventTitleCn}
              </span>
            ) : null}
          </h1>
        </div>
      </div>

      {/* Day switcher */}
      {days.length > 1 ? (
        <nav ref={dayRowRef} aria-label="Event day" className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
          {days.map((d) => {
            const active = d.day === day;
            return (
              <Link
                key={d.day}
                href={`?day=${d.day}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)] border text-[12.5px] whitespace-nowrap focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ${
                  active
                    ? "bg-[var(--cinnabar)] border-[var(--cinnabar)] text-[var(--paper)]"
                    : "bg-[var(--paper)] border-[var(--paper-shadow)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]"
                }`}
                style={{ color: active ? "var(--paper)" : undefined }}
              >
                <span className="font-medium">{dayLabel(d)}</span>
                {d.index !== null ? (
                  <span className={active ? "opacity-80" : "text-[var(--ink-faint)]"}>
                    {shortDate(d.day)}
                  </span>
                ) : null}
                {d.day === today ? (
                  <span className={active ? "opacity-80" : "text-[var(--cinnabar)]"}>· today</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/* Test mode: everything recorded is a rehearsal */}
      {desk.testMode ? (
        <div
          role="status"
          className="rounded-[var(--radius-card)] border border-[var(--gold-deep,#A87A2A)]/50 px-5 py-3 text-[13px] text-[var(--ink)]"
          style={{
            background:
              "repeating-linear-gradient(135deg, rgba(168,122,42,0.10) 0 10px, transparent 10px 20px)",
          }}
        >
          <strong className="font-semibold tracking-[0.04em]">TEST MODE · 测试模式</strong>
          <span className="text-[var(--ink-soft)]">
            {" "}
            — desks can scan on any day and every record is marked as test. Clear them in
            Check-in settings before the event.
          </span>
        </div>
      ) : null}

      {/* Live desk mode */}
      {isToday ? (
        <ModeBar
          eventId={eventId}
          mode={desk.mode}
          canRun={canRun}
          outNowCount={outNow.length}
          onChanged={refreshNow}
        />
      ) : null}

      {/* Headcount */}
      <section className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="text-[12px] text-[var(--ink-mute)]">
            {sessionL.en} arrived · {sessionL.cn}已到
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[56px] md:text-[64px] leading-none tracking-[-0.03em] text-[var(--ink)] tabular-nums">
              {stats.total_checked_in}
            </span>
            <span className="text-[18px] text-[var(--ink-faint)] tabular-nums">
              / {stats.total_eligible}
            </span>
            <span className="ml-2 inline-flex items-center h-[24px] px-2.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[11.5px] font-medium tabular-nums">
              {pct}%
            </span>
          </div>
        </div>
        {SESSIONS.filter((s) => s !== stats.session).map((s) => (
          <Figure
            key={s}
            label={`${SESSION_LABEL[s].en} · ${SESSION_LABEL[s].cn}`}
            value={`${bySession[s].arrived} / ${bySession[s].expected}`}
          />
        ))}
        <Figure label="Not here yet · 未到" value={remaining} />
        {isToday ? <Figure label="Out now · 目前在外" value={outNow.length} /> : null}
        <Figure
          label="Groups complete · 小组到齐"
          value={`${groupsComplete} / ${realGroups.length}`}
        />
        {stats.unpaid_overrides > 0 ? (
          <Figure label="Let in unpaid · 未付款放行" value={stats.unpaid_overrides} tone="warn" />
        ) : null}
      </section>

      {/* Desk: camera + manual search. Only scans for today. */}
      <DeskScanner
        eventId={eventId}
        desk={desk}
        eventDatesLabel={eventDatesLabel}
        active={isToday}
        todayHref={`?day=${today}`}
        onCheckedIn={refreshNow}
        listVersion={`${bySession.am.arrived}.${bySession.pm.arrived}:${outNow.map((o) => o.exit_id).join(",")}`}
      />

      {canRun ? (
        <CheckInSettings
          eventId={eventId}
          testMode={desk.testMode}
          onChanged={refreshNow}
        />
      ) : null}

      {/* Which registration the panels below are about */}
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Session" className="inline-flex p-1 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]">
        {SESSIONS.map((s) => {
          const active = s === viewSession;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => pickSession(s)}
              className={`inline-flex items-center gap-2 h-9 px-4 rounded-[var(--radius-pill)] text-[13px] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px transition-[background-color,color,transform] duration-[var(--dur-fast)] ${
                active
                  ? "bg-[var(--paper)] text-[var(--ink)] font-medium shadow-[var(--shadow-paper)]"
                  : "text-[var(--ink-mute)] hover:text-[var(--ink)]"
              }`}
            >
              {SESSION_LABEL[s].en} · {SESSION_LABEL[s].cn}
              <span className="text-[11.5px] text-[var(--ink-faint)] tabular-nums">
                {bySession[s].arrived}/{bySession[s].expected}
              </span>
            </button>
          );
        })}
      </div>
        {canRun ? (
          <a
            href={`/api/admin/events/${eventId}/check-in/export.xlsx?day=${day}`}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-shadow)] text-[12.5px] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[border-color,color,transform] duration-[var(--dur-fast)]"
            style={{ color: "var(--ink-soft)" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
            </svg>
            Export Excel · 导出
          </a>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 items-start">
        {/* Groups */}
        <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
          <PanelHead
            title="Groups · 小组"
            meta="Tap a group to see who's missing"
          />
          <div className="px-4 pb-4 max-h-[560px] overflow-y-auto">
            {groups.length === 0 ? (
              <Empty>No groups yet · 未分组</Empty>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                {groups.map((g) => {
                  const selected = g.group_id === groupFilter;
                  return (
                    <button
                      key={g.group_id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setGroupFilter(selected ? null : g.group_id)}
                      className={`text-left rounded-[12px] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px transition-[transform,box-shadow] duration-[var(--dur-fast)] ${
                        selected ? "shadow-[0_0_0_2px_var(--cinnabar)]" : "hover:shadow-[0_0_0_1px_var(--cinnabar)]"
                      }`}
                    >
                      <GroupCompletionCard row={g} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Not yet here */}
        <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
          <PanelHead
            title="Not here yet · 未到场"
            meta={`${visibleAbsent.length} of ${absent.length}`}
          />
          <div className="px-5 pb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, region ID or phone"
              aria-label="Search people not here yet"
              className="flex-1 min-w-[200px] h-10 px-3.5 rounded-[10px] bg-[var(--paper)] border border-[var(--paper-shadow)] text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            />
            {selectedGroup ? (
              <button
                type="button"
                onClick={() => setGroupFilter(null)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/30 text-[12.5px] text-[var(--cinnabar-deep)] hover:bg-[var(--cinnabar)]/15 active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform] duration-[var(--dur-fast)]"
              >
                {selectedGroup.group_id === UNGROUPED_GROUP_ID
                  ? "Ungrouped"
                  : groupNumber(selectedGroup).en}
                <span aria-hidden="true">×</span>
                <span className="sr-only">Clear group filter</span>
              </button>
            ) : null}
          </div>
          {absent.length === 0 ? (
            <Empty>Everyone&apos;s here · 全员到齐</Empty>
          ) : visibleAbsent.length === 0 ? (
            <Empty>No one matches · 无匹配</Empty>
          ) : (
            <ul className="divide-y divide-[var(--paper-deep)]/70 max-h-[520px] overflow-y-auto border-t border-[var(--paper-deep)]/70">
              {visibleAbsent.map((row) => (
                <AbsenteeRow key={row.enrollment_id} row={row} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <OutOfClassPanel outNow={outNow} totals={exitTotals} isToday={isToday} />

      {/* Recent */}
      <section className="bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[var(--radius-card)] shadow-[var(--shadow-paper)] overflow-hidden">
        <PanelHead title="Latest arrivals · 最新签到" meta={recent.length ? "Last 20" : ""} />
        {recent.length === 0 ? (
          <Empty>No {sessionL.en.toLowerCase()} check-ins yet · 还没有签到</Empty>
        ) : (
          <ul className="divide-y divide-[var(--paper-deep)]/70 border-t border-[var(--paper-deep)]/70">
            {recent.map((r) => (
              <li
                key={r.enrollment_id + r.checked_in_at}
                className="px-5 py-2.5 flex items-center gap-3 text-[13px]"
              >
                <span className="inline-flex items-center justify-center h-[22px] min-w-[52px] px-2 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[11px] font-medium text-[var(--ink-mute)] tabular-nums">
                  {r.region_id ?? "—"}
                </span>
                <span className="font-medium text-[var(--ink)] flex-1 min-w-0 truncate">
                  {r.name_cn ?? r.name_en ?? "(unnamed)"}
                </span>
                {r.unpaid_override ? (
                  <span className="inline-flex items-center h-[20px] px-2 rounded-full bg-[var(--gold,#C99B47)]/20 text-[11px] text-[var(--ink-soft)]">
                    Unpaid · 未付款
                  </span>
                ) : null}
                <span className="text-[12px] text-[var(--ink-soft)] tabular-nums">
                  {groupNumber(r).no !== null ? groupNumber(r).en : "No group"}
                </span>
                <span className="w-[44px] text-right text-[12px] text-[var(--ink-faint)] tabular-nums">
                  {formatTime(r.checked_in_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn";
}) {
  return (
    <div>
      <div className="text-[12px] text-[var(--ink-mute)]">{label}</div>
      <div
        className={`mt-1 font-display text-[30px] leading-none tracking-[-0.02em] tabular-nums ${
          tone === "warn" ? "text-[var(--gold-deep,#A87A2A)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function PanelHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-medium text-[var(--ink)]">{title}</h2>
      {meta ? <div className="text-[12px] text-[var(--ink-faint)] tabular-nums">{meta}</div> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-[13px] text-[var(--ink-faint)]">{children}</div>
  );
}

// Pinned to the event's zone: this renders on the server (UTC on Netlify) and
// again in the browser, and the two must agree or React flags a mismatch.
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: EVENT_TZ,
    });
  } catch {
    return "—";
  }
}
