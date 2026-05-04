-- M6.0 — Qualitative scoring + 组长 model rework.
--
-- The hand-built grouping process at GMC doesn't compute a composite
-- "overall_score" and pick the highest-scoring old student as 组长. Real
-- model: 组长 are CURATED per-event from a tagged pool; groups themselves
-- are classed (特级 / 重点 / 成长 / 维护) by member qualification, with
-- deterministic leader-tier pairings per class.
--
-- This migration aligns the schema with the real model:
--   * Five new enums: zu_zhang_tier, growth_dimension, upgrade_potential,
--     student_qualification, group_class.
--   * Rescale participants.financial_score + influence_score from 1-10 to
--     1-5 (existing values divided by 2 rounded up).
--   * participants.overall_score is left in place for legacy reads but the
--     grouping algorithm stops consuming it.
--   * New participant fields: zu_zhang_tier (global tag), zu_zhang_dimensions
--     (which dimensions a 组长 excels in), zu_zhang_traits (5-trait JSONB
--     placeholder for future matching), goal_dimensions (ordered goals each
--     participant declares), upgrade_potential, student_qualification
--     (override only — null means use computed max), has_special_contribution
--     (flag for 重点感召型 eligibility), times_led_groups (cached counter
--     maintained by trigger on zu_zhang_history).
--   * New enrolment fields: serving_as_zu_zhang (per-event toggle) and
--     zu_zhang_tier_for_event (per-event tier override).
--   * New event_groups.group_class column — 特级 / 重点 / 成长 / 维护;
--     drives leader-tier pairing + M6.6 seating zone.
--   * New zu_zhang_history table tracks past service so admin sees track
--     record before assigning at a new event. Trigger on insert/delete keeps
--     participants.times_led_groups in sync.
--
-- All statements idempotent; safe to re-run.

-- =============================================================================
-- Enums
-- =============================================================================

