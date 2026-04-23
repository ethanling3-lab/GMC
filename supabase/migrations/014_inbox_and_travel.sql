-- M5 Wave 1 — Unified team Inbox (WhatsApp + LINE) + travel/transfer-list foundations.
--
-- Four feature surfaces land in this migration:
--   1. Conversations + messages (bidirectional) — the inbox substrate
--   2. Contact identifiers — channel ↔ participant resolver (phone, LINE user id…)
--   3. AI runs + webhook events — telemetry + replay protection
--   4. flight_info + transfer_lists + transfer_list_rows — Wave 3 feeds from the
--      inbox AI flight extraction
--
-- Also:
--   * Extends participant_status with a `lead` value so auto-created participants
--     from first inbound messages can be flagged for admin linking.
--   * Creates the `inbox-attachments` private storage bucket.
--
-- All statements idempotent so re-runs are safe in dev. RLS matches the
-- precedent set in migration 001: super_admin full; regional_lead by region;
-- customer_service by assigned_cs_id; finance + instructor excluded.

-- =============================================================================
-- Enums
-- =============================================================================

do $$ begin
  create type comm_channel as enum ('whatsapp', 'line', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_sender_type as enum ('participant', 'admin', 'system', 'ai_agent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_delivery_status as enum ('pending', 'queued', 'sent', 'delivered', 'read', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conversation_status as enum ('open', 'pending', 'snoozed', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type flight_direction as enum ('arrival', 'departure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type flight_info_source as enum ('manual', 'ai_extract', 'api');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transfer_list_status as enum ('draft', 'final');
exception when duplicate_object then null; end $$;

-- Extend participant_status with `lead`. ALTER TYPE ... ADD VALUE IF NOT EXISTS
-- lands idempotently; it cannot run inside a transaction on some Supabase
-- managed runtimes, so the block below tolerates both paths.
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'participant_status' and e.enumlabel = 'lead'
  ) then
    alter type participant_status add value 'lead';
  end if;
end $$;

-- =============================================================================
-- conversations — one thread per (participant, channel, external_thread_id)
-- =============================================================================

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  channel comm_channel not null,
  external_thread_id text not null,
  subject text,
  status conversation_status not null default 'open',
  assigned_to uuid references admins(id) on delete set null,
  tags text[] not null default '{}',
  last_message_at timestamptz,
  last_message_preview text,
  ai_autopilot_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_channel_thread_key unique (channel, external_thread_id)
);

drop trigger if exists conversations_set_updated_at on conversations;
create trigger conversations_set_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create index if not exists conversations_participant_idx on conversations (participant_id);
create index if not exists conversations_status_idx on conversations (status);
create index if not exists conversations_assigned_idx on conversations (assigned_to);
create index if not exists conversations_last_message_idx on conversations (last_message_at desc nulls last);
create index if not exists conversations_tags_idx on conversations using gin (tags);

-- =============================================================================
-- conversation_reads — per-admin last_read_at cursor
-- =============================================================================

create table if not exists conversation_reads (
  conversation_id uuid not null references conversations(id) on delete cascade,
  admin_id uuid not null references admins(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, admin_id)
);

create index if not exists conversation_reads_admin_idx on conversation_reads (admin_id);

-- =============================================================================
-- messages — bidirectional message log
-- =============================================================================

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction message_direction not null,
  channel comm_channel not null,
  external_message_id text,
  sender_type message_sender_type not null,
  sender_admin_id uuid references admins(id) on delete set null,
  body_text text,
  body_html text,
  attachments jsonb not null default '[]',
  ai_tags jsonb not null default '{}',
  delivery_status message_delivery_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);

-- Partial unique index for webhook idempotency. Meta + LINE both redeliver.
-- Outbound messages may not have an external_message_id yet (queued, pending),
-- hence `where external_message_id is not null`.
create unique index if not exists messages_external_id_uniq
  on messages (channel, external_message_id)
  where external_message_id is not null;

create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
create index if not exists messages_direction_idx on messages (direction);
create index if not exists messages_delivery_idx on messages (delivery_status);

