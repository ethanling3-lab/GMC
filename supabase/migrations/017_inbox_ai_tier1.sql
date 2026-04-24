-- 017_inbox_ai_tier1.sql
--
-- Adds a per-conversation AI toggle so admin can opt specific threads into
-- the Tier 1 auto-responder (public event info only; everything else
-- handoffs to a human). Default off — admin flips on deliberately.
--
-- The `ai_runs` telemetry table (migration 014) already has the shape we
-- need for per-invocation logging; no schema change there.

alter table conversations
  add column if not exists ai_enabled boolean not null default false;

create index if not exists conversations_ai_enabled_idx
  on conversations (ai_enabled)
  where ai_enabled = true;
