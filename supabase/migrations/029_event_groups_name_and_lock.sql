-- Pass 2 of the GroupBuilder: editable group names + lock-from-regenerate.
--
-- name_en / name_cn — optional admin-curated display name per group.
-- Falls back to the auto-generated "Group N" / "组 N" pattern when null.
--
-- locked — when true, the group AND its event_seat_assignments survive
-- a Regenerate run intact. The persist step re-numbers fresh groups to
-- skip locked group_no values so the locked group keeps its identity.

alter table public.event_groups
  add column if not exists name_en text,
  add column if not exists name_cn text,
  add column if not exists locked boolean not null default false;

-- Partial index on locked=true rows — there will be very few of these
-- relative to total groups, so a partial index is the right shape.
create index if not exists event_groups_locked_idx
  on public.event_groups (event_id) where locked = true;

comment on column public.event_groups.name_en is
  'Optional admin display name (EN). Null = auto-format "Group N".';
comment on column public.event_groups.name_cn is
  'Optional admin display name (CN). Null = auto-format "组 N".';
comment on column public.event_groups.locked is
  'When true, this group + its assignments survive a Regenerate run.';