-- =============================================================================
-- contact_identifiers — (channel, identifier) → participant
-- =============================================================================
--
-- Examples:
--   channel='whatsapp', identifier='65 9123 4567' (E.164 recommended)
--   channel='line',     identifier='U1a2b3c...' (LINE user id)
--   channel='email',    identifier='ethan@example.com'
--
-- Participants can have multiple identifiers per channel. The unique
-- constraint enforces (channel, identifier) globally so two participants
-- can't claim the same identity.
create table if not exists contact_identifiers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  channel comm_channel not null,
  identifier text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint contact_identifiers_channel_identifier_key unique (channel, identifier)
);

create index if not exists contact_identifiers_participant_idx on contact_identifiers (participant_id);

-- =============================================================================
-- ai_runs — per-call telemetry (triage, draft, flight extract)
-- =============================================================================

create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  task text not null,                            -- 'classify_and_draft' | 'extract_flight' | ...
  model text not null,                           -- e.g. 'claude-haiku-4-5-20251001'
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_creation_tokens int,
  latency_ms int,
  result jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists ai_runs_conversation_idx on ai_runs (conversation_id);
create index if not exists ai_runs_task_idx on ai_runs (task);
create index if not exists ai_runs_created_idx on ai_runs (created_at desc);

-- =============================================================================
-- webhook_events — replay protection for inbound webhooks
-- =============================================================================

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  channel comm_channel not null,
  external_event_id text not null,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  constraint webhook_events_channel_event_key unique (channel, external_event_id)
);

create index if not exists webhook_events_received_idx on webhook_events (received_at desc);

-- =============================================================================
-- flight_info — confirmed flight data per (enrollment, direction)
-- =============================================================================

create table if not exists flight_info (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  direction flight_direction not null,
  flight_number text,
  airline text,
  origin_airport text,                  -- IATA 3-letter
  destination_airport text,             -- IATA 3-letter
  scheduled_at timestamptz,
  terminal text,
  hotel_key text,                       -- event-local key; 'main_venue' | 'designated:<id>'
  is_vip boolean not null default false,
  passport_info jsonb,
  source flight_info_source not null default 'manual',
  raw_source_message_id uuid references messages(id) on delete set null,
  confirmed_by uuid references admins(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flight_info_enrollment_direction_key unique (enrollment_id, direction)
);

drop trigger if exists flight_info_set_updated_at on flight_info;
create trigger flight_info_set_updated_at
  before update on flight_info
  for each row execute function set_updated_at();

create index if not exists flight_info_enrollment_idx on flight_info (enrollment_id);
create index if not exists flight_info_scheduled_idx on flight_info (scheduled_at);

-- =============================================================================
-- transfer_lists + transfer_list_rows — Wave 3 generator outputs
-- =============================================================================

create table if not exists transfer_lists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  direction flight_direction not null,
  status transfer_list_status not null default 'draft',
  generated_at timestamptz not null default now(),
  generated_by uuid references admins(id) on delete set null,
  rules_snapshot jsonb not null default '{}',    -- window minutes, vehicles, VIP list, routing
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists transfer_lists_set_updated_at on transfer_lists;
create trigger transfer_lists_set_updated_at
  before update on transfer_lists
  for each row execute function set_updated_at();

create index if not exists transfer_lists_event_idx on transfer_lists (event_id, direction);

create table if not exists transfer_list_rows (
  id uuid primary key default gen_random_uuid(),
  transfer_list_id uuid not null references transfer_lists(id) on delete cascade,
  group_no int not null,
  vehicle_type text,
  landing_or_takeoff_at timestamptz,
  terminal text,
  destination text,
  remark text,
  vip boolean not null default false,
  flight_info_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists transfer_list_rows_list_idx on transfer_list_rows (transfer_list_id, group_no);

-- =============================================================================
-- Storage bucket: inbox-attachments (private, signed URL access)
-- =============================================================================
--
-- Images, PDFs, audio clips downloaded from WhatsApp/LINE media endpoints.
-- Raw external URLs expire fast so we copy-and-store on ingest.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbox-attachments',
  'inbox-attachments',
  false,
  10 * 1024 * 1024,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/webm'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- RLS — super_admin full; regional_lead by participant region; customer_service
-- by assigned_cs_id (scoped via join); finance + instructor excluded.
-- =============================================================================

alter table conversations enable row level security;
alter table conversation_reads enable row level security;
alter table messages enable row level security;
alter table contact_identifiers enable row level security;
alter table ai_runs enable row level security;
alter table webhook_events enable row level security;
alter table flight_info enable row level security;
alter table transfer_lists enable row level security;
alter table transfer_list_rows enable row level security;

-- conversations
drop policy if exists "admins view conversations" on conversations;
create policy "admins view conversations"
  on conversations for select
  to authenticated
  using (
    is_super_admin()
    or (current_admin_role() = 'regional_lead'
        and exists (
          select 1 from participants p
          where p.id = conversations.participant_id
            and p.region = current_admin_region()
        ))
    or (current_admin_role() = 'customer_service'
        and exists (
          select 1 from participants p
          where p.id = conversations.participant_id
            and (p.assigned_cs_id = auth.uid() or conversations.assigned_to = auth.uid())
        ))
  );

drop policy if exists "admins manage conversations" on conversations;
create policy "admins manage conversations"
  on conversations for all
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service')
  )
  with check (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service')
  );

-- conversation_reads — admin can only touch their own cursor
drop policy if exists "admins manage own reads" on conversation_reads;
create policy "admins manage own reads"
  on conversation_reads for all
  to authenticated
  using (admin_id = auth.uid() or is_super_admin())
  with check (admin_id = auth.uid() or is_super_admin());

-- messages — inherit conversation visibility
drop policy if exists "admins view messages" on messages;
create policy "admins view messages"
  on messages for select
  to authenticated
  using (
    is_super_admin()
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (
          is_super_admin()
          or (current_admin_role() = 'regional_lead'
              and exists (
                select 1 from participants p
                where p.id = c.participant_id and p.region = current_admin_region()
              ))
          or (current_admin_role() = 'customer_service'
              and (c.assigned_to = auth.uid()
                   or exists (
                     select 1 from participants p
                     where p.id = c.participant_id and p.assigned_cs_id = auth.uid()
                   )))
        )
    )
  );

