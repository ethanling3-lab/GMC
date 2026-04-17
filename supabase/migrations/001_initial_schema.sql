-- GMC CRM initial schema (M1 scope: registration + confirmation flow)
-- Tables: participants, admins, events, enrollments, notifications, audit_log
-- Later milestones add: accommodations, travel_info, transfer_*, event_groups, group_members, check_ins
--
-- IMPORTANT: Public can only INSERT into participants and enrollments. All SELECT/UPDATE
-- requires authenticated admin. Service-role key bypasses RLS for server-side ops.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

create type admin_role as enum (
  'super_admin', 'regional_lead', 'customer_service', 'finance', 'instructor'
);

create type participant_status as enum (
  'new', 'info_verified', 'cs_enriched', 'active', 'inactive'
);

create type motivation_tag as enum (
  'clean', 'insurance', 'direct_sales', 'spiritual', 'other'
);

create type event_type as enum (
  'retreat', 'course', 'workshop', 'seminar', 'other'
);

create type event_mode as enum ('online', 'offline');

create type event_status as enum ('draft', 'open', 'closed', 'archived');

create type enrollment_status as enum (
  'pending_approval', 'approved', 'rejected', 'paid', 'cancelled'
);

create type payment_method as enum (
  'hitpay', 'stripe', 'bank_transfer', 'tt'
);

create type payment_status as enum (
  'none', 'pending', 'paid', 'failed', 'refunded'
);

create type notification_channel as enum ('whatsapp', 'email', 'sms');

create type notification_status as enum (
  'pending', 'sent', 'delivered', 'read', 'failed'
);

-- =============================================================================
-- HELPER: updated_at trigger
-- =============================================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- admins (extends auth.users)
-- =============================================================================

create table admins (
  id uuid primary key references auth.users(id) on delete cascade,
  name_cn text,
  name_en text,
  role admin_role not null default 'customer_service',
  region text,                          -- ISO country code (e.g. MY, SG)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger admins_set_updated_at
  before update on admins
  for each row execute function set_updated_at();

-- =============================================================================
-- participants (shared student master, one row per person globally)
-- =============================================================================

create table participants (
  id uuid primary key default gen_random_uuid(),
  region_id text unique,                -- auto-assigned by trigger: MY001, SG042, ...
  name_cn text,
  name_en text,
  email citext,
  phone text,
  region text,                          -- ISO country code
  language text,                        -- zh / en / both
  gender text,                          -- male / female / other / undisclosed
  birth_date date,
  occupation text,
  industry text,

  financial_score int check (financial_score between 1 and 10),
  influence_score int check (influence_score between 1 and 10),
  overall_score   int check (overall_score   between 1 and 10),
  motivation_tag  motivation_tag,

  is_old_student boolean not null default false,
  family_of_participant_id uuid references participants(id) on delete set null,
  referrer_id uuid references participants(id) on delete set null,   -- 感召报名

  personality text,
  face_type text,
  parameter_framework text,
  front_photo_url text,

  assigned_region_lead_id uuid references admins(id) on delete set null,
  assigned_cs_id uuid references admins(id) on delete set null,
  cs_notes text,

  status participant_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One person = one record; email+phone together should be unique if both present
  constraint participants_email_phone_unique unique (email, phone)
);

create index participants_status_idx       on participants (status);
create index participants_region_idx       on participants (region);
create index participants_referrer_idx     on participants (referrer_id);
create index participants_assigned_cs_idx  on participants (assigned_cs_id);

create trigger participants_set_updated_at
  before update on participants
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- region_id auto-assignment trigger
-- Format: <ISO-2-country><3-digit-sequence> e.g. MY001, SG042
-- Sequence is per-country and monotonic. Gaps are OK (deletions leave them).
-- -----------------------------------------------------------------------------

create or replace function assign_participant_region_id() returns trigger as $$
declare
  country_code text;
  next_seq int;
begin
  if new.region_id is not null and new.region_id <> '' then
    return new;
  end if;

  country_code := upper(coalesce(new.region, 'XX'));
  -- Keep only letters, cap at 2 chars. Fallback 'XX' if missing.
  country_code := regexp_replace(country_code, '[^A-Z]', '', 'g');
  if length(country_code) < 2 then
    country_code := 'XX';
  else
    country_code := substring(country_code from 1 for 2);
  end if;

  -- Compute next sequence for this country. Regex extracts the digits.
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

  new.region_id := country_code || lpad(next_seq::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create trigger participants_assign_region_id
  before insert on participants
  for each row execute function assign_participant_region_id();

-- =============================================================================
-- events (unified: retreats, courses, workshops)
-- =============================================================================

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,

  title_cn text,
  title_en text,
  heading_cn text,
  heading_en text,
  sub_heading_cn text,
  sub_heading_en text,
  body_cn text,
  body_en text,

  poster_url text,
  gallery text[] not null default '{}',

  type event_type not null default 'course',
  mode event_mode not null default 'offline',
  venue text,
  city text,
  country text,

  main_venue_hotel_id uuid,              -- FK to accommodations, added in later migration
  start_date date,
  end_date date,
  departure_day date,

  enrollment_opens_at timestamptz,
  enrollment_closes_at timestamptz,

  capacity int,
  price numeric(10,2),
  currency text not null default 'SGD',
  payment_methods payment_method[] not null default '{}',

  target_audience_filter jsonb not null default '{}'::jsonb,
  status event_status not null default 'draft',
  requires_approval boolean not null default true,

  created_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_status_idx           on events (status);
create index events_start_date_idx       on events (start_date);

create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- =============================================================================
-- enrollments (per-event registrations)
-- =============================================================================

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,

  status enrollment_status not null default 'pending_approval',
  approved_by uuid references admins(id) on delete set null,
  approved_at timestamptz,

  payment_method payment_method,
  payment_provider_id text,
  payment_status payment_status not null default 'none',
  amount_paid numeric(10,2),
  paid_at timestamptz,

  cs_followup_notes text,
  qr_token text unique,                       -- set on approval/paid for check-in

  -- Email/WhatsApp confirmation flow
  confirmation_token text unique,             -- HMAC, emailed to participant
  confirmation_token_expires_at timestamptz,
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One participant can only enroll in a given event once
  constraint enrollments_unique_per_event unique (participant_id, event_id)
);

create index enrollments_event_status_idx on enrollments (event_id, status);
create index enrollments_participant_idx  on enrollments (participant_id);

create trigger enrollments_set_updated_at
  before update on enrollments
  for each row execute function set_updated_at();

-- =============================================================================
-- notifications (audit log of outbound comms)
-- =============================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete set null,
  enrollment_id uuid references enrollments(id) on delete set null,
  event_id uuid references events(id) on delete set null,

  channel notification_channel not null,
  template text not null,                     -- e.g. 'confirm_registration_zh'
  to_address text,                            -- masked in read-level views; raw stored server-side
  payload jsonb not null default '{}'::jsonb,
  status notification_status not null default 'pending',
  provider_id text,                           -- WhatsApp message id / Resend id
  error_message text,

  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_participant_idx on notifications (participant_id);
create index notifications_status_idx on notifications (status);

-- =============================================================================
-- audit_log (generic change log)
-- =============================================================================

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references admins(id) on delete set null,
  action text not null,                       -- e.g. 'participant.reveal_pii'
  entity text not null,                       -- e.g. 'participants'
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity, entity_id);
create index audit_log_actor_idx  on audit_log (actor_id);

