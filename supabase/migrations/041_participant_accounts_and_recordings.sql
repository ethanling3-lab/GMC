-- M8 Participant Accounts + Recording Library + Volunteer Recruit flag.
--
-- Three additions in one migration:
--
--   1. participants.auth_user_id — links a participants row to a Supabase
--      Auth user. Nullable so the 300+ existing participants don't break;
--      a participant gets an auth_user_id only after they (a) claim their
--      pre-existing row via the /login set-up-account flow, OR (b) get
--      auto-invited when admin approves their first enrollment / payment
--      arrives. The unique partial index enforces one auth user → one
--      participant row.
--
--   2. event_recordings + event_recording_access — admin uploads class
--      recordings; admin grants per-(recording, participant) access. The
--      access table is the gate for /me/recordings playback. Soft delete
--      on both tables preserves audit trail.
--
--   3. enrollments.recruited_via_portal — boolean flag for the volunteer
--      recruitment flow (/me/recruit). Lets admin filter portal-recruited
--      enrollments from the finance/enrolment views. `referrer_id` reuse
--      lives on the participants row (already exists since 001) — when a
--      volunteer adds a lead, the new participant gets referrer_id set to
--      the volunteer's participant_id.
--
-- RLS: recordings + access tables admin-only at the table level; the /me
-- read path uses service-role inside API routes gated by
-- requireParticipant(). No client-side participant RLS needed.

-- ---------------------------------------------------------------------------
-- 1. participants.auth_user_id
-- ---------------------------------------------------------------------------

alter table public.participants
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists participants_auth_user_id_unique
  on public.participants (auth_user_id)
  where auth_user_id is not null;

comment on column public.participants.auth_user_id is
  'Link to auth.users for participants who have claimed an account. Nullable; set on claim (self-claim via /login set-up-account) or auto-invite-then-claim from enrollment approval / payment.';

-- ---------------------------------------------------------------------------
-- 2. event_recordings + event_recording_access
-- ---------------------------------------------------------------------------

create table if not exists public.event_recordings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  -- At least one of title_en / title_cn must be present (enforced app-side).
  title_en text,
  title_cn text,
  description_en text,
  description_cn text,

  -- Path inside the `event-recordings` storage bucket.
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  duration_seconds integer,

  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists event_recordings_event_idx
  on public.event_recordings (event_id, created_at desc)
  where deleted_at is null;

create trigger event_recordings_set_updated_at
  before update on public.event_recordings
  for each row execute function set_updated_at();

create table if not exists public.event_recording_access (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.event_recordings(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  granted_by uuid references public.admins(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Partial unique on (recording, participant) where live — same row can be
-- re-granted after revoke, history preserved in audit_log.
create unique index if not exists event_recording_access_unique_live
  on public.event_recording_access (recording_id, participant_id)
  where revoked_at is null;

create index if not exists event_recording_access_participant_idx
  on public.event_recording_access (participant_id, granted_at desc)
  where revoked_at is null;

create index if not exists event_recording_access_recording_idx
  on public.event_recording_access (recording_id)
  where revoked_at is null;

-- RLS — mirrors event_seat_assignments pattern (021:305-319). Admin SELECT
-- open to all roles for visibility; writes go through service-role with
-- app-level role gating. Participant reads NEVER hit the table directly —
-- the /me API route uses service-role behind requireParticipant().

alter table public.event_recordings enable row level security;
alter table public.event_recording_access enable row level security;

create policy "admins view event recordings"
  on public.event_recordings for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

create policy "admins view recording access"
  on public.event_recording_access for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

comment on table public.event_recordings is
  'Per-event class recordings. Soft-deleted via deleted_at. Storage object lives in the event-recordings bucket at storage_path.';
comment on table public.event_recording_access is
  'Per-(recording, participant) access grants. Soft-revoked via revoked_at so audit history of who-had-access-when is preserved.';

-- ---------------------------------------------------------------------------
-- 3. enrollments.recruited_via_portal
-- ---------------------------------------------------------------------------

alter table public.enrollments
  add column if not exists recruited_via_portal boolean not null default false;

create index if not exists enrollments_recruited_via_portal_idx
  on public.enrollments (recruited_via_portal)
  where recruited_via_portal = true;

comment on column public.enrollments.recruited_via_portal is
  'True when the enrollment was created via /me/recruit by a volunteer. Distinguishes from public /register and admin-created enrolments.';

-- ---------------------------------------------------------------------------
-- 4. event-recordings storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-recordings',
  'event-recordings',
  false,
  2147483648, -- 2 GB per file (conservative cap; lift if recordings prove longer)
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg'
  ]
)
on conflict (id) do nothing;
