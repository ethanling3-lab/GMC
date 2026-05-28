-- Phase 1 follow-up — Inbox saved views (per-admin filter presets).
--
-- Admin saves the current URL-state filter combo (scope, channel,
-- status, lifecycle, tag, q) under a name. The sidebar lists them as
-- clickable links that re-apply the combo. Per-admin — not shared —
-- because triage routines differ by role (CS owns "unassigned WhatsApp
-- leads", regional lead owns "open tag:vip", etc.).
--
-- Soft delete via `deleted_at` so audit_log entries (which carry
-- saved_view.id in entity_id) remain interpretable after a view is
-- removed. The (owner, lowercase-name) unique constraint is a partial
-- index that only enforces on live rows, so a deleted name can be
-- re-used.

create table if not exists public.inbox_saved_views (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- Serialized InboxListFilters shape: { scope, channel, status, lifecycle, tag, q }
  -- admin_id is intentionally excluded — it's a caller-identity field, not a filter.
  filters jsonb not null,
  created_by uuid not null references public.admins(id) on delete cascade,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists inbox_saved_views_owner_name_live_unique
  on public.inbox_saved_views (created_by, lower(name))
  where deleted_at is null;

create index if not exists inbox_saved_views_owner_idx
  on public.inbox_saved_views (created_by, updated_at desc)
  where deleted_at is null;

alter table public.inbox_saved_views enable row level security;

-- Defense-in-depth: even though writes flow through the service role
-- (bypasses RLS) with app-level owner scoping, restrict direct reads to
-- the row's owner. admins.id IS auth.users.id (FK reference at
-- 001_initial_schema.sql:69), so auth.uid() = admins.id directly.
-- is_super_admin() bypass kept so support can debug.
create policy "admins read their own saved views"
  on public.inbox_saved_views for select
  to authenticated
  using (is_super_admin() or created_by = auth.uid());

comment on table public.inbox_saved_views is
  'Per-admin saved filter presets for the inbox sidebar. URL-state combos serialized into filters jsonb.';
