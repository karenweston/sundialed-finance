-- Let a mapping apply only when a transaction was paid with certain accounts, e.g.
-- "amazon" on the Apple Card -> one category, on an Amex card -> another.
-- An empty list means "any account", which is how every existing mapping behaves.

alter table public.vendor_rules
  add column if not exists accounts text[] not null default '{}';

alter table public.vendor_rules
  drop constraint if exists vendor_rules_accounts_limit;
alter table public.vendor_rules
  add constraint vendor_rules_accounts_limit check (cardinality(accounts) <= 20);

-- The same text may now appear in several mappings, one per set of accounts.
-- (Replaces the old uniqueness rule that allowed only one mapping per text.)
alter table public.vendor_rules
  drop constraint if exists vendor_rules_match_type_pattern_key;
alter table public.vendor_rules
  drop constraint if exists vendor_rules_unique;
alter table public.vendor_rules
  add constraint vendor_rules_unique unique (match_type, pattern, accounts);
