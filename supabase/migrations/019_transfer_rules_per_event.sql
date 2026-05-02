-- 019_transfer_rules_per_event.sql
--
-- Make transfer-list rules customizable per-event + per-row. The Wave 3
-- algorithm shipped with global constants (30-min consolidation, 3-hour
-- lead, 15:00 coach cutoff, 12:00 hotel departure); real events deviate
-- — some don't run a 12:00 coach at all, KL events use a 4-hour lead, etc.
--
-- events.transfer_rules — JSONB overrides applied on top of DEFAULT_RULES
-- in src/lib/transfer/types.ts. Empty default means "use code defaults".
--
--   Shape (all fields optional):
--     {
--       "consolidation_window_minutes": 30,
--       "departure_lead_hours": 3,
--       "coach_cutoff_hour_local": 15,
--       "coach_hotel_departure_local": "12:00",
--       "coach_rule_enabled": true
--     }
--
-- transfer_list_rows.admin_edited — flag set by the per-row PATCH route so
-- regeneration can refuse to silently overwrite manual tweaks. Forced
-- regeneration via ?force=1 wipes the draft as before.

alter table events
  add column if not exists transfer_rules jsonb not null default '{}'::jsonb;

alter table transfer_list_rows
  add column if not exists admin_edited boolean not null default false;

create index if not exists transfer_list_rows_edited_idx
  on transfer_list_rows (transfer_list_id)
  where admin_edited = true;