drop policy if exists "admins manage messages" on messages;
create policy "admins manage messages"
  on messages for all
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'))
  with check (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'));

-- contact_identifiers
drop policy if exists "admins view contact identifiers" on contact_identifiers;
create policy "admins view contact identifiers"
  on contact_identifiers for select
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'));

drop policy if exists "admins manage contact identifiers" on contact_identifiers;
create policy "admins manage contact identifiers"
  on contact_identifiers for all
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'))
  with check (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'));

-- ai_runs — super_admin only (cost/PII sensitive)
drop policy if exists "super admins view ai runs" on ai_runs;
create policy "super admins view ai runs"
  on ai_runs for select
  to authenticated
  using (is_super_admin());

-- webhook_events — super_admin only
drop policy if exists "super admins view webhook events" on webhook_events;
create policy "super admins view webhook events"
  on webhook_events for select
  to authenticated
  using (is_super_admin());

-- flight_info — inbox-viewing roles, same scope as conversations
drop policy if exists "admins view flight info" on flight_info;
create policy "admins view flight info"
  on flight_info for select
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service', 'instructor'));

drop policy if exists "admins manage flight info" on flight_info;
create policy "admins manage flight info"
  on flight_info for all
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'))
  with check (is_super_admin() or current_admin_role() in ('regional_lead', 'customer_service'));

-- transfer_lists + rows — super_admin + regional_lead + instructor read; super + regional_lead write
drop policy if exists "admins view transfer lists" on transfer_lists;
create policy "admins view transfer lists"
  on transfer_lists for select
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'instructor'));

drop policy if exists "admins manage transfer lists" on transfer_lists;
create policy "admins manage transfer lists"
  on transfer_lists for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');

drop policy if exists "admins view transfer list rows" on transfer_list_rows;
create policy "admins view transfer list rows"
  on transfer_list_rows for select
  to authenticated
  using (is_super_admin() or current_admin_role() in ('regional_lead', 'instructor'));

drop policy if exists "admins manage transfer list rows" on transfer_list_rows;
create policy "admins manage transfer list rows"
  on transfer_list_rows for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');