do $$ begin
  create type zu_zhang_tier as enum (
    'key_recruitment',  -- 重点感召型 — top-tier 组长 (≥20 led + 卓越级+ OR 区域负责人 OR 特殊贡献)
    'recruitment',      -- 感召型     — ≥10 led + 精英级+
    'maintenance',      -- 维护型     — ≥5 led + 成长级+
    'auxiliary'         -- 辅助型     — <5 led + 成长级+; replaces score-derived 副组长
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type growth_dimension as enum (
    'financial',    -- 財富
    'relationship', -- 关系
    'health',       -- 健康
    'inner_peace'   -- 内心平静
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type upgrade_potential as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type student_qualification as enum (
    'basic',       -- 基础级 (score 1)
    'rising',      -- 成长级 (score 2)
    'elite',       -- 精英级 (score 3)
    'excellence',  -- 卓越级 (score 4)
    'strategic'    -- 战略级 (score 5)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type group_class as enum (
    'strategic',   -- 特级组 — front row center; key_recruitment + recruitment leaders
    'key',         -- 重点组 — front row sides / second row; recruitment + maintenance
    'growth',      -- 成长组 — middle; maintenance + auxiliary
    'maintenance'  -- 维护组 — last row; maintenance + auxiliary
  );
exception when duplicate_object then null; end $$;

-- =============================================================================
-- participants — rescale scores 1-10 → 1-5
-- =============================================================================
--
-- Existing data uses the legacy 1-10 scale. Map: ceil(x / 2.0) so that
-- 1-2 → 1, 3-4 → 2, 5-6 → 3, 7-8 → 4, 9-10 → 5. We rescale BEFORE swapping
-- the check constraint so the new constraint is satisfied on every row.
-- The mapping is idempotent under re-runs because once a value is in
-- [1,5] the formula collapses to itself (e.g. ceil(3/2.0)=2, then
-- ceil(2/2.0)=1 — NOT idempotent). To guard against double-application,
-- we predicate on the OLD check constraint still being installed.

do $$
declare
  legacy_check_present boolean;
begin
  select exists (
    select 1
    from pg_constraint
    where conrelid = 'participants'::regclass
      and conname = 'participants_financial_score_check'
      and pg_get_constraintdef(oid) ilike '%<= 10%'
  ) into legacy_check_present;

  if legacy_check_present then
    update participants
    set financial_score = ceil(financial_score::numeric / 2.0)::int
    where financial_score is not null;

    update participants
    set influence_score = ceil(influence_score::numeric / 2.0)::int
    where influence_score is not null;

    alter table participants
      drop constraint if exists participants_financial_score_check,
      drop constraint if exists participants_influence_score_check;

    alter table participants
      add constraint participants_financial_score_check
        check (financial_score between 1 and 5),
      add constraint participants_influence_score_check
        check (influence_score between 1 and 5);
  end if;
end $$;

-- overall_score column intentionally left in place at the 1-10 scale. The
-- grouping algorithm stops reading it (see src/lib/grouping/), and no new
-- writes occur — this is a soft deprecation. Drop in a later migration
-- once we're sure no legacy reports depend on it.

-- =============================================================================
-- participants — qualitative profile fields
-- =============================================================================

alter table participants
  add column if not exists zu_zhang_tier zu_zhang_tier;
-- null = not eligible to serve as 组长. Set when admin tags someone.

alter table participants
  add column if not exists zu_zhang_dimensions growth_dimension[] not null default '{}';
-- Which growth dimensions this 组长 excels in. Multi-valued — one 组长
-- can cover multiple dimensions. Empty array on non-组长.

alter table participants
  add column if not exists goal_dimensions growth_dimension[] not null default '{}';
-- Ordered list of growth dimensions the participant declares as goals.
-- Index 0 = primary goal. Array order is meaningful (used by the
-- matching algorithm to weight primary dimension highest).

alter table participants
  add column if not exists upgrade_potential upgrade_potential;
-- null when admin hasn't assessed yet. Surfaces in the participant
-- detail page; doesn't drive grouping directly but informs admin's
-- 组长 curation decisions.

alter table participants
  add column if not exists zu_zhang_traits jsonb not null default '{}'::jsonb;
-- Five-trait scores for 组长 matching: {logic, sociability, agility,
-- goal_oriented, rigor} each 1-5. Captured in UI now; algorithm consumes
-- when the matching logic is finalized. JSONB lets us tweak the trait
-- list without another migration.

alter table participants
  add column if not exists student_qualification student_qualification;
-- Override ONLY. NULL = use the computed value from
-- max(financial_score, influence_score) mapped to the 5-tier ladder
-- (1=basic, 2=rising, 3=elite, 4=excellence, 5=strategic). Admin sets
-- this explicitly when downgrading a participant for credit/legal/
-- leverage issues — keeps the underlying scores truthful.

alter table participants
  add column if not exists has_special_contribution boolean not null default false;
-- Manual flag — one of the eligibility paths to 重点感召型 (alongside
-- 区域负责人 admin role and ≥20 带组次数 + 卓越级+).

alter table participants
  add column if not exists times_led_groups int not null default 0;
-- Cached counter. Maintained by the trigger on zu_zhang_history
-- insert/delete (defined further below). Pre-seeded at 0; backfill
-- from historical sheets is a separate one-shot task.

do $$ begin
  alter table participants
    add constraint participants_times_led_groups_chk
    check (times_led_groups >= 0)
    not valid;
exception when duplicate_object then null; end $$;

create index if not exists participants_zu_zhang_tier_idx
  on participants (zu_zhang_tier)
  where zu_zhang_tier is not null;

create index if not exists participants_zu_zhang_dimensions_gin
  on participants using gin (zu_zhang_dimensions);
-- For "find me all 组长 who cover the financial dimension" lookups.

create index if not exists participants_goal_dimensions_gin
  on participants using gin (goal_dimensions);
-- For "find me everyone whose primary goal is health" lookups.

create index if not exists participants_student_qualification_idx
  on participants (student_qualification)
  where student_qualification is not null;
-- Curate-modal filter: "show me everyone admin has explicitly downgraded."

-- =============================================================================
-- enrollments — per-event 组长 service flag + tier override
-- =============================================================================

alter table enrollments
  add column if not exists serving_as_zu_zhang boolean not null default false;
-- Admin toggles this on per-enrolment when curating the 组长 roster
-- for that event. Defaults false so existing enrolments aren't auto-
-- promoted.

alter table enrollments
  add column if not exists zu_zhang_tier_for_event zu_zhang_tier;
-- Optional per-event override of participants.zu_zhang_tier. null
-- means "use the global tier from the participants row."

create index if not exists enrollments_serving_as_zu_zhang_idx
  on enrollments (event_id)
  where serving_as_zu_zhang = true;
-- Hot path: "load all 组长 for this event" runs every time the
-- algorithm seeds groups.

-- =============================================================================
-- event_groups — group_class (drives leader pairing + seating zone)
-- =============================================================================
--
-- Set by the algorithm at generate time based on member qualification
-- majority; admin can override via the group card UI. Default 'growth'
-- so existing rows get a sane class without a backfill UPDATE.

alter table event_groups
  add column if not exists group_class group_class not null default 'growth';

create index if not exists event_groups_event_class_idx
  on event_groups (event_id, group_class);
-- M6.6 auto-place query: "give me all 特级组 for this event so I can
-- seat them in the front row."

-- =============================================================================
-- zu_zhang_history — track record across past events
-- =============================================================================
--
-- One row per (participant, event) where the participant served as a
-- 组长. Used by admin when curating the next event's roster — they
-- want to see who served, at what tier, and on which dimensions, before
-- promoting again. Kept separate from enrollments so the read query is
-- cheap and the row survives even if the underlying enrolment is
-- archived later.
--
-- Backfill strategy: rows are inserted lazily by the application layer
-- when an admin marks the event as "complete" (M7 work). For now the
-- table is empty; the structure is in place so the algorithm + UI can
-- already query it without a follow-up migration.

create table if not exists zu_zhang_history (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  tier_served_as zu_zhang_tier not null,
  dimensions_focused_on growth_dimension[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint zu_zhang_history_participant_event_key unique (participant_id, event_id)
);

create index if not exists zu_zhang_history_participant_idx
  on zu_zhang_history (participant_id, created_at desc);

create index if not exists zu_zhang_history_event_idx
  on zu_zhang_history (event_id);

-- =============================================================================
-- Trigger: keep participants.times_led_groups in sync with zu_zhang_history
-- =============================================================================
--
-- Counter cache so the curate modal can filter "≥20 led" without a
-- COUNT(*) per participant. Floors at 0 on delete to defend against
-- hand-edits that remove rows we never inserted.

create or replace function bump_times_led_groups()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update participants
    set times_led_groups = times_led_groups + 1
    where id = new.participant_id;
  elsif tg_op = 'DELETE' then
    update participants
    set times_led_groups = greatest(0, times_led_groups - 1)
    where id = old.participant_id;
  end if;
  return null;
end $$;

drop trigger if exists zu_zhang_history_count_sync on zu_zhang_history;
create trigger zu_zhang_history_count_sync
  after insert or delete on zu_zhang_history
  for each row execute function bump_times_led_groups();

-- =============================================================================
-- RLS — match the precedent set in 014/021: super_admin full;
-- regional_lead manage; instructor + customer_service read.
-- =============================================================================

alter table zu_zhang_history enable row level security;

drop policy if exists "admins view zu_zhang history" on zu_zhang_history;
create policy "admins view zu_zhang history"
  on zu_zhang_history for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'instructor', 'customer_service')
  );

drop policy if exists "admins manage zu_zhang history" on zu_zhang_history;
create policy "admins manage zu_zhang history"
  on zu_zhang_history for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');
