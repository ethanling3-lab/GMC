-- Per-event custom registration forms.
-- Admins design the form in the event editor; the JSONB document encodes the
-- identity-block toggles plus an ordered list of custom fields. Submitted
-- answers live on the enrollment keyed by field id.

alter table events
  add column if not exists form_schema jsonb not null default '{}'::jsonb;

alter table enrollments
  add column if not exists form_answers jsonb not null default '{}'::jsonb;

create index if not exists enrollments_form_answers_gin
  on enrollments using gin (form_answers);
