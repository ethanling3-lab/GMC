-- Event pricing refinement: split the shared misc fee out of the per-tier price.
--
-- GMC's real pricing: every participant pays a MISC FEE (会务费) for an event,
-- plus a COURSE FEE that depends on their programme tier (higher tiers pay a
-- smaller course fee, or none). The course fee varies per tier within one event.
--
-- `events.price_tiers[].amount` is now the per-tier COURSE FEE (the additional
-- amount on top of misc), so a participant's total = misc_fee + matched tier's
-- course fee. The resolver (src/lib/pricing/tiers.ts) computes this and stamps
-- enrollments.amount_due at registration.
--
-- Backward compatible: existing events default misc_fee = 0, so 0 + amount =
-- today's totals — no behaviour change until an admin sets a misc fee (then
-- they re-enter that event's per-tier course fees). Existing enrollments keep
-- their already-stamped amount_due.

alter table events
  add column if not exists misc_fee numeric(10,2) not null default 0;
