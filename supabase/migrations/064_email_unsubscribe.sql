-- Lets the unsubscribe link in marketing emails record where a "no" came from.

alter table public.participants
  drop constraint if exists participants_marketing_status_source_check;

alter table public.participants
  add constraint participants_marketing_status_source_check
  check (marketing_status_source in (
    'registration', 'whatsapp_keyword', 'meta_opt_out', 'admin', 'merge', 'email_link'
  ));
