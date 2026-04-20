-- Defer student-ID (region_id) assignment to admin approval.
--
-- The original trigger (migration 001) auto-assigned region_id on every
-- participant insert, including public /register submissions that hadn't
-- been vetted yet. Two problems:
--
--   1. Race condition: the trigger's `max(seq) + 1` lookup wasn't atomic
--      against the unique constraint, so two near-simultaneous registrations
--      (or a double-submitted form) computed the same number and the second
--      one died with `participants_region_id_key`. Surfaced to the
--      participant as "Couldn't submit · Something went wrong".
--
--   2. Policy: GMC's intent is that the student ID is only minted once an
--      admin has reviewed and approved the registration. Pre-approval
--      participants should have region_id = NULL.
--
-- Fix: drop the auto-fire trigger and provide a `assign_region_id(participant)`
-- function the server calls when the approval transition runs. The function
-- holds a per-country transaction advisory lock across BOTH the max-lookup
-- AND the participants UPDATE, so two concurrent admin approvals in the same
-- country code serialize cleanly. Idempotent: if the participant already has
-- a region_id (returning student, prior approval, manual import) the function
-- returns the existing value untouched.

drop trigger if exists participants_assign_region_id on participants;

create or replace function assign_region_id(p_participant_id uuid) returns text as $$
declare
  country_code   text;
  participant_region text;
  existing       text;
  next_seq       int;
  computed       text;
begin
  -- Fast path: already assigned. No lock needed.
  select region_id, region
    into existing, participant_region
    from participants
    where id = p_participant_id;
  if existing is not null and existing <> '' then
    return existing;
  end if;
  if participant_region is null then
    -- Participant row missing — let the caller decide how to handle.
    return null;
  end if;

  country_code := upper(coalesce(participant_region, 'XX'));
  country_code := regexp_replace(country_code, '[^A-Z]', '', 'g');
  if length(country_code) < 2 then
    country_code := 'XX';
  else
    country_code := substring(country_code from 1 for 2);
  end if;

  -- Serialize per-country across the whole compute + update window.
  -- Different country codes hash to different keys → still parallel.
  perform pg_advisory_xact_lock(
    hashtext('participants_region_id_' || country_code)
  );

  -- Re-check after taking the lock — another tx may have assigned us.
  select region_id into existing from participants where id = p_participant_id;
  if existing is not null and existing <> '' then
    return existing;
  end if;

  select coalesce(max(
    case
      when region_id ~ ('^' || country_code || '[0-9]+$')
        then (regexp_replace(region_id, '^' || country_code, ''))::int
      else 0
    end
  ), 0) + 1
  into next_seq
  from participants
  where region_id like country_code || '%';

  computed := country_code || lpad(next_seq::text, 3, '0');
  update participants set region_id = computed where id = p_participant_id;
  return computed;
end;
$$ language plpgsql;
