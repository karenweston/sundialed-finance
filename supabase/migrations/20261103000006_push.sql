-- Phone notifications (web push).
-- push_subscriptions: one row per phone that turned notifications on. A person can add or
-- remove only their own. The sync function (service role) reads them to send alerts.
create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 20 and 2000),
  p256dh text not null check (char_length(p256dh) between 10 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  user_id uuid not null default auth.uid(),
  email text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions read" on public.push_subscriptions;
drop policy if exists "own subscriptions add" on public.push_subscriptions;
drop policy if exists "own subscriptions remove" on public.push_subscriptions;
create policy "own subscriptions read"   on public.push_subscriptions for select to authenticated using (public.is_allowed() and user_id = auth.uid());
create policy "own subscriptions add"    on public.push_subscriptions for insert to authenticated with check (public.is_allowed() and user_id = auth.uid());
create policy "own subscriptions remove" on public.push_subscriptions for delete to authenticated using (public.is_allowed() and user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- alerts_sent: remembers which alerts already went out so none repeats.
-- No policies and no grants for the browser: only the sync function touches it.
create table if not exists public.alerts_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table public.alerts_sent enable row level security;
revoke all on public.alerts_sent from anon, authenticated;
grant all on public.alerts_sent to service_role;
