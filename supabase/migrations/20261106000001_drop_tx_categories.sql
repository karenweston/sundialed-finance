-- Single-transaction category changes were removed: the Sheet stays the only place categories are decided.
drop table if exists public.tx_categories;
