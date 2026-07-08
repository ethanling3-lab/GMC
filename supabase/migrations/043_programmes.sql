-- Programme management + validity.
--
-- Replaces the hardcoded `programme_tier` enum (migration 023) with an
-- admin-managed `programmes` table, and makes programme membership
-- TIME-BOUND: a participant's programme has a validity term, and once it
-- expires the participant reverts to new/returning pricing.
--
-- DESIGN: each seeded programme's `slug` is byte-identical to the old enum
-- value (abundance / glorious_family / elite_cultural_heritage /
-- glorious_cultural_heritage). Slugs are the pricing contract — they appear
-- in `events.price_tiers[].applies_to`, `enrollments.price_tier_key`, and
-- `participants.attended_courses[].programme_tier`. Keeping them identical
-- means NONE of that jsonb/text data needs migrating; only the SOURCE of
-- labels/prices moves from hardcoded TS into this table.
--
-- TRANSITION: this migration is ADDITIVE. The `programme_tier` enum column
-- on `participants` is intentionally KEPT (written in lock-step by the
-- assignment UI) so every existing reader keeps working. It — and the enum
-- type itself — are dropped in a later migration only after all readers are
-- cut over to `programme_id`. Do NOT drop it here.

create table if not exists public.programmes (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name_en text not null,
  name_cn text not null,
  abbrev text not null,                       -- 1-2 CJK chars for floor-plan badges
  validity_months int,                        -- null = perpetual / no expiry
  price_sgd numeric(10,2) not null,
  on_site_sgd numeric(10,2),                  -- nullable on-site price
  active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.admins(id) on delete set null,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint programmes_slug_shape
    check (slug ~ '^[a-z0-9][a-z0-9_]{0,49}$'),   -- allows '_' (enum values use it)
  constraint programmes_abbrev_len
    check (char_length(abbrev) between 1 and 2)
);

create unique index if not exists programmes_slug_live_unique
  on public.programmes (slug)
  where deleted_at is null;

create index if not exists programmes_active_sort_idx
  on public.programmes (sort_order)
  where active and deleted_at is null;

alter table public.programmes enable row level security;

create policy "admins can view programmes"
  on public.programmes for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- Writes happen server-side via service role (bypasses RLS). Mirrors the
-- inbox_tags / inbox_snippets pattern.

-- Seed the 4 existing programmes. slugs == old enum values; prices + abbrevs
-- mirror PROGRAMME_TIER_LABEL (src/lib/grouping/types.ts) + PROGRAMME_ABBREV
-- (src/components/admin/layout/types.ts). validity_months = 36 (3 years).
insert into public.programmes (slug, name_en, name_cn, abbrev, validity_months, price_sgd, on_site_sgd, sort_order)
values
  ('abundance',                  'Abundance',                 '丰盛',     '丰', 36,  16135, 15135, 1),
  ('glorious_family',            'Glorious Family',           '荣贵',     '贵', 36,  38135, 36135, 2),
  ('elite_cultural_heritage',    'Elite Cultural Heritage',   '精英文化财', '精', 36,  70000, 65000, 3),
  ('glorious_cultural_heritage', 'Glorious Cultural Heritage', '荣耀文化财', '耀', 36, 104000, 96000, 4)
on conflict do nothing;

-- Per-participant membership: FK to the chosen programme + a FROZEN validity
-- window. `programme_started_at` is anchored at assignment time to the
-- participant's latest paid enrollment (computed in the assignment PATCH),
-- and `programme_expires_at = started_at + programme.validity_months`.
-- Freezing (vs live-recompute) prevents any new payment from perpetually
-- extending validity. Both are admin-overridable.
alter table public.participants
  add column if not exists programme_id uuid references public.programmes(id),
  add column if not exists programme_started_at timestamptz,
  add column if not exists programme_expires_at timestamptz;

create index if not exists participants_programme_id_idx
  on public.participants (programme_id)
  where programme_id is not null;

-- Backfill programme_id from the legacy enum (clean 1:1 via identical slugs).
-- programme_started_at / programme_expires_at are left NULL here and filled
-- by a reviewable one-off backfill script (scripts/backfill-programme-anchor)
-- so the computed anchors can be eyeballed before they affect pricing.
update public.participants p
  set programme_id = pr.id
  from public.programmes pr
  where p.programme_tier is not null
    and p.programme_tier::text = pr.slug
    and p.programme_id is null;
