// Shared types for the M6 grouping pipeline. Pure types — no runtime
// imports, no `server-only`, safe to import from client components for
// rendering existing assignments.
//
// M6.0 rework: schema-aligned with migration 022 — adds 4-class group
// taxonomy (特级 / 重点 / 成长 / 维护), curated 组长 model, growth
// dimensions, and the 5-tier student qualification ladder. The algorithm
// now seeds groups with admin-curated 组长 instead of deriving leaders
// from scores.

export type SeatingMode = "tables" | "cushions";

export type GroupMemberRole =
  | "zu_zhang"      // 组长 — group leader (curated per event)
  | "fu_zu_zhang"   // 副组长 — auxiliary 组长 (辅助 tier or class-required pairing)
  | "pai_zhang"     // 排长 — row leader (cushion only)
  | "participant";

export type FloorPlanShapeKind =
  | "round_table"
  | "square_table"
  | "cushion"
  | "stage"
  | "podium"
  | "text_label"
  | "door"
  | "wall";

// Four-tier 组长 ladder. Eligibility (informational; admin curates):
//   key_recruitment — ≥20 led + 卓越级+ OR 区域负责人 OR 特殊贡献
//   recruitment    — ≥10 led + 精英级+
//   maintenance    — ≥5  led + 成长级+
//   auxiliary      — <5  led + 成长级+
export type ZuZhangTier =
  | "key_recruitment"
  | "recruitment"
  | "maintenance"
  | "auxiliary";

// Four growth dimensions. 组长 cover an array of these (multi-valued);
// participants declare an ordered array (index 0 = primary goal).
export type GrowthDimension =
  | "financial"     // 財富
  | "relationship"  // 关系
  | "health"        // 健康
  | "inner_peace";  // 内心平静

// Five-tier qualification ladder. Maps from max(financial, influence):
//   1 → basic, 2 → rising, 3 → elite, 4 → excellence, 5 → strategic
// participants.student_qualification is an admin-only OVERRIDE; null
// means "use the computed value." Used to downgrade for credit/legal/
// leverage issues without falsifying the underlying scores.
export type StudentQualification =
  | "basic"
  | "rising"
  | "elite"
  | "excellence"
  | "strategic";

// Group class — drives leader-tier pairing + M6.6 seating zone.
//   strategic 特级组 — 卓越级+ members; key_recruitment + recruitment
//   key       重点组 — 精英级 members;  recruitment + maintenance
//   growth    成长组 — 成长级 members;  maintenance + auxiliary
//   maintenance 维护组 — 基础级 members; maintenance + auxiliary
export type GroupClass = "strategic" | "key" | "growth" | "maintenance";

export type UpgradePotential = "low" | "medium" | "high";

// Programme tier — paid GMC course a student is enrolled in. Grants
// entitlement to attend events for just the 会务 (misc fee). Pricing
// (informational, not enforced):
//   abundance                S$16,135 / on-site S$15,135
//   glorious_family          S$38,135 / on-site S$36,135
//   elite_cultural_heritage  S$70,000 / on-site S$65,000
//   glorious_cultural_heritage S$104,000 / on-site S$96,000
export type ProgrammeTier =
  | "abundance"
  | "glorious_family"
  | "elite_cultural_heritage"
  | "glorious_cultural_heritage";

// Categorical core traits — admin picks which of these define the
// group leader (multi-select). Used by future matching logic.
export type ZuZhangCoreTrait =
  | "logical_thinking"     // 逻辑性
  | "social_intelligence"  // 社交性
  | "adaptability"         // 灵动性
  | "goal_orientation"     // 目标性
  | "attention_to_detail"; // 严谨性

// Participant fields the grouping algorithms care about. Caller flattens
// the join from enrollments → participants. region_id is the PII-safe
// identifier we use everywhere external (LLM input, exports).
//
// `overall_score` is retained in the type for legacy reads (CSV export,
// detail page) but the algorithm does not consume it. It can be null
// without affecting any decision.
export type GroupingParticipant = {
  participant_id: string;
  region_id: string | null;
  // Score fields — null is allowed; the algorithm imputes to mean.
  // Post-022 these are 1-5.
  overall_score: number | null;
  influence_score: number | null;
  financial_score: number | null;
  motivation_tag: string | null;
  is_old_student: boolean;
  // Family link points at another participant's id (legacy single
  // edge — kept for back-compat during the transition to the multi-
  // edge join table). Resolves to that other participant's region_id
  // when present in the same event.
  family_of_participant_id: string | null;
  // Multi-edge family graph (migration 027). Undirected list of
  // partner participant IDs. The loader unions this with the legacy
  // single-edge column so the algorithm sees a single coherent set.
  family_member_ids: string[];
  region: string | null;
  // Pinned to a specific group_no (table mode only; cushion mode ignores).
  pinned_group_no: number | null;

  // M6.0 additions (all default-ish so legacy callers can omit):
  goal_dimensions: GrowthDimension[];
  // Override only — null means use computed max(fin, inf) → label.
  student_qualification_override: StudentQualification | null;

  // M6.4 grouping signals (migration 030):
  //  energy_profile: balance H/M/Q across groups (soft).
  //  language_fluency: each group needs ≥1 of each language present
  //    in the wider enrolment (soft).
  //  conflict_member_ids: hard split — same rules as family.
  energy_profile: "high" | "medium" | "quiet" | null;
  language_fluency: "en" | "cn" | "both" | null;
  conflict_member_ids: string[];
};

