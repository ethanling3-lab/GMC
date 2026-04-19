-- Free-text referrer fallback for the public registration form.
-- `participants.referrer_id` is the canonical FK for when the referrer is
-- themselves a registered participant; these columns capture the name +
-- contact typed into the form when that's not the case (感召报名 filled
-- out with someone who isn't — yet — in the CRM).

alter table participants
  add column if not exists referrer_name text,
  add column if not exists referrer_contact text;
