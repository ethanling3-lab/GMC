-- M7.6 Broadcasts — campaign-level outbound to event-cohort or participant-master audiences.
--
-- Two tables:
--   - broadcasts: one row per campaign (audience filter snapshot, channels,
--     content, status, stats). Soft-deletable.
--   - broadcast_recipients: one row per (broadcast, participant, channel)
--     fan-out leaf. Each row is the unit of work for the background sender:
--     status='pending' is picked up, status='sent'/'failed'/'skipped' is done.
--     This is also what powers the detail page's per-status tabs.
--
-- Channels: WhatsApp templates + email. Multi-channel per recipient — each
-- participant with both addresses gets one row per channel. Each successful
-- send mirrors into the participant's inbox conversation as an outbound
-- messages row; broadcast_recipients.conversation_id + message_id link
-- back to the mirror.
--
-- Scheduling: status='scheduled' + scheduled_for timestamptz. A 5-min cron
-- (cron-broadcasts-due) flips due rows to 'sending' and kicks the
-- broadcast-fanout-background Netlify function.
--
-- RLS: SELECT on broadcasts is open to all roles (instructor/finance need
-- read for visibility). SELECT on broadcast_recipients gates regional_lead
-- to their own region via a participants subquery — same shape as
-- conversations RLS in 014_inbox_and_travel.sql. All writes via service-role.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'broadcast_status') then
    create type broadcast_status as enum (
      'draft', 'scheduled', 'sending', 'sent', 'partial', 'cancelled', 'failed'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'broadcast_audience_mode') then
    create type broadcast_audience_mode as enum (
      'event_cohort', 'participant_master'
    );
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'broadcast_channel') then
    create type broadcast_channel as enum ('whatsapp', 'email');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'broadcast_recipient_status') then
    create type broadcast_recipient_status as enum (
      'pending', 'sent', 'failed', 'skipped'
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- broadcasts (campaign rows)
-- ---------------------------------------------------------------------------

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),

  name text not null check (char_length(trim(name)) between 1 and 120),

  -- Audience: which resolver to use + the serialized filter shape.
  audience_mode broadcast_audience_mode not null,
  audience_filter jsonb not null,
  -- Resolved at create-time; for display + drift detection (the actual
  -- recipient list is materialized fresh at send-time).
  audience_snapshot_count integer not null default 0,

  -- Channels admin chose. Array (1-2 entries) lets one campaign hit
  -- WhatsApp AND email per recipient. Enforced non-empty.
  channels broadcast_channel[] not null
    check (array_length(channels, 1) between 1 and 2),

  -- WhatsApp content (nullable when channel set doesn't include whatsapp).
  whatsapp_template_name text,
  whatsapp_template_language text,   -- matches messages.template_language column shape
  whatsapp_template_params jsonb,    -- {variable_1: "${name_cn}", variable_2: "Hotel X", ...}

  -- Email content (nullable when channel set doesn't include email).
  -- Bilingual EN + 中文; participantEmailLocale() picks per recipient.
  email_subject_en text,
  email_subject_cn text,
  email_body_en text,                -- raw HTML; interpolation tokens identical to WhatsApp
  email_body_cn text,

  status broadcast_status not null default 'draft',
  scheduled_for timestamptz,         -- non-null when status='scheduled'

  -- Stats updated by the fan-out background function as it processes
  -- recipients. Shape: { queued: int, sent: int, failed: int, skipped: int }
  stats jsonb not null default '{}'::jsonb,

  started_at timestamptz,
  completed_at timestamptz,

  created_by uuid not null references public.admins(id) on delete set null,
  updated_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Channel/content consistency: if 'whatsapp' is in channels, template_name
  -- must be set; if 'email' is in channels, subject + body for at least one
  -- locale must be set. Enforced for non-draft rows only — drafts can be
  -- saved with incomplete content.
  constraint broadcasts_whatsapp_content_when_sending
    check (
      status = 'draft'
      or not ('whatsapp' = any(channels))
      or whatsapp_template_name is not null
    ),
  constraint broadcasts_email_content_when_sending
    check (
      status = 'draft'
      or not ('email' = any(channels))
      or (
        (email_subject_en is not null and email_body_en is not null)
        or (email_subject_cn is not null and email_body_cn is not null)
      )
    ),
  constraint broadcasts_scheduled_for_present
    check (status <> 'scheduled' or scheduled_for is not null)
);

create index if not exists broadcasts_due_idx
  on public.broadcasts (scheduled_for)
  where status = 'scheduled' and deleted_at is null;

create index if not exists broadcasts_list_idx
  on public.broadcasts (created_at desc)
  where deleted_at is null;

create index if not exists broadcasts_status_idx
  on public.broadcasts (status)
  where deleted_at is null;

create trigger broadcasts_set_updated_at
  before update on public.broadcasts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- broadcast_recipients (per-recipient fan-out leaves)
-- ---------------------------------------------------------------------------

create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),

  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  -- Event-cohort mode only — set when audience came from a specific event
  -- enrollment. Used for interpolating ${amount_due} and ${payment_link}.
  enrollment_id uuid references public.enrollments(id) on delete set null,

  channel broadcast_channel not null,
  -- Snapshotted at resolve-time so audit + retry behave even if the
  -- participant's contact details change later.
  target_address text,

  status broadcast_recipient_status not null default 'pending',
  error_message text,
  -- Stable machine tag: 'no_address' | 'outside_window' | 'provider' |
  -- 'cancelled' | null. Used to filter retry-failed (no_address stays
  -- skipped; outside_window + provider are retryable).
  error_code text,

  external_message_id text,

  -- Mirror into inbox: the conversation + message rows this recipient's
  -- send created. Null until status='sent'.
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,

  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One (broadcast, participant, channel) tuple is unique — prevents
  -- duplicate fan-out rows when retry-failed re-resolves audience.
  constraint broadcast_recipients_unique
    unique (broadcast_id, participant_id, channel)
);

