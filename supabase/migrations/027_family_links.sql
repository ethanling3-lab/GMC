-- Multi-edge family graph. Replaces participants.family_of_participant_id
-- (single edge) with a symmetric many-to-many table so admin can mark a
-- whole family on one record (e.g. spouse + 2 kids in one save).
--
-- Canonical ordering (a_id < b_id) lets the unique constraint enforce
-- "one row per pair" without storing both directions. Algorithm reads
-- both directions when building the union-find adjacency.
--
-- The legacy `family_of_participant_id` column stays in place for now —
-- the loader unions it with this table during the transition. A future
-- migration can drop the column once all writers are migrated.

create table if not exists participant_family_links (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references participants(id) on delete cascade,
  b_id uuid not null references participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references admins(id) on delete set null,
  constraint participant_family_links_pair_order check (a_id < b_id),
  constraint participant_family_links_pair_unique unique (a_id, b_id)
);

create index if not exists participant_family_links_a_idx
  on participant_family_links (a_id);
create index if not exists participant_family_links_b_idx
  on participant_family_links (b_id);

-- Backfill from the legacy single-edge column. `least`/`greatest` give us
-- the canonical ordering required by the check constraint. Self-links
-- (a row pointing at itself — there shouldn't be any but defensively)
-- are skipped.
insert into participant_family_links (a_id, b_id)
select least(id, family_of_participant_id) as a_id,
       greatest(id, family_of_participant_id) as b_id
from participants
where family_of_participant_id is not null
  and family_of_participant_id <> id
on conflict (a_id, b_id) do nothing;

-- RLS: admins can read all; writes go through the service role (the
-- PATCH route). Mirrors the policy stance on participants itself.
alter table participant_family_links enable row level security;

do $$ begin
  create policy participant_family_links_admin_read
    on participant_family_links for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
