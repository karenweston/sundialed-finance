-- App-side vendor mappings and month locks.
-- These are the only tables the browser can write to, and only for signed-in users
-- whose email is on allowed_users. Everything else stays read-only.

-- ------------------------------------------------------------- vendor_rules
-- Applied on top of the Sheet's Vendor Mapping tab, and only to transactions the
-- Sheet left uncategorized. 'exact' matches a merchant name; 'contains' matches any
-- merchant name or description containing the text (for example 'amazon').
create table if not exists public.vendor_rules (
  id bigint generated always as identity primary key,
  match_type text not null check (match_type in ('exact', 'contains')),
  pattern text not null,
  category text not null check (char_length(category) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint vendor_rules_pattern_clean check (pattern = btrim(lower(pattern))),
  -- A very short 'contains' pattern would match nearly everything.
  constraint vendor_rules_pattern_length check (
    (match_type = 'exact'    and char_length(pattern) between 2 and 120) or
    (match_type = 'contains' and char_length(pattern) between 3 and 120)
  ),
  unique (match_type, pattern)
);

-- -------------------------------------------------------------- month_locks
-- Locking freezes a finished month: the totals, categories and daily series as they
-- were at that moment are stored here and shown instead of the live numbers.
create table if not exists public.month_locks (
  month date primary key check (extract(day from month) = 1),
  locked_at timestamptz not null default now(),
  locked_by uuid default auth.uid(),
  snapshot jsonb not null check (octet_length(snapshot::text) < 1000000)
);

-- ----------------------------------------------------------------- security
alter table public.vendor_rules enable row level security;
alter table public.month_locks enable row level security;

drop policy if exists "allowed users can read" on public.vendor_rules;
drop policy if exists "allowed users can add" on public.vendor_rules;
drop policy if exists "allowed users can change" on public.vendor_rules;
drop policy if exists "allowed users can remove" on public.vendor_rules;
create policy "allowed users can read"   on public.vendor_rules for select to authenticated using (public.is_allowed());
create policy "allowed users can add"    on public.vendor_rules for insert to authenticated with check (public.is_allowed());
create policy "allowed users can change" on public.vendor_rules for update to authenticated using (public.is_allowed()) with check (public.is_allowed());
create policy "allowed users can remove" on public.vendor_rules for delete to authenticated using (public.is_allowed());

drop policy if exists "allowed users can read" on public.month_locks;
drop policy if exists "allowed users can lock" on public.month_locks;
drop policy if exists "allowed users can unlock" on public.month_locks;
create policy "allowed users can read"   on public.month_locks for select to authenticated using (public.is_allowed());
create policy "allowed users can lock"   on public.month_locks for insert to authenticated with check (public.is_allowed());
create policy "allowed users can unlock" on public.month_locks for delete to authenticated using (public.is_allowed());
-- No update policy on month_locks: a snapshot is never edited, only removed.

revoke all on public.vendor_rules, public.month_locks from anon;
grant select, insert, update, delete on public.vendor_rules to authenticated;
grant select, insert, delete on public.month_locks to authenticated;
grant usage on sequence public.vendor_rules_id_seq to authenticated;
grant all on public.vendor_rules, public.month_locks to service_role;
grant all on sequence public.vendor_rules_id_seq to service_role;
