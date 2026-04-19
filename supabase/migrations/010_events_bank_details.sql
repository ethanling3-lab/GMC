-- Bank transfer / TT instructions shown on the public /pay/[token] portal.
-- JSONB shape: { en: "<free text>", zh: "<free text>" }. Payment portal
-- skips the bank-transfer panel when the object is empty.

alter table events
  add column if not exists bank_details jsonb not null default '{}'::jsonb;
