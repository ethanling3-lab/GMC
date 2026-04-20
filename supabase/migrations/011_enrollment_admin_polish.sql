-- Wave 3 of the enrolments admin overhaul. Adds the columns the admin
-- portal needs to be operable end-to-end:
--
--   * reject_reason / reject_note  — captures *why* an admin rejected, so the
--     rejection email can carry the right tone (no_seats vs duplicate vs
--     unsuitable vs other) and so future-Ethan can audit it.
--   * transfer_slip_url + transfer_slip_uploaded_at — participant uploads
--     their bank-transfer receipt on /pay/[token]; admin verifies it before
--     marking paid.
--   * group_id / seat_number — M6 (AI grouping + podium layout) needs these
--     on every enrolment. Adding the columns now means the grouping module
--     can land without retrofitting the table.
--
-- All idempotent so re-runs are safe in dev.

alter table enrollments
  add column if not exists reject_reason text,
  add column if not exists reject_note   text,
  add column if not exists transfer_slip_url          text,
  add column if not exists transfer_slip_uploaded_at  timestamptz,
  add column if not exists group_id     uuid,
  add column if not exists seat_number  int;

create index if not exists enrollments_group_idx on enrollments (group_id);

-- Private bucket for transfer slips. Public role gets no list/get/delete by
-- default — admin reads via service-role + signed URLs from the admin UI.
-- The slip-upload API route writes via service-role too, after verifying the
-- payment-access token, so storage RLS doesn't need a public-write policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transfer-slips',
  'transfer-slips',
  false,
  5 * 1024 * 1024,                                       -- 5 MB cap
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
