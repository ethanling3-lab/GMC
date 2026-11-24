-- Motivation · 报名动机 now means WHY the participant is attending, and a
-- person can have several (ordered: first = main reason), like
-- goal_dimensions. The old single `motivation_tag` enum mixed "who they are"
-- (insurance / direct sales) with "why they came" (spiritual).
--
-- "Who they are" survives as its own flag, `sells_products`, so grouping can
-- still spread people who sell insurance / direct-sales products across
-- groups.
--
-- Additive only. `motivation_tag` (+ its enum) is left in place, unused by
-- the new code, because the currently deployed build still selects it. Drop
-- it in a cleanup migration after this code is live. Existing values were
-- test dummies (Ethan, 2026-11-24), so nothing is carried over.

alter table participants
  add column if not exists motivations text[] not null default '{}',
  add column if not exists sells_products boolean not null default false;

do $$ begin
  alter table participants
    add constraint participants_motivations_check
    check (
      motivations <@ array['networking','spiritual','business','family','other']::text[]
    );
exception when duplicate_object then null; end $$;

create index if not exists participants_motivations_idx
  on participants using gin (motivations);