create index if not exists broadcast_recipients_pending_idx
  on public.broadcast_recipients (broadcast_id, channel)
  where status = 'pending';

create index if not exists broadcast_recipients_status_idx
  on public.broadcast_recipients (broadcast_id, status);

create index if not exists broadcast_recipients_participant_idx
  on public.broadcast_recipients (participant_id, sent_at desc nulls last);

create trigger broadcast_recipients_set_updated_at
  before update on public.broadcast_recipients
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

-- broadcasts: open SELECT to all admin roles (read-only visibility for
-- instructor/finance, full edit via writes which go through service-role
-- with app-level role gating). Regional gate happens at audience-resolution
-- + write time, not table SELECT — super-created broadcasts targeting any
-- region must still be visible to the regional leads in that region.
create policy "admins can view broadcasts"
  on public.broadcasts for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('regional_lead', 'customer_service', 'finance', 'instructor')
  );

-- broadcast_recipients: per-participant region gate for regional_lead,
-- same shape as conversations RLS at 014_inbox_and_travel.sql:328-333.
-- A MY lead never sees the SG recipients of a cross-region campaign.
create policy "admins can view broadcast recipients"
  on public.broadcast_recipients for select
  to authenticated
  using (
    is_super_admin()
    or current_admin_role() in ('customer_service', 'finance', 'instructor')
    or (
      current_admin_role() = 'regional_lead'
      and exists (
        select 1 from public.participants p
        where p.id = broadcast_recipients.participant_id
          and p.region = current_admin_region()
      )
    )
  );

-- Writes happen server-side via service role (bypasses RLS); the API
-- routes enforce role membership (super_admin | regional_lead for
-- create/edit/send; CS/finance/instructor read-only).

comment on table public.broadcasts is
  'Campaign-level outbound: audience filter snapshot + channels + content + status. Fans out into broadcast_recipients at send-time.';
comment on table public.broadcast_recipients is
  'Per-(broadcast,participant,channel) fan-out leaves. status=pending is the unit of work for the background sender; status=sent links to the mirrored messages row.';
