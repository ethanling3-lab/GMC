-- 020_manual_transfer_rows.sql
--
-- Lets admins drop fully manual rows into a generated transfer list — the
-- ones the algorithm can't model on its own (external pickups, driver
-- placeholders, vendor cars, special arrangements). The row stores its
-- passenger names directly in JSONB so we don't need to spin up a fake
-- participant + enrolment + flight_info chain just to display "Driver Tan"
-- on a row.
--
-- Shape:
--   [
--     { "name": "Driver Tan", "region_id": null, "note": "vendor: GoCar" },
--     { "name": "Lim Sheng Chi", "region_id": "MY100" }
--   ]
--   - name: required string
--   - region_id: optional, used to render the same mono badge as real
--                participants where it exists
--   - note: optional freeform text shown next to the name
--
-- Algorithm-generated rows always have flight_info_ids[] populated and
-- manual_passengers = []. Manually added rows have the inverse. Mixed rows
-- (algorithm row + admin appended a passenger note) are allowed but
-- discouraged — the UI doesn't surface that case.

alter table transfer_list_rows
  add column if not exists manual_passengers jsonb not null default '[]'::jsonb;
