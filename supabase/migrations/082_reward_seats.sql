-- 名额 · Reward seats (Ethan, 2026-11-25).
-- A seat comes with a programme a member bought. It is for ONE course and
-- is given to a recipient — family, a business partner or a friend, never
-- the member themselves. When staff use it on the recipient's enrollment,
-- the course fee is waived and they pay the 会务费 only.
--
-- For now Super Admin issues seats by hand on the member's profile; the
-- payments phase will release them automatically at 定金 / 完款.
--
-- Lifecycle: available → assigned (recipient set) → used (on an
-- enrollment). Removing it from the enrollment, or cancelling/deleting
-- that enrollment, puts it back to assigned. cancelled = voided by staff.

create table if not exists public.reward_seats (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references public.participants(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  note text,                                   -- e.g. "荣贵 2026 purchase"
  status text not null default 'available'
    check (status in ('available', 'assigned', 'used', 'cancelled')),
  recipient_id uuid references public.participants(id) on delete set null,
  enrollment_id uuid unique references public.enrollments(id) on delete set null,
  issued_by uuid references public.admins(id) on delete set null,
  issued_at timestamptz not null default now(),
  assigned_at timestamptz,
  used_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  constraint reward_seats_not_to_self check (recipient_id is null or recipient_id <> holder_id),
  constraint reward_seats_state check (
    (status = 'available' and recipient_id is null and enrollment_id is null)
    or (status = 'assigned' and recipient_id is not null and enrollment_id is null)
    or (status = 'used' and recipient_id is not null and enrollment_id is not null)
    or (status = 'cancelled' and enrollment_id is null)
  )
);

create index if not exists reward_seats_holder_idx on public.reward_seats (holder_id);
create index if not exists reward_seats_recipient_idx on public.reward_seats (recipient_id) where recipient_id is not null;

-- Deleting an enrollment frees its seat (back to assigned) instead of
-- leaving a "used" seat pointing at nothing.
create or replace function public.reward_seats_release_on_enrollment_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.reward_seats
     set status = 'assigned', enrollment_id = null, used_at = null, updated_at = now()
   where enrollment_id = old.id;
  return old;
end $$;

drop trigger if exists reward_seats_release on public.enrollments;
create trigger reward_seats_release
  before delete on public.enrollments
  for each row execute function public.reward_seats_release_on_enrollment_delete();

-- A deleted recipient: an unused seat goes back to available; a used one
-- is kept as history (the enrollment cascade-deletes and the trigger above
-- has already reset it, so clear the recipient too).
create or replace function public.reward_seats_release_on_recipient_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.reward_seats
     set status = case when status = 'cancelled' then 'cancelled' else 'available' end,
         recipient_id = null, enrollment_id = null, assigned_at = null, used_at = null, updated_at = now()
   where recipient_id = old.id;
  return old;
end $$;

drop trigger if exists reward_seats_recipient_release on public.participants;
create trigger reward_seats_recipient_release
  before delete on public.participants
  for each row execute function public.reward_seats_release_on_recipient_delete();

alter table public.reward_seats enable row level security;
do $$ begin
  create policy reward_seats_super_admin on public.reward_seats
    for all using (public.is_super_admin()) with check (public.is_super_admin());
exception when duplicate_object then null; end $$;
