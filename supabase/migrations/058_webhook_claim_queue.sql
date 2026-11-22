-- Gate 2, step 7: make inbound durable.
--
-- WHAT IS WRONG TODAY
--
-- ingest.ts does all of this INSIDE the webhook request: media downloads,
-- identity resolution, message insert, and a full Claude tool-use loop that
-- can take tens of seconds. Three properties combine badly:
--
--   1. The webhook_events dedupe row is committed FIRST, before the work it
--      guards. Step 1 inserts it; steps 2-7 do the work.
--   2. The route returns 200 on error (`{ok:true, ingest_error:true}`).
--   3. Meta only retries on a non-2xx.
--
-- So any mid-pipeline failure marks the message as seen, tells Meta it was
-- handled, and LOSES IT PERMANENTLY — with a console.warn as the only trace.
-- That is the same silent-failure shape as the 401s that sat unnoticed for two
-- months and the alert fan-out that resolved to zero recipients.
--
-- THE MODEL
--
-- webhook_events stops being a dedupe ledger and becomes a claim queue. The
-- webhook does the minimum that must be synchronous — verify, parse, enqueue —
-- and returns 200. A worker claims rows and does the real work, so a crash
-- leaves a row in `pending`/`processing` to be retried rather than a gap.
--
-- Dedupe is unchanged: the unique index on (channel, external_event_id) still
-- makes a replayed webhook a no-op, but now it is the ENQUEUE that is
-- idempotent, not the processing.

begin;

-- 1. Queue state ---------------------------------------------------------------

alter table webhook_events
  add column if not exists status text not null default 'pending',
  add column if not exists attempts int not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text,
  -- Serialisation key. Every event for one person carries the same value, so
  -- the claim can hand a whole conversation to ONE worker and keep its
  -- messages in order. During Phase 1 QA two messages 0.6s apart produced two
  -- near-identical AI replies and two charges; that is what this prevents.
  add column if not exists thread_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'webhook_events_status_check'
  ) then
    alter table webhook_events
      add constraint webhook_events_status_check
      check (status in ('pending','processing','done','dead'));
  end if;
end $$;

-- 2. Backfill ------------------------------------------------------------------
--
-- CRITICAL. 43 rows going back to 2026-04-23 are already processed. The column
-- default is 'pending', so without this the first worker run would replay four
-- months of history — re-running identity resolution and the AI reply loop
-- against messages answered long ago. Everything that exists now is done.
update webhook_events
set status = 'done',
    processed_at = coalesce(processed_at, received_at)
where status = 'pending';

-- 3. Claim index ---------------------------------------------------------------
create index if not exists webhook_events_claim_idx
  on webhook_events (status, next_attempt_at, received_at)
  where status in ('pending', 'processing');

-- 4. The claim -----------------------------------------------------------------
--
-- Claims whole THREADS, not individual rows, and never a thread that already
-- has a row in flight. Two properties fall out:
--
--   * one person's rapid-fire messages are processed in order, by one worker
--   * a second concurrent worker cannot interleave with the first
--
-- The second guarantee does NOT come from `for update skip locked` — a
-- concurrent call would evaluate the not-exists check before the first commits
-- and pass it. It comes from the UPDATE itself: in READ COMMITTED, a blocked
-- UPDATE re-evaluates its WHERE clause after acquiring the row lock, by which
-- point status is no longer 'pending' and the row no longer matches. The
-- second caller gets zero rows for that thread, which is exactly right.
--
-- Stale 'processing' rows are NOT reclaimed here — that is the sweeper's job,
-- so a slow worker is never raced by the claim path itself.
create or replace function public.claim_webhook_events(p_thread_limit int default 5)
returns setof webhook_events
language sql
as $$
  update webhook_events e
  set status = 'processing',
      locked_at = now(),
      attempts = e.attempts + 1
  where e.status = 'pending'
    and e.next_attempt_at <= now()
    and e.thread_key in (
      select w.thread_key
      from webhook_events w
      where w.status = 'pending'
        and w.next_attempt_at <= now()
        and not exists (
          select 1 from webhook_events p
          where p.thread_key is not distinct from w.thread_key
            and p.status = 'processing'
        )
      group by w.thread_key
      order by min(w.received_at)
      limit p_thread_limit
    )
  returning e.*;
$$;

-- 5. Reap abandoned workers ----------------------------------------------------
--
-- A crashed or timed-out worker leaves a row stuck in 'processing' forever.
-- Returns it to 'pending' with a backoff so the next drain picks it up.
-- Attempts is NOT incremented here: the claim already counted this try, and
-- double-counting would dead-letter a message after half as many real attempts.
create or replace function public.reap_stale_webhook_events(p_older_than interval default interval '10 minutes')
returns int
language sql
as $$
  with reaped as (
    update webhook_events
    set status = 'pending',
        locked_at = null,
        next_attempt_at = now(),
        last_error = coalesce(last_error, 'reclaimed from a worker that never finished')
    where status = 'processing'
      and locked_at < now() - p_older_than
    returning 1
  )
  select coalesce(count(*), 0)::int from reaped;
$$;

commit;
