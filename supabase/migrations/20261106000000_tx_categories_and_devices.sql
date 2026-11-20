-- One-off category changes made in the app for a single transaction.
-- Keyed by the transaction's id, so a change survives re-syncs. The Sheet is untouched.
create table if not exists public.tx_categories (
  tx_id text primary key check (char_length(tx_id) between 1 and 100),
  category text not null check (char_length(category) between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.tx_categories enable row level security;
drop policy if exists "allowed users can read" on public.tx_categories;
drop policy if exists "allowed users can add" on public.tx_categories;
drop policy if exists "allowed users can change" on public.tx_categories;
drop policy if exists "allowed users can remove" on public.tx_categories;
create policy "allowed users can read"   on public.tx_categories for select to authenticated using (public.is_allowed());
create policy "allowed users can add"    on public.tx_categories for insert to authenticated with check (public.is_allowed());
create policy "allowed users can change" on public.tx_categories for update to authenticated using (public.is_allowed()) with check (public.is_allowed());
create policy "allowed users can remove" on public.tx_categories for delete to authenticated using (public.is_allowed());

revoke all on public.tx_categories from anon;
grant select, insert, update, delete on public.tx_categories to authenticated;
grant all on public.tx_categories to service_role;

-- A readable name for each phone that turned notifications on (e.g. "iPhone"),
-- so old installs can be told apart and removed.
alter table public.push_subscriptions add column if not exists label text check (char_length(label) <= 60);
