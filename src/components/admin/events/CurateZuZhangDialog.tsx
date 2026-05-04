"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GROUP_CLASS_LABEL,
  ZU_ZHANG_TIER_LABEL,
  requiredLeaderTiers,
} from "@/lib/grouping/types";
import type {
  GroupClass,
  GrowthDimension,
  StudentQualification,
  ZuZhangCoreTrait,
  ZuZhangTier,
} from "@/lib/grouping/types";

// CurateZuZhangDialog
//
// Full-screen modal for batch-curating a per-event 组长 roster. Lets
// admin toggle serving_as_zu_zhang, override per-event tier, and set
// per-event grade for many participants in one save. The shortfall
// panel at the top mirrors what the algorithm would compute against
// the *current* state — admin sees what they need to fix.
//
// Backed by /api/admin/events/[id]/zu-zhang-roster (GET + POST).

type Candidate = {
  enrollment_id: string;
  participant_id: string;
  region_id: string | null;
  name_en: string | null;
  name_cn: string | null;
  status: string;
  serving_as_zu_zhang: boolean;
  zu_zhang_tier_for_event: ZuZhangTier | null;
  zu_zhang_grade_for_event: number | null;
  global_tier: ZuZhangTier | null;
  global_grade: number | null;
  financial_score: number | null;
  influence_score: number | null;
  is_old_student: boolean;
  qualification: StudentQualification | null;
  dimensions: GrowthDimension[];
  core_traits: ZuZhangCoreTrait[];
  has_special_contribution: boolean;
  times_led_groups: number;
};

type Shortfall = {
  group_class: GroupClass;
  k_required: number;
  required_tier: ZuZhangTier;
  required_role: "main" | "auxiliary";
  have: number;
  need: number;
};

type RosterPayload = {
  candidates: Candidate[];
  member_count_by_class: Record<GroupClass, number>;
  k_by_class: Record<GroupClass, number>;
  shortfalls: Shortfall[];
};

type Draft = {
  serving_as_zu_zhang: boolean;
  zu_zhang_tier_for_event: ZuZhangTier | null;
  zu_zhang_grade_for_event: number | null;
};

const TIER_OPTIONS: Array<{ value: ZuZhangTier | ""; label: string }> = [
  { value: "", label: "— Use global" },
  { value: "key_recruitment", label: "重点感召型 · KR" },
  { value: "recruitment", label: "感召型 · Recruitment" },
  { value: "maintenance", label: "维护型 · Maintenance" },
  { value: "auxiliary", label: "辅助 · Auxiliary" },
];

function name(c: Candidate): string {
  const en = c.name_en?.trim();
  const cn = c.name_cn?.trim();
  if (en && cn) return `${en} · ${cn}`;
  return en || cn || "(unnamed)";
}

function effectiveTier(c: Candidate, draft: Draft): ZuZhangTier | null {
  return draft.zu_zhang_tier_for_event ?? c.global_tier;
}
function effectiveGrade(c: Candidate, draft: Draft): number | null {
  return draft.zu_zhang_grade_for_event ?? c.global_grade;
}

