-- Close a read leak on events (found 2026-11-25, fixed 2026-11-26).
-- "admins can view all events" was granted TO authenticated USING (true), so
-- every signed-in MEMBER could read draft and planned events straight from the
-- database, even though the website hides them. Now:
--   • active staff (any role) read every event, as before;
--   • signed-in members read only what the public reads (open events).
-- Member and public pages load events with the server key, so they are
-- unaffected; this only stops direct reads with a member's own session.

drop policy if exists "admins can view all events" on public.events;

create policy "staff can view all events" on public.events
  for select to authenticated
  using (public.current_admin_role() is not null);

drop policy if exists "members can view open events" on public.events;
create policy "members can view open events" on public.events
  for select to authenticated
  using (status = 'open'::event_status);
