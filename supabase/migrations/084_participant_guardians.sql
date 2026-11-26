-- Children · 子女 (Ethan, 2026-11-25).
-- A child is an ordinary participant with no email / phone / login of their
-- own, linked to one or more parents. Parents register them from /me; staff
-- can add them in the admin. Messages about a child go to the parent.
-- No age limit: "child" means "managed by a parent", not "under 18".

alter table public.participants
  add column if not exists is_minor boolean not null default false;

comment on column public.participants.is_minor is
  'Managed by a parent (participant_guardians): no own contact or login; messages go to the parent.';

create table if not exists public.participant_guardians (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.participants(id) on delete cascade,
  guardian_id uuid not null references public.participants(id) on delete cascade,
  relationship text not null default 'parent' check (relationship in ('parent', 'guardian')),
  created_at timestamptz not null default now(),
  created_by uuid references public.admins(id) on delete set null,
  constraint participant_guardians_not_self check (child_id <> guardian_id),
  constraint participant_guardians_pair_unique unique (child_id, guardian_id)
);

create index if not exists participant_guardians_guardian_idx on public.participant_guardians (guardian_id);
create index if not exists participant_guardians_child_idx on public.participant_guardians (child_id);

-- Dedupe lookups: a parent's child by name + birth date.
create index if not exists participants_minor_name_birth_idx
  on public.participants (lower(name_cn), birth_date) where is_minor;

alter table public.participant_guardians enable row level security;
do $$ begin
  -- App reads/writes go through the service role (server routes check the
  -- staff role or the logged-in parent); this only covers direct access.
  create policy participant_guardians_super_admin on public.participant_guardians
    for all using (public.is_super_admin()) with check (public.is_super_admin());
exception when duplicate_object then null; end $$;
