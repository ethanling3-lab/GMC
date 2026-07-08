-- 045 — Retire the legacy programme_tier enum shim.
--
-- The Programmes feature (043/044) replaced the static programme_tier enum
-- with the dynamic `programmes` table + `participants.programme_id` FK. The
-- enum column was kept as a lock-step compat shim while display-only read
-- sites (floor plan, PPTX exports, public profile) were cut over to the
-- programmes join. Those readers are now fully migrated, so the shim is dead.
--
-- APPLY ONLY AFTER the cutover code is deployed and live — the previously
-- deployed bundle SELECTs participants.programme_tier and would 500 if the
-- column disappeared under it. Sequence: deploy code → Netlify READY → apply.
--
-- Only participants.programme_tier binds the enum type (verified via
-- information_schema), so the type drops cleanly once the column is gone.
-- Idempotent: safe to re-run.

alter table participants drop column if exists programme_tier;

drop type if exists programme_tier;
