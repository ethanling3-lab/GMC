-- M6 — AI grouping + Visio-style floor plan editor.
--
-- Replaces the legacy hand-built Google Sheets grouping flow with an
-- end-to-end pipeline:
--   * cluster + LLM-refine participants into seated groups (table mode)
--   * rank-and-seat participants front-to-back (cushion / meditation mode)
--   * lay them out spatially in a per-event floor plan (round/square tables,
--     cushions, stages, podium, text labels, walls, doors)
--   * auto-place groups onto tables nearest the podium / cushions onto rows
--     by score, with admin drag-drop swap
--   * export to PPT (editable), PDF, PNG
--
-- Six new tables, three enums, four columns on existing tables, one
-- mode-switch guard trigger, and one private storage bucket.
--
-- All statements idempotent so re-runs are safe in dev. RLS matches
-- precedent set in migration 014: super_admin full; regional_lead manage;
-- instructor + customer_service read where useful.

-- =============================================================================
-- Enums
-- =============================================================================

do $$ begin
  create type seating_mode as enum ('tables', 'cushions');
exception when duplicate_object then null; end $$;

do $$ begin
  create type floor_plan_shape_kind as enum (
    'round_table', 'square_table', 'cushion',
    'stage', 'podium', 'text_label', 'door', 'wall'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type group_member_role as enum (
    'zu_zhang',       -- 组长 — group leader (1 per table)
    'fu_zu_zhang',    -- 副组长 — deputy (1-2 per table)
    'pai_zhang',      -- 排长 — row leader (cushion mode, leftmost/rightmost)
    'participant'
  );
exception when duplicate_object then null; end $$;

-- =============================================================================
-- events — seating mode + group size policy + podium position
-- =============================================================================

alter table events
  add column if not exists seating_mode seating_mode not null default 'tables';

alter table events
  add column if not exists group_size_min int not null default 10;

alter table events
  add column if not exists group_size_max int not null default 12;

alter table events
  add column if not exists podium_position jsonb;
-- shape: {"x_pct": 50, "y_pct": 5} — 0-100 within the layout viewport.

alter table events
  add constraint events_group_size_range_chk
  check (group_size_min between 1 and 64
         and group_size_max between 1 and 64
         and group_size_min <= group_size_max)
  not valid;
-- not valid: existing rows ride on defaults (10/12) which already pass the
-- check; new inserts/updates are validated. Validation enforced by the
-- application layer for legacy rows on next edit.

-- =============================================================================
-- enrollments — pinned_group_no (table mode only; cushion mode ignores)
-- =============================================================================

alter table enrollments
  add column if not exists pinned_group_no int;

create index if not exists enrollments_pinned_group_idx
  on enrollments (event_id, pinned_group_no)
  where pinned_group_no is not null;

-- =============================================================================
-- event_groups — logical group with rationale + leader (table mode only)
-- =============================================================================

create table if not exists event_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  group_no int not null,
  name_en text,
  name_cn text,
  leader_participant_id uuid references participants(id) on delete set null,
  rationale_en text,
  rationale_cn text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_groups_event_no_key unique (event_id, group_no)
);

drop trigger if exists event_groups_set_updated_at on event_groups;
create trigger event_groups_set_updated_at
  before update on event_groups
  for each row execute function set_updated_at();

create index if not exists event_groups_event_idx on event_groups (event_id);

-- =============================================================================
-- event_floor_plan_shapes — geometry layer (no participant data)
-- =============================================================================

create table if not exists event_floor_plan_shapes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  kind floor_plan_shape_kind not null,
  -- All geometry expressed as 0-100 percentages inside a fixed viewport
  -- (viewBox="0 0 100 60") so the same coords drive screen + PPT + PDF.
  x_pct numeric not null,
  y_pct numeric not null,
  width_pct numeric not null,
  height_pct numeric not null,
  rotation_deg numeric not null default 0,
  seat_count int,                       -- null for shapes that don't seat anyone
  seats_per_side jsonb,                 -- square table: {"top":3,"right":3,"bottom":3,"head":1}
  label_en text,
  label_cn text,
  group_id uuid references event_groups(id) on delete set null,
  locked boolean not null default false,
  z_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists event_floor_plan_shapes_set_updated_at on event_floor_plan_shapes;
create trigger event_floor_plan_shapes_set_updated_at
  before update on event_floor_plan_shapes
  for each row execute function set_updated_at();

create index if not exists event_floor_plan_shapes_event_idx
  on event_floor_plan_shapes (event_id, z_order);
create index if not exists event_floor_plan_shapes_group_idx
  on event_floor_plan_shapes (group_id)
  where group_id is not null;

-- =============================================================================
-- event_seat_assignments — every seated person (both modes)
-- =============================================================================
--
-- A unified assignment table that works for both table mode and cushion
-- mode:
--   * Round/square table: one row per occupied seat, all sharing shape_id
--     with seat_no 1..seat_count. group_id populated.
--   * Cushion: one row per cushion shape (seat_count=1, seat_no=0).
--     group_id null.
-- Empty seats simply have no row.

