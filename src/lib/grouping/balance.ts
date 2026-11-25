// Class-bucketed grouping for table-mode events — the ONLY placement
// engine (grouping rework, 2026-11-24). Deterministic: the same input
// always gives the same output. No AI.
//
// Rule order (higher wins):
//   1. Language (listening_language, migration 074) — HARD, universal:
//      whoever listens in a language is grouped under a 组长 who speaks it.
//      The default language (中文) is grouped by type as below; every other
//      language gets its own groups ACROSS types (a group's type = its most
//      common member type).
//   2. Group type (特级 / 重点 / 成长 / 维护) from qualification — HARD
//      within a language.
//   3. Family & conflict splits — HARD.
//   4. CS-suggested 组长 (participant_suggested_leaders, first = preferred):
//      if a suggested leader leads a group of the student's language (and,
//      for 中文, type) with room, the student goes there.
//   5. Main goal (goal_dimensions[0]) covered by the 主 or 副组长's
//      strengths, whenever a group with room covers it.
//   6. Stronger students → higher-grade leaders: students are ranked by
//      qualification then scores, groups by main-leader grade, and each
//      student aims for the group at their rank.
//   7. Second goal covered — tie-break.
//   8. Core traits — display-only until Yi Suan confirms the pairing.
//   9. Energy / 老新 mix — soft swaps.
//
// Balancing swaps may never break rules 1–6: suggested placements and
// pins never move, and a swap must keep both students' goal coverage and
// stay between groups whose main-leader grades differ by at most 1.
//
// Caution-flagged people (sells_products = 注意：可能拉保险/直销/传销) are
// NOT auto-placed. They stay unassigned and the admin places them by hand
// from the Unassigned pool. A pin still places them (the admin's call).
//
// Tier gap: when a group lacks its required 组长 tier, the best leader
// from the next tier down is borrowed (then further down, then up), and a
// warning names the group. Language beats tier: a speaker of another tier
// is borrowed before a non-speaker, and a non-speaker raises
// `language_leader_missing`.
//
// Every placement carries a rule-based reason. Reasons are written into
// the group rationale as "• <region_id> — <reason>" lines; the groups
// page shows them on each member's detail row.
//
// Pure function. No DB. Caller persists.

import { applyCuratedRoles } from "./roles";
import {
  GROUP_CLASS_LABEL,
  GROWTH_DIMENSION_LABEL,
  STUDENT_QUALIFICATION_LABEL,
  ZU_ZHANG_TIER_LABEL,
  effectiveQualification,
  participantToClass,
  requiredLeaderTiers,
} from "./types";
import type {
  DraftGroup,
  GroupClass,
  GroupingConfig,
  GroupingParticipant,
  GroupingResult,
  GroupingWarning,
  GroupingZuZhang,
  GrowthDimension,
  RosterShortfall,
  ZuZhangTier,
} from "./types";
import {
  DEFAULT_LANGUAGE,
  languageLabel,
  speaks,
  type ClassLanguage,
} from "../participants/languages";

type Reason = { en: string; cn: string };

type WorkingGroup = {
  group_no: number;
  group_class: GroupClass;
  language: ClassLanguage;
  main_zu_zhang: GroupingZuZhang | null;
  auxiliary_zu_zhang: GroupingZuZhang | null;
  members: GroupingParticipant[];
  borrowed: Array<{
    role: "main" | "auxiliary";
    wanted: ZuZhangTier;
    got: ZuZhangTier;
    // The borrowed leader doesn't speak the group's language.
    language_missing: boolean;
  }>;
};

type Ctx = {
  familyChains: Map<string, string>;
  conflictChains: Map<string, string>;
  // Students that must not move during balancing: pins + CS suggestions.
  locked: Set<string>;
  // Fixed reasons (pins, suggestions, surplus leaders).
  reasons: Map<string, Reason>;
  // Placement notes for everyone else; the goal/grade part of the reason
  // is written from the FINAL group, after balancing swaps.
  notes: Map<string, Reason[]>;
};

// Students grouped for seeding: the default language by type, every
// other language as one cohort each (keyed by language code).
type Cohorts = {
  main: Record<GroupClass, GroupingParticipant[]>;
  other: Map<string, GroupingParticipant[]>;
};

// A set of groups placed together: one type of 中文 groups, or all the
// groups of one other language.
type PlacementSet = {
  language: ClassLanguage;
  cls: GroupClass | null;
  groups: WorkingGroup[];
  students: GroupingParticipant[];
};

export type BalanceOptions = {
  // group_no values held by protected (locked / hand-edited) groups.
  // Fresh groups skip them so pins (which use the numbers the admin
  // sees) land in the right group.
  reserved_group_nos?: number[];
};

const CLASS_ORDER: GroupClass[] = ["strategic", "key", "growth", "maintenance"];
const TIER_LADDER: ZuZhangTier[] = [
  "key_recruitment",
  "recruitment",
  "maintenance",
  "auxiliary",
];

// Other languages in seeding priority: fewest speaking 组长 first, so
// bilingual leaders go where they're scarcest. Ties by code.
function otherLanguagesBySpeakerScarcity(
  cohorts: Cohorts,
  roster: GroupingZuZhang[],
): string[] {
  const speakers = (lang: string) =>
    roster.filter((z) => speaks(z.spoken_languages, lang)).length;
  return [...cohorts.other.keys()].sort(
    (a, b) => speakers(a) - speakers(b) || a.localeCompare(b),
  );
}

