-- Gate 2, step 6: model the WhatsApp 24-hour customer service window.
--
-- THE INCIDENT THIS EXISTS FOR
--
-- During Phase 1 QA an admin typed "hi" into the composer on a thread whose
-- last inbound was 53 hours old. The send was accepted by Meta, audit-logged
-- as `sent`, and then failed asynchronously with 131047 "Re-engagement
-- message". Cost: one guaranteed-doomed Graph call, one FAILED bubble in the
-- transcript, and a forensic query to explain why.
--
-- Nothing in this system knew the window existed. `isOutsideWindowError` in
-- whatsapp-templates-types.ts classifies the failure AFTER Meta reports it,
-- by substring-matching an error string. That is diagnosis, not prevention.
--
-- WHAT A WINDOW IS
--
-- Free-form messages are allowed only within 24h of the participant's last
-- inbound message. Outside it, only an approved template may be sent, and it
-- is the template that re-opens the thread. So the window is a function of
-- one fact: when did they last message us.
--
-- CONTENTS
--   1. last_inbound_at + generated window_expires_at
--   2. window_verified_closed_at / marketing_backoff_until
--   3. backfill from existing inbound messages
--   4. mark_conversation_inbound() — the only writer, monotonic

begin;

-- 1. The window ---------------------------------------------------------------

alter table conversations
  add column if not exists last_inbound_at timestamptz;

-- WHY THE at-time-zone DANCE, AND DO NOT "SIMPLIFY" IT
--
-- The obvious form — `last_inbound_at + interval '24 hours'` — is REJECTED
-- with `42P17 generation expression is not immutable`. `timestamptz + interval`
-- is only STABLE, because for day/month intervals the answer depends on the
-- session TimeZone (DST). Anchoring to UTC first makes it a plain
-- `timestamp + interval`, which IS immutable, and UTC has no DST so the result
-- is exactly +24h of absolute time. Verified against this database before
-- writing this migration.
alter table conversations
  add column if not exists window_expires_at timestamptz
  generated always as (
    ((last_inbound_at at time zone 'UTC') + interval '24 hours') at time zone 'UTC'
  ) stored;

-- 2. Signals the window model needs but cannot infer --------------------------
--
-- window_expires_at is our BELIEF about the window. These two record what the
-- provider actually told us, which can disagree:
--
--   window_verified_closed_at — Meta rejected a free-form send with 131047.
--     Ground truth that the window is shut, independent of our arithmetic.
--     Set it when the send path classifies `outside_window`, so a clock skew
--     or a missed inbound webhook cannot keep us optimistically retrying.
--
--   marketing_backoff_until — a per-thread pause after a frequency cap
--     (131049) or opt-out (131050). Distinct from the window: the window is
--     about recency, this is about permission. Retrying into either is what
--     damages the quality rating that gates every messaging-tier increase.
alter table conversations
  add column if not exists window_verified_closed_at timestamptz;

alter table conversations
  add column if not exists marketing_backoff_until timestamptz;

-- 3. Backfill -----------------------------------------------------------------
--
-- From the inbound messages we already have. delivered_at is populated on
-- every inbound row (ingest sets it from the provider timestamp), so it is a
-- truer "when did they message" than created_at, which is when we processed it.
-- Only fills NULLs, so re-running this migration cannot move a live window.
update conversations c
set last_inbound_at = s.max_at
from (
  select conversation_id, max(delivered_at) as max_at
  from messages
  where direction = 'inbound'
  group by conversation_id
) s
where s.conversation_id = c.id
  and c.last_inbound_at is null;

-- Supports "whose window closes soon" — the reason to keep the expiry in the
-- database rather than computing it only in TypeScript. Partial: a thread that
-- has never received an inbound message has no window to expire.
create index if not exists conversations_window_expires_at_idx
  on conversations (window_expires_at)
  where last_inbound_at is not null;

-- 4. The only writer ----------------------------------------------------------
--
-- MONOTONIC BY CONSTRUCTION. Meta retries webhooks for up to 7 days, and the
-- durable queue in the next migration will replay them deliberately. Writing
-- `now()` on ingest would let a replayed three-day-old webhook re-open a window
-- that is genuinely shut, and we would then send free-form into a closed thread
-- and eat a 131047 — the exact failure this migration prevents.
--
-- Takes the message's own timestamp and keeps the later of the two. GREATEST
-- ignores NULLs in Postgres, so the first inbound on a thread works without a
-- coalesce.
create or replace function public.mark_conversation_inbound(
  p_conversation_id uuid,
  p_at timestamptz
)
returns timestamptz
language sql
as $$
  update conversations
     set last_inbound_at = greatest(last_inbound_at, p_at),
         -- A fresh inbound is proof the thread is open again, so our record of
         -- a verified-closed window is stale the moment one arrives.
         window_verified_closed_at = case
           when greatest(last_inbound_at, p_at) > coalesce(window_verified_closed_at, '-infinity'::timestamptz)
             then null
           else window_verified_closed_at
         end
   where id = p_conversation_id
  returning last_inbound_at;
$$;

commit;
