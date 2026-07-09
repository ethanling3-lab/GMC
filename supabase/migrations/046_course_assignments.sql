-- Phase 1 — Learner portal: homework / report submission.
--
-- Adds the assignment + submission model so learners can submit homework and
-- reports from the /me/courses/[id] Assignment tab, and admins can create
-- assignments and read submissions. Purely additive — nothing here touches
-- enrollments, payments, grouping, or check-in.
--
--   1. course_assignments      — an assignment attached to an event/course.
--   2. course_submissions      — one per (assignment, participant); draft→submitted.
--   3. course_submission_files — attached files for a submission.
--
-- RLS: admin-only SELECT at the table level (mirrors event_recordings, 041).
-- The /me read + write path uses service-role inside API routes gated by
-- requireParticipant() — participants never hit these tables directly.
--
-- Storage: a private `course-submissions` bucket for uploaded homework files.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type course_assignment_kind as enum ('homework', 'report');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_submission_type as enum ('file', 'text', 'both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_submission_status as enum ('draft', 'submitted');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. course_assignments
-- ---------------------------------------------------------------------------

create table if not exists public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,

  -- At least one of title_en / title_cn must be present (enforced app-side).
  title_en text,
  title_cn text,
  description_en text,
  description_cn text,

  kind course_assignment_kind not null default 'homework',
  submission_type course_submission_type not null default 'both',
  due_at timestamptz,
  active boolean not null default true,

  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists course_assignments_event_idx
  on public.course_assignments (event_id, created_at desc)
  where deleted_at is null;

create trigger course_assignments_set_updated_at
  before update on public.course_assignments
  for each row execute function set_updated_at();

comment on table public.course_assignments is
  'Per-event homework / report assignments learners submit against. Soft-deleted via deleted_at.';

-- ---------------------------------------------------------------------------
-- 2. course_submissions
-- ---------------------------------------------------------------------------

create table if not exists public.course_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.course_assignments(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,

  status course_submission_status not null default 'draft',
  text_body text,
  submitted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One submission row per (assignment, participant). Re-opening a submitted
-- work updates the same row (status flips back to draft on the app side).
create unique index if not exists course_submissions_unique
  on public.course_submissions (assignment_id, participant_id);

create index if not exists course_submissions_participant_idx
  on public.course_submissions (participant_id, updated_at desc);

create index if not exists course_submissions_assignment_idx
  on public.course_submissions (assignment_id, status);

create trigger course_submissions_set_updated_at
  before update on public.course_submissions
  for each row execute function set_updated_at();

comment on table public.course_submissions is
  'One per (assignment, participant). status draft→submitted; submitted_at stamped on submit.';

-- ---------------------------------------------------------------------------
-- 3. course_submission_files
-- ---------------------------------------------------------------------------

create table if not exists public.course_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.course_submissions(id) on delete cascade,

  -- Path inside the `course-submissions` storage bucket.
  storage_path text not null,
  filename text not null,
  mime_type text,
  byte_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists course_submission_files_submission_idx
  on public.course_submission_files (submission_id, created_at);

comment on table public.course_submission_files is
  'Files attached to a submission. Storage object lives in the course-submissions bucket at storage_path.';

-- ---------------------------------------------------------------------------
-- RLS — admin-only SELECT (mirrors event_recordings, 041:105-122). Writes +
-- participant reads flow through service-role behind requireAdmin() /
-- requireParticipant() in API routes.
-- ---------------------------------------------------------------------------

alter table public.course_assignments enable row level security;
alter table public.course_submissions enable row level security;
alter table public.course_submission_files enable row level security;

create policy "admins view course assignments"
  on public.course_assignments for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

create policy "admins view course submissions"
  on public.course_submissions for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

create policy "admins view course submission files"
  on public.course_submission_files for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- ---------------------------------------------------------------------------
-- 4. course-submissions storage bucket (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-submissions',
  'course-submissions',
  false,
  52428800, -- 50 MB per file
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip'
  ]
)
on conflict (id) do nothing;
