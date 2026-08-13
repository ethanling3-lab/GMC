-- Retire the participant lifecycle enum. Replace it with one honest axis.
--
-- WHAT participant_status WAS
--
--   create type participant_status as enum
--     ('new', 'info_verified', 'cs_enriched', 'active', 'inactive');   -- 001
--   alter type participant_status add value 'lead';                    -- 014
--
-- Five of those six values described a CS enrichment pipeline that nobody
-- ever ran. The sixth, 'lead', described something entirely different and
-- genuinely useful: "this row was auto-created from an inbound WhatsApp
-- message and has never been confirmed to be a real, distinct person."
--
-- Conflating those two ideas in one column cost reach in three places:
--
--   src/lib/broadcasts/types.ts:96   default audience excluded 'lead', so
--                                    every person who had only ever messaged
--                                    us on WhatsApp was invisible to every
--                                    broadcast — silently, by default.
--
--   src/lib/broadcasts/audience.ts   archived:"active" was hardcoded with no
--                                    toggle, so archived people could not be
--                                    reached at all.
--
--   src/lib/inbox/identity.ts:150    softMatchExistingParticipant filtered
--                                    .neq("status","inactive"). An inactive
--                                    participant who messaged us therefore
--                                    failed to match their own record and the
--                                    webhook auto-created a DUPLICATE row.
--                                    Same bug class as 052's phone mismatch.
--
-- WHAT REPLACES IT
--
-- identity_confidence — 'unverified' | 'verified'. Strictly narrower and
-- strictly more useful:
--
--   unverified  This row came from an inbound identifier and nothing has
--               confirmed it maps to a real distinct person. Formerly 'lead'.
--   verified    A human or a completed transaction confirmed it.
--
-- It is NOT a lifecycle. It never moves backwards on its own, nothing
-- filters outreach by it, and it exists to answer exactly one question:
-- may the AI hand this conversation tools that read personal data?
--
-- Reachability after this migration is a single predicate with no enum in
-- it: has a phone_e164, has not opted out, is not archived.
-- Segmentation is event cohort + programme. Nothing else.
--
-- SAFE TO DROP DESTRUCTIVELY: every participants row today is M6_TEST_DUMMY
-- seed data. This will never be cheaper to do.

begin;

-- 1. The replacement column ------------------------------------------------

alter table public.participants
  add column if not exists identity_confidence text not null default 'unverified';

alter table public.participants
  add constraint participants_identity_confidence_ck
  check (identity_confidence in ('unverified', 'verified'));

comment on column public.participants.identity_confidence is
  'unverified = auto-created from an inbound identifier, never confirmed to be '
  'a real distinct person (this is what status=''lead'' used to mean). '
  'verified = confirmed by an admin merge, an approved/paid enrollment, or a '
  'pre-existing contact_identifiers row. '
  'GATES AI TOOL ACCESS: personal-data tools (get_my_status, get_price) are '
  'omitted from the model''s tool list entirely for unverified conversations — '
  'not refused by the prompt, ABSENT. Never widen this without re-reading '
  'src/lib/inbox/ai/tools.ts. Set only in code, never by a model.';

-- 2. Backfill ---------------------------------------------------------------
--
-- Anything that was not a 'lead' predates the inbox and was created by a real
-- registration flow, so it is verified. Leads stay unverified UNLESS they have
-- since transacted — a completed payment is the strongest possible confirmation
-- that a phone number belongs to a real person.

update public.participants p
   set identity_confidence = 'verified'
 where p.status <> 'lead'
    or exists (
         select 1
           from public.enrollments e
          where e.participant_id = p.id
            and e.status in ('approved', 'paid')
       );

