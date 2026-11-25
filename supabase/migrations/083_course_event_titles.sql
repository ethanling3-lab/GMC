-- A Course-type event's title IS its course's name (Ethan, 2026-11-25).
-- One rule in the database so every path follows it: the event editor,
-- New event, the calendar plan form and "Duplicate to next year".
-- Heading / Sub-heading stay free for the run (e.g. "2026年12月 · 新加坡").
-- Other event types (retreats, single classes …) keep typed titles.

create or replace function public.events_title_from_course()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  if new.type = 'course' and new.course_id is not null then
    select name_cn, name_en into c from public.courses where id = new.course_id;
    if found then
      new.title_cn := c.name_cn;
      new.title_en := c.name_en;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists events_title_from_course on public.events;
create trigger events_title_from_course
  before insert or update of type, course_id, title_cn, title_en on public.events
  for each row execute function public.events_title_from_course();

-- Renaming a course renames its runs.
create or replace function public.courses_rename_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name_cn is distinct from old.name_cn or new.name_en is distinct from old.name_en then
    update public.events
       set title_cn = new.name_cn, title_en = new.name_en
     where course_id = new.id and type = 'course';
  end if;
  return new;
end $$;

drop trigger if exists courses_rename_events on public.courses;
create trigger courses_rename_events
  after update of name_cn, name_en on public.courses
  for each row execute function public.courses_rename_events();

-- Bring existing linked course events into line.
update public.events e
   set title_cn = c.name_cn, title_en = c.name_en
  from public.courses c
 where e.course_id = c.id and e.type = 'course'
   and (e.title_cn is distinct from c.name_cn or e.title_en is distinct from c.name_en);
