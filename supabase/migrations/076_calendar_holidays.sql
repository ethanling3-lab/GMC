-- Public holidays on the year calendar, managed by Super Admin (Ethan,
-- 2026-11-25). The admin adds / edits / deletes them; an "Import <year>"
-- button pre-fills a year from the date-holidays library (MY national,
-- Johor, SG) so nobody types 20+ rows by hand. Imported rows are ordinary
-- rows afterwards — editable and deletable.
--
--   regions   — which calendars it belongs to: MY (national), JHR (Johor
--               only, on top of national), SG. At least one.
--   estimated — Islamic-calendar dates that may move ±1 day; shown with ≈.
--   source    — 'import' or 'manual', for reference only.

create table if not exists calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name_en text not null check (length(btrim(name_en)) between 1 and 120),
  name_cn text check (name_cn is null or length(name_cn) <= 120),
  regions text[] not null
    check (cardinality(regions) >= 1 and regions <@ array['MY','JHR','SG']::text[]),
  estimated boolean not null default false,
  source text not null default 'manual' check (source in ('import','manual')),
  created_by uuid references admins(id) on delete set null,
  updated_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, name_en)
);

create index if not exists calendar_holidays_date_idx on calendar_holidays (date);

-- Writes and reads go through role-checked server code (service client);
-- direct access is Super Admin only.
alter table calendar_holidays enable row level security;
drop policy if exists "calendar_holidays_super_admin" on calendar_holidays;
create policy "calendar_holidays_super_admin" on calendar_holidays
  for all using (is_super_admin()) with check (is_super_admin());
