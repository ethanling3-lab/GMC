-- Phase 1 "nervous system": make an unseen message impossible.
--
-- THE INCIDENT THIS EXISTS FOR
--
-- A colleague messaged the staging number. `conversations.ai_enabled` defaults
-- to false, so the AI stayed silent — correct. Nobody noticed for days: no
-- unread badge, no notification, no live update. Separately, every Tier 1 reply
-- had been failing with 401/190 for two months, discovered only by a human
-- happening to read one thread.
--
-- Neither was a logic bug. Both were the absence of an observability layer.
--
-- WHY THIS SHIPS BEFORE THE DURABLE QUEUE AND THE AI WORK
--
-- It is the instrument the later phases are tested with. You cannot QA a
-- replayed webhook ("one message row or two?"), a STOP keyword, or an AI
-- handoff without watching messages land live. Today that loop is: send from a
-- phone, alt-tab, hard-refresh, squint.
--
-- CONTENTS
--   1. unread_conversation_counts()  — the read half of a half-built feature
--   2. admin_notifications           — new_inbound | ai_handoff | send_failed
--   3. realtime publication          — messages, conversations, notifications
--   4. customer_service RLS fix      — let triage see the triage queue

begin;

-- 1. Unread counts -----------------------------------------------------------
--
-- `conversation_reads` has existed since 014 and MarkReadOnMount has always
-- written the cursor. Nothing ever read it back: loadConversations never
-- joined, ConversationListRow had no field, InboxListItem rendered no badge.
-- The code comments said "Wave 2b will drive unread badges". Wave 2b never
-- shipped, so the cursor has been advancing into a void for months.
--
-- Deliberately takes NO admin_id parameter and resolves auth.uid() itself.
-- An id parameter on a function that reports what someone has not yet read is
-- an invitation to pass somebody else's. Runs SECURITY INVOKER (the default),
-- so the conversations RLS policy below still decides what is visible.
create or replace function public.unread_conversation_counts()
returns table (conversation_id uuid, unread_count integer)
language sql
stable
as $$
  select
    c.id,
    count(m.id)::integer
  from conversations c
  left join conversation_reads r
    on r.conversation_id = c.id
   and r.admin_id = auth.uid()
  left join messages m
    on m.conversation_id = c.id
   and m.direction = 'inbound'
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by c.id
  having count(m.id) > 0;
$$;

comment on function public.unread_conversation_counts() is
  'Per-admin unread inbound counts for the caller (auth.uid()). Only rows with '
  'unread_count > 0 are returned — the caller treats a missing conversation as '
  'zero, which keeps the payload proportional to what is actually unread '
  'rather than to the size of the inbox.';

-- 2. Admin notifications -----------------------------------------------------
--
-- One row per (admin, event). Distinct from `notifications`, which is the
-- participant-facing delivery log — these are for staff, and the two must not
-- be conflated.
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admins(id) on delete cascade,
  kind text not null check (kind in ('new_inbound', 'ai_handoff', 'send_failed')),
  conversation_id uuid references conversations(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists admin_notifications_unread_idx
  on public.admin_notifications (admin_id, created_at desc)
  where read_at is null and dismissed_at is null;

create index if not exists admin_notifications_conversation_idx
  on public.admin_notifications (conversation_id, kind, created_at desc);

comment on table public.admin_notifications is
  'Staff-facing alerts: new_inbound, ai_handoff, send_failed. NOT the same as '
  'public.notifications, which logs participant-facing sends. send_failed is '
  'the direct answer to the 401/190 incident — two months of failing replies '
  'that the system knew about and told nobody.';

alter table public.admin_notifications enable row level security;

-- An admin sees only their own alerts. No super-admin override: this is an
-- inbox, not an audit log — audit_log already covers accountability.
drop policy if exists "admins read own notifications" on public.admin_notifications;
create policy "admins read own notifications"
  on public.admin_notifications for select
  to authenticated
  using (admin_id = auth.uid());

drop policy if exists "admins update own notifications" on public.admin_notifications;
create policy "admins update own notifications"
  on public.admin_notifications for update
  to authenticated
  using (admin_id = auth.uid())
  with check (admin_id = auth.uid());

-- Inserts come from the service role (ingest, tier1 handoff, send failure),
-- which bypasses RLS. No insert policy on purpose: an admin must not be able
-- to manufacture another admin's alerts.

-- 3. Realtime ----------------------------------------------------------------
--
-- Adding a table already in the publication raises, so each is guarded.
-- Realtime still respects RLS, so a client subscription only receives rows the
-- subscriber could have selected.
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'conversations', 'admin_notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. Let customer_service see unassigned threads -----------------------------
--
-- The 014 policy grants customer_service a conversation only when the
-- participant is assigned to them (p.assigned_cs_id = auth.uid()) or the thread
-- already is (conversations.assigned_to = auth.uid()). A brand-new inbound from
-- an unknown number satisfies neither, so the queue of things most needing
-- triage was invisible to exactly the role that triages.
--
-- Adds unassigned threads. Deliberately does NOT grant CS another CS's
-- assigned threads — the gap being closed is "nobody owns this yet", not
-- "everybody sees everything".
drop policy if exists "admins view conversations" on conversations;
create policy "admins view conversations"
  on conversations for select
  to authenticated
  using (
    is_super_admin()
    or (current_admin_role() = 'regional_lead'
        and exists (
          select 1 from participants p
          where p.id = conversations.participant_id
            and p.region = current_admin_region()
        ))
    or (current_admin_role() = 'customer_service'
        and (
          conversations.assigned_to is null
          or conversations.assigned_to = auth.uid()
          or exists (
            select 1 from participants p
            where p.id = conversations.participant_id
              and p.assigned_cs_id = auth.uid()
          )
        ))
  );

commit;
