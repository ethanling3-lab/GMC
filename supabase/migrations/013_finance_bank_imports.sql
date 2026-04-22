-- M4 Finance — bank CSV import + reconciliation.
--
-- Two new tables:
--
--   bank_imports        — one row per uploaded CSV file (provenance + stats)
--   bank_transactions   — one row per CSV line, tracked through its match
--                         lifecycle (unmatched → suggested → matched → confirmed)
--
-- Plus two new columns on `enrollments` so refunds and partial payments have
-- a home without overloading `amount_paid`. `amount_paid` stays the net
-- positive inflow; `refund_amount` is the running outflow; the UI derives
-- the outstanding balance against event.price.
--
-- RLS: both tables are admin-only. `super_admin` + `finance` get full CRUD;
-- every other role is invisible. Follows the same pattern the enrollments
-- policies use (see migration 001).
--
-- All statements are idempotent so re-runs are safe in dev.

-- =============================================================================
-- Enrolment refund + partial payment columns
-- =============================================================================

alter table enrollments
  add column if not exists refund_amount numeric(10,2) not null default 0,
  add column if not exists refunded_at timestamptz,
  add column if not exists bank_transaction_id uuid;

create index if not exists enrollments_bank_txn_idx on enrollments (bank_transaction_id);

-- =============================================================================
-- bank_txn_status enum
-- =============================================================================

do $$ begin
  create type bank_txn_status as enum (
    'unmatched',
    'suggested',
    'auto_matched',
    'manual_matched',
    'confirmed',
    'ignored'
  );
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- bank_imports — provenance for each CSV upload
-- =============================================================================

create table if not exists bank_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references admins(id) on delete set null,
  filename text not null,
  row_count int not null default 0,
  auto_matched_count int not null default 0,
  suggested_count int not null default 0,
  unmatched_count int not null default 0,
  confirmed_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bank_imports_set_updated_at on bank_imports;
create trigger bank_imports_set_updated_at
  before update on bank_imports
  for each row execute function set_updated_at();

create index if not exists bank_imports_uploaded_by_idx on bank_imports (uploaded_by);
create index if not exists bank_imports_created_idx on bank_imports (created_at desc);

-- =============================================================================
-- bank_transactions — one row per CSV line
-- =============================================================================

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references bank_imports(id) on delete cascade,

  -- Parsed from CSV
  txn_date date not null,
  amount numeric(12,2) not null,
  currency text,
  raw_name text,
  raw_reference text,
  raw_row jsonb not null default '{}'::jsonb,

  -- Match state
  status bank_txn_status not null default 'unmatched',
  matched_enrollment_id uuid references enrollments(id) on delete set null,
  match_confidence numeric(5,4),
  match_basis text,                                -- e.g. 'provider_id' | 'name_amount_date'
  matched_by uuid references admins(id) on delete set null,
  matched_at timestamptz,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bank_transactions_set_updated_at on bank_transactions;
create trigger bank_transactions_set_updated_at
  before update on bank_transactions
  for each row execute function set_updated_at();

create index if not exists bank_transactions_import_idx on bank_transactions (import_id);
create index if not exists bank_transactions_status_idx on bank_transactions (status);
create index if not exists bank_transactions_match_idx on bank_transactions (matched_enrollment_id);
create index if not exists bank_transactions_txn_date_idx on bank_transactions (txn_date);

-- Back-fill enrollment.bank_transaction_id FK now that the table exists.
-- Use NOT VALID + VALIDATE so existing rows don't need to satisfy it (all
-- existing bank_transaction_id values will be NULL).
do $$ begin
  alter table enrollments
    add constraint enrollments_bank_transaction_id_fkey
    foreign key (bank_transaction_id) references bank_transactions(id)
    on delete set null
    not valid;
  alter table enrollments validate constraint enrollments_bank_transaction_id_fkey;
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table bank_imports enable row level security;
alter table bank_transactions enable row level security;

drop policy if exists "finance + super view bank imports" on bank_imports;
create policy "finance + super view bank imports"
  on bank_imports for select
  to authenticated
  using (is_super_admin() or current_admin_role() = 'finance');

drop policy if exists "finance + super manage bank imports" on bank_imports;
create policy "finance + super manage bank imports"
  on bank_imports for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'finance')
  with check (is_super_admin() or current_admin_role() = 'finance');

drop policy if exists "finance + super view bank transactions" on bank_transactions;
create policy "finance + super view bank transactions"
  on bank_transactions for select
  to authenticated
  using (is_super_admin() or current_admin_role() = 'finance');

drop policy if exists "finance + super manage bank transactions" on bank_transactions;
create policy "finance + super manage bank transactions"
  on bank_transactions for all
  to authenticated
  using (is_super_admin() or current_admin_role() = 'finance')
  with check (is_super_admin() or current_admin_role() = 'finance');