create table if not exists event_seat_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  -- shape_id + seat_no are NULLABLE so table-mode generate can persist
  -- draft membership before the layout exists. Auto-place (M6.6) backfills
  -- both columns. Cushion mode populates them at generate time.
  shape_id uuid references event_floor_plan_shapes(id) on delete cascade,
  seat_no int,
  participant_id uuid not null references participants(id) on delete cascade,
  role group_member_role not null default 'participant',
  group_id uuid references event_groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_seat_assignments_event_participant_key unique (event_id, participant_id)
);

-- Partial unique: enforce one-person-per-seat only when both columns set.
create unique index if not exists event_seat_assignments_shape_seat_key
  on event_seat_assignments (shape_id, seat_no)
  where shape_id is not null and seat_no is not null;

drop trigger if exists event_seat_assignments_set_updated_at on event_seat_assignments;
create trigger event_seat_assignments_set_updated_at
  before update on event_seat_assignments
  for each row execute function set_updated_at();

create index if not exists event_seat_assignments_event_idx
  on event_seat_assignments (event_id);
create index if not exists event_seat_assignments_group_idx
  on event_seat_assignments (group_id)
  where group_id is not null;
create index if not exists event_seat_assignments_role_idx
  on event_seat_assignments (event_id, role);

-- =============================================================================
-- event_floor_plan_assets — uploaded floor-plan reference images
-- =============================================================================

create table if not exists event_floor_plan_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  kind text not null default 'background_image',
  storage_path text not null,
  original_filename text,
  width_px int,
  height_px int,
  opacity numeric not null default 0.4,
  created_at timestamptz not null default now()
);

create index if not exists event_floor_plan_assets_event_idx
  on event_floor_plan_assets (event_id);

-- =============================================================================
-- Mode-switch guard — refuse changing events.seating_mode while shapes or
-- assignments exist for that event. Admin must clear the layout first.
-- =============================================================================

create or replace function refuse_seating_mode_switch_with_data()
returns trigger
language plpgsql
as $$
begin
  if new.seating_mode is distinct from old.seating_mode then
    if exists (select 1 from event_floor_plan_shapes where event_id = new.id)
       or exists (select 1 from event_seat_assignments where event_id = new.id)
       or exists (select 1 from event_groups where event_id = new.id) then
      raise exception 'cannot change seating_mode for event % while shapes, groups, or seat assignments exist; clear the layout first',
        new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists events_refuse_seating_mode_switch on events;
create trigger events_refuse_seating_mode_switch
  before update of seating_mode on events
  for each row execute function refuse_seating_mode_switch_with_data();

-- =============================================================================
-- Storage bucket: event-floor-plans (private, signed URL access)
-- =============================================================================
--
-- Hotel ballroom screenshots / vendor PDFs / sketches uploaded by admin to
-- feed the vision auto-detect step + use as background tracing reference.
-- 20 MB cap to accommodate PDFs from venue documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-floor-plans',
  'event-floor-plans',
  false,
  20 * 1024 * 1024,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- RLS — super_admin full; regional_lead manage; instructor + customer_service
-- read (instructors need to know group lists; CS may answer participant
-- questions about table seating).
-- =============================================================================

alter table event_groups enable row level security;
alter table event_floor_plan_shapes enable row level security;
alter table event_seat_assignments enable row level security;
alter table event_floor_plan_assets enable row level security;

-- event_groups
drop policy if exists "admins view event groups" on event_groups;
create policy "admins view event groups"
  on event_groups for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'instructor', 'customer_service')
  );

drop policy if exists "admins manage event groups" on event_groups;
create policy "admins manage event groups"
  on event_groups for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');

-- event_floor_plan_shapes
drop policy if exists "admins view floor plan shapes" on event_floor_plan_shapes;
create policy "admins view floor plan shapes"
  on event_floor_plan_shapes for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'instructor', 'customer_service')
  );

drop policy if exists "admins manage floor plan shapes" on event_floor_plan_shapes;
create policy "admins manage floor plan shapes"
  on event_floor_plan_shapes for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');

-- event_seat_assignments
drop policy if exists "admins view seat assignments" on event_seat_assignments;
create policy "admins view seat assignments"
  on event_seat_assignments for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'instructor', 'customer_service')
  );

drop policy if exists "admins manage seat assignments" on event_seat_assignments;
create policy "admins manage seat assignments"
  on event_seat_assignments for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');

-- event_floor_plan_assets
drop policy if exists "admins view floor plan assets" on event_floor_plan_assets;
create policy "admins view floor plan assets"
  on event_floor_plan_assets for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'instructor', 'customer_service')
  );

drop policy if exists "admins manage floor plan assets" on event_floor_plan_assets;
create policy "admins manage floor plan assets"
  on event_floor_plan_assets for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');