// Group numbering order for other languages: by code, stable.
function otherLanguagesInOrder(cohorts: Cohorts): string[] {
  return [...cohorts.other.keys()].sort();
}

export function balance(
  participants: GroupingParticipant[],
  roster: GroupingZuZhang[],
  config: GroupingConfig,
  options: BalanceOptions = {},
): GroupingResult {
  const n = participants.length;
  if (n === 0) {
    return {
      strategy: "balance",
      groups: [],
      cushion_assignments: [],
      metadata: { n: 0, k: 0 },
    };
  }

  const reserved = new Set(options.reserved_group_nos ?? []);
  const rosterPids = new Set(roster.map((z) => z.participant_id));
  const regular = participants.filter((p) => !rosterPids.has(p.participant_id));

  // Caution-flagged + unpinned → left for manual placement.
  const manual = regular.filter((p) => p.sells_products && p.pinned_group_no == null);
  const manualPids = new Set(manual.map((p) => p.participant_id));
  const auto = regular.filter((p) => !manualPids.has(p.participant_id));

  // Each group seats the leader pair + this many regular members.
  const regularCapacity = Math.max(1, config.group_size_max - 2);

  // Seed groups. Leaders left over after every slot is filled are demoted
  // to regular members (in their own listening language) — which can
  // raise a group count, which needs more leaders. Iterate to a fixed
  // point (converges in 1–2 rounds in practice).
  let demoted: GroupingZuZhang[] = [];
  let seeded = seedGroups(roster, buildCohorts(auto, demoted), regularCapacity, reserved);
  for (let round = 0; round < 4; round += 1) {
    if (seeded.leftover.length === demoted.length) break;
    demoted = seeded.leftover;
    seeded = seedGroups(roster, buildCohorts(auto, demoted), regularCapacity, reserved);
  }
  const groups = seeded.groups;
  const cohorts = buildCohorts(auto, seeded.leftover);

  const shortfalls = computeRosterShortfalls(roster, seeded.kByClass);

  const ctx: Ctx = {
    familyChains: buildFamilyChains(participants),
    conflictChains: buildConflictChains(participants),
    locked: new Set(),
    reasons: new Map(),
    notes: new Map(),
  };
  for (const z of seeded.leftover) {
    ctx.reasons.set(z.participant_id, {
      en: `surplus ${ZU_ZHANG_TIER_LABEL[z.tier].en} leader, seated as a member`,
      cn: `${ZU_ZHANG_TIER_LABEL[z.tier].cn}组长有余，作为组员入座`,
    });
  }

  // Leader → group, and region_id lookups for reasons.
  const groupByLeader = new Map<string, WorkingGroup>();
  for (const g of groups) {
    if (g.main_zu_zhang) groupByLeader.set(g.main_zu_zhang.participant_id, g);
    if (g.auxiliary_zu_zhang) groupByLeader.set(g.auxiliary_zu_zhang.participant_id, g);
  }
  const regionByPid = new Map<string, string | null>();
  for (const p of participants) regionByPid.set(p.participant_id, p.region_id);
  for (const z of roster) regionByPid.set(z.participant_id, z.region_id);

  // Placement sets: each type of the default language, then each other
  // language.
  const sets: PlacementSet[] = [
    ...CLASS_ORDER.map((cls) => ({
      language: DEFAULT_LANGUAGE as ClassLanguage,
      cls,
      groups: groups.filter((g) => g.language === DEFAULT_LANGUAGE && g.group_class === cls),
      students: cohorts.main[cls],
    })),
    ...otherLanguagesInOrder(cohorts).map((lang) => ({
      language: lang,
      cls: null,
      groups: groups.filter((g) => g.language === lang),
      students: cohorts.other.get(lang) ?? [],
    })),
  ];

  // Pins first — they use the group numbers the admin sees.
  const groupByNo = new Map(groups.map((g) => [g.group_no, g]));
  for (const set of sets) {
    const unpinned: GroupingParticipant[] = [];
    for (const p of set.students) {
      const pinned = p.pinned_group_no != null ? groupByNo.get(p.pinned_group_no) : undefined;
      if (pinned) {
        pinned.members.push(p);
        ctx.locked.add(p.participant_id);
        ctx.reasons.set(p.participant_id, {
          en: `pinned to #${pinned.group_no} by admin`,
          cn: `管理员指定第 ${pinned.group_no} 组`,
        });
      } else {
        unpinned.push(p);
      }
    }
    set.students = unpinned;
  }

  for (const set of sets) {
    if (set.groups.length === 0) continue;
    placeSet(set, config.group_size_max, ctx, groupByLeader, regionByPid);

    // Hard repairs (only fire after an overflow fallback).
    repairChainSplit(set.groups, ctx, "family");
    repairChainSplit(set.groups, ctx, "conflict");
    // Soft mixes — guarded so they never break rules 4–6.
    repairOldStudentMix(set.groups, ctx);
    repairEnergyDistribution(set.groups, ctx);
  }

  // Warnings: missing language speakers, borrowed tiers, leaderless groups.
  const warnings: GroupingWarning[] = [];
  for (const g of groups) {
    if (g.members.length === 0) continue;
    const where_en = `#${g.group_no} ${groupLabel(g, "en")}`;
    const where_cn = `第 ${g.group_no} 组（${groupLabel(g, "cn")}）`;
    for (const b of g.borrowed) {
      const role_cn = b.role === "main" ? "主组长" : "副组长";
      if (b.language_missing) {
        warnings.push({
          code: "language_leader_missing",
          group_no: g.group_no,
          detail_en: `${where_en}: no ${languageLabel(g.language).native}-speaking ${role_cn} — seated one who doesn't speak it`,
          detail_cn: `${where_cn}：没有会说${languageLabel(g.language).cn}的${role_cn}`,
        });
      }
      if (b.got !== b.wanted) {
        warnings.push({
          code: "tier_borrowed",
          group_no: g.group_no,
          detail_en: `${where_en}: ${role_cn} is ${ZU_ZHANG_TIER_LABEL[b.got].en} (needs ${ZU_ZHANG_TIER_LABEL[b.wanted].en})`,
          detail_cn: `${where_cn}：${role_cn}借用${ZU_ZHANG_TIER_LABEL[b.got].cn}（应为${ZU_ZHANG_TIER_LABEL[b.wanted].cn}）`,
        });
      }
    }
    if (!g.main_zu_zhang && !roster.some((z) => speaks(z.spoken_languages, g.language))) {
      warnings.push({
        code: "language_leader_missing",
        group_no: g.group_no,
        detail_en: `${where_en}: no 组长 at this event speaks ${languageLabel(g.language).native}`,
        detail_cn: `${where_cn}：本场没有会说${languageLabel(g.language).cn}的组长`,
      });
    }
    if (!g.main_zu_zhang) {
      warnings.push({
        code: "no_leader",
        group_no: g.group_no,
        detail_en: `${where_en}: no 组长 available`,
        detail_cn: `${where_cn}：没有可用组长`,
      });
    }
  }

  const drafts: DraftGroup[] = groups
    .filter((g) => g.members.length > 0)
    .map((g) => ({
      group_no: g.group_no,
      group_class: g.group_class,
      language: g.language,
      leader_participant_id: g.main_zu_zhang?.participant_id ?? null,
      members: applyCuratedRoles(g),
      rationale_en: writeRationale(g, ctx, "en"),
      rationale_cn: writeRationale(g, ctx, "cn"),
    }));

  return {
    strategy: "balance",
    groups: drafts,
    cushion_assignments: [],
    metadata: {
      n,
      k: drafts.length,
      roster_shortfalls: shortfalls.length > 0 ? shortfalls : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      manual_placement: manual.map((p) => ({
        participant_id: p.participant_id,
        region_id: p.region_id,
      })),
    },
  };
}