-- =============================================================================
-- HELPERS: role & region lookups (used by RLS)
-- =============================================================================

create or replace function current_admin_role() returns admin_role as $$
  select role from admins where id = auth.uid()
$$ language sql stable security definer;

create or replace function current_admin_region() returns text as $$
  select region from admins where id = auth.uid()
$$ language sql stable security definer;

create or replace function is_super_admin() returns boolean as $$
  select exists (select 1 from admins where id = auth.uid() and role = 'super_admin')
$$ language sql stable security definer;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table participants   enable row level security;
alter table admins         enable row level security;
alter table events         enable row level security;
alter table enrollments    enable row level security;
alter table notifications  enable row level security;
alter table audit_log      enable row level security;

-- ---------- participants ----------

-- Public can INSERT (self-registration). All other access requires authenticated admin.
create policy "public can insert participants"
  on participants for insert
  to anon
  with check (true);

-- Authenticated admins can SELECT based on role
create policy "admins can view participants"
  on participants for select
  to authenticated
  using (
    is_super_admin()
    or (current_admin_role() = 'regional_lead' and region = current_admin_region())
    or (current_admin_role() = 'customer_service' and assigned_cs_id = auth.uid())
    or (current_admin_role() = 'finance')
    or (current_admin_role() = 'instructor')
  );

create policy "admins can update participants"
  on participants for update
  to authenticated
  using (
    is_super_admin()
    or (current_admin_role() = 'regional_lead' and region = current_admin_region())
    or (current_admin_role() = 'customer_service' and assigned_cs_id = auth.uid())
  )
  with check (true);

-- ---------- events ----------

-- Public can SELECT events that are open (for public event catalog)
create policy "public can view open events"
  on events for select
  to anon
  using (status = 'open');

create policy "admins can view all events"
  on events for select
  to authenticated
  using (true);

create policy "super admins manage events"
  on events for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ---------- enrollments ----------

-- Public can INSERT (enrollment at registration time)
create policy "public can insert enrollments"
  on enrollments for insert
  to anon
  with check (true);

-- Public can SELECT their own enrollment by confirmation_token (non-blocking; /confirm page)
-- We keep this restrictive: SELECT requires the token to match exactly via server-side call
-- using service role, so no policy for anon SELECT is added here.

create policy "admins can view enrollments"
  on enrollments for select
  to authenticated
  using (
    is_super_admin()
    or (current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor'))
  );

create policy "admins can update enrollments"
  on enrollments for update
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'finance')
  )
  with check (true);

-- ---------- admins ----------

create policy "admins see themselves and peers"
  on admins for select
  to authenticated
  using (is_super_admin() or id = auth.uid());

create policy "super admins manage admins"
  on admins for all
  to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- ---------- notifications ----------

create policy "admins view notifications"
  on notifications for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- Inserts happen server-side via service role (bypasses RLS). No anon policy.

-- ---------- audit_log ----------

create policy "super admins view audit log"
  on audit_log for select
  to authenticated
  using (is_super_admin());

-- =============================================================================
-- STORAGE BUCKETS
-- =============================================================================
-- Created via Supabase dashboard or supabase CLI. Buckets:
--   participant-photos   — private, signed URLs only
--   flight-images        — private, signed URLs only
--   event-posters        — public read, admin write
-- These are documented here but created via the Supabase Storage UI on setup.
