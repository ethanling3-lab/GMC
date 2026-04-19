-- Participant import jobs. Used by the async extraction flow:
--   1. Kickoff endpoint inserts a row (status=pending) with the raw source payload
--   2. A Netlify background function picks it up, runs Claude, writes rows+summary
--   3. Client polls status until it flips to 'done' (or 'error')
--
-- Service-role only. No RLS policies — all access goes through server routes
-- that have already called requireAdmin().

create type import_job_status as enum ('pending', 'running', 'done', 'error');

create table import_jobs (
  id            uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admins(id) on delete cascade,

  status       import_job_status not null default 'pending',
  source_label  text,

  -- { kind: 'text', text, label } OR { kind: 'pdf', base64, filename }
  source_payload jsonb not null,

  rows         jsonb,
  summary      text,
  usage        jsonb,
  error        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create index import_jobs_admin_created_idx
  on import_jobs (admin_id, created_at desc);

create trigger import_jobs_updated_at
  before update on import_jobs
  for each row execute function set_updated_at();

alter table import_jobs enable row level security;
-- No policies: only service-role (which bypasses RLS) may read/write.
