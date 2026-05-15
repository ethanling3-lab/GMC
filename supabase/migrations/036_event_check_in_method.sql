-- M7.1d — Per-event check-in method.
--
-- Some events use QR codes, some use face recognition, some need both
-- available at the door. The scanner page reads this column to dispatch
-- to ScannerStation / FaceScannerStation / UnifiedScannerStation.
--
-- Default `'face'` so new events use the M7.1c flow without admin
-- intervention; existing events all default to 'face' too — admin can
-- downgrade a specific event to 'qr' from the event editor.

create type event_check_in_method as enum ('qr', 'face', 'both');

alter table public.events
  add column if not exists check_in_method event_check_in_method
    not null default 'face';
