-- Per-day check-in (签到按天) + unpaid override flag.
--
-- Until now check_ins had unique(enrollment_id): one check-in per person per
-- EVENT. Multi-day events need one per DAY — Day 2 arrivals are a separate
-- headcount from Day 1.
--
--   check_in_date   the event-local (Asia/Singapore; MY shares the offset)
--                   calendar day of the check-in. Written by the server from
--                   its own clock — never taken from the client.
--   unpaid_override true when desk staff checked in an approved-but-unpaid
--                   attendee after the "not paid" warning (e.g. a VIP who
--                   settles later). Paid attendees are the expected list.
--
-- Uniqueness moves from (enrollment_id) to (enrollment_id, check_in_date).
-- The column default keeps any insert that omits the date (old code still
-- deployed between applying this and shipping the new code) valid, and that
-- old code dedupes on enrollment alone, so it can't create a second row.

alter table public.check_ins
  add column if not exists check_in_date date;

update public.check_ins
  set check_in_date = (checked_in_at at time zone 'Asia/Singapore')::date
  where check_in_date is null;

alter table public.check_ins
  alter column check_in_date set default ((now() at time zone 'Asia/Singapore')::date),
  alter column check_in_date set not null;

alter table public.check_ins
  add column if not exists unpaid_override boolean not null default false;

alter table public.check_ins
  drop constraint if exists check_ins_enrollment_id_key;

alter table public.check_ins
  add constraint check_ins_enrollment_day_key unique (enrollment_id, check_in_date);

create index if not exists check_ins_event_day_time_idx
  on public.check_ins (event_id, check_in_date, checked_in_at desc);

comment on column public.check_ins.check_in_date is
  'Event-local (Asia/Singapore) day of the check-in. One check-in per enrollment per day.';
comment on column public.check_ins.unpaid_override is
  'Desk checked in an approved-but-unpaid attendee after the not-paid warning.';
