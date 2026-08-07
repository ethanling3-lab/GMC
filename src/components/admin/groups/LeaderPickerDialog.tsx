"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { GroupBuilderLeaderCandidate } from "@/lib/grouping/load-groups";
import {
  GROUP_CLASS_LABEL,
  GROWTH_DIMENSION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  requiredLeaderTiers,
} from "@/lib/grouping/types";
import type {
  GroupClass,
  GrowthDimension,
  ZuZhangTier,
} from "@/lib/grouping/types";

// Phase 3 — direct 组长 pick from the curated roster.
//
// Before this, filling a group's empty leader slot meant three moves across
// two surfaces: hunt the person down in the flat Unassigned pool, + → #N to
// seat them as a plain member, then reopen their row to promote them. The
// pool showed no tier, no grade, no dimensions — nothing you actually pick a
// 组长 on.
//
// This dialog lists the event's curated roster (enrollments.serving_as_zu_zhang)
// ranked against THIS group: required-tier match first, then unseated leaders,
// then grade. One click writes the seat + the role together via the members
// route's `assign_leader` action.
//
// Guards follow the manual-editing convention — advisory here, hard in the
// auto-generator. A tier that doesn't match the group class is flagged, not
// blocked; poaching a leader off another group is flagged, not blocked; only
// a locked group refuses (server-side). The roster filter is likewise a
// default, not a fence: "All enrolled · 全部" widens the list to anyone
// enrolled, marking picks that aren't on the roster.
//
// Portal-mounted on document.body per the dialog-portal convention.

export type LeaderRole = "zu_zhang" | "fu_zu_zhang";

type Props = {
  groupNo: number;
  groupClass: GroupClass;
  groupLabel: string;
  initialRole: LeaderRole;
  // Curated roster (serving: true) merged with everyone else enrolled
  // (serving: false), deduped by participant_id.
  candidates: GroupBuilderLeaderCandidate[];
  // Primary growth goals declared by this group's current members. Used to
  // show how much of the group's demand a candidate's strengths cover.
  groupGoals: GrowthDimension[];
  // Who currently holds each role in this group. 主组长 is a single seat
  // (picking replaces); a group may carry several 副组长 (picking adds).
  currentHolders: { zu_zhang: string | null; fu_zu_zhang: string[] };
  onPick: (participantId: string, role: LeaderRole) => Promise<void>;
  onClose: () => void;
};

const ROLE_LABEL: Record<LeaderRole, { cn: string; en: string }> = {
  zu_zhang: { cn: "主组长", en: "Main leader" },
  fu_zu_zhang: { cn: "副组长", en: "Auxiliary leader" },
};

const TIER_ORDER: Record<ZuZhangTier, number> = {
  key_recruitment: 0,
  recruitment: 1,
  maintenance: 2,
  auxiliary: 3,
};

function candidateName(c: GroupBuilderLeaderCandidate): string {
  const en = c.name_en?.trim();
  const cn = c.name_cn?.trim();
  if (en && cn) return `${cn} · ${en}`;
  return cn || en || c.region_id || "—";
}

