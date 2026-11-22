-- FAQs the AI answers from, and one automatic payment follow-up.
--
-- Both start OFF, so applying this changes nothing customers see.
--
-- followup_enabled_at: only people approved after follow-ups were turned on
-- are reminded, so switching it on can never message an old backlog at once.
-- enrollments.payment_followup_sent_at: claimed before sending, so each
-- registration gets at most one automatic reminder.

alter table public.whatsapp_automations
  add column if not exists faqs_enabled boolean not null default false,
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists followup_after_days integer not null default 3
    check (followup_after_days between 1 and 14),
  add column if not exists followup_enabled_at timestamptz;

create table if not exists public.whatsapp_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(trim(question)) between 1 and 300),
  answer_en text check (answer_en is null or char_length(answer_en) between 1 and 1500),
  answer_zh text check (answer_zh is null or char_length(answer_zh) between 1 and 1500),
  created_by uuid references public.admins(id) on delete set null,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_faqs_has_answer check (answer_en is not null or answer_zh is not null)
);

comment on table public.whatsapp_faqs is
  'Approved answers the WhatsApp AI may use. Managed on /admin/whatsapp.';

alter table public.whatsapp_faqs enable row level security;

-- Writes go through the service role in the admin API.
drop policy if exists "admins view whatsapp faqs" on public.whatsapp_faqs;
create policy "admins view whatsapp faqs"
  on public.whatsapp_faqs for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service')
  );

alter table public.enrollments
  add column if not exists payment_followup_sent_at timestamptz;

create index if not exists enrollments_payment_followup_idx
  on public.enrollments (approved_at)
  where status = 'approved' and payment_followup_sent_at is null;
