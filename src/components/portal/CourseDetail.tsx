"use client";

import Link from "next/link";
import { useState } from "react";
import type { CourseDetail as CourseDetailData } from "@/lib/course-portal-types";
import type { LeaderGroupReportItem } from "@/lib/group-report-portal-types";
import { AssignmentSubmit } from "@/components/portal/AssignmentSubmit";

type Tab = "overview" | "content" | "assignment" | "groups";

const TABS: Array<{ key: Tab; en: string; cn: string }> = [
  { key: "overview", en: "Overview", cn: "概览" },
  { key: "content", en: "Content", cn: "内容" },
  { key: "assignment", en: "Assignment", cn: "作业" },
  { key: "groups", en: "Groups", cn: "小组" },
];

function formatDuration(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (end && end !== start) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start);
}

export function CourseDetail({
  detail,
  groupReports,
}: {
  detail: CourseDetailData;
  groupReports: LeaderGroupReportItem[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const { event, assignments, recordings } = detail;

  const title = event.title_cn ?? event.title_en ?? event.slug;
  const alt = event.title_cn && event.title_en ? event.title_en : null;
  const dateRange = formatDateRange(event.start_date, event.end_date);
  const body = event.body_cn ?? event.body_en ?? null;

  const submittedCount = assignments.filter((a) => a.mine?.status === "submitted").length;

  return (
    <div>
      <h1 className="mt-4 font-display text-[26px] md:text-[30px] leading-[1.15] tracking-[-0.015em] text-[var(--ink)]">
        {title}
      </h1>
      {alt ? <div className="mt-1 text-[14px] italic text-[var(--ink-soft)]">{alt}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--ink-mute)]">
        {dateRange ? <span className="tabular-nums">{dateRange}</span> : null}
        {event.venue ? <span>{event.venue}</span> : null}
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b border-[var(--paper-shadow)]">
        <div role="tablist" aria-label="Course sections" className="flex gap-6">
          {TABS.map((t) => {
            const active = tab === t.key;
            const badge =
              t.key === "content"
                ? recordings.length
                : t.key === "assignment"
                  ? assignments.length
                  : t.key === "groups"
                    ? groupReports.length
                    : 0;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t.key)}
                className={`group relative -mb-px pb-3 pt-1 text-[13.5px] tracking-[0.01em] transition-colors duration-[var(--dur-fast)] focus-visible:outline-none ${
                  active ? "text-[var(--ink)]" : "text-[var(--ink-mute)] hover:text-[var(--ink-soft)]"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {t.en}
                  <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                    {t.cn}
                  </span>
                  {badge > 0 ? (
                    <span className="tabular-nums text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--paper-deep)] text-[var(--ink-mute)]">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`absolute left-0 right-0 bottom-0 h-[2px] rounded-full transition-transform duration-[var(--dur-fast)] ${
                    active ? "bg-[var(--cinnabar)] scale-x-100" : "bg-transparent scale-x-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels */}
      <div className="mt-6">
        {tab === "overview" ? (
          <div className="max-w-[68ch]">
            {body ? (
              <p className="text-[13.5px] leading-[1.7] text-[var(--ink-soft)] whitespace-pre-wrap">
                {body}
              </p>
            ) : (
              <p className="text-[13.5px] leading-[1.7] text-[var(--ink-mute)]">
                No description for this course yet. 暂无课程简介。
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60">
                {recordings.length} recordings · 录像
              </span>
              <span className="text-[11px] tracking-[0.1em] uppercase text-[var(--ink-mute)] px-2.5 py-1.5 rounded-[var(--radius-pill)] bg-[var(--paper-deep)]/60">
                {submittedCount}/{assignments.length} submitted · 已交
              </span>
            </div>
          </div>
        ) : null}

        {tab === "content" ? (
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mb-3">
              Recordings · 录像
            </div>
            {recordings.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-6 text-center text-[13px] text-[var(--ink-mute)]">
                No recordings shared with you for this course yet. 暂无录像。
              </div>
            ) : (
              <ul className="space-y-3">
                {recordings.map((r) => {
                  const rt = r.title_cn ?? r.title_en ?? "Recording";
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/me/recordings/${r.id}`}
                        className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 hover:-translate-y-0.5 transition-transform duration-[var(--dur-fast)] shadow-[var(--shadow-paper-1)]"
                        style={{ color: "inherit" }}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)] flex-none">
                            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                              <path d="M6.5 5v8l6-4z" fill="currentColor" />
                            </svg>
                          </span>
                          <span className="font-display text-[15px] text-[var(--ink)] truncate">{rt}</span>
                        </span>
                        <span className="text-[11px] tracking-[0.12em] uppercase text-[var(--ink-mute)] tabular-nums flex-none">
                          {formatDuration(r.duration_seconds)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {tab === "assignment" ? (
          <div>
            {assignments.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-6 text-center text-[13px] text-[var(--ink-mute)]">
                No assignments for this course yet. 暂无作业。
              </div>
            ) : (
              <div className="space-y-5">
                {assignments.map((a) => (
                  <AssignmentSubmit key={a.id} assignment={a} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "groups" ? (
          <div>
            {groupReports.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] p-6 text-center text-[13px] text-[var(--ink-mute)]">
                Your group and any report to fill will appear here. 你的小组与需填写的报告会显示在这里。
              </div>
            ) : (
              <div>
                <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] mb-3">
                  Group reports · 小组报告
                </div>
                <ul className="space-y-3">
                  {groupReports.map((r) => {
                    const statusLabel =
                      r.status === "submitted"
                        ? "Submitted · 已提交"
                        : r.status === "draft"
                          ? "Draft saved · 草稿"
                          : "Not started · 未开始";
                    const tone =
                      r.status === "submitted"
                        ? "bg-[#5b9a5d]/12 text-[#3a6b3b]"
                        : r.status === "draft"
                          ? "bg-[var(--paper-deep)] text-[var(--ink-mute)]"
                          : "bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]";
                    return (
                      <li key={r.group_id}>
                        <Link
                          href={`/me/group/${r.group_id}`}
                          className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-4 hover:-translate-y-0.5 transition-transform duration-[var(--dur-fast)] shadow-[var(--shadow-paper-1)]"
                          style={{ color: "inherit" }}
                        >
                          <span className="font-display text-[15px] text-[var(--ink)]">
                            Group {r.group_no} · 第 {r.group_no} 组
                          </span>
                          <span className={`flex-none text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-[var(--radius-pill)] ${tone}`}>
                            {statusLabel}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
