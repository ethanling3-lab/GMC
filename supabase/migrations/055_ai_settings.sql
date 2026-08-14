-- The off switch, and the ceiling.
--
-- WHY THIS EXISTS BEFORE `ai_enabled` GOES DEFAULT-ON
--
-- Turning the AI on for every inbound is a one-line change (017 set
-- `conversations.ai_enabled boolean not null default false`). What made that
-- one line unsafe was not the AI's answers — it was that switching it back off
-- across the board meant a hand-written UPDATE run by whoever happened to be
-- awake, and that nothing bounded a bad day's spend.
--
-- Tier 1 runs an Opus-class model on every inbound with up to 4 tool
-- round-trips. A scripted flood, a message loop between two bots, or one
-- determined stranger had no ceiling at all.
--
-- So: a switch a human can reach without a deploy, and a cap the code enforces
-- before it calls Anthropic.
--
-- SCOPE ROWS
--
-- One row per scope. 'global' is the master; a 'region' row overrides it for
-- that region only. Resolution is global-AND-region — if either says off, the
-- AI is off. An override can only ever be more restrictive, so flipping the
-- global switch off is always sufficient and never second-guessed by a
-- forgotten regional row. That property is the whole point of a kill switch.

begin;

create table if not exists public.ai_settings (
  id uuid primary key default gen_random_uuid(),

  scope text not null check (scope in ('global', 'region')),
  -- ISO country code for scope='region'; null for the global row.
  region text,

  -- The kill switch. Checked before every Tier 1 run.
  ai_enabled boolean not null default true,

  -- Hard ceiling on Tier 1 spend per UTC day, in cents. Computed from
  -- ai_runs.cost_cents. Null = no cap (allowed, but the admin UI warns).
  daily_cost_cap_cents integer check (daily_cost_cap_cents is null or daily_cost_cap_cents > 0),

  -- Per-conversation rate limits. A burst this large from one thread is either
  -- a loop or someone testing the system; neither deserves an Opus call.
  max_replies_per_conversation_hour integer not null default 12
    check (max_replies_per_conversation_hour > 0),
  max_replies_per_conversation_day integer not null default 40
    check (max_replies_per_conversation_day > 0),

  -- Which model Tier 1 runs. Read at request time so a model can be rolled
  -- back without a deploy — the code supplies the default.
  model_tier1 text,

  updated_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one global row; at most one row per region.
  constraint ai_settings_scope_region_ck check (
    (scope = 'global' and region is null)
    or (scope = 'region' and region is not null)
  )
);

create unique index if not exists ai_settings_global_uniq
  on public.ai_settings ((true)) where scope = 'global';

create unique index if not exists ai_settings_region_uniq
  on public.ai_settings (region) where scope = 'region';

comment on table public.ai_settings is
  'Runtime AI controls that must be changeable without a deploy: the kill '
  'switch, the daily spend cap, per-conversation rate limits, and the Tier 1 '
  'model. Resolution is global AND region — either scope saying off wins, so '
  'the global switch is always sufficient to stop everything.';

-- Seed the global row. ai_enabled=true here is NOT the same thing as the AI
-- replying to everyone: conversations.ai_enabled still gates each thread. This
-- row is the master switch above that, and it starts on so the switch is a
-- no-op until the per-conversation default is flipped in the same change.
insert into public.ai_settings (scope, region, ai_enabled, daily_cost_cap_cents)
values ('global', null, true, 2000)
on conflict do nothing;

alter table public.ai_settings enable row level security;

-- All admin roles can read (the inbox shows AI state); only super_admin and
-- regional_lead can change it. Deliberately NOT super-admin-only: at 2am the
-- person who needs the switch is whoever is awake.
drop policy if exists "admins read ai settings" on public.ai_settings;
create policy "admins read ai settings"
  on public.ai_settings for select
  to authenticated
  using (current_admin_role() is not null);

drop policy if exists "leads write ai settings" on public.ai_settings;
create policy "leads write ai settings"
  on public.ai_settings for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'regional_lead')
  with check (is_super_admin() or current_admin_role() = 'regional_lead');

-- Cost per run -------------------------------------------------------------
--
-- ai_runs has carried token counts since 014 and cost has never been derivable
-- from them without a model→price table, which existed nowhere. Storing cents
-- at write time makes the cap check a cheap sum and means a later price change
-- doesn't silently rewrite history.
alter table public.ai_runs
  add column if not exists cost_cents numeric(10, 4);

comment on column public.ai_runs.cost_cents is
  'Cost of this run in cents, computed at write time from the token counts and '
  'the price of the model that actually ran (see src/lib/ai/pricing.ts). Stored '
  'rather than derived so historical rows keep the price that applied then.';

create index if not exists ai_runs_cost_window_idx
  on public.ai_runs (created_at desc)
  where cost_cents is not null;

commit;
