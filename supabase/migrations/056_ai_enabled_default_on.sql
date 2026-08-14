-- Answer everyone by default.
--
-- 017 created `conversations.ai_enabled boolean not null default false`, so
-- every new thread started silent and waited for a staffer to notice it and
-- flip a per-thread toggle. That is exactly what happened to a colleague who
-- messaged the staging number: `ai_enabled` was false, the AI said nothing, and
-- with no unread badge, no alert and no realtime, nobody noticed for days.
--
-- WHAT HAD TO EXIST FIRST
--
-- Flipping this default was always one line. What made it unsafe was the
-- absence of everything around it:
--
--   * 054 — unread counts, realtime, and alerts on inbound / handoff / failed
--     send. You can now see what the AI is doing while it does it.
--   * 055 — a kill switch reachable from /admin/ai without a deploy, a daily
--     spend cap enforced before each Anthropic call, and per-conversation rate
--     limits that break a bot-to-bot loop cheaply.
--   * ai_runs.cost_cents — spend is finally computable, so the cap has
--     something real to enforce against.
--
-- Order mattered: default-on without an off switch is a system you can only
-- stop by deploying.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Existing conversations keep whatever `ai_enabled` they already have. A
-- thread a human deliberately took over stays taken over, and a thread the AI
-- handed off stays handed off — `handoffConversation` sets ai_enabled=false and
-- that decision must survive this migration. Only threads created from now on
-- start with the AI on.
--
-- HOW TO UNDO IT
--
-- Not by reverting this migration. Use the master switch at /admin/ai, which
-- stops every AI reply everywhere within 20 seconds and needs no deploy. That
-- is the rollback path, and it is the reason this change is safe to make.

begin;

alter table public.conversations
  alter column ai_enabled set default true;

comment on column public.conversations.ai_enabled is
  'Whether Tier 1 answers on this thread. Default TRUE since migration 056 — a '
  'new inbound gets an AI reply rather than silence. Set false by an admin '
  'toggle or by handoffConversation() when the AI decides it cannot help; both '
  'decisions persist. The master kill switch in ai_settings (055) overrides '
  'this column globally and is the correct way to stop the AI everywhere.';

commit;
