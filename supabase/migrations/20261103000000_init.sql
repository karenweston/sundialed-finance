-- Sundialed: initial schema.
-- Security model: every table has row-level security on. Signed-in users can
-- READ only if their verified email is in allowed_users. Nobody can write from
-- the browser; the sync function writes with the service-role key.

-- ---------------------------------------------------------------- allow-list
create table public.allowed_users (
  email text primary key,
  added_at timestamptz not null default now(),
  constraint allowed_users_email_lowercase check (email = lower(email))
);
alter table public.allowed_users enable row level security;
-- Deliberately no policies: the browser can never read or change this table.

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed() from public;
grant execute on function public.is_allowed() to anon, authenticated;

-- Defense in depth: refuse to create an auth account for any email that is not
-- on the allow-list, even if sign-ups are accidentally enabled in the dashboard.
create or replace function public.block_unlisted_signups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_users where email = lower(coalesce(new.email, ''))
  ) then
    raise exception 'Sign-ups are closed';
  end if;
  return new;
end;
$$;
revoke all on function public.block_unlisted_signups() from public;

create trigger block_unlisted_signups
  before insert on auth.users
  for each row execute function public.block_unlisted_signups();

-- ---------------------------------------------------------------- sync runs
create table public.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  counts jsonb,
  error text
);

-- ------------------------------------------------------------------ accounts
create table public.accounts (
  id text primary key,
  name text not null,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  credit_limit numeric,
  interest_rate numeric,
  last_payment_amount numeric,
  last_payment_date date,
  next_payment_due date,
  last_statement_balance numeric,
  minimum_payment numeric,
  last_seen_run bigint not null
);

-- -------------------------------------------------------------- vendor_map
create table public.vendor_map (
  merchant_name text primary key,
  clean_name text,
  category text,
  memo text,
  last_seen_run bigint not null
);

-- ------------------------------------------------------------- transactions
-- Convention: amount is negative for money going out, positive for money in.
create table public.transactions (
  id text primary key,
  source text not null check (source in ('transactions', 'applecard')),
  account text,
  posted_on date not null,
  month date not null,
  summary text,
  merchant text,
  clean_merchant text,
  category text not null default 'Uncategorized',
  amount numeric not null,
  is_pending boolean not null default false,
  last_seen_run bigint not null
);
create index transactions_month_idx on public.transactions (month);
create index transactions_category_idx on public.transactions (category);

-- ------------------------------------------------------------------ targets
-- A target applies from effective_month until a later row for the same category.
create table public.targets (
  category text not null,
  effective_month date not null,
  amount numeric not null,
  last_seen_run bigint not null,
  primary key (category, effective_month)
);

-- ------------------------------------------------------- row-level security
do $$
declare t text;
begin
  foreach t in array array['sync_runs','accounts','vendor_map','transactions','targets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "allowed users can read" on public.%I for select to authenticated using (public.is_allowed())',
      t
    );
  end loop;
end $$;

-- No insert/update/delete policies exist, so the browser cannot write.
-- Belt and braces: remove table privileges from the anonymous role entirely.
revoke all on all tables in schema public from anon;