function groupLabel(g: WorkingGroup, lang: "en" | "cn"): string {
  const cls = GROUP_CLASS_LABEL[g.group_class][lang];
  if (g.language === DEFAULT_LANGUAGE) return cls;
  const l = languageLabel(g.language);
  return lang === "en" ? `${l.en} · ${cls}` : `${l.cn}组 · ${cls}`;
}

// =============================================================================
// Cohorts + seeding
// =============================================================================

function buildCohorts(auto: GroupingParticipant[], demoted: GroupingZuZhang[]): Cohorts {
  const cohorts: Cohorts = {
    main: { strategic: [], key: [], growth: [], maintenance: [] },
    other: new Map(),
  };
  const add = (p: GroupingParticipant) => {
    const lang = p.listening_language || DEFAULT_LANGUAGE;
    if (lang === DEFAULT_LANGUAGE) {
      cohorts.main[participantToClass(p)].push(p);
    } else {
      const list = cohorts.other.get(lang) ?? [];
      list.push(p);
      cohorts.other.set(lang, list);
    }
  };
  for (const p of auto) add(p);
  for (const z of demoted) add(demotedLeaderAsMember(z));
  return cohorts;
}

// The most common type among a language group's members (ties → the
// stronger type). Decides its leader tiers and floor-plan zone.
function modeClass(members: GroupingParticipant[]): GroupClass {
  const count: Record<GroupClass, number> = { strategic: 0, key: 0, growth: 0, maintenance: 0 };
  for (const m of members) count[participantToClass(m)] += 1;
  let best: GroupClass = "growth";
  let bestN = 0;
  for (const cls of CLASS_ORDER) {
    if (count[cls] > bestN) {
      best = cls;
      bestN = count[cls];
    }
  }
  return best;
}

