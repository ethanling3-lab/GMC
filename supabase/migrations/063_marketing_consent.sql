-- Marketing permission for each contact.
--
--   not_asked     default; marketing broadcasts must not reach them
--   subscribed    ticked the registration box, replied JOIN, or asked staff
--   unsubscribed  replied STOP, Meta reported an opt-out, or asked staff
--
-- This covers marketing only. Official notices about an event someone
-- registered for are not affected.

alter table public.participants
  add column if not exists marketing_status text not null default 'not_asked'
    check (marketing_status in ('not_asked', 'subscribed', 'unsubscribed')),
  add column if not exists marketing_status_at timestamptz,
  add column if not exists marketing_status_source text
    check (marketing_status_source in ('registration', 'whatsapp_keyword', 'meta_opt_out', 'admin', 'merge'));

comment on column public.participants.marketing_status is
  'Permission for marketing messages: not_asked | subscribed | unsubscribed.';
comment on column public.participants.marketing_status_source is
  'How the current marketing_status was set.';

create index if not exists participants_marketing_status_idx
  on public.participants (marketing_status);
