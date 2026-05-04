-- M6.0 follow-up — replace the per-trait numeric scoring (zu_zhang_traits
-- JSONB) with a categorical "core traits" multi-select. Five trait
-- options; admin tags the ones that define the group leader.
--
-- The original `zu_zhang_traits` column shipped in 022 carried no data
-- in production (UI only just landed) so it's safe to drop.

do $$ begin
  create type zu_zhang_trait as enum (
    'logical_thinking',     -- 逻辑性
    'social_intelligence',  -- 社交性
    'adaptability',         -- 灵动性
    'goal_orientation',     -- 目标性
    'attention_to_detail'   -- 严谨性
  );
exception when duplicate_object then null; end $$;

alter table participants
  add column if not exists zu_zhang_core_traits zu_zhang_trait[] not null default '{}';

alter table participants
  drop column if exists zu_zhang_traits;
