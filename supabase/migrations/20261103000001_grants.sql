-- Newer Supabase projects don't automatically grant table privileges to the API roles.
-- Signed-in users can query the data tables (row-level security still limits them to
-- allowed emails); the server-side role used by the sync function gets full access.

grant usage on schema public to authenticated, service_role;

grant select on public.sync_runs, public.accounts, public.vendor_map,
                public.transactions, public.targets
  to authenticated;

-- The allow-list stays invisible to the browser.
revoke all on public.allowed_users from authenticated, anon;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