function seedGroups(
  roster: GroupingZuZhang[],
  cohorts: Cohorts,
  regularCapacity: number,
  reserved: Set<number>,
): {
  groups: WorkingGroup[];
  leftover: GroupingZuZhang[];
  kByClass: Record<GroupClass, number>;
} {
  const kByClass: Record<GroupClass, number> = {
    strategic: 0,
    key: 0,
    growth: 0,
    maintenance: 0,
  };

  // Group shells, numbered default language by type first, then each
  // other language.
  const shells: Array<{ language: ClassLanguage; cls: GroupClass }> = [];
  for (const cls of CLASS_ORDER) {
    const k = Math.ceil(cohorts.main[cls].length / regularCapacity);
    for (let i = 0; i < k; i += 1) shells.push({ language: DEFAULT_LANGUAGE, cls });
  }
  for (const lang of otherLanguagesInOrder(cohorts)) {
    const cohort = [...(cohorts.other.get(lang) ?? [])].sort(compareStrength);
    const k = Math.ceil(cohort.length / regularCapacity);
    // Strongest students first, dealt into k near-equal chunks; each
    // chunk's most common type becomes that group's type.
    let start = 0;
    for (let i = 0; i < k; i += 1) {
      const size = Math.floor(cohort.length / k) + (i < cohort.length % k ? 1 : 0);
      shells.push({ language: lang, cls: modeClass(cohort.slice(start, start + size)) });
      start += size;
    }
  }

  const groups: WorkingGroup[] = [];
  let nextNo = 1;
  for (const s of shells) {
    while (reserved.has(nextNo)) nextNo += 1;
    kByClass[s.cls] += 1;
    groups.push({
      group_no: nextNo,
      group_class: s.cls,
      language: s.language,
      main_zu_zhang: null,
      auxiliary_zu_zhang: null,
      members: [],
      borrowed: [],
    });
    nextNo += 1;
  }

  // Seeding order: other languages (scarcest speakers first), then the
  // default language strongest type first, so the best leaders of a tier
  // go to the strongest students.
  const seedSets: WorkingGroup[][] = [
    ...otherLanguagesBySpeakerScarcity(cohorts, roster).map((lang) =>
      groups.filter((g) => g.language === lang),
    ),
    ...CLASS_ORDER.map((cls) =>
      groups.filter((g) => g.language === DEFAULT_LANGUAGE && g.group_class === cls),
    ),
  ].filter((set) => set.length > 0);
  const ordered = seedSets.flat();

  const pool = bucketRosterByTier(roster);

  // Pass 1 — exact tier AND speaks the language. Within a set: all mains,
  // then all auxiliaries.
  for (const set of seedSets) {
    for (const g of set) {
      g.main_zu_zhang = popPreferringDimensionSpread(
        pool,
        requiredLeaderTiers(g.group_class).main,
        g.language,
        set.filter((x) => x.main_zu_zhang && x.group_class === g.group_class),
      );
    }
    for (const g of set) {
      g.auxiliary_zu_zhang = popPreferringDimensionSpread(
        pool,
        requiredLeaderTiers(g.group_class).auxiliary,
        g.language,
        g.main_zu_zhang ? [{ main_zu_zhang: g.main_zu_zhang }] : [],
      );
    }
  }

  // Pass 2 — borrow another tier that speaks the language.
  // Pass 3 — nobody speaks it: borrow anyone, flagged.
  for (const speakingOnly of [true, false]) {
    for (const role of ["main", "auxiliary"] as const) {
      for (const g of ordered) {
        const seat = role === "main" ? "main_zu_zhang" : "auxiliary_zu_zhang";
        if (g[seat]) continue;
        const wanted = requiredLeaderTiers(g.group_class)[role];
        const got = borrowFrom(pool, wanted, speakingOnly ? g.language : null);
        if (!got) continue;
        g[seat] = got;
        g.borrowed.push({
          role,
          wanted,
          got: got.tier,
          language_missing: !speaks(got.spoken_languages, g.language),
        });
      }
    }
  }

  const leftover = TIER_LADDER.flatMap((t) => pool[t]);
  return { groups, leftover, kByClass };
}

// The wanted tier first (pass 2 only — pass 1 already took exact-tier
// speakers), then next tier down, further down, then the closest tier up.
// `language` null = anyone.
function borrowFrom(
  pool: Record<ZuZhangTier, GroupingZuZhang[]>,
  wanted: ZuZhangTier,
  language: ClassLanguage | null,
): GroupingZuZhang | null {
  const idx = TIER_LADDER.indexOf(wanted);
  const order = [
    wanted,
    ...TIER_LADDER.slice(idx + 1),
    ...TIER_LADDER.slice(0, idx).reverse(),
  ];
  for (const t of order) {
    const i = pool[t].findIndex((z) => language == null || speaks(z.spoken_languages, language));
    if (i >= 0) return pool[t].splice(i, 1)[0];
  }
  return null;
}

function demotedLeaderAsMember(z: GroupingZuZhang): GroupingParticipant {
  return {
    participant_id: z.participant_id,
    region_id: z.region_id,
    overall_score: null,
    influence_score: null,
    financial_score: null,
    motivations: [],
    motivation_other: null,
    sells_products: false,
    is_old_student: false,
    family_of_participant_id: null,
    family_member_ids: [],
    region: null,
    pinned_group_no: null,
    goal_dimensions: z.dimensions,
    student_qualification_override: null,
    energy_profile: null,
    language_fluency: null,
    conflict_member_ids: [],
    suggested_leader_ids: [],
    listening_language: z.listening_language,
  };
}

// =============================================================================
// Placement within one set (a 中文 type, or one other language)
// =============================================================================