// One curated 组长 in the per-event roster. Algorithm seeds groups
// with these BEFORE distributing regular participants.
export type GroupingZuZhang = {
  participant_id: string;
  region_id: string | null;
  // Effective tier: enrollments.zu_zhang_tier_for_event override else
  // participants.zu_zhang_tier global.
  tier: ZuZhangTier;
  // Effective grade 1-5 within tier (override ?? global). Higher =
  // more prominent placement. Null = ungraded; sorts last in tier.
  // Establishes leader priority order; M6.6 floor plan editor pairs
  // this with priority-table tags on the venue layout.
  grade: number | null;
  // Growth dimensions this 组长 excels in (key strengths).
  dimensions: GrowthDimension[];
  // Categorical core traits (multi-select). Future matching algorithm
  // input.
  core_traits: ZuZhangCoreTrait[];
  // Convenience flags computed from tier:
  //   is_main = tier in {key_recruitment, recruitment, maintenance}
  //   is_auxiliary = tier === 'auxiliary'
  is_main: boolean;
  is_auxiliary: boolean;
};

// Per-event constraint config used by both balance.ts and llm-grouping.ts.
export type GroupingConfig = {
  group_size_min: number;
  group_size_max: number;
};

// One assigned member inside a draft group. group_no is set; shape_id +
// seat_no fill in later when the layout is auto-placed (M6.6).
export type DraftMember = {
  participant_id: string;
  region_id: string | null;
  role: GroupMemberRole;
};

export type DraftGroup = {
  group_no: number;
  group_class: GroupClass;          // M6.0 — drives leader pairing + seating zone
  leader_participant_id: string | null;
  members: DraftMember[];
  rationale_en: string;
  rationale_cn: string;
};

export type GroupingStrategy = "llm" | "balance" | "cushion_rank";

export type GroupingResult = {
  strategy: GroupingStrategy;
  groups: DraftGroup[];
  // For cushion mode the algorithm produces seat assignments directly
  // because it needs the shape layout. For table mode this is empty
  // until M6.6 auto-place runs.
  cushion_assignments: CushionAssignment[];
  metadata: {
    n: number;
    k: number;
    retry_count?: number;
    validation_errors?: string[];
    // M6.0 — surface roster shortfalls so the route can return them.
    roster_shortfalls?: RosterShortfall[];
  };
};

// Cushion-mode produces these directly (one per seated cushion).
export type CushionAssignment = {
  shape_id: string;
  seat_no: number;
  participant_id: string;
  role: GroupMemberRole;
};

// A cushion shape with its position — input to cushion-rank.ts row
// detection. Comes from event_floor_plan_shapes filtered to kind='cushion'.
export type CushionShape = {
  id: string;
  x_pct: number;
  y_pct: number;
  height_pct: number;
};

// Roster shortfall — surfaced when curated 组长 don't cover the
// required leader-tier pairings for the qualifications enrolled.
export type RosterShortfall = {
  group_class: GroupClass;
  k_required: number;
  required_tier: ZuZhangTier;
  required_role: "main" | "auxiliary";
  have: number;
  need: number;
};

// =============================================================================
// Pure helpers — no DB, no side effects. Reused by balance.ts, validate.ts,
// llm-grouping.ts, and any UI surface that needs to derive class / tier
// without re-implementing the rules.
// =============================================================================

// Map a 1-5 score to a qualification label.
export function scoreToQualification(score: number | null): StudentQualification | null {
  if (score == null) return null;
  if (score >= 5) return "strategic";
  if (score >= 4) return "excellence";
  if (score >= 3) return "elite";
  if (score >= 2) return "rising";
  if (score >= 1) return "basic";
  return null;
}

// Effective qualification = override if set, else max(fin, inf) → label.
// Returns null if neither score is set AND no override — caller falls
// back to a safe default class (growth).
export function effectiveQualification(p: {
  financial_score: number | null;
  influence_score: number | null;
  student_qualification_override: StudentQualification | null;
}): StudentQualification | null {
  if (p.student_qualification_override) return p.student_qualification_override;
  const fin = p.financial_score ?? 0;
  const inf = p.influence_score ?? 0;
  const max = Math.max(fin, inf);
  if (max < 1) return null;
  return scoreToQualification(max);
}

// Map qualification → default group_class. Strategic and Excellence
// both go to 特级组 per spec ("卓越级以上").
export function qualificationToClass(q: StudentQualification | null): GroupClass {
  switch (q) {
    case "strategic":
    case "excellence":
      return "strategic";
    case "elite":
      return "key";
    case "rising":
      return "growth";
    case "basic":
      return "maintenance";
    case null:
      // Unscored participants default to 成长组 — safe middle bucket.
      return "growth";
  }
}

