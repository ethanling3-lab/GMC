-- Phase 1, slice 1 — course catalogue + planned events (Ethan, 2026-11-25).
--
--   courses            — the catalogue (永不落空, HLCC, 金口之道 …). Each
--                        event is a dated session of one course.
--   events.course_id   — optional; existing events keep working without one.
--   event_status       — gains 'planned': shows on the staff (and later the
--                        member) calendar but can NOT be registered for.
--   events.dates_tentative — "TBC" flag for planned sessions whose dates
--                        aren't final.
--
-- RLS mirrors programmes: Super Admin manages; reads for limited roles go
-- through role-checked server code.

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_cn text not null,
  short_label text not null,
  colour text not null default '#3B5BDB' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references admins(id) on delete set null,
  updated_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table courses enable row level security;
drop policy if exists "courses_super_admin" on courses;
create policy "courses_super_admin" on courses
  for all using (is_super_admin()) with check (is_super_admin());

alter table events
  add column if not exists course_id uuid references courses(id) on delete set null,
  add column if not exists dates_tentative boolean not null default false;

create index if not exists events_course_id_idx on events (course_id);
create index if not exists events_start_date_idx on events (start_date);

-- Between draft (hidden) and open (registrable).
alter type event_status add value if not exists 'planned' after 'draft';
