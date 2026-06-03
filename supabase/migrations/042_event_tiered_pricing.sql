-- Tiered pricing — one event holds multiple prices, keyed by student tier.
--
-- Today `events.price` is a single number, so charging different
-- student categories (programme-tier holders pay only 会务费, new/
-- returning students pay full) forced a separate event per price.
--
-- This migration lets one event carry an ordered list of price tiers.
-- At checkout the right tier is auto-resolved from the participant's
-- record (programme_tier, else new/returning) and the resolved amount
-- is persisted on the enrollment. `events.price` stays as the legacy
-- default + fallback — an empty `price_tiers` behaves exactly as today.
--
-- Tier row shape (jsonb array element):
--   { "key": "glorious_family",
--     "label_en": "Glorious Family",
--     "label_cn": "荣贵",
--     "amount": 865,
--     "applies_to": ["glorious_family"] }
--
-- `applies_to` controlled vocab (resolved against the participant):
--   abundance | glorious_family | elite_cultural_heritage |
--   glorious_cultural_heritage   (the 4 programme_tier values)
--   returning_student | new_student | default (catch-all)

alter table events
  add column if not exists price_tiers jsonb not null default '[]'::jsonb;
-- Ordered list. Empty = single-price mode (use events.price).

alter table enrollments
  add column if not exists price_tier_key text,
  add column if not exists amount_due numeric(10,2);
-- price_tier_key = which tier was applied (null for single-price events).
-- amount_due = the resolved amount this enrollment owes. Payment reads
-- this; legacy rows (null) fall back to event.price.
