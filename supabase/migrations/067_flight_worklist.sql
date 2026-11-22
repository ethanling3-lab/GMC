-- Customer service flight worklist.
--
-- flight_followups: who was contacted, and who doesn't need a transfer.
-- flight_change_flags: changes by customer service that an admin must see,
-- plus VIP requests that an admin must approve.
--
-- Both are read and written only by server routes after a role check, so
-- no browser-facing policies are granted.

create table if not exists flight_followups (
  enrollment_id uuid primary key references enrollments(id) on delete cascade,
  contacted_at timestamptz,
  contacted_by uuid references admins(id) on delete set null,
  contact_note text check (contact_note is null or char_length(contact_note) <= 300),
  arrival_not_needed boolean not null default false,
  departure_not_needed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists flight_change_flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  direction flight_direction not null,
  kind text not null check (kind in ('changed', 'deleted', 'vip_request')),
  before_details jsonb,
  after_details jsonb,
  requested_vip boolean,
  requested_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references admins(id) on delete set null,
  resolution text check (resolution in ('reviewed', 'approved', 'declined')),
  constraint flight_flag_vip_value check (kind <> 'vip_request' or requested_vip is not null),
  constraint flight_flag_resolution_pair check ((resolved_at is null) = (resolution is null))
);

-- One open change flag and one open VIP request per passenger and direction.
create unique index if not exists flight_change_flags_open_change
  on flight_change_flags (enrollment_id, direction)
  where resolved_at is null and kind in ('changed', 'deleted');

create unique index if not exists flight_change_flags_open_vip
  on flight_change_flags (enrollment_id, direction)
  where resolved_at is null and kind = 'vip_request';

create index if not exists flight_change_flags_event_open
  on flight_change_flags (event_id, created_at desc)
  where resolved_at is null;

alter table flight_followups enable row level security;
alter table flight_change_flags enable row level security;

revoke all on flight_followups from anon, authenticated;
revoke all on flight_change_flags from anon, authenticated;
grant all on flight_followups to service_role;
grant all on flight_change_flags to service_role;