function placeSet(
  set: PlacementSet,
  groupSizeMax: number,
  ctx: Ctx,
  groupByLeader: Map<string, WorkingGroup>,
  regionByPid: Map<string, string | null>,
): void {
  const students = set.students;
  const classGroups = set.groups;

  // Rule 5 — rank groups by main-leader grade (best first) and students
  // by strength (strongest first). A student's target is the group at the
  // same relative rank.
  const rankedGroups = [...classGroups].sort(
    (a, b) =>
      grade(b.main_zu_zhang) - grade(a.main_zu_zhang)
      || grade(b.auxiliary_zu_zhang) - grade(a.auxiliary_zu_zhang)
      || a.group_no - b.group_no,
  );
  const groupRank = new Map(rankedGroups.map((g, i) => [g.group_no, i]));
  const byStrength = [...students].sort(compareStrength);
  const target = new Map<string, number>();
  byStrength.forEach((p, i) => {
    target.set(
      p.participant_id,
      Math.floor((i * classGroups.length) / Math.max(1, byStrength.length)),
    );
  });

  // Placement order: CS suggestions first (they claim specific seats),
  // then students with a goal, then students with no goal — strongest
  // first within each so they get first pick of the top groups.
  const tierOf = (p: GroupingParticipant) =>
    p.suggested_leader_ids.length > 0 ? 0 : p.goal_dimensions.length > 0 ? 1 : 2;
  const order = [...byStrength].sort((a, b) => tierOf(a) - tierOf(b));

  const seats = (g: WorkingGroup) =>
    (g.main_zu_zhang ? 1 : 0) + (g.auxiliary_zu_zhang ? 1 : 0) + g.members.length;
  const hasRoom = (g: WorkingGroup) => seats(g) < groupSizeMax;

  for (const p of order) {
    const notes: Reason[] = [];
    const safe = (g: WorkingGroup) => !createsHardConflict(p, g, ctx);

    // Rule 3 — CS-suggested 组长.
    let placed: WorkingGroup | null = null;
    for (const leaderId of p.suggested_leader_ids) {
      const name = regionByPid.get(leaderId) ?? "suggested 组长";
      const g = groupByLeader.get(leaderId);
      if (!g) {
        notes.push({
          en: `suggested ${name} is not leading at this event`,
          cn: `建议组长 ${name} 本场未带组`,
        });
        continue;
      }
      if (g.language !== set.language) {
        notes.push({
          en: `suggested ${name} leads a ${languageLabel(g.language).en} group, student listens in ${languageLabel(set.language).en}`,
          cn: `建议组长 ${name} 带${languageLabel(g.language).cn}组，学员听${languageLabel(set.language).cn}`,
        });
        continue;
      }
      if (set.cls && g.group_class !== set.cls) {
        const cls = set.cls;
        notes.push({
          en: `suggested ${name} leads ${GROUP_CLASS_LABEL[g.group_class].short_cn}, student is ${GROUP_CLASS_LABEL[cls].short_cn}`,
          cn: `建议组长 ${name} 带${GROUP_CLASS_LABEL[g.group_class].cn}，学员属${GROUP_CLASS_LABEL[cls].cn}`,
        });
        continue;
      }
      if (!hasRoom(g)) {
        notes.push({ en: `suggested ${name}'s group is full`, cn: `建议组长 ${name} 的组已满` });
        continue;
      }
      if (!safe(g)) {
        notes.push({
          en: `suggested ${name}'s group has family / a conflict pair`,
          cn: `建议组长 ${name} 的组有家人或冲突对象`,
        });
        continue;
      }
      placed = g;
      g.members.push(p);
      ctx.locked.add(p.participant_id);
      ctx.reasons.set(p.participant_id, {
        en: [`CS-suggested 组长 ${name}`, ...notes.map((x) => x.en)].join(" · "),
        cn: [`客服建议组长 ${name}`, ...notes.map((x) => x.cn)].join(" · "),
      });
      break;
    }
    if (placed) continue;

    // Rules 4 + 5.
    let candidates = classGroups.filter((g) => hasRoom(g) && safe(g));
    let overflow = false;
    if (candidates.length === 0) {
      candidates = classGroups.filter(hasRoom);
      if (candidates.length === 0) {
        candidates = [...classGroups];
        overflow = true;
      }
      notes.push({ en: "no clean seat — check family / size", cn: "无合适空位，请检查家人/人数" });
    }

    const goal = p.goal_dimensions[0] ?? null;
    if (goal) {
      const covering = candidates.filter((g) => coverer(g, goal));
      if (covering.length > 0) {
        candidates = covering;
      } else {
        notes.push({
          en: `no group with room covers ${GROWTH_DIMENSION_LABEL[goal].en}`,
          cn: `没有可覆盖${GROWTH_DIMENSION_LABEL[goal].cn}的空位`,
        });
      }
    }

    const t = target.get(p.participant_id) ?? 0;
    // Tie-break: a group whose leaders also cover the second goal.
    const second = p.goal_dimensions[1] ?? null;
    const coversSecond = (g: WorkingGroup) => (second && coverer(g, second) ? 0 : 1);
    const pick = [...candidates].sort(
      (a, b) =>
        Math.abs((groupRank.get(a.group_no) ?? 0) - t)
          - Math.abs((groupRank.get(b.group_no) ?? 0) - t)
        || coversSecond(a) - coversSecond(b)
        || seats(a) - seats(b)
        || a.group_no - b.group_no,
    )[0];
    pick.members.push(p);
    if (overflow) notes.push({ en: "group over size", cn: "超出人数上限" });
    ctx.notes.set(p.participant_id, notes);
  }
}

