-- Per-person settings (pins, Budget order) are stored under a key ending in ":<user id>".
-- Anyone allowed can still read every setting, but can only write their own per-person keys.
drop policy if exists "allowed users can add" on public.app_settings;
drop policy if exists "allowed users can change" on public.app_settings;
create policy "allowed users can add" on public.app_settings for insert to authenticated
  with check (public.is_allowed() and (position(':' in key) = 0 or right(key, 36) = auth.uid()::text));
create policy "allowed users can change" on public.app_settings for update to authenticated
  using (public.is_allowed() and (position(':' in key) = 0 or right(key, 36) = auth.uid()::text))
  with check (public.is_allowed() and (position(':' in key) = 0 or right(key, 36) = auth.uid()::text));
