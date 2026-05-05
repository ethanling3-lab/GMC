-- Fix assign_region_id sequence-overflow bug.
--
-- The original function (migration 012) computed the new ID with:
--     country_code || lpad(next_seq::text, 3, '0')
-- Postgres lpad TRUNCATES inputs longer than the target length, so once a
-- region's sequence crosses 999, lpad('1006', 3, '0') returns '100' and the
-- function produces a duplicate (e.g. MY100 collision when next_seq=1006).
-- MY hit this on staging because legacy imports already seeded MY1001+.
--
-- Fix: pad to a minimum width of 3 but never truncate longer numbers.

create or replace function public.assign_region_id(p_participant_id uuid)
returns text
language plpgsql
as $function$
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
    return null;
  end if;

  country_code := upper(coalesce(participant_region, 'XX'));
  country_code := regexp_replace(country_code, '[^A-Z]', '', 'g');
  if length(country_code) < 2 then
    country_code := 'XX';
  else
    country_code := substring(country_code from 1 for 2);
  end if;

  perform pg_advisory_xact_lock(
    hashtext('participants_region_id_' || country_code)
  );

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

  -- Pad to a MINIMUM of 3 digits; never truncate longer sequences.
  computed := country_code
    || lpad(next_seq::text, greatest(3, length(next_seq::text)), '0');
  update participants set region_id = computed where id = p_participant_id;
  return computed;
end;
$function$;
