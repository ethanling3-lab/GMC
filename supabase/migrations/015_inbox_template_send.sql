-- 015_inbox_template_send.sql
--
-- Adds optional template metadata to outbound inbox messages so the composer
-- can send WhatsApp HSM templates outside the 24-hour customer-service window.
-- body_text still holds the rendered preview (what admin + the recipient see);
-- template_name + template_language + template_params preserve provenance for
-- audit + future re-render.

alter table messages
  add column if not exists template_name text,
  add column if not exists template_language text,
  add column if not exists template_params jsonb;

create index if not exists messages_template_name_idx
  on messages (template_name)
  where template_name is not null;
