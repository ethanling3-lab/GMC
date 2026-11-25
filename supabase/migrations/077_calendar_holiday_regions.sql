-- Holiday regions are no longer limited to MY / Johor / SG (Ethan,
-- 2026-11-25). The list of choices lives in code
-- (HOLIDAY_REGION_CATALOGUE, src/lib/calendar/types.ts), so adding a region
-- needs no migration. The database only checks the code shape:
-- 2–3 capital letters (country "MY", "TW" or Malaysian state "JHR", "SGR").

alter table calendar_holidays drop constraint if exists calendar_holidays_regions_check;
alter table calendar_holidays add constraint calendar_holidays_regions_check
  check (
    cardinality(regions) >= 1
    and array_to_string(regions, ',') ~ '^[A-Z]{2,3}(,[A-Z]{2,3})*$'
  );
