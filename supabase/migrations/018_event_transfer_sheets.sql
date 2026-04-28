-- 018_event_transfer_sheets.sql
--
-- Per-event Google Sheet pointer + the hotel metadata the transfer-list
-- generator needs to render destination text.
--
-- Sheet pointer:
--   transfer_sheet_id   — Google Sheets / Drive file id
--   transfer_sheet_url  — convenience: https://docs.google.com/spreadsheets/d/<id>/edit
--   transfer_synced_at  — last successful export timestamp
--
-- Hotel metadata (admin-edited on the event detail page):
--   main_venue_hotel_name — human label for the main venue hotel (e.g. "St. Giles").
--                            Required for departures (everyone departs here) and
--                            the fallback for non-designated arrivals.
--   designated_hotels     — JSONB map keyed by an arbitrary hotel key (slug/uuid)
--                            to its display name. The inbox flight-info panel
--                            offers these as the dropdown for `hotel_key` on
--                            arrival rows. Departures ignore this entirely.
--
--                            Example shape:
--                              { "cititel": "Cititel", "stgiles": "St. Giles" }
--                            On flight_info, hotel_key='designated:cititel' resolves
--                            to "Cititel" via this map. main_venue resolves to
--                            main_venue_hotel_name.

alter table events
  add column if not exists transfer_sheet_id text,
  add column if not exists transfer_sheet_url text,
  add column if not exists transfer_synced_at timestamptz,
  add column if not exists main_venue_hotel_name text,
  add column if not exists designated_hotels jsonb not null default '{}'::jsonb;
