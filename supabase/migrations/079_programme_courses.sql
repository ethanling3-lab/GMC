-- Course lists under each programme (Ethan, 2026-11-25).
--
-- There's no standalone Courses screen (removed in 078: "Event = Course").
-- Instead each programme lists the courses it includes, grouped into the
-- brochure's sections (入门课 / 必修课 / 专题课 …), and staff manage them on
-- the programme's page.
--
--   courses            — course NAMES, stored once and shared: 永不落空 is
--                        in all four programmes. No colour, no slug.
--   programme_courses  — which programme includes which course, under
--                        which section, in what order.
--   events.course_id   — optional: which course an event is a run of. Lets
--                        the pricing slice give members 会务费-only for
--                        every run of an included course.

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name_cn text not null check (length(btrim(name_cn)) between 1 and 120),
  name_en text check (name_en is null or length(name_en) <= 200),
  subtitle_cn text check (subtitle_cn is null or length(subtitle_cn) <= 120),
  subtitle_en text check (subtitle_en is null or length(subtitle_en) <= 200),
  active boolean not null default true,
  created_by uuid references admins(id) on delete set null,
  updated_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists courses_name_cn_unique on courses (name_cn);

create table if not exists programme_courses (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references programmes(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  section_cn text not null default '' check (length(section_cn) <= 60),
  section_en text not null default '' check (length(section_en) <= 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (programme_id, course_id)
);
create index if not exists programme_courses_course_idx on programme_courses (course_id);

alter table events
  add column if not exists course_id uuid references courses(id) on delete set null;
create index if not exists events_course_id_idx on events (course_id);

-- Reads and writes go through role-checked server code (service client).
alter table courses enable row level security;
drop policy if exists "courses_super_admin" on courses;
create policy "courses_super_admin" on courses
  for all using (is_super_admin()) with check (is_super_admin());

alter table programme_courses enable row level security;
drop policy if exists "programme_courses_super_admin" on programme_courses;
create policy "programme_courses_super_admin" on programme_courses
  for all using (is_super_admin()) with check (is_super_admin());