-- 3. Repoint the lead-merge RPC's guards at the new column -------------------
--
-- 016_inbox_lead_merge.sql reads participants.status twice, purely to assert
-- "source must be a lead, target must not be." Dropping the column below would
-- break the function at its next call, so the guards move to
-- identity_confidence: fold an unverified row into a verified one, never the
-- reverse, and never two verified rows (a real-person merge needs a human
-- decision this CRM does not model).
--
-- EVERYTHING ELSE IS 016 VERBATIM and must stay that way — the enrollment
-- conflict check, the (channel, identifier) collision drop, the per-step move
-- counters, and the jsonb return shape the admin route renders. Note the
-- return type is `jsonb`, NOT void: Postgres refuses to change a function's
-- return type in place, so getting this wrong fails loudly rather than
-- silently shipping a gutted merge.
create or replace function public.merge_lead_into_participant(
  p_lead_id uuid,
  p_target_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead   record;
  v_target record;
  v_moved_identifiers int := 0;
  v_dropped_identifiers int := 0;
  v_moved_conversations int := 0;
  v_moved_enrollments int := 0;
  v_conflict_event uuid;
  v_moved_notifications int := 0;
begin
  if p_lead_id is null or p_target_id is null then
    raise exception 'merge: lead_id and target_id are required';
  end if;
  if p_lead_id = p_target_id then
    raise exception 'merge: lead_id and target_id must differ';
  end if;

  -- CHANGED IN 053: was `status`, guarded against 'lead'.
  select id, identity_confidence into v_lead
    from participants where id = p_lead_id for update;
  if not found then
    raise exception 'merge: lead participant % not found', p_lead_id;
  end if;
  if v_lead.identity_confidence is distinct from 'unverified' then
    raise exception 'merge: participant % is not unverified (identity_confidence=%)',
      p_lead_id, v_lead.identity_confidence;
  end if;

  -- CHANGED IN 053: was `status`, guarded against 'lead'.
  select id, identity_confidence into v_target
    from participants where id = p_target_id for update;
  if not found then
    raise exception 'merge: target participant % not found', p_target_id;
  end if;
  if v_target.identity_confidence = 'unverified' then
    raise exception 'merge: target % is also unverified — merge into a confirmed participant instead', p_target_id;
  end if;

  -- 1. Enrolment conflict check (surface the first colliding event_id for the
  --    error message so admin can resolve manually).
  select e_lead.event_id into v_conflict_event
  from enrollments e_lead
  where e_lead.participant_id = p_lead_id
    and exists (
      select 1 from enrollments e_target
      where e_target.participant_id = p_target_id
        and e_target.event_id = e_lead.event_id
    )
  limit 1;
  if v_conflict_event is not null then
    raise exception 'merge: both participants have an enrollment for event % — resolve duplicates before merging', v_conflict_event;
  end if;

  -- 2. Drop lead-side contact_identifiers that would collide with target-side
  --    on the (channel, identifier) unique constraint. Target wins.
  with drops as (
    delete from contact_identifiers c
    where c.participant_id = p_lead_id
      and exists (
        select 1 from contact_identifiers t
        where t.participant_id = p_target_id
          and t.channel = c.channel
          and t.identifier = c.identifier
      )
    returning 1
  )
  select count(*) into v_dropped_identifiers from drops;

  -- 3. Reparent remaining contact_identifiers.
  with moved as (
    update contact_identifiers
    set participant_id = p_target_id
    where participant_id = p_lead_id
    returning 1
  )
  select count(*) into v_moved_identifiers from moved;

  -- 4. Reparent conversations.
  with moved as (
    update conversations
    set participant_id = p_target_id
    where participant_id = p_lead_id
    returning 1
  )
  select count(*) into v_moved_conversations from moved;

  -- 5. Reparent enrollments (conflict check already ran above).
  with moved as (
    update enrollments
    set participant_id = p_target_id
    where participant_id = p_lead_id
    returning 1
  )
  select count(*) into v_moved_enrollments from moved;

  -- 6. Reparent notifications so the audit trail survives.
  with moved as (
    update notifications
    set participant_id = p_target_id
    where participant_id = p_lead_id
    returning 1
  )
  select count(*) into v_moved_notifications from moved;

  -- 7. Delete the lead.
  delete from participants where id = p_lead_id;

  return jsonb_build_object(
    'lead_id', p_lead_id,
    'target_id', p_target_id,
    'moved_identifiers', v_moved_identifiers,
    'dropped_duplicate_identifiers', v_dropped_identifiers,
    'moved_conversations', v_moved_conversations,
    'moved_enrollments', v_moved_enrollments,
    'moved_notifications', v_moved_notifications
  );
end;
$$;

revoke all on function public.merge_lead_into_participant(uuid, uuid) from public;
revoke all on function public.merge_lead_into_participant(uuid, uuid) from anon;
revoke all on function public.merge_lead_into_participant(uuid, uuid) from authenticated;

-- 4. Drop the old axis ------------------------------------------------------

drop index if exists public.participants_status_idx;

alter table public.participants drop column status;

drop type if exists public.participant_status;

create index participants_identity_confidence_idx
  on public.participants (identity_confidence)
  where identity_confidence = 'unverified';

commit;
