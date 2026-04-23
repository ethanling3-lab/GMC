-- 016_inbox_lead_merge.sql
--
-- RPC `merge_lead_into_participant(p_lead_id, p_target_id)` — folds an
-- inbox-auto-created lead into an existing participant in a single transaction.
--
-- Moves:
--   contact_identifiers (resolves (channel, identifier) unique conflicts by
--     dropping the lead-side duplicates — target wins)
--   conversations   (reparents participant_id)
--   enrollments     (reparents; aborts if both sides hold a row for the same
--     event because enrollments_unique_per_event would fire)
--   notifications   (reparents to keep the audit trail intact)
--
-- Then deletes the lead participant. Any remaining cascades (messages through
-- conversations, audit logs, etc.) are already reparented or safely null.
--
-- Validation:
--   - Both ids must exist.
--   - Lead must actually be status='lead' — prevents fat-fingered merges of
--     a real participant into another.
--   - Target must not be status='lead'.
--   - Lead and target must differ.
--
-- Security:
--   - `security definer` so callers can invoke without direct table privileges,
--     but the API route owns authorisation (admin role + region scoping).
--   - `search_path = public` locks the function to this schema.

create or replace function merge_lead_into_participant(
  p_lead_id uuid,
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead record;
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

  select id, status into v_lead from participants where id = p_lead_id for update;
  if not found then
    raise exception 'merge: lead participant % not found', p_lead_id;
  end if;
  if v_lead.status is distinct from 'lead' then
    raise exception 'merge: participant % is not a lead (status=%)', p_lead_id, v_lead.status;
  end if;

  select id, status into v_target from participants where id = p_target_id for update;
  if not found then
    raise exception 'merge: target participant % not found', p_target_id;
  end if;
  if v_target.status = 'lead' then
    raise exception 'merge: target % is also a lead — merge into a real participant instead', p_target_id;
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

  -- 7. Delete the lead. Any ancillary cascades (family_of_participant_id,
  --    referrer_id) set null — those shouldn't point at a fresh lead anyway.
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

-- Lock down execute. The API route uses service_role which bypasses grants,
-- but anon/authenticated must not call this directly from the client.
revoke all on function merge_lead_into_participant(uuid, uuid) from public;
revoke all on function merge_lead_into_participant(uuid, uuid) from anon;
revoke all on function merge_lead_into_participant(uuid, uuid) from authenticated;
