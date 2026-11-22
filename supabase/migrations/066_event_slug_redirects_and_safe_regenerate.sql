-- 066_event_slug_redirects_and_safe_regenerate.sql
--
-- 1. Old event links keep working after a slug change. The trigger records
--    every old slug, so no write path can forget to.
-- 2. Regenerating a transfer list replaces it in one transaction, so a failed
--    save can never lose the list or its manual edits.

create table if not exists event_slug_redirects (
  old_slug text primary key,
  event_id uuid not null references events(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists event_slug_redirects_event_idx
  on event_slug_redirects (event_id);

-- Server-only: no policies, so only the service role can read or write it.
alter table event_slug_redirects enable row level security;

create or replace function record_event_slug_redirect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug then
    insert into event_slug_redirects (old_slug, event_id)
    values (old.slug, new.id)
    on conflict (old_slug) do update
      set event_id = excluded.event_id, created_at = now();
    -- Changing back to an earlier slug makes it live again.
    delete from event_slug_redirects where old_slug = new.slug;
  end if;
  return new;
end;
$$;

revoke all on function record_event_slug_redirect() from public, anon, authenticated;

drop trigger if exists events_record_slug_redirect on events;
create trigger events_record_slug_redirect
  after update of slug on events
  for each row execute function record_event_slug_redirect();

create or replace function replace_transfer_list(
  p_event_id uuid,
  p_direction flight_direction,
  p_generated_by uuid,
  p_rules jsonb,
  p_rows jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_list_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text || ':' || p_direction::text));

  if exists (
    select 1 from transfer_lists
    where event_id = p_event_id and direction = p_direction and status = 'final'
  ) then
    raise exception 'already_finalized' using errcode = 'P0001';
  end if;

  delete from transfer_lists
  where event_id = p_event_id and direction = p_direction;

  insert into transfer_lists (event_id, direction, status, generated_by, rules_snapshot)
  values (p_event_id, p_direction, 'draft', p_generated_by, p_rules)
  returning id into v_list_id;

  insert into transfer_list_rows (
    transfer_list_id, group_no, vehicle_type, landing_or_takeoff_at, terminal,
    destination, remark, vip, flight_info_ids, manual_passengers, admin_edited
  )
  select
    v_list_id, r.group_no, r.vehicle_type, r.landing_or_takeoff_at, r.terminal,
    r.destination, r.remark, coalesce(r.vip, false),
    coalesce(r.flight_info_ids, '{}'), coalesce(r.manual_passengers, '[]'::jsonb),
    coalesce(r.admin_edited, false)
  from jsonb_to_recordset(p_rows) as r(
    group_no int,
    vehicle_type text,
    landing_or_takeoff_at timestamptz,
    terminal text,
    destination text,
    remark text,
    vip boolean,
    flight_info_ids uuid[],
    manual_passengers jsonb,
    admin_edited boolean
  );

  return v_list_id;
end;
$$;

revoke all on function replace_transfer_list(uuid, flight_direction, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function replace_transfer_list(uuid, flight_direction, uuid, jsonb, jsonb)
  to service_role;
