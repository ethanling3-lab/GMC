-- Phase 4 · Replays · 回播 (Ethan, 2026-11-26).
--   • Members get an event's replays automatically: an approved / paid
--     registration for that event + a programme still valid today. Worked
--     out when they open /me/recordings, so access ends by itself on the
--     day their validity ends (no rows to keep in sync, no nightly job).
--   • The data team (Super Admin) adds anyone else by hand, with an
--     optional last day.
--   • Each recording can switch the automatic member access off.

alter table public.event_recordings
  add column if not exists members_auto boolean not null default true;

comment on column public.event_recordings.members_auto is
  'When true, members with a valid programme and an approved/paid registration for the event can watch automatically.';

alter table public.event_recording_access
  add column if not exists expires_on date,
  add column if not exists note text;

comment on column public.event_recording_access.expires_on is
  'Last day (Singapore) the hand-added grant works. Null = no end.';
