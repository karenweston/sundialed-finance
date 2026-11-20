-- A mapping can also require an exact amount (for example a recurring transfer of $500).
-- The amount is positive; it matches money in or out of that size.
alter table public.vendor_rules
  add column if not exists amount numeric(12,2) check (amount is null or (amount > 0 and amount < 100000000));

-- The same text and accounts may now appear with different amounts.
alter table public.vendor_rules drop constraint if exists vendor_rules_match_type_pattern_accounts_key;
create unique index if not exists vendor_rules_unique_idx
  on public.vendor_rules (match_type, pattern, accounts, coalesce(amount, 0));
