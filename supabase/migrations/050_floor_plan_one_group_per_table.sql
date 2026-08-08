-- One group sits at exactly one table.
--
-- The schema has always enforced the easy direction — a shape holds a single
-- `group_id`, so a table hosts at most one group. The reverse was unenforced:
-- two shapes could point at the SAME group. That already misbehaved (both
-- tables rendered the same roster, and auto-place's stale-pairing sweep could
-- leave one behind), but it becomes a correctness problem now that migration
-- 049 makes the table number the identity every downstream surface displays —
-- one group would resolve to two different numbers depending on which shape
-- the lookup happened to hit first.
--
-- Split from 049 deliberately: 049 had to apply cleanly regardless of existing
-- data, and this index would fail to build on a dirty row. The editor's
-- updateShape now clears the previous holder when a group is re-paired, so
-- new duplicates can't be created from the UI.
--
-- Pre-flight (run before applying — must return zero rows):
--   select event_id, group_id, count(*)
--     from public.event_floor_plan_shapes
--    where group_id is not null
--    group by 1, 2 having count(*) > 1;

create unique index if not exists event_floor_plan_shapes_group_key
  on public.event_floor_plan_shapes (event_id, group_id)
  where group_id is not null;

comment on index public.event_floor_plan_shapes_group_key is
  'One group is paired to at most one table per event. Guarantees the group → table_no lookup in src/lib/floor-plan/table-numbers.ts is single-valued.';