// Goal + grade reason for a student in their final group.
function placementReason(p: GroupingParticipant, g: WorkingGroup, notes: Reason[]): Reason {
  const parts: Reason[] = [];
  const goal = p.goal_dimensions[0] ?? null;
  const by = goal ? coverer(g, goal) : null;
  if (goal && by) {
    parts.push({
      en: `main goal ${GROWTH_DIMENSION_LABEL[goal].en} ✓ ↔ ${by.region_id ?? "组长"}`,
      cn: `主要目标${GROWTH_DIMENSION_LABEL[goal].cn} ✓ ↔ ${by.region_id ?? "组长"}`,
    });
  } else if (!goal) {
    parts.push({ en: "no goal set", cn: "未填成长方向" });
  }
  const second = p.goal_dimensions[1] ?? null;
  const by2 = second ? coverer(g, second) : null;
  if (second && by2) {
    parts.push({
      en: `2nd goal ${GROWTH_DIMENSION_LABEL[second].en} ✓`,
      cn: `次要目标${GROWTH_DIMENSION_LABEL[second].cn} ✓`,
    });
  }
  const q = effectiveQualification(p);
  const lg = g.main_zu_zhang?.grade;
  parts.push({
    en: `${q ? STUDENT_QUALIFICATION_LABEL[q].en : "unscored"} → ${lg != null ? `grade-${lg}` : "ungraded"} leader`,
    cn: `${q ? STUDENT_QUALIFICATION_LABEL[q].cn : "未评分"} → ${lg != null ? `${lg} 级` : "未定级"}组长`,
  });
  const all = [...parts, ...notes];
  return { en: all.map((x) => x.en).join(" · "), cn: all.map((x) => x.cn).join(" · ") };
}

function grade(z: GroupingZuZhang | null): number {
  return z?.grade ?? 0;
}

function strengthScore(p: GroupingParticipant): [number, number, number] {
  const q = effectiveQualification(p);
  const fin = p.financial_score ?? 0;
  const inf = p.influence_score ?? 0;
  return [q ? STUDENT_QUALIFICATION_LABEL[q].score : 0, Math.max(fin, inf), fin + inf];
}

function compareStrength(a: GroupingParticipant, b: GroupingParticipant): number {
  const sa = strengthScore(a);
  const sb = strengthScore(b);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i];
  }
  return (a.region_id ?? a.participant_id).localeCompare(b.region_id ?? b.participant_id);
}

// The 主组长 if they cover the goal, else the 副组长, else null.
function coverer(g: WorkingGroup, goal: GrowthDimension): GroupingZuZhang | null {
  if (g.main_zu_zhang?.dimensions.includes(goal)) return g.main_zu_zhang;
  if (g.auxiliary_zu_zhang?.dimensions.includes(goal)) return g.auxiliary_zu_zhang;
  return null;
}

// =============================================================================
// Balancing swaps
// =============================================================================

// May `p` move from group `from` to group `to` without breaking rules 3–5?
function softMoveOk(p: GroupingParticipant, from: WorkingGroup, to: WorkingGroup, ctx: Ctx): boolean {
  if (ctx.locked.has(p.participant_id)) return false;
  if (p.pinned_group_no != null) return false;
  if (Math.abs(grade(from.main_zu_zhang) - grade(to.main_zu_zhang)) > 1) return false;
  const goal = p.goal_dimensions[0];
  if (goal && coverer(from, goal) && !coverer(to, goal)) return false;
  return true;
}

function softSwapOk(
  a: GroupingParticipant,
  ga: WorkingGroup,
  b: GroupingParticipant,
  gb: WorkingGroup,
  ctx: Ctx,
): boolean {
  return (
    softMoveOk(a, ga, gb, ctx)
    && softMoveOk(b, gb, ga, ctx)
    && !createsHardConflict(a, gb, ctx, b)
    && !createsHardConflict(b, ga, ctx, a)
  );
}

// Family / conflict repair. Hard rules outrank goal and grade, so these
// swaps only respect pins + suggestions, not the soft guards.
function repairChainSplit(classGroups: WorkingGroup[], ctx: Ctx, kind: "family" | "conflict"): void {
  const chains = kind === "family" ? ctx.familyChains : ctx.conflictChains;
  for (let swaps = 0; swaps < 100; swaps += 1) {
    let fixed = false;
    for (const g of classGroups) {
      const seen = new Set<string>();
      let clash: GroupingParticipant | null = null;
      for (const m of g.members) {
        const c = chains.get(m.participant_id);
        if (!c) continue;
        if (seen.has(c) && !ctx.locked.has(m.participant_id)) {
          clash = m;
          break;
        }
        seen.add(c);
      }
      if (!clash) continue;
      for (const other of classGroups) {
        if (other === g) continue;
        const partner = other.members.find(
          (m) =>
            !ctx.locked.has(m.participant_id)
            && !createsHardConflict(clash!, other, ctx, m)
            && !createsHardConflict(m, g, ctx, clash!),
        );
        if (partner) {
          swapMembers(g, other, clash, partner);
          fixed = true;
          break;
        }
      }
      if (fixed) break;
    }
    if (!fixed) return;
  }
}