// Combined: participant → group_class, going through the override.
export function participantToClass(p: {
  financial_score: number | null;
  influence_score: number | null;
  student_qualification_override: StudentQualification | null;
}): GroupClass {
  return qualificationToClass(effectiveQualification(p));
}

// Priority = max(financial, influence) ≥ 4 (Excellence or Strategic).
// Either dimension alone qualifies — NOT a composite sum.
export function isPriority(p: {
  financial_score: number | null;
  influence_score: number | null;
}): boolean {
  const fin = p.financial_score ?? 0;
  const inf = p.influence_score ?? 0;
  return Math.max(fin, inf) >= 4;
}

// Required leader-tier pairing for each group class.
//   特级 → key_recruitment + recruitment
//   重点 → recruitment + maintenance
//   成长 → maintenance + auxiliary
//   维护 → maintenance + auxiliary
export function requiredLeaderTiers(c: GroupClass): {
  main: ZuZhangTier;
  auxiliary: ZuZhangTier;
} {
  switch (c) {
    case "strategic":
      return { main: "key_recruitment", auxiliary: "recruitment" };
    case "key":
      return { main: "recruitment", auxiliary: "maintenance" };
    case "growth":
      return { main: "maintenance", auxiliary: "auxiliary" };
    case "maintenance":
      return { main: "maintenance", auxiliary: "auxiliary" };
  }
}

// Bilingual labels for UI rendering. Kept in types.ts so client +
// server share one source of truth.
export const GROUP_CLASS_LABEL: Record<
  GroupClass,
  { en: string; cn: string; short_cn: string }
> = {
  strategic: { en: "Strategic", cn: "特级组", short_cn: "特级" },
  key: { en: "Key", cn: "重点组", short_cn: "重点" },
  growth: { en: "Growth", cn: "成长组", short_cn: "成长" },
  maintenance: { en: "Maintenance", cn: "维护组", short_cn: "维护" },
};

export const ZU_ZHANG_TIER_LABEL: Record<
  ZuZhangTier,
  { en: string; cn: string; short_cn: string }
> = {
  key_recruitment: { en: "Key Recruitment", cn: "重点感召型", short_cn: "重" },
  recruitment: { en: "Recruitment", cn: "感召型", short_cn: "召" },
  maintenance: { en: "Maintenance", cn: "维护型", short_cn: "维" },
  auxiliary: { en: "Auxiliary", cn: "辅助组长", short_cn: "辅" },
};

export const STUDENT_QUALIFICATION_LABEL: Record<
  StudentQualification,
  { en: string; cn: string; short_cn: string; score: number }
> = {
  basic: { en: "Basic", cn: "基础级", short_cn: "基", score: 1 },
  rising: { en: "Rising", cn: "成长级", short_cn: "成", score: 2 },
  elite: { en: "Elite", cn: "精英级", short_cn: "精", score: 3 },
  excellence: { en: "Excellence", cn: "卓越级", short_cn: "卓", score: 4 },
  strategic: { en: "Strategic", cn: "战略级", short_cn: "战", score: 5 },
};

export const GROWTH_DIMENSION_LABEL: Record<
  GrowthDimension,
  { en: string; cn: string; short_cn: string; icon: string }
> = {
  financial: { en: "Financial", cn: "財富", short_cn: "財", icon: "💰" },
  relationship: { en: "Relationship", cn: "关系", short_cn: "关", icon: "❤️" },
  health: { en: "Health", cn: "健康", short_cn: "健", icon: "⚕️" },
  inner_peace: { en: "Inner Peace", cn: "内心平静", short_cn: "心", icon: "🧘" },
};

export const ZU_ZHANG_TRAIT_LABEL: Record<
  ZuZhangCoreTrait,
  { en: string; cn: string }
> = {
  logical_thinking: { en: "Logical Thinking", cn: "逻辑性" },
  social_intelligence: { en: "Social Intelligence", cn: "社交性" },
  adaptability: { en: "Adaptability", cn: "灵动性" },
  goal_orientation: { en: "Goal Orientation", cn: "目标性" },
  attention_to_detail: { en: "Attention to Detail", cn: "严谨性" },
};

export const PROGRAMME_TIER_LABEL: Record<
  ProgrammeTier,
  { en: string; cn: string; price_sgd: number; on_site_sgd: number }
> = {
  abundance: {
    en: "Abundance",
    cn: "丰盛",
    price_sgd: 16135,
    on_site_sgd: 15135,
  },
  glorious_family: {
    en: "Glorious Family",
    cn: "荣贵",
    price_sgd: 38135,
    on_site_sgd: 36135,
  },
  elite_cultural_heritage: {
    en: "Elite Cultural Heritage",
    cn: "精英文化财",
    price_sgd: 70000,
    on_site_sgd: 65000,
  },
  glorious_cultural_heritage: {
    en: "Glorious Cultural Heritage",
    cn: "荣耀文化财",
    price_sgd: 104000,
    on_site_sgd: 96000,
  },
};
