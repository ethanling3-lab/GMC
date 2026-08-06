-- Auto-protect hand-edited groups from Regenerate.
--
-- Until now the ONLY thing that shielded an admin's manual grouping edits
-- (renames, class changes, member moves, role/leader tweaks) from being
-- wiped by a Regenerate run was the explicit `locked` flag. If the admin
-- forgot to lock a group they had carefully tuned, one Regenerate threw
-- all of it away.
--
-- `edited` is set true automatically by every group/member mutation
-- handler the moment an admin touches a group. persistGroupingResult now
-- treats `locked OR edited` as protected — the group and its assignments
-- survive Regenerate intact, and fresh algorithm groups renumber around
-- them (same mechanism locked groups already use).
--
-- Distinction:
--   locked  — explicit, admin toggles the 🔒. A hard fence (also blocks
--             drag in/out).
--   edited  — implicit, stamped on any hand-edit. Soft protection: the
--             group survives Regenerate but is still freely editable.
--             The admin can hand a group back to the algorithm with the
--             "Reset to auto" control (clears edited via set_edited).

alter table public.event_groups
  add column if not exists edited boolean not null default false;

-- Partial index — like locked, only a subset of groups will be edited,
-- and persist filters on (event_id, edited=true).
create index if not exists event_groups_edited_idx
  on public.event_groups (event_id) where edited = true;

comment on column public.event_groups.edited is
  'Set true automatically on any admin edit. Protects the group + its assignments from Regenerate (like locked, but soft — still editable). Cleared by "Reset to auto".';
