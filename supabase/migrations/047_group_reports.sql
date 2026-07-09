-- Group Reports (小组报告) — reusable form templates + per-group leader submissions.
--
-- A group LEADER (组长/副组长) fills one report per group: an overall summary
-- section (汇总) plus one section per group member. Admins author the questions
-- Google-Forms-style (reusing the event-form field engine). Admins export all
-- reports for an event as XLSX.
--
--   1. group_report_templates       — reusable library of report forms (jsonb schema)
--   2. events.group_report_template_id — which template an event activates (null = off)
--   3. group_report_submissions     — one per (event, group); group + per-member answers
--
-- RLS: admin-only SELECT (mirrors event_recordings, 041). Leader reads + writes
-- flow through the service-role client behind requireParticipant() gates.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

do $$ begin
  create type group_report_status as enum ('draft', 'submitted');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. group_report_templates  (reusable library)
-- ---------------------------------------------------------------------------

create table if not exists public.group_report_templates (
  id uuid primary key default gen_random_uuid(),
  name_en text,
  name_cn text,
  -- GroupReportSchema jsonb: { version, group_section:{...}, member_section:{...} }.
  schema jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists group_report_templates_active_idx
  on public.group_report_templates (active, created_at desc)
  where deleted_at is null;

create trigger group_report_templates_set_updated_at
  before update on public.group_report_templates
  for each row execute function set_updated_at();

comment on table public.group_report_templates is
  'Reusable 小组报告 form templates. schema jsonb holds the group + per-member question sections.';

-- ---------------------------------------------------------------------------
-- 2. events.group_report_template_id
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists group_report_template_id uuid
    references public.group_report_templates(id) on delete set null;

comment on column public.events.group_report_template_id is
  'Active group-report template for this event. Null = group reports off for the event.';

-- ---------------------------------------------------------------------------
-- 3. group_report_submissions  (one per group)
-- ---------------------------------------------------------------------------

create table if not exists public.group_report_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null references public.event_groups(id) on delete cascade,
  template_id uuid references public.group_report_templates(id) on delete set null,

  status group_report_status not null default 'draft',
  -- Summary answers: flat { field_id -> value }.
  group_answers jsonb not null default '{}'::jsonb,
  -- Per-member answers: { participant_id -> { field_id -> value } }.
  member_answers jsonb not null default '{}'::jsonb,

  submitted_by uuid references public.participants(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists group_report_submissions_unique
  on public.group_report_submissions (event_id, group_id);

create index if not exists group_report_submissions_event_idx
  on public.group_report_submissions (event_id, status);

create trigger group_report_submissions_set_updated_at
  before update on public.group_report_submissions
  for each row execute function set_updated_at();

comment on table public.group_report_submissions is
  'One 小组报告 per (event, group), filled by the group leader. group_answers = summary; member_answers keyed by participant_id.';

-- ---------------------------------------------------------------------------
-- RLS — admin-only SELECT (mirrors event_recordings, 041).
-- ---------------------------------------------------------------------------

alter table public.group_report_templates enable row level security;
alter table public.group_report_submissions enable row level security;

create policy "admins view group report templates"
  on public.group_report_templates for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

create policy "admins view group report submissions"
  on public.group_report_submissions for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );
