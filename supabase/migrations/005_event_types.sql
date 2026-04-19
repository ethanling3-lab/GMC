-- Replace the event_type enum:
--   drop  workshop, seminar
--   add   single_class (单课), delivery_class (交付课)
--
-- PostgreSQL can't drop individual enum values, so we recreate the type.
-- Any existing rows typed 'workshop' or 'seminar' are coerced to 'other' before
-- the rename so the cast can't fail.

update events set type = 'other' where type in ('workshop', 'seminar');

alter type event_type rename to event_type_old;

create type event_type as enum (
  'retreat', 'course', 'single_class', 'delivery_class', 'other'
);

alter table events
  alter column type drop default,
  alter column type type event_type using type::text::event_type,
  alter column type set default 'course';

drop type event_type_old;