// No group is 100% new students while old students remain in the type.
function repairOldStudentMix(classGroups: WorkingGroup[], ctx: Ctx): void {
  for (const g of classGroups) {
    if (g.members.some((m) => m.is_old_student)) continue;
    const donors = classGroups
      .filter((c) => c !== g && c.members.filter((m) => m.is_old_student).length >= 2)
      .sort(
        (a, b) =>
          b.members.filter((m) => m.is_old_student).length
          - a.members.filter((m) => m.is_old_student).length,
      );
    let done = false;
    for (const donor of donors) {
      for (const os of donor.members.filter((m) => m.is_old_student)) {
        const out = g.members.find((m) => !m.is_old_student && softSwapOk(os, donor, m, g, ctx));
        if (out) {
          swapMembers(donor, g, os, out);
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
}

// Spread high / medium / quiet energy evenly (soft).
function repairEnergyDistribution(classGroups: WorkingGroup[], ctx: Ctx): void {
  if (classGroups.length < 2) return;
  const k = classGroups.length;
  const kinds = ["high", "medium", "quiet"] as const;
  const count = (g: WorkingGroup, b: (typeof kinds)[number]) =>
    g.members.filter((m) => m.energy_profile === b).length;
  const cap = Object.fromEntries(
    kinds.map((b) => [b, Math.ceil(classGroups.reduce((s, g) => s + count(g, b), 0) / k)]),
  ) as Record<(typeof kinds)[number], number>;

  for (let swaps = 0; swaps < 30; swaps += 1) {
    let moved = false;
    for (const b of kinds) {
      for (const donor of classGroups) {
        if (count(donor, b) <= cap[b]) continue;
        for (const receiver of classGroups) {
          if (receiver === donor || count(receiver, b) >= cap[b]) continue;
          let pair: [GroupingParticipant, GroupingParticipant] | null = null;
          for (const out of donor.members.filter((m) => m.energy_profile === b)) {
            const inn = receiver.members.find(
              (m) => m.energy_profile !== b && softSwapOk(out, donor, m, receiver, ctx),
            );
            if (inn) {
              pair = [out, inn];
              break;
            }
          }
          if (pair) {
            swapMembers(donor, receiver, pair[0], pair[1]);
            moved = true;
            break;
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) return;
  }
}

// Would `candidate` joining `group` put two members of one family or
// conflict chain together? `leaving` (a swap partner) is ignored.
function createsHardConflict(
  candidate: GroupingParticipant,
  group: WorkingGroup,
  ctx: Ctx,
  leaving?: GroupingParticipant,
): boolean {
  const others = group.members.filter(
    (m) => m.participant_id !== candidate.participant_id && m.participant_id !== leaving?.participant_id,
  );
  const fam = ctx.familyChains.get(candidate.participant_id);
  if (fam && others.some((m) => ctx.familyChains.get(m.participant_id) === fam)) return true;
  const con = ctx.conflictChains.get(candidate.participant_id);
  if (con && others.some((m) => ctx.conflictChains.get(m.participant_id) === con)) return true;
  return false;
}

function swapMembers(
  ga: WorkingGroup,
  gb: WorkingGroup,
  fromGa: GroupingParticipant,
  fromGb: GroupingParticipant,
): void {
  ga.members = ga.members.filter((m) => m.participant_id !== fromGa.participant_id);
  gb.members = gb.members.filter((m) => m.participant_id !== fromGb.participant_id);
  ga.members.push(fromGb);
  gb.members.push(fromGa);
}

// =============================================================================
// Roster shortfalls — exported so the groups page can preview requirements
// without running the whole algorithm.
// =============================================================================

export function computeRosterShortfalls(
  roster: Array<Pick<GroupingZuZhang, "tier">>,
  kByClass: Record<GroupClass, number>,
): RosterShortfall[] {
  const required: Array<{
    group_class: GroupClass;
    k_required: number;
    tier: ZuZhangTier;
    role: "main" | "auxiliary";
  }> = [];
  for (const cls of CLASS_ORDER) {
    const k = kByClass[cls];
    if (k === 0) continue;
    const { main, auxiliary } = requiredLeaderTiers(cls);
    required.push({ group_class: cls, k_required: k, tier: main, role: "main" });
    required.push({ group_class: cls, k_required: k, tier: auxiliary, role: "auxiliary" });
  }

  const haveByTier: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const z of roster) haveByTier[z.tier] += 1;

  const demandByTier: Record<ZuZhangTier, number> = {
    key_recruitment: 0,
    recruitment: 0,
    maintenance: 0,
    auxiliary: 0,
  };
  for (const r of required) demandByTier[r.tier] += r.k_required;

  const shortfalls: RosterShortfall[] = [];
  for (const r of required) {
    const totalDemand = demandByTier[r.tier];
    if (totalDemand === 0) continue;
    const share = Math.floor((haveByTier[r.tier] * r.k_required) / totalDemand);
    if (share < r.k_required) {
      shortfalls.push({
        group_class: r.group_class,
        k_required: r.k_required,
        required_tier: r.tier,
        required_role: r.role,
        have: share,
        need: r.k_required,
      });
    }
  }
  return shortfalls;
}

// =============================================================================
// Helpers
// =============================================================================

function bucketRosterByTier(roster: GroupingZuZhang[]): Record<ZuZhangTier, GroupingZuZhang[]> {
  const out: Record<ZuZhangTier, GroupingZuZhang[]> = {
    key_recruitment: [],
    recruitment: [],
    maintenance: [],
    auxiliary: [],
  };
  for (const z of roster) out[z.tier].push(z);
  // Highest grade first; region_id for determinism.
  for (const tier of TIER_LADDER) {
    out[tier].sort(
      (a, b) =>
        (b.grade ?? 0) - (a.grade ?? 0)
        || (a.region_id ?? a.participant_id).localeCompare(b.region_id ?? b.participant_id),
    );
  }
  return out;
}

// Pick a 组长 of `tier` who speaks `language`, preferring one whose
// strengths add dimensions the comparison groups don't cover yet; ties go
// to the higher grade (the pool is grade-sorted).
function popPreferringDimensionSpread(
  bucket: Record<ZuZhangTier, GroupingZuZhang[]>,
  tier: ZuZhangTier,
  language: ClassLanguage,
  comparisonGroups: Array<{ main_zu_zhang: GroupingZuZhang | null }>,
): GroupingZuZhang | null {
  const pool = bucket[tier];
  const seen = new Set<GrowthDimension>();
  for (const g of comparisonGroups) {
    for (const d of g.main_zu_zhang?.dimensions ?? []) seen.add(d);
  }
  let bestIndex = -1;
  let bestNew = -1;
  let bestGrade = -1;
  for (let i = 0; i < pool.length; i += 1) {
    if (!speaks(pool[i].spoken_languages, language)) continue;
    const fresh = pool[i].dimensions.filter((d) => !seen.has(d)).length;
    const g = pool[i].grade ?? 0;
    if (fresh > bestNew || (fresh === bestNew && g > bestGrade)) {
      bestNew = fresh;
      bestGrade = g;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  const [picked] = pool.splice(bestIndex, 1);
  return picked;
}

// Connected components over family edges (legacy single edge + join table).
function buildFamilyChains(participants: GroupingParticipant[]): Map<string, string> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const p of participants) {
    if (p.family_of_participant_id) link(p.participant_id, p.family_of_participant_id);
    for (const o of p.family_member_ids) link(p.participant_id, o);
  }
  return components(participants, adj);
}

function buildConflictChains(participants: GroupingParticipant[]): Map<string, string> {
  const adj = new Map<string, Set<string>>();
  for (const p of participants) {
    for (const o of p.conflict_member_ids) {
      if (o === p.participant_id) continue;
      if (!adj.has(p.participant_id)) adj.set(p.participant_id, new Set());
      if (!adj.has(o)) adj.set(o, new Set());
      adj.get(p.participant_id)!.add(o);
      adj.get(o)!.add(p.participant_id);
    }
  }
  return components(participants, adj);
}

function components(
  participants: GroupingParticipant[],
  adj: Map<string, Set<string>>,
): Map<string, string> {
  const chains = new Map<string, string>();
  for (const p of participants) {
    if (chains.has(p.participant_id) || !adj.has(p.participant_id)) continue;
    const root = p.participant_id;
    const queue = [root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (chains.has(cur)) continue;
      chains.set(cur, root);
      for (const next of adj.get(cur) ?? []) if (!chains.has(next)) queue.push(next);
    }
  }
  return chains;
}

// =============================================================================
// Rationale — a summary line, then one "• <region_id> — <reason>" line per
// placed student. The groups page splits these back out.
// =============================================================================

function writeRationale(g: WorkingGroup, ctx: Ctx, lang: "en" | "cn"): string {
  const cls = groupLabel(g, lang === "en" ? "en" : "cn");
  const main = g.main_zu_zhang;
  const tier = main ? ZU_ZHANG_TIER_LABEL[main.tier][lang] : null;
  const dims = new Set<GrowthDimension>([
    ...(main?.dimensions ?? []),
    ...(g.auxiliary_zu_zhang?.dimensions ?? []),
  ]);
  const dimText = [...dims].map((d) => GROWTH_DIMENSION_LABEL[d][lang]).join(" / ");
  const old = g.members.filter((m) => m.is_old_student).length;
  const fresh = g.members.length - old;
  const borrowed = g.borrowed.flatMap((b) => {
    const out: string[] = [];
    if (b.language_missing) {
      out.push(
        lang === "en"
          ? `⚠ ${b.role === "main" ? "Main" : "Auxiliary"} leader doesn't speak ${languageLabel(g.language).en}.`
          : `⚠ ${b.role === "main" ? "主组长" : "副组长"}不会说${languageLabel(g.language).cn}。`,
      );
    }
    if (b.got !== b.wanted) {
      out.push(
        lang === "en"
          ? `⚠ ${b.role === "main" ? "Main" : "Auxiliary"} leader borrowed: ${ZU_ZHANG_TIER_LABEL[b.got].en} (needs ${ZU_ZHANG_TIER_LABEL[b.wanted].en}).`
          : `⚠ ${b.role === "main" ? "主组长" : "副组长"}借用${ZU_ZHANG_TIER_LABEL[b.got].cn}（应为${ZU_ZHANG_TIER_LABEL[b.wanted].cn}）。`,
      );
    }
    return out;
  });

  const summary =
    lang === "en"
      ? `${cls} group led by ${main?.region_id ?? "—"}${tier ? ` (${tier}${main?.grade != null ? `, grade ${main.grade}` : ""})` : ""}. Strengths: ${dimText || "none set"}. ${old} old + ${fresh} new.`
      : `${cls}，由 ${main?.region_id ?? "—"}${tier ? `（${tier}${main?.grade != null ? `，${main.grade} 级` : ""}）` : ""}担任组长。专长：${dimText || "未设"}。旧生 ${old} 位，新生 ${fresh} 位。`;

  const lines = [...borrowed, summary];
  const sorted = [...g.members].sort((a, b) =>
    (a.region_id ?? "").localeCompare(b.region_id ?? ""),
  );
  for (const m of sorted) {
    if (!m.region_id) continue;
    const r =
      ctx.reasons.get(m.participant_id)
      ?? placementReason(m, g, ctx.notes.get(m.participant_id) ?? []);
    lines.push(`• ${m.region_id} — ${r[lang]}`);
  }
  return lines.join("\n");
}
