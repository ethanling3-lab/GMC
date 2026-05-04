-- M6.0 follow-up — programme tier (学员类别).
--
-- GMC's offering is programme-based: a student enrolls in a paid
-- programme (丰盛 / 荣贵 / 精英文化财 / 荣耀文化财) which entitles
-- them to attend events for just the 会务 (misc fee). Each programme
-- has different event-attendance privileges.
--
-- This migration introduces the concept as a single label column on
-- participants — admin manually tags which programme a student is in.
-- Full programme-enrollment tracking (payment, dates, entitlement
-- enforcement) is intentionally OUT of scope here; that's a separate
-- milestone.
--
-- Pricing reference (informational, not enforced in schema):
--   abundance               (丰盛)            S$16,135 / on-site S$15,135
--   glorious_family         (荣贵)            S$38,135 / on-site S$36,135
--   elite_cultural_heritage (精英文化财)       S$70,000 / on-site S$65,000
--   glorious_cultural_heritage (荣耀文化财)    S$104,000 / on-site S$96,000

do $$ begin
  create type programme_tier as enum (
    'abundance',                  -- 丰盛
    'glorious_family',            -- 荣贵
    'elite_cultural_heritage',    -- 精英文化财
    'glorious_cultural_heritage'  -- 荣耀文化财
  );
exception when duplicate_object then null; end $$;

alter table participants
  add column if not exists programme_tier programme_tier;
-- null = no programme enrolled yet (admin hasn't tagged or student
-- isn't in a programme). Admin tags this on the participant detail
-- page. Algorithm doesn't read this — it's metadata for admin
-- workflow + the upgrade-potential pairing.

create index if not exists participants_programme_tier_idx
  on participants (programme_tier)
  where programme_tier is not null;
-- For roster filters: "show me everyone in 荣贵 programme" lookups.
