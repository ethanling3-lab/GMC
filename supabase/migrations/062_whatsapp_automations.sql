-- WhatsApp setup page: settings admins control without a deploy.
--
-- One row (id is always true). Starts with the welcome message OFF, so applying
-- this migration changes nothing customers see until an admin turns it on.
--
-- conversations.welcome_sent_at is the once-only guard: sending claims it with
-- a conditional update, so a replayed webhook can't welcome someone twice.
-- Existing conversations are stamped so nobody already talking to GMC is
-- greeted as new.

create table if not exists public.whatsapp_automations (
  id boolean primary key default true check (id),
  welcome_enabled boolean not null default false,
  welcome_en text not null check (char_length(welcome_en) between 1 and 1024),
  welcome_zh text not null check (char_length(welcome_zh) between 1 and 1024),
  updated_by uuid references public.admins(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_automations (id, welcome_en, welcome_zh)
values (
  true,
  E'Hi, thank you for contacting GMC!\n\nWe can help with course details, registration and event information. Tell us what you need, or say "talk to a person" anytime.',
  E'您好，感谢您联系 GMC！\n\n我们可以为您解答课程详情、报名和活动信息。请告诉我们您的需要，也可以随时回复“联系人工”。'
)
on conflict (id) do nothing;

comment on table public.whatsapp_automations is
  'Single-row settings for the WhatsApp setup page (/admin/whatsapp).';

alter table public.whatsapp_automations enable row level security;

-- Writes go through the service role in the admin API.
drop policy if exists "admins view whatsapp automations" on public.whatsapp_automations;
create policy "admins view whatsapp automations"
  on public.whatsapp_automations for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service')
  );

alter table public.conversations
  add column if not exists welcome_sent_at timestamptz;

comment on column public.conversations.welcome_sent_at is
  'When the first-contact welcome was claimed. Null = not welcomed yet.';

update public.conversations
set welcome_sent_at = created_at
where welcome_sent_at is null;
