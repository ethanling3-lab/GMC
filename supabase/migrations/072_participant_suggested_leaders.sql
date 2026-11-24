-- Suggested 组长 · 建议在谁的小组 — CS picks group leaders from the CRM
-- instead of typing names (Ethan, 2026-11-24). Ordered: position 1 =
-- preferred. Max 2 per participant. The old free-text column
-- `suggested_group_leader_notes` stays as the optional "why" note.
--
-- Writes go through PATCH /api/admin/participants/[id] (role-scoped, then
-- service client), same as family links / conflict pairs. RLS: Super
-- Admin only for direct access.
--
-- Grouping: if the suggested leader serves at the event and leads a group
-- of the student's group type with room, place the student there (beats
-- goal + grade matching, never crosses group type).

create table if not exists participant_suggested_leaders (
  participant_id uuid not null references participants(id) on delete cascade,
  leader_id uuid not null references participants(id) on delete cascade,
  position smallint not null check (position between 1 and 2),
  created_at timestamptz not null default now(),
  created_by uuid references admins(id) on delete set null,
  primary key (participant_id, leader_id),
  constraint participant_suggested_leaders_position_unique unique (participant_id, position),
  constraint participant_suggested_leaders_not_self check (participant_id <> leader_id)
);

create index if not exists participant_suggested_leaders_leader_idx
  on participant_suggested_leaders (leader_id);

alter table participant_suggested_leaders enable row level security;

drop policy if exists "participant_suggested_leaders_super_admin" on participant_suggested_leaders;
create policy "participant_suggested_leaders_super_admin" on participant_suggested_leaders
  for all using (is_super_admin()) with check (is_super_admin());
