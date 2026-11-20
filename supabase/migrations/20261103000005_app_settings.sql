-- Settings shared by everyone on allowed_users (for example, which months are hidden).
-- Browser writes are limited to allowed users, like vendor_rules and month_locks.
create table if not exists public.app_settings (
  key text primary key check (char_length(key) between 1 and 60),
  value jsonb not null check (octet_length(value::text) < 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.app_settings enable row level security;

drop policy if exists "allowed users can read" on public.app_settings;
drop policy if exists "allowed users can add" on public.app_settings;
drop policy if exists "allowed users can change" on public.app_settings;
create policy "allowed users can read"   on public.app_settings for select to authenticated using (public.is_allowed());
create policy "allowed users can add"    on public.app_settings for insert to authenticated with check (public.is_allowed());
create policy "allowed users can change" on public.app_settings for update to authenticated using (public.is_allowed()) with check (public.is_allowed());

revoke all on public.app_settings from anon;
grant select, insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
