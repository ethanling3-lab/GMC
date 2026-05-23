-- Phase 1 follow-up — Inbox snippets (canned replies).
--
-- Org-shared snippets that admins insert into the inbox composer via
-- slash-command (`/refund-policy`, `/welcome`, etc.). Bilingual body in
-- both EN + ZH; the composer picks the language matching the conversation
-- participant's `language` field on insert. Variables like {name} or
-- {event_title} are detected and substituted client-side from a context
-- dict supplied by the thread page.
--
-- Soft delete via `deleted_at` so the audit_log entries (which carry
-- snippet_id in entity_id) remain interpretable after a snippet is
-- "removed". The shortcut unique constraint is a partial index that only
-- enforces uniqueness across live rows, so a deleted snippet's shortcut
-- can be reused.

create table if not exists public.inbox_snippets (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null,
  title_en text not null,
  title_zh text not null,
  body_en text not null,
  body_zh text not null,
  description_en text,
  description_zh text,
  created_by uuid references public.admins(id) on delete set null,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint inbox_snippets_shortcut_shape
    check (shortcut ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

create unique index if not exists inbox_snippets_shortcut_live_unique
  on public.inbox_snippets (shortcut)
  where deleted_at is null;

create index if not exists inbox_snippets_updated_idx
  on public.inbox_snippets (updated_at desc)
  where deleted_at is null;

alter table public.inbox_snippets enable row level security;

create policy "admins can view snippets"
  on public.inbox_snippets for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- Writes happen server-side via service role (bypasses RLS). Mirrors the
-- check_ins / inbox tables pattern — every mutation flows through an API
-- handler that calls writeAuditLog().