export function CurateZuZhangDialog({
  eventId,
  trigger,
}: {
  eventId: string;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RosterPayload | null>(null);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [tierFilter, setTierFilter] = useState<ZuZhangTier | "all" | "serving">(
    "all",
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/zu-zhang-roster`,
          { cache: "no-store" },
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error ?? `load failed (${res.status})`);
        if (cancelled) return;
        setData(payload as RosterPayload);
        const next = new Map<string, Draft>();
        for (const c of payload.candidates as Candidate[]) {
          next.set(c.enrollment_id, {
            serving_as_zu_zhang: c.serving_as_zu_zhang,
            zu_zhang_tier_for_event: c.zu_zhang_tier_for_event,
            zu_zhang_grade_for_event: c.zu_zhang_grade_for_event,
          });
        }
        setDrafts(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  // Keyboard: Esc closes when not saving.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving]);

  const candidates = data?.candidates ?? [];
  const filtered = useMemo(() => {
    if (tierFilter === "all") return candidates;
    if (tierFilter === "serving") {
      return candidates.filter(
        (c) => drafts.get(c.enrollment_id)?.serving_as_zu_zhang,
      );
    }
    return candidates.filter((c) => {
      const draft = drafts.get(c.enrollment_id);
      const tier = draft ? effectiveTier(c, draft) : c.global_tier;
      return tier === tierFilter;
    });
  }, [candidates, tierFilter, drafts]);

  // Compute the shortfall panel against the LIVE drafts (so admin sees
  // it update as they toggle). Keeps the same logic shape as the
  // server's computeRosterShortfalls — pool by tier, divide by demand.
  const liveShortfalls = useMemo(() => {
    if (!data) return [];
    const tierHave: Record<ZuZhangTier, number> = {
      key_recruitment: 0,
      recruitment: 0,
      maintenance: 0,
      auxiliary: 0,
    };
    for (const c of candidates) {
      const draft = drafts.get(c.enrollment_id);
      if (!draft?.serving_as_zu_zhang) continue;
      const tier = effectiveTier(c, draft);
      if (tier) tierHave[tier] += 1;
    }
    const out: Array<{
      group_class: GroupClass;
      tier: ZuZhangTier;
      role: "main" | "auxiliary";
      have: number;
      need: number;
    }> = [];
    for (const cls of [
      "strategic",
      "key",
      "growth",
      "maintenance",
    ] as GroupClass[]) {
      const k = data.k_by_class[cls];
      if (k === 0) continue;
      const { main, auxiliary } = requiredLeaderTiers(cls);
      out.push({ group_class: cls, tier: main, role: "main", have: 0, need: k });
      out.push({
        group_class: cls,
        tier: auxiliary,
        role: "auxiliary",
        have: 0,
        need: k,
      });
    }
    const demandByTier: Record<ZuZhangTier, number> = {
      key_recruitment: 0,
      recruitment: 0,
      maintenance: 0,
      auxiliary: 0,
    };
    for (const r of out) demandByTier[r.tier] += r.need;
    for (const r of out) {
      if (demandByTier[r.tier] === 0) continue;
      r.have = Math.floor(
        (tierHave[r.tier] * r.need) / demandByTier[r.tier],
      );
    }
    return out;
  }, [data, candidates, drafts]);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? {
        serving_as_zu_zhang: false,
        zu_zhang_tier_for_event: null,
        zu_zhang_grade_for_event: null,
      };
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }

  function changedRows(): Array<{
    enrollment_id: string;
    serving_as_zu_zhang?: boolean;
    zu_zhang_tier_for_event?: ZuZhangTier | null;
    zu_zhang_grade_for_event?: number | null;
  }> {
    const out: Array<{
      enrollment_id: string;
      serving_as_zu_zhang?: boolean;
      zu_zhang_tier_for_event?: ZuZhangTier | null;
      zu_zhang_grade_for_event?: number | null;
    }> = [];
    for (const c of candidates) {
      const d = drafts.get(c.enrollment_id);
      if (!d) continue;
      const change: Record<string, unknown> = {};
      if (d.serving_as_zu_zhang !== c.serving_as_zu_zhang) {
        change.serving_as_zu_zhang = d.serving_as_zu_zhang;
      }
      if (d.zu_zhang_tier_for_event !== c.zu_zhang_tier_for_event) {
        change.zu_zhang_tier_for_event = d.zu_zhang_tier_for_event;
      }
      if (d.zu_zhang_grade_for_event !== c.zu_zhang_grade_for_event) {
        change.zu_zhang_grade_for_event = d.zu_zhang_grade_for_event;
      }
      if (Object.keys(change).length > 0) {
        out.push({ enrollment_id: c.enrollment_id, ...change });
      }
    }
    return out;
  }

  async function save() {
    const changes = changedRows();
    if (changes.length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/zu-zhang-roster`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? `Save failed (${res.status})`);
      router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const dirtyCount = changedRows().length;

  return (
    <>
      {trigger(() => setOpen(true))}
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Curate 组长 roster"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setOpen(false);
          }}
        >
          <div className="w-full max-w-[1100px] max-h-[90vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] shadow-[var(--shadow-paper-2)] overflow-hidden">
            <header className="flex items-center justify-between gap-4 px-7 py-5 border-b border-[var(--paper-shadow)]">
              <div>
                <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
                  <span className="w-5 h-px bg-current" />
                  Curate 组长 · 组长名单
                </div>
                <h2 className="mt-1 font-display text-[20px] leading-[1.2] tracking-[-0.005em] text-[var(--ink)]">
                  Per-event leader roster
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                disabled={saving}
                className="text-[var(--ink-mute)] hover:text-[var(--ink)] disabled:opacity-50"
                aria-label="Close"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M5 5l8 8M13 5l-8 8" />
                </svg>
              </button>
            </header>

            <div className="px-7 py-5 border-b border-[var(--paper-shadow)] bg-[var(--paper)]/60">
              {loading ? (
                <p className="text-[12.5px] text-[var(--ink-mute)]">Loading…</p>
              ) : data ? (
                <div className="grid md:grid-cols-2 gap-5">
                  <div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                      Class demand
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {(["strategic", "key", "growth", "maintenance"] as GroupClass[])
                        .filter((cls) => data.k_by_class[cls] > 0)
                        .map((cls) => (
                          <li key={cls}>
                            <span className="inline-flex items-baseline gap-2 px-2.5 py-1 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[11.5px]">
                              <span className="text-[var(--ink)]">
                                {GROUP_CLASS_LABEL[cls].cn}
                              </span>
                              <span className="text-[var(--ink-mute)] tabular-nums">
                                {data.member_count_by_class[cls]}p →{" "}
                                {data.k_by_class[cls]} group
                                {data.k_by_class[cls] === 1 ? "" : "s"}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                      Tier coverage
                    </div>
                    {liveShortfalls.length === 0 ? (
                      <p className="mt-2 text-[12px] text-[var(--ink-mute)]">
                        No demand yet.
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {liveShortfalls.map((r, i) => {
                          const ok = r.have >= r.need;
                          return (
                            <li key={i}>
                              <span
                                className={`inline-flex items-baseline gap-2 px-2.5 py-1 rounded-[var(--radius-pill)] border text-[11.5px] ${
                                  ok
                                    ? "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)]"
                                    : "border-[var(--cinnabar)]/40 bg-[var(--cinnabar-wash)] text-[var(--cinnabar-deep)]"
                                }`}
                                title={`${GROUP_CLASS_LABEL[r.group_class].cn} ${r.role === "main" ? "main" : "aux"} = ${ZU_ZHANG_TIER_LABEL[r.tier].cn}`}
                              >
                                <span>
                                  {GROUP_CLASS_LABEL[r.group_class].short_cn}·
                                  {r.role === "main" ? "主" : "副"}{" "}
                                  {ZU_ZHANG_TIER_LABEL[r.tier].short_cn}
                                </span>
                                <span className="tabular-nums">
                                  {r.have} / {r.need}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-7 py-3 border-b border-[var(--paper-shadow)] flex items-center gap-2 flex-wrap">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--ink-faint)]">
                Filter
              </span>
              {([
                ["all", "All candidates"],
                ["serving", "Serving"],
                ["key_recruitment", "重"],
                ["recruitment", "召"],
                ["maintenance", "维"],
                ["auxiliary", "辅"],
              ] as Array<[ZuZhangTier | "all" | "serving", string]>).map(
                ([v, label]) => {
                  const on = tierFilter === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTierFilter(v)}
                      className={`px-2.5 py-1 rounded-[var(--radius-pill)] border text-[11.5px] tracking-[0.04em] transition-colors duration-[var(--dur-fast)] ${
                        on
                          ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                          : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                },
              )}
              <span className="ml-auto text-[11px] text-[var(--ink-mute)] tabular-nums">
                {filtered.length} shown · {candidates.length} candidates
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {loading ? (
                <p className="px-7 py-6 text-[12.5px] text-[var(--ink-mute)]">
                  Loading…
                </p>
              ) : filtered.length === 0 ? (
                <p className="px-7 py-6 text-[12.5px] text-[var(--ink-mute)]">
                  No candidates match.
                </p>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-[var(--paper-warm)] border-b border-[var(--paper-shadow)] text-[10px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
                    <tr>
                      <th className="text-left px-7 py-2.5 font-medium">Serve</th>
                      <th className="text-left px-3 py-2.5 font-medium">
                        Participant
                      </th>
                      <th className="text-left px-3 py-2.5 font-medium">
                        Tier
                      </th>
                      <th className="text-left px-3 py-2.5 font-medium">
                        Grade
                      </th>
                      <th className="text-left px-7 py-2.5 font-medium">
                        Context
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const d = drafts.get(c.enrollment_id) ?? {
                        serving_as_zu_zhang: c.serving_as_zu_zhang,
                        zu_zhang_tier_for_event: c.zu_zhang_tier_for_event,
                        zu_zhang_grade_for_event: c.zu_zhang_grade_for_event,
                      };
                      const tier = effectiveTier(c, d);
                      const grade = effectiveGrade(c, d);
                      const dirty =
                        d.serving_as_zu_zhang !== c.serving_as_zu_zhang
                        || d.zu_zhang_tier_for_event !== c.zu_zhang_tier_for_event
                        || d.zu_zhang_grade_for_event !== c.zu_zhang_grade_for_event;
                      return (
                        <tr
                          key={c.enrollment_id}
                          className={`border-b border-[var(--paper-shadow)]/60 ${dirty ? "bg-[var(--cinnabar-wash)]/40" : ""}`}
                        >
                          <td className="px-7 py-2">
                            <input
                              type="checkbox"
                              checked={d.serving_as_zu_zhang}
                              onChange={(e) =>
                                update(c.enrollment_id, {
                                  serving_as_zu_zhang: e.target.checked,
                                })
                              }
                              className="accent-[var(--cinnabar)]"
                              aria-label="Serve as 组长"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[10.5px] text-[var(--cinnabar-deep)]">
                                {c.region_id ?? "—"}
                              </span>
                              <span className="text-[12.5px] text-[var(--ink)]">
                                {name(c)}
                              </span>
                              {c.is_old_student ? (
                                <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)] bg-[var(--cinnabar-wash)] px-1.5 py-0.5 rounded-full border border-[var(--cinnabar)]/30">
                                  Old
                                </span>
                              ) : null}
                              {c.has_special_contribution ? (
                                <span
                                  title="特殊贡献"
                                  className="text-[9px] tracking-[0.18em] uppercase text-[var(--gold-deep)] bg-[var(--gold-soft)] px-1.5 py-0.5 rounded-full border border-[var(--gold)]/40"
                                >
                                  特
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={d.zu_zhang_tier_for_event ?? ""}
                              onChange={(e) =>
                                update(c.enrollment_id, {
                                  zu_zhang_tier_for_event:
                                    (e.target.value || null) as
                                      | ZuZhangTier
                                      | null,
                                })
                              }
                              disabled={!d.serving_as_zu_zhang}
                              className="h-7 px-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper)] text-[12px] disabled:opacity-50"
                            >
                              {TIER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.value === ""
                                    ? `${opt.label}${c.global_tier ? ` (${ZU_ZHANG_TIER_LABEL[c.global_tier].short_cn})` : ""}`
                                    : opt.label}
                                </option>
                              ))}
                            </select>
                            {tier ? (
                              <div className="mt-1 text-[10px] text-[var(--ink-faint)]">
                                effective: {ZU_ZHANG_TIER_LABEL[tier].cn}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((n) => {
                                const on = d.zu_zhang_grade_for_event === n;
                                return (
                                  <button
                                    key={n}
                                    type="button"
                                    disabled={!d.serving_as_zu_zhang}
                                    onClick={() =>
                                      update(c.enrollment_id, {
                                        zu_zhang_grade_for_event: on ? null : n,
                                      })
                                    }
                                    className={`w-6 h-6 rounded-full text-[10.5px] tabular-nums border transition-colors duration-[var(--dur-fast)] disabled:opacity-30 ${
                                      on
                                        ? "border-[var(--cinnabar)] bg-[var(--cinnabar)] text-[var(--paper)]"
                                        : "border-[var(--paper-shadow)] bg-[var(--paper)] text-[var(--ink-mute)] hover:border-[var(--cinnabar)]/40"
                                    }`}
                                    aria-label={`Grade ${n}`}
                                  >
                                    {n}
                                  </button>
                                );
                              })}
                            </div>
                            {grade != null && d.zu_zhang_grade_for_event == null ? (
                              <div className="mt-1 text-[10px] text-[var(--ink-faint)]">
                                global: {grade}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-7 py-2 text-[10.5px] text-[var(--ink-mute)]">
                            <div>
                              带组 {c.times_led_groups} ·{" "}
                              {c.qualification ?? "—"} ·{" "}
                              <span className="font-mono">
                                F{c.financial_score ?? "—"}/I{c.influence_score ?? "—"}
                              </span>
                            </div>
                            {c.dimensions.length > 0 ? (
                              <div className="text-[10px] text-[var(--ink-faint)]">
                                {c.dimensions.join(" · ")}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <footer className="flex items-center justify-between gap-4 px-7 py-4 border-t border-[var(--paper-shadow)] bg-[var(--paper)]/60">
              <div className="text-[12px] text-[var(--ink-mute)]">
                {error ? (
                  <span className="text-[var(--cinnabar-deep)]">{error}</span>
                ) : dirtyCount > 0 ? (
                  <>
                    <span className="text-[var(--ink)] tabular-nums">
                      {dirtyCount}
                    </span>{" "}
                    pending change{dirtyCount === 1 ? "" : "s"}
                  </>
                ) : (
                  "No changes yet."
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => !saving && setOpen(false)}
                  disabled={saving}
                  className="h-9 px-3 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--ink)] hover:bg-[var(--paper-deep)] disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || dirtyCount === 0}
                  className={`h-9 px-4 rounded-[var(--radius-pill)] text-[12px] tracking-[0.04em] font-medium ${
                    saving || dirtyCount === 0
                      ? "bg-[var(--paper-deep)] text-[var(--ink-faint)] cursor-not-allowed"
                      : "bg-[var(--cinnabar)] text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)]"
                  }`}
                >
                  {saving ? "Saving…" : `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
