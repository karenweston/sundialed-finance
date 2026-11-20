-- Notes for each month: things the household wants to talk about.
-- Anyone on allowed_users can read every note and add their own. You can only remove your own.
-- Notes can't be edited; to change one, remove it and add it again.
create table if not exists public.month_notes (
  id bigint generated always as identity primary key,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}-01$'),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  author_id uuid not null default auth.uid(),
  author_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists month_notes_month_idx on public.month_notes (month, created_at);

alter table public.month_notes enable row level security;
drop policy if exists "allowed users can read" on public.month_notes;
drop policy if exists "allowed users can add own" on public.month_notes;
drop policy if exists "allowed users can remove own" on public.month_notes;
create policy "allowed users can read" on public.month_notes for select to authenticated using (public.is_allowed());
create policy "allowed users can add own" on public.month_notes for insert to authenticated
  with check (public.is_allowed() and author_id = auth.uid());
create policy "allowed users can remove own" on public.month_notes for delete to authenticated
  using (public.is_allowed() and author_id = auth.uid());

revoke all on public.month_notes from anon;
grant select, insert, delete on public.month_notes to authenticated;
grant all on public.month_notes to service_role;
