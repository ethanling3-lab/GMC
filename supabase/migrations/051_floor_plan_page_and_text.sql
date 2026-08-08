-- Printable page size + manual seat-name text sizing.
--
-- Two things admins could not control before, both of which decide whether a
-- printed seating chart is actually usable in the room:
--
-- 1. PAGE SIZE. The printable area was the compile-time constant 300×180
--    user-space units (a 5:3 ratio that matches no real paper). Exports
--    inherited it, so an A3 printout always carried white margins.
--
--    Units are now read as MILLIMETRES, which makes the presets exact: A4
--    landscape = 297×210, A3 = 420×297, A2 = 594×420, A1 = 841×594. The
--    default stays 300×180 so every existing plan renders byte-identically
--    until someone picks a preset — shapes keep their coordinates, the page
--    rectangle around them changes.
--
-- 2. SEAT-NAME TEXT SIZE. Every font size in the editor is derived from shape
--    geometry (seat radius × a factor), so a crowded 14-seat table rendered
--    names too small to read on paper with no way to intervene. `name_scale`
--    is a multiplier applied to seat-name labels only — the centre numeral
--    keeps auto-sizing so tables stay visually consistent.
--
--    Resolution order: shape.name_scale ?? event.floor_plan_name_scale ?? 1.
--    The per-shape column is nullable precisely so "inherit the event default"
--    is distinguishable from "explicitly set to 1.0".

alter table public.events
  add column if not exists floor_plan_page_w numeric not null default 300,
  add column if not exists floor_plan_page_h numeric not null default 180,
  -- Which preset produced the w/h above, for the picker's selected state.
  -- Null = custom / legacy. Purely cosmetic: w/h are the source of truth.
  add column if not exists floor_plan_page_preset text,
  add column if not exists floor_plan_name_scale numeric not null default 1;

alter table public.event_floor_plan_shapes
  -- Nullable = inherit the event default. Only meaningful on seated kinds.
  add column if not exists name_scale numeric;

-- Sanity bounds. Page min 50mm keeps the canvas usable; max 2000mm covers A0+
-- and any plotter roll anyone would sanely print a seating chart on.
alter table public.events
  drop constraint if exists events_floor_plan_page_chk;
alter table public.events
  add constraint events_floor_plan_page_chk
  check (
    floor_plan_page_w between 50 and 2000
    and floor_plan_page_h between 50 and 2000
  ) not valid;
alter table public.events
  validate constraint events_floor_plan_page_chk;

-- Text scale: 0.5×–3× on both the event default and the per-shape override.
-- Wider than anyone should need, tight enough that a fat-fingered value can't
-- render a plan as one giant unreadable glyph.
alter table public.events
  drop constraint if exists events_floor_plan_name_scale_chk;
alter table public.events
  add constraint events_floor_plan_name_scale_chk
  check (floor_plan_name_scale between 0.5 and 3) not valid;
alter table public.events
  validate constraint events_floor_plan_name_scale_chk;

alter table public.event_floor_plan_shapes
  drop constraint if exists event_floor_plan_shapes_name_scale_chk;
alter table public.event_floor_plan_shapes
  add constraint event_floor_plan_shapes_name_scale_chk
  check (name_scale is null or name_scale between 0.5 and 3) not valid;
alter table public.event_floor_plan_shapes
  validate constraint event_floor_plan_shapes_name_scale_chk;

comment on column public.events.floor_plan_page_w is
  'Printable page width in MILLIMETRES. Default 300 preserves the legacy 300×180 canvas. Presets write true paper sizes (A3 landscape = 420×297). Drives the SVG viewBox, shape clamp bounds, and the PNG/PDF/PPTX export aspect.';

comment on column public.events.floor_plan_name_scale is
  'Event-wide multiplier for seat-NAME label font sizes on the floor plan (not the centre numeral, which stays auto-sized). Overridden per table by event_floor_plan_shapes.name_scale.';

comment on column public.event_floor_plan_shapes.name_scale is
  'Per-table override for seat-name font scale. NULL = inherit events.floor_plan_name_scale. Nullable on purpose so "inherit" is distinct from "explicitly 1.0".';
