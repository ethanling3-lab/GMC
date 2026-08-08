-- Separate the TABLE number from the GROUP number.
--
-- Until now they were the same number. There was no table identifier at all:
-- a table's on-canvas label was derived from whichever group happened to be
-- paired to it (`GROUP 3 · 组 3`, with a `Table 3` fallback), so the number
-- staff and attendees read off the plan was really `event_groups.group_no`.
--
-- But `group_no` is handed out 1..k by the grouping algorithm walking class
-- order (strategic → key → growth → maintenance), so it encodes WHEN a group
-- was formed, not WHERE it sits. The real workflow is two-phase: group people
-- first, then seat those groups at physical tables. The number that matters
-- downstream — to attendees, door staff, the printed plan — is the table.
--
-- So:
--   event_floor_plan_shapes.table_no  — the PHYSICAL identity of a table.
--                                       Venue-numbered, unique per event.
--   event_groups.group_no             — stays the INTERNAL key. Never
--                                       renumbered. Pins, the XLSX importer,
--                                       and every member-move action keep
--                                       resolving by it.
--
-- Display everywhere becomes `table_no ?? group_no` with the unit still
-- Group / 组 — a group seated at table 7 reads "Group 7 · 第 7 组" even when
-- it is internally group_no 3. See src/lib/group-number.ts.
--
-- The two backfills below make deploying a visual no-op: every label reads
-- exactly as it did before, until someone runs Auto-number in the editor.

alter table public.event_floor_plan_shapes
  add column if not exists table_no int;

-- Backfill 1 — from the currently-paired group. This is what preserves
-- today's on-screen numbers.
--
-- `shapes.group_id` has no unique constraint, so two shapes CAN point at one
-- group (which already double-renders that roster today). Rank and let only
-- one win, otherwise the unique index below fails to build.
with ranked as (
  select s.id,
         g.group_no,
         row_number() over (
           partition by s.event_id, g.group_no
           order by s.z_order, s.created_at, s.id
         ) as rn
    from public.event_floor_plan_shapes s
    join public.event_groups g on g.id = s.group_id
   where s.kind in ('round_table', 'square_table')
)
update public.event_floor_plan_shapes s
   set table_no = r.group_no
  from ranked r
 where r.id = s.id
   and r.rn = 1
   and s.table_no is null;

-- Backfill 2 — from a numeric `label_en`. Vision auto-detect already reads
-- the printed table number off an uploaded floor plan and writes it there
-- (LayoutEditor.acceptCandidate), so those numbers are real venue numbers
-- and worth promoting into the structured column.
--
-- Takes the first 1-3 digit run, skips numbers already claimed by backfill 1,
-- and dedupes within the event. `label_en` is deliberately NOT cleared —
-- ShapeNode now prefers table_no over it, and the free text may carry a name
-- ("Head table 12") worth keeping.
with parsed as (
  select s.id,
         s.event_id,
         (regexp_match(s.label_en, '(\d{1,3})'))[1]::int as n
    from public.event_floor_plan_shapes s
   where s.kind in ('round_table', 'square_table')
     and s.table_no is null
     and s.label_en ~ '\d'
), ok as (
  select p.id,
         p.n,
         row_number() over (partition by p.event_id, p.n order by p.id) as rn
    from parsed p
   where p.n between 1 and 999
     and not exists (
       select 1
         from public.event_floor_plan_shapes t
        where t.event_id = p.event_id
          and t.table_no = p.n
     )
)
update public.event_floor_plan_shapes s
   set table_no = o.n
  from ok o
 where o.id = s.id
   and o.rn = 1;

-- Constraints come AFTER the backfills so a bad backfill can't half-apply.

-- Unique per event, nulls free. Note for the API layer: unique INDEXES cannot
-- be DEFERRABLE, and a partial constraint can't be expressed as a deferrable
-- table constraint either — so a renumber that swaps T3 <-> T4 in a single
-- statement WILL raise 23505 mid-batch. The shapes route pre-nulls the rows
-- it is about to overwrite, mirroring the two-phase pattern auto-place
-- already uses for (shape_id, seat_no).
create unique index if not exists event_floor_plan_shapes_table_no_key
  on public.event_floor_plan_shapes (event_id, table_no)
  where table_no is not null;

-- Only actual tables carry a number — not stages, doors, walls or cushions.
alter table public.event_floor_plan_shapes
  drop constraint if exists event_floor_plan_shapes_table_no_kind_ck;
alter table public.event_floor_plan_shapes
  add constraint event_floor_plan_shapes_table_no_kind_ck
  check (table_no is null or kind in ('round_table', 'square_table')) not valid;
alter table public.event_floor_plan_shapes
  validate constraint event_floor_plan_shapes_table_no_kind_ck;

alter table public.event_floor_plan_shapes
  drop constraint if exists event_floor_plan_shapes_table_no_positive_ck;
alter table public.event_floor_plan_shapes
  add constraint event_floor_plan_shapes_table_no_positive_ck
  check (table_no is null or table_no > 0) not valid;
alter table public.event_floor_plan_shapes
  validate constraint event_floor_plan_shapes_table_no_positive_ck;

comment on column public.event_floor_plan_shapes.table_no is
  'Physical table number (1-based, unique per event, null for non-table kinds). Independent of event_groups.group_no: a group PLACED at this table displays this number, an unplaced group falls back to its group_no. Set by Auto-number (layout order) or by hand in the inspector. Belongs to the furniture, not the roster — un-pairing a group leaves it intact, and it survives Regenerate (which only SET NULLs group_id).';
