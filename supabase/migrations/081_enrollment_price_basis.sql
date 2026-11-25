-- Why each enrollment got its price (src/lib/pricing/tiers.ts resolvePrice).
-- A snapshot written at registration / admin add / price override, e.g.
--   { "v": 1, "rule": "included", "category": "glorious_family",
--     "programme_slug": "glorious_family", "valid_until": "2027-06-30",
--     "on_date": "2027-03-12", "course_id": "…", "misc_fee": 300,
--     "course_fee": 0, "amount": 300 }
-- Lets staff (and the "Price check" on the enrollments page) see months
-- later exactly which rule priced a person. Null for older enrollments.

alter table public.enrollments
  add column if not exists price_basis jsonb;

-- Capacity is retired (Ethan, 2026-11-25): registration is opened/closed
-- with the editor's toggle (event status open ↔ closed) instead. Clear the
-- remaining cap (6月份 新山 永不落空的力量 = 300) so no hidden limit stays.
update public.events set capacity = null where capacity is not null;
