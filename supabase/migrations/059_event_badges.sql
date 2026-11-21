-- Name badges (名牌) — per-event badge design + print log.
--
-- Badges are generated in bulk as an A4-landscape PDF (5 × 2 grid, each badge
-- 54 × 85 mm portrait), printed on an office printer, cut, and sorted by
-- group/seat before the event. The CRM draws the name + check-in QR on top of
-- an admin-uploaded background design.
--
--   1. event_badge_settings — one row per event: background image + ink colour
--                             + layout knobs (name/QR position, QR size).
--   2. badge_prints          — one row per enrollment: a snapshot of what was
--                             last printed, so "new & changed since last print"
--                             can be computed (seat moved, name corrected, …).
--
-- The background image lives in the existing private `event-floor-plans`
-- bucket under `${event_id}/badge/…` — same access model (service role only,
-- signed URLs), no new bucket needed.
--
-- RLS: admin-only SELECT; all writes go through the service-role client
-- behind requireAdmin() role gates.

-- ---------------------------------------------------------------------------
-- 1. event_badge_settings
-- ---------------------------------------------------------------------------

create table if not exists public.event_badge_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  bg_storage_path text,
  bg_original_filename text,
  -- One colour for both the name text and the QR modules.
  ink_color text not null default '#FFFFFF'
    check (ink_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Fallback for scanners that can't read light-on-dark QR: draw a light
  -- rounded plate behind a dark QR instead of a transparent inverted one.
  qr_plate boolean not null default false,
  -- Plate mode colours (the plate, and the QR drawn on it). Admin-chosen so
  -- the plate can match the design; keep the QR much darker than the plate.
  plate_fill text not null default '#FFFFFF'
    check (plate_fill ~ '^#[0-9A-Fa-f]{6}$'),
  plate_ink text not null default '#111111'
    check (plate_ink ~ '^#[0-9A-Fa-f]{6}$'),
  -- Layout, as % of badge height from the top edge (badge is 85 mm tall).
  name_center_pct numeric not null default 40
    check (name_center_pct between 5 and 95),
  qr_top_pct numeric not null default 50
    check (qr_top_pct between 5 and 95),
  qr_size_mm numeric not null default 26
    check (qr_size_mm between 18 and 44),
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger event_badge_settings_set_updated_at
  before update on public.event_badge_settings
  for each row execute function set_updated_at();

comment on table public.event_badge_settings is
  'Per-event 名牌 design: background image (event-floor-plans bucket), ink colour for name + QR, layout knobs.';

-- ---------------------------------------------------------------------------
-- 2. badge_prints
-- ---------------------------------------------------------------------------

create table if not exists public.badge_prints (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  -- Snapshot of what was on the printed badge. A later difference between
  -- this and the live data marks the badge "changed".
  printed_name text not null,
  printed_display_no int,
  printed_seat_no int,
  -- First 8 chars of the QR token: detects a re-minted token, which would
  -- make the printed QR unscannable.
  printed_token_prefix text not null,
  print_count int not null default 1,
  first_printed_at timestamptz not null default now(),
  last_printed_at timestamptz not null default now(),
  last_printed_by uuid references public.admins(id) on delete set null
);

create index if not exists badge_prints_event_idx
  on public.badge_prints (event_id);

comment on table public.badge_prints is
  'Latest printed 名牌 snapshot per enrollment; drives the "new & changed since last print" reprint.';

-- ---------------------------------------------------------------------------
-- RLS — admin-only SELECT (mirrors group_report_*, 047).
-- ---------------------------------------------------------------------------

alter table public.event_badge_settings enable row level security;
alter table public.badge_prints enable row level security;

create policy "admins view badge settings"
  on public.event_badge_settings for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'instructor')
  );

create policy "admins view badge prints"
  on public.badge_prints for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'instructor')
  );
