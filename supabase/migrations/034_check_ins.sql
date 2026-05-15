-- M7.1 — On-site check-in.
--
-- Schema for the QR + manual check-in flow. `enrollments.qr_token` (text
-- unique nullable, from migration 001) is finally consumed here: when admin
-- approves an enrollment, the approval path mints a token via
-- src/lib/tokens.ts → createToken("check_in", enrollment_id) and stores it
-- on the enrollment row. The participant's approval email/WhatsApp embeds
-- a check-in URL whose QR encodes that token; the venue scanner POSTs to
-- /api/admin/events/[id]/check-in with the token and we insert a row here.
--
-- One check-in per enrollment (unique). `method` distinguishes QR scans
-- from manual region_id/name lookups so we can audit + report on staffing
-- behaviour later. Notes are free-form (late arrival, brought a guest,
-- etc.).
--
-- RLS mirrors the enrollments table: read for any admin, writes happen
-- server-side via service role.

create type check_in_method as enum ('qr', 'manual');

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.admins(id) on delete set null,
  method check_in_method not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (enrollment_id)
);

create index if not exists check_ins_event_time_idx
  on public.check_ins (event_id, checked_in_at desc);
create index if not exists check_ins_participant_idx
  on public.check_ins (participant_id);

alter table public.check_ins enable row level security;

create policy "admins can view check_ins"
  on public.check_ins for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- Inserts + updates + deletes happen server-side via service role (bypasses
-- RLS). No authenticated write policy — keeps the audit invariant that
-- every check_ins mutation flows through the API handler.
