-- 069_staff_role_access.sql
-- Staff roles are now Super Admin, Customer Service and Finance.
--
-- Row rules can't hide individual columns, so limited roles no longer read most
-- tables directly. Their pages go through role-checked server code that selects
-- fixed fields. Direct access that remains:
--   * customer service: their assigned participants (read only)
--   * finance: bank imports and bank transactions
--
-- Safe to run before the code ships: Super Admin access does not change, and
-- all active staff are Super Admins today.

begin;

-- Every existing role-based rule becomes Super Admin only, except the tables
-- handled separately below.
do $$
declare
  rule record;
begin
  for rule in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename not in ('bank_imports', 'bank_transactions', 'participants')
      and (
        coalesce(qual, '') ~ 'current_admin_role'
        or coalesce(with_check, '') ~ 'current_admin_role'
      )
  loop
    if rule.cmd = 'SELECT' or rule.cmd = 'DELETE' then
      execute format(
        'alter policy %I on public.%I using (is_super_admin())',
        rule.policyname, rule.tablename
      );
    elsif rule.cmd = 'INSERT' then
      execute format(
        'alter policy %I on public.%I with check (is_super_admin())',
        rule.policyname, rule.tablename
      );
    else
      execute format(
        'alter policy %I on public.%I using (is_super_admin()) with check (is_super_admin())',
        rule.policyname, rule.tablename
      );
    end if;
  end loop;
end $$;

-- Customer service reads only their assigned participants. Finance has no
-- direct read. All staff edits go through server routes that record history.
alter policy "admins can view participants" on public.participants
  using (
    is_super_admin()
    or (current_admin_role() = 'customer_service' and assigned_cs_id = auth.uid())
  );

alter policy "admins can update participants" on public.participants
  using (is_super_admin())
  with check (is_super_admin());

-- These were readable by any signed-in account, including participants.
alter policy "participant_family_links_admin_read" on public.participant_family_links
  using (is_super_admin());

alter policy "participant_conflict_pairs_admin_read" on public.participant_conflict_pairs
  using (is_super_admin());

commit;
