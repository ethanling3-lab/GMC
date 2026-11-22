-- Check-in sessions (早/午签到), out-of-class log (课堂外出), test mode.
--
-- GMC event days have two registrations: Morning, and Afternoon after lunch.
-- Everyone is checked in at each. Between them, during class, anyone who
-- leaves the room (not an official break) is logged out and back.
--
--   check_ins.session        'am' | 'pm' — one check-in per person per day
--                            per session. Existing rows become 'am'.
--   check_ins.is_test        written while the event is in test mode, so a
--                            rehearsal can be wiped before the real event.
--   events.check_in_mode     the live desk mode the organizer sets; every desk
--                            follows it. Registration modes check people in,
--                            class modes log out/back, 'break' logs nothing.
--   events.check_in_test_mode  outside the event dates check-in is locked
--                            unless this is on.
--   events.long_absence_minutes  trips longer than this are flagged.
--   class_exits              one row per trip out of class.

-- ---------------------------------------------------------------------------
-- check_ins
-- ---------------------------------------------------------------------------

alter table public.check_ins
  add column if not exists session text not null default 'am'
    check (session in ('am', 'pm')),
  add column if not exists is_test boolean not null default false;

alter table public.check_ins
  drop constraint if exists check_ins_enrollment_day_key;

alter table public.check_ins
  add constraint check_ins_enrollment_day_session_key
    unique (enrollment_id, check_in_date, session);

drop index if exists public.check_ins_event_day_time_idx;
create index if not exists check_ins_event_day_session_time_idx
  on public.check_ins (event_id, check_in_date, session, checked_in_at desc);

comment on column public.check_ins.session is
  'am = Morning registration, pm = Afternoon registration. One check-in per enrollment per day per session.';
comment on column public.check_ins.is_test is
  'Recorded while the event was in check-in test mode; cleared before the real event.';

-- ---------------------------------------------------------------------------
-- events: live desk mode + check-in settings
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists check_in_mode text not null default 'am_registration'
    check (check_in_mode in ('am_registration', 'am_class', 'break', 'pm_registration', 'pm_class')),
  add column if not exists check_in_mode_set_at timestamptz,
  add column if not exists check_in_mode_set_by uuid references public.admins(id) on delete set null,
  add column if not exists check_in_test_mode boolean not null default false,
  add column if not exists long_absence_minutes int not null default 15
    check (long_absence_minutes between 1 and 240);

comment on column public.events.check_in_mode is
  'Live desk mode set by the organizer: am_registration | am_class | break | pm_registration | pm_class.';
comment on column public.events.check_in_test_mode is
  'Allows check-in outside the event dates; records are flagged is_test.';

-- ---------------------------------------------------------------------------
-- class_exits — out-of-class log
-- ---------------------------------------------------------------------------

create table if not exists public.class_exits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  exit_date date not null,
  session text not null check (session in ('am', 'pm')),
  out_at timestamptz not null default now(),
  back_at timestamptz,
  -- scanned_back = they came back through a desk; session_ended = the
  -- organizer left class mode while they were still out (no return scan).
  closed_reason text check (closed_reason in ('scanned_back', 'session_ended')),
  out_by uuid references public.admins(id) on delete set null,
  back_by uuid references public.admins(id) on delete set null,
  -- They weren't checked in for this session when they walked out.
  not_checked_in boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  check ((back_at is null) = (closed_reason is null))
);

-- At most one open trip per person: two desks scanning the same badge at
-- once can't both log "out".
create unique index if not exists class_exits_one_open_per_enrollment
  on public.class_exits (enrollment_id)
  where back_at is null;

create index if not exists class_exits_event_day_idx
  on public.class_exits (event_id, exit_date, out_at desc);

comment on table public.class_exits is
  'Out-of-class log (课堂外出): one row per trip out during class. back_at null = still out.';

alter table public.class_exits enable row level security;

-- Same readers as check_ins (migration 034); writes via the service role.
create policy "admins view class exits"
  on public.class_exits for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );
