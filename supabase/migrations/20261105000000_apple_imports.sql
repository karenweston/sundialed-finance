-- Apple Card transactions imported from the CSV in the app.
-- Each row waits here until the sync has added it to the Sheet's AppleCard tab
-- (pushed_at is then set); after that the Sheet is the owner.
-- The id is derived from the row's date, description, amount and repeat number,
-- the same way the sync derives it for rows in the AppleCard tab, so a row is never counted twice.
create table if not exists public.apple_imports (
  id text primary key check (id ~ '^apc-[0-9a-f]{32}$'),
  posted_on date not null check (posted_on between date '2015-01-01' and date '2100-01-01'),
  summary text check (char_length(summary) <= 300),
  merchant text check (char_length(merchant) <= 300),
  amount numeric not null check (abs(amount) < 10000000),
  imported_at timestamptz not null default now(),
  imported_by uuid default auth.uid(),
  pushed_at timestamptz
);

alter table public.apple_imports enable row level security;

drop policy if exists "allowed users can read" on public.apple_imports;
drop policy if exists "allowed users can add" on public.apple_imports;
drop policy if exists "allowed users can undo" on public.apple_imports;
create policy "allowed users can read" on public.apple_imports for select to authenticated using (public.is_allowed());
create policy "allowed users can add" on public.apple_imports for insert to authenticated with check (public.is_allowed() and pushed_at is null);
-- A mistaken import can be taken back until the sync has copied it to the Sheet.
create policy "allowed users can undo" on public.apple_imports for delete to authenticated using (public.is_allowed() and pushed_at is null);

revoke all on public.apple_imports from anon, authenticated;
grant select on public.apple_imports to authenticated;
-- The browser can set only these columns; pushed_at is set by the sync alone.
grant insert (id, posted_on, summary, merchant, amount) on public.apple_imports to authenticated;
grant delete on public.apple_imports to authenticated;
grant all on public.apple_imports to service_role;
