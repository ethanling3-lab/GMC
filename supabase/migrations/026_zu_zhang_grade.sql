-- M6.0 follow-up: leader grade (intra-tier priority ordering).
--
-- Tiers + classes establish *which* group a 组长 leads; grade decides
-- *which* leader of a tier gets the most prominent placement (e.g. the
-- center-front table). M6.6 floor plan editor consumes this ordering
-- alongside priority-table tags on the venue layout.
--
-- Both columns are nullable: ungraded leaders sort to the bottom of
-- their tier's seeding queue. Per-event override mirrors the existing
-- zu_zhang_tier / zu_zhang_tier_for_event pattern.

alter table participants
  add column if not exists zu_zhang_grade int;

do $$ begin
  alter table participants
    add constraint participants_zu_zhang_grade_check
    check (zu_zhang_grade is null or zu_zhang_grade between 1 and 5);
exception when duplicate_object then null; end $$;

alter table enrollments
  add column if not exists zu_zhang_grade_for_event int;

do $$ begin
  alter table enrollments
    add constraint enrollments_zu_zhang_grade_for_event_check
    check (zu_zhang_grade_for_event is null or zu_zhang_grade_for_event between 1 and 5);
exception when duplicate_object then null; end $$;

create index if not exists participants_zu_zhang_grade_idx
  on participants (zu_zhang_grade)
  where zu_zhang_grade is not null;
