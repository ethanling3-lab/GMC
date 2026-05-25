-- Phase 1 follow-up #2 — Inbox tag definitions.
--
-- `conversations.tags text[]` + its GIN index were provisioned back in
-- migration 014 but never had a definition table behind them. This adds
-- `inbox_tags` so each slug stored in `conversations.tags[]` resolves to
-- a stable label (EN + ZH) + colour. Lookups join on slug; the array
-- column itself isn't FK-constrained (Postgres can't FK individual array
-- elements). Orphan slugs are tolerated — the UI renders them as a
-- neutral chip so deleting a tag doesn't break old conversations.
--
-- Create-on-apply: admins can mint a tag from the picker inside any
-- thread. Soft delete via `deleted_at` so audit trail keeps the slug
-- attached after removal; the partial unique index frees the slug for
-- reuse after delete.
--
-- Colours are stored as `#RRGGBB` hex. CHECK constraint enforces shape.

create table if not exists public.inbox_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  label_en text not null,
  label_zh text not null,
  color text not null,
  created_by uuid references public.admins(id) on delete set null,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint inbox_tags_slug_shape
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  constraint inbox_tags_color_shape
    check (color ~ '^#[0-9a-fA-F]{6}$')
);

create unique index if not exists inbox_tags_slug_live_unique
  on public.inbox_tags (slug)
  where deleted_at is null;

create index if not exists inbox_tags_updated_idx
  on public.inbox_tags (updated_at desc)
  where deleted_at is null;

alter table public.inbox_tags enable row level security;

create policy "admins can view tags"
  on public.inbox_tags for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- Writes happen server-side via service role (bypasses RLS). Mirrors the
-- inbox_snippets / check_ins pattern.
