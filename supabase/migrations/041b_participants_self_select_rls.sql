-- M8 follow-up: defense-in-depth RLS policy so a logged-in participant
-- can SELECT their own row by auth_user_id link.
--
-- Background: the existing `admins can view participants` policy (from
-- 001_initial_schema.sql) gates SELECT to admin roles only. When a
-- participant signs in via /api/auth/participant/login the API route
-- needs to look up `participants` by auth_user_id — but the anon
-- session won't see anything past the admin gate, so the login route
-- now uses service-role for that lookup (see src/lib/participant-guard.ts
-- + src/app/api/auth/participant/login/route.ts).
--
-- This policy adds belt-and-braces: even if a future code path reads
-- `participants` via the anon client (e.g. a client-side useEffect
-- fetch), a participant can still see their own row. Admin policies
-- still cover cross-participant visibility.

create policy "participants can view themselves"
  on public.participants for select
  to authenticated
  using (auth_user_id = auth.uid());

comment on policy "participants can view themselves" on public.participants is
  'M8: lets a logged-in participant see their own row by auth_user_id link. Admin policies still cover cross-participant visibility.';
