-- Staff accounts.
--
-- Removing someone's access keeps their row, because 18 tables point at admins
-- with ON DELETE SET NULL and deleting it would erase who approved, paid or
-- changed things. A removed person stops counting as an admin everywhere,
-- since every RLS policy goes through the three helper functions below.

alter table admins add column if not exists deactivated_at timestamptz;

create or replace function current_admin_role() returns admin_role as $$
  select role from admins where id = auth.uid() and deactivated_at is null
$$ language sql stable security definer;

create or replace function current_admin_region() returns text as $$
  select region from admins where id = auth.uid() and deactivated_at is null
$$ language sql stable security definer;

create or replace function is_super_admin() returns boolean as $$
  select exists (
    select 1 from admins
    where id = auth.uid() and role = 'super_admin' and deactivated_at is null
  )
$$ language sql stable security definer;

-- The CRM must always keep one active super admin, whichever path changes it.
create or replace function protect_last_super_admin() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'super_admin'
     and old.deactivated_at is null
     and (
       tg_op = 'DELETE'
       or new.role <> 'super_admin'
       or new.deactivated_at is not null
     )
  then
    perform pg_advisory_xact_lock(hashtext('admins_last_super_admin'));
    if not exists (
      select 1 from admins
      where role = 'super_admin'
        and deactivated_at is null
        and id <> old.id
    ) then
      raise exception 'last_super_admin' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function protect_last_super_admin() from public, anon, authenticated;

drop trigger if exists admins_protect_last_super on admins;
create trigger admins_protect_last_super
  before update of role, deactivated_at or delete on admins
  for each row execute function protect_last_super_admin();

-- Remove access and hand back their work in one step, so no participant or
-- conversation stays assigned to someone who can no longer see it.
create or replace function deactivate_admin(p_admin_id uuid)
returns table (participants_released integer, conversations_released integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participants integer;
  v_conversations integer;
begin
  update admins
  set deactivated_at = now()
  where id = p_admin_id and deactivated_at is null;
  if not found then
    raise exception 'admin_not_active' using errcode = 'P0002';
  end if;

  update participants
  set assigned_cs_id = case when assigned_cs_id = p_admin_id then null else assigned_cs_id end,
      assigned_region_lead_id = case when assigned_region_lead_id = p_admin_id then null else assigned_region_lead_id end
  where assigned_cs_id = p_admin_id or assigned_region_lead_id = p_admin_id;
  get diagnostics v_participants = row_count;

  update conversations
  set assigned_to = null
  where assigned_to = p_admin_id;
  get diagnostics v_conversations = row_count;

  return query select v_participants, v_conversations;
end;
$$;

revoke all on function deactivate_admin(uuid) from public, anon, authenticated;
grant execute on function deactivate_admin(uuid) to service_role;
