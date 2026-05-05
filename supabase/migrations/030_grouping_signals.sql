-- New grouping signals — three pieces.
--
-- 1. participants.energy_profile (high/medium/quiet) — soft balance signal.
--    Algorithm spreads energy levels across groups so no table is all
--    quiet or all loud.
--
-- 2. participants.language_fluency (en/cn/both) — soft constraint.
--    Each table should have ≥1 person fluent in each language present
--    in the wider enrolment, otherwise discussion stalls.
--
-- 3. participant_conflict_pairs — exact mirror of participant_family_links
--    (migration 027). Captures admin knowledge of pairs that should NEVER
--    sit together (ex-spouses, business rivals, bad-blood). Algorithm
--    enforces this as a HARD split, identical to the family-split rule.
--    Has an extra `note` column for admin context (never seen by algo
--    or LLM).

do $$ begin
  create type energy_profile as enum ('high', 'medium', 'quiet');
exception when duplicate_object then null; end $$;

do $$ begin
  create type language_fluency as enum ('en', 'cn', 'both');
exception when duplicate_object then null; end $$;

alter table public.participants
  add column if not exists energy_profile energy_profile,
  add column if not exists language_fluency language_fluency;

create table if not exists participant_conflict_pairs (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references participants(id) on delete cascade,
  b_id uuid not null references participants(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references admins(id) on delete set null,
  constraint participant_conflict_pairs_pair_order check (a_id < b_id),
  constraint participant_conflict_pairs_pair_unique unique (a_id, b_id)
);

create index if not exists participant_conflict_pairs_a_idx
  on participant_conflict_pairs (a_id);
create index if not exists participant_conflict_pairs_b_idx
  on participant_conflict_pairs (b_id);

alter table participant_conflict_pairs enable row level security;

do $$ begin
  create policy participant_conflict_pairs_admin_read
    on participant_conflict_pairs for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

comment on column public.participants.energy_profile is
  'Admin-tagged energy level (high/medium/quiet). Soft signal — algorithm spreads across groups.';
comment on column public.participants.language_fluency is
  'Conversational fluency (en/cn/both). Soft signal — each group needs ≥1 of each language present in the wider enrolment.';
comment on table public.participant_conflict_pairs is
  'Pairs that must NEVER sit together. Mirrors participant_family_links structure; same hard-split enforcement in the grouping algorithm.';