export function LeaderPickerDialog({
  groupNo,
  groupClass,
  groupLabel,
  initialRole,
  candidates,
  groupGoals,
  currentHolders,
  onPick,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<LeaderRole>(initialRole);
  const [query, setQuery] = useState("");
  const [rosterOnly, setRosterOnly] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const wantedTier = requiredLeaderTiers(groupClass)[
    role === "zu_zhang" ? "main" : "auxiliary"
  ];

  // Distinct primary goals in this group — a candidate "covers" one when
  // it's among their strength dimensions.
  const goalSet = useMemo(() => new Set(groupGoals), [groupGoals]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = candidates.filter((c) => {
      if (rosterOnly && !c.serving) return false;
      if (!q) return true;
      return (
        (c.region_id ?? "").toLowerCase().includes(q)
        || (c.name_en ?? "").toLowerCase().includes(q)
        || (c.name_cn ?? "").toLowerCase().includes(q)
      );
    });
    return filtered
      .map((c) => {
        const covers = [...goalSet].filter((g) =>
          c.dimensions.includes(g),
        ).length;
        return { c, covers, tierMatch: c.tier === wantedTier };
      })
      .sort((a, b) => {
        // Exact tier pairing for this class+slot is the strongest signal.
        if (a.tierMatch !== b.tierMatch) return a.tierMatch ? -1 : 1;
        // Then leaders who aren't seated anywhere — picking them costs
        // no other group its leader.
        const aFree = a.c.current_group_no == null;
        const bFree = b.c.current_group_no == null;
        if (aFree !== bFree) return aFree ? -1 : 1;
        const ta = a.c.tier ? TIER_ORDER[a.c.tier] : 9;
        const tb = b.c.tier ? TIER_ORDER[b.c.tier] : 9;
        if (ta !== tb) return ta - tb;
        if (a.covers !== b.covers) return b.covers - a.covers;
        const ga = a.c.grade ?? -1;
        const gb = b.c.grade ?? -1;
        if (ga !== gb) return gb - ga;
        return (a.c.region_id ?? "").localeCompare(b.c.region_id ?? "");
      });
  }, [candidates, query, rosterOnly, wantedTier, goalSet]);

  const rosterCount = candidates.filter((c) => c.serving).length;
  // Everyone already holding the picked role here — one for 主, possibly
  // several for 副.
  const heldBy =
    role === "zu_zhang"
      ? currentHolders.zu_zhang
        ? [currentHolders.zu_zhang]
        : []
      : currentHolders.fu_zu_zhang;

  async function pick(participantId: string) {
    if (pending) return;
    setPending(participantId);
    try {
      await onPick(participantId, role);
    } finally {
      setPending(null);
    }
  }

  if (!mounted) return null;

  const content = (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Assign ${ROLE_LABEL[role].cn} for group ${groupNo}`}
        className="w-full max-w-[600px] max-h-[88vh] bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[18px] shadow-[var(--shadow-elevated)] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[var(--paper-deep)] flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
              Assign leader · 指派组长
            </div>
            <div className="mt-1 font-display text-[18px] leading-tight text-[var(--ink)] truncate">
              #{groupNo} {groupLabel}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">
              {GROUP_CLASS_LABEL[groupClass].cn} ·{" "}
              {GROUP_CLASS_LABEL[groupClass].en} — pairs with{" "}
              {ZU_ZHANG_TIER_LABEL[wantedTier].cn}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!pending}
            className="text-[var(--ink-faint)] hover:text-[var(--ink)] disabled:opacity-40 text-[18px] leading-none shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 pt-3 pb-3 border-b border-[var(--paper-deep)]/60 flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5" role="group" aria-label="Leader slot">
            {(["zu_zhang", "fu_zu_zhang"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={`inline-flex items-center h-[26px] px-3 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em] transition-[background-color,color,border-color] duration-[var(--dur-fast)] ${
                  role === r
                    ? "border-[var(--cinnabar)]/50 bg-[var(--cinnabar)] text-[var(--paper)]"
                    : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-soft)] hover:border-[var(--cinnabar)]/40 hover:text-[var(--cinnabar-deep)]"
                }`}
              >
                {ROLE_LABEL[r].cn}
                <span className="ml-1.5 text-[9.5px] opacity-70">
                  {r === "zu_zhang"
                    ? currentHolders.zu_zhang
                      ? "seated"
                      : "empty"
                    : currentHolders.fu_zu_zhang.length > 0
                      ? `${currentHolders.fu_zu_zhang.length} seated`
                      : "empty"}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or ID · 搜索"
              aria-label="Search candidates"
              className="flex-1 min-w-[180px] h-[30px] px-2.5 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
            />
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-soft)] cursor-pointer">
              <input
                type="checkbox"
                checked={!rosterOnly}
                onChange={(e) => setRosterOnly(!e.target.checked)}
                className="accent-[var(--cinnabar)]"
              />
              All enrolled · 全部
            </label>
          </div>
          {role === "zu_zhang" && heldBy.length > 0 ? (
            <p className="text-[11px] text-[var(--ink-faint)]">
              主组长 is a single seat — picking replaces the current one, who
              stays in the group as a member.
            </p>
          ) : role === "fu_zu_zhang" ? (
            <p className="text-[11px] text-[var(--ink-faint)]">
              A group can carry several 副组长 — picking adds one, it doesn&rsquo;t
              replace anyone.
            </p>
          ) : null}
        </div>

        {/* Candidate list */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2.5 min-h-[120px]">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[12.5px] text-[var(--ink-soft)]">
                {rosterOnly && rosterCount === 0
                  ? "No 组长 curated for this event yet."
                  : "No candidates match."}
              </p>
              {rosterOnly ? (
                <p className="mt-1.5 text-[11px] text-[var(--ink-faint)]">
                  {rosterCount === 0
                    ? "Mark people as serving 组长 on the enrolments page, or tick “All enrolled” to pick anyone."
                    : "Tick “All enrolled · 全部” to widen beyond the roster."}
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map(({ c, covers, tierMatch }) => {
                const isHolder = heldBy.includes(c.participant_id);
                const busy = pending === c.participant_id;
                return (
                  <li key={c.participant_id}>
                    <button
                      type="button"
                      disabled={!!pending || isHolder}
                      onClick={() => pick(c.participant_id)}
                      className={`w-full text-left px-3 py-2 rounded-[var(--radius-md)] border transition-[background-color,border-color] duration-[var(--dur-fast)] disabled:cursor-default ${
                        isHolder
                          ? "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)]/50"
                          : "border-transparent hover:border-[var(--paper-shadow)] hover:bg-[var(--paper)] focus-visible:border-[var(--cinnabar)]/50 focus-visible:bg-[var(--paper)]"
                      } ${busy ? "opacity-60" : ""}`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="inline-flex items-baseline gap-2 min-w-0 flex-wrap">
                          <span className="font-mono text-[10px] tabular-nums text-[var(--cinnabar-deep)]">
                            {c.region_id ?? "—"}
                          </span>
                          <span className="text-[12.5px] text-[var(--ink)] truncate">
                            {candidateName(c)}
                          </span>
                          {c.is_old_student ? (
                            <span
                              title="老学员"
                              className="text-[9px] text-[var(--gold-deep)]"
                            >
                              旧
                            </span>
                          ) : null}
                          {isHolder ? (
                            <span className="text-[9.5px] tracking-[0.06em] text-[var(--cinnabar-deep)]">
                              current
                            </span>
                          ) : null}
                        </span>
                        <span className="inline-flex items-center gap-1.5 shrink-0">
                          {c.tier ? (
                            <span
                              className={`inline-flex items-center h-[17px] px-1.5 rounded-[var(--radius-pill)] border text-[9.5px] tracking-[0.04em] ${
                                tierMatch
                                  ? "border-[var(--cinnabar)]/45 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                  : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                              }`}
                              title={`${ZU_ZHANG_TIER_LABEL[c.tier].cn} · ${
                                ZU_ZHANG_TIER_LABEL[c.tier].en
                              }${
                                tierMatch
                                  ? " — matches this slot"
                                  : ` — this slot pairs with ${ZU_ZHANG_TIER_LABEL[wantedTier].cn}`
                              }`}
                            >
                              {ZU_ZHANG_TIER_LABEL[c.tier].cn}
                              {c.grade != null ? (
                                <span className="ml-1 tabular-nums opacity-80">
                                  {c.grade}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center h-[17px] px-1.5 rounded-[var(--radius-pill)] border border-[var(--gold)]/50 bg-[var(--gold-soft)] text-[9.5px] text-[var(--gold-deep)]"
                              title="No 组长 tier set — the auto-generator skips untiered leaders."
                            >
                              no tier
                            </span>
                          )}
                          {c.dimensions.length > 0 ? (
                            <span
                              className="text-[11px]"
                              title={c.dimensions
                                .map((d) => GROWTH_DIMENSION_LABEL[d].cn)
                                .join(" · ")}
                            >
                              {c.dimensions
                                .map((d) => GROWTH_DIMENSION_LABEL[d].icon)
                                .join("")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2.5 flex-wrap text-[10.5px] text-[var(--ink-faint)]">
                        <span>
                          {c.current_group_no == null
                            ? "unassigned · 未编排"
                            : c.current_group_no === groupNo
                              ? `in this group${
                                  c.current_role === "zu_zhang"
                                    ? " · 组长"
                                    : c.current_role === "fu_zu_zhang"
                                      ? " · 副组长"
                                      : ""
                                }`
                              : c.current_role === "zu_zhang"
                                || c.current_role === "fu_zu_zhang"
                                ? `⚠ leads #${c.current_group_no}`
                                : `in #${c.current_group_no}`}
                        </span>
                        {covers > 0 ? (
                          <span title="Growth goals declared in this group that this leader's strengths cover">
                            covers {covers} goal{covers === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {c.times_led_groups > 0 ? (
                          <span>led {c.times_led_groups}×</span>
                        ) : null}
                        {!c.serving ? (
                          <span
                            className="text-[var(--gold-deep)]"
                            title="Not on this event's curated 组长 roster."
                          >
                            not curated
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
