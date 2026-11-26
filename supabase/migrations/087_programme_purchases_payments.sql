-- Phase 2 · Payment counter, programme purchases, payments ledger
-- (Ethan, 2026-11-26).
--
-- How it happens on the day: a new person fills in the paper form, comes
-- to the payment counter, pays by card on the HitPay terminal, and Finance
-- records it in the CRM. Programmes are sold on the spot (定金 or 全款);
-- members pay later instalments at the counter too.
--
--   payment_templates (+ items) — reusable schedules Finance sets up, e.g.
--     "荣贵 · 定金 + 6期". A template with one row = full payment.
--   programme_purchases — one programme someone bought.
--   purchase_schedule — that buyer's own due rows, copied from the template
--     and then editable for them alone.
--   payments — every payment received, one row per thing paid. Items paid
--     with one card swipe share a counter_batch.
--
-- Writes go through server routes (Finance + Super Admin). RLS lets those
-- two roles read and write directly; everyone else gets nothing.

-- Card and cash at the counter, on event enrolments too.
alter type public.payment_method add value if not exists 'card';
alter type public.payment_method add value if not exists 'cash';

create table if not exists public.payment_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  programme_id uuid references public.programmes(id) on delete set null,
  kind text not null default 'new' check (kind in ('new', 'upgrade', 'other')),
  total_sgd numeric(12,2) not null check (total_sgd >= 0),
  note text,
  active boolean not null default true,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.payment_templates(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),   -- 定金 / 第1期 / 全款
  amount_sgd numeric(12,2) not null check (amount_sgd >= 0),
  due_after_months int not null default 0 check (due_after_months between 0 and 120),
  sort int not null default 0
);
create index if not exists payment_template_items_tpl_idx on public.payment_template_items (template_id, sort);

create table if not exists public.programme_purchases (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  programme_id uuid references public.programmes(id) on delete set null,
  template_id uuid references public.payment_templates(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null default 'new' check (kind in ('new', 'upgrade', 'other')),
  total_sgd numeric(12,2) not null check (total_sgd >= 0),
  registered_on date not null default (now() at time zone 'Asia/Singapore')::date,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  event_id uuid references public.events(id) on delete set null,      -- sold at this event's counter
  note text,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text
);
create index if not exists programme_purchases_participant_idx on public.programme_purchases (participant_id);
create index if not exists programme_purchases_active_idx on public.programme_purchases (status) where status = 'active';

create table if not exists public.purchase_schedule (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.programme_purchases(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  due_on date,                                  -- null = no fixed date (never "behind")
  amount_sgd numeric(12,2) not null check (amount_sgd >= 0),
  sort int not null default 0
);
create index if not exists purchase_schedule_purchase_idx on public.purchase_schedule (purchase_id, sort);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  purchase_id uuid references public.programme_purchases(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'SGD' check (currency in ('SGD', 'MYR')),
  fx_rate numeric(12,6) check (fx_rate is null or fx_rate > 0),   -- SGD per 1 MYR
  amount_sgd numeric(12,2) not null check (amount_sgd > 0),
  method text not null check (method in
    ('card_pos', 'cash', 'bank_transfer', 'paynow', 'hitpay_online', 'tt', 'other')),
  paid_on date not null default (now() at time zone 'Asia/Singapore')::date,
  reference text,                               -- terminal approval code / receipt no. / bank ref
  counter_batch uuid,                           -- items paid with one swipe share this
  event_id uuid references public.events(id) on delete set null,  -- counter it was taken at
  note text,
  recorded_by uuid references public.admins(id) on delete set null,
  hitpay_request_id text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.admins(id) on delete set null,
  void_reason text,
  constraint payments_one_target check ((purchase_id is null) <> (enrollment_id is null)),
  constraint payments_fx check (
    (currency = 'SGD' and fx_rate is null) or (currency = 'MYR' and fx_rate is not null)
  ),
  constraint payments_void_reason check (voided_at is null or void_reason is not null)
);
create index if not exists payments_participant_idx on public.payments (participant_id);
create index if not exists payments_purchase_idx on public.payments (purchase_id) where purchase_id is not null;
create index if not exists payments_enrollment_idx on public.payments (enrollment_id) where enrollment_id is not null;
create index if not exists payments_event_day_idx on public.payments (event_id, paid_on);
create index if not exists payments_batch_idx on public.payments (counter_batch) where counter_batch is not null;
create unique index if not exists payments_hitpay_unique on public.payments (hitpay_request_id)
  where hitpay_request_id is not null;

-- RLS: Finance + Super Admin only. CS reads go through server routes,
-- scoped to their own customers.
alter table public.payment_templates enable row level security;
alter table public.payment_template_items enable row level security;
alter table public.programme_purchases enable row level security;
alter table public.purchase_schedule enable row level security;
alter table public.payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['payment_templates', 'payment_template_items', 'programme_purchases', 'purchase_schedule', 'payments']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.current_admin_role() in (''super_admin'', ''finance''))
         with check (public.current_admin_role() in (''super_admin'', ''finance''))',
      t || '_finance', t);
  end loop;
end $$;
