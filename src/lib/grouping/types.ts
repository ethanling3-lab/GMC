// Shared types for the M6 grouping pipeline. Pure types — no runtime
// imports, no `server-only`, safe to import from client components for
// rendering existing assignments.

export type SeatingMode = "tables" | "cushions";

export type GroupMemberRole =
  | "zu_zhang"      // 组长 — group leader
  | "fu_zu_zhang"   // 副组长 — deputy leader
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

// Participant fields the grouping algorithms care about. Caller flattens
// the join from enrollments → participants. region_id is the PII-safe
// identifier we use everywhere external (LLM input, exports).
export type GroupingParticipant = {
  participant_id: string;
  region_id: string | null;
  // Score fields — null is allowed; the algorithm imputes to mean.
  overall_score: number | null;
  influence_score: number | null;
  financial_score: number | null;
  motivation_tag: string | null;
  is_old_student: boolean;
  // Family link points at another participant's id (single edge — chains
  // walked separately). Resolves to that other participant's region_id
  // when present in the same event.
  family_of_participant_id: string | null;
  region: string | null;
  // Pinned to a specific group_no (table mode only; cushion mode ignores).
  pinned_group_no: number | null;
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
