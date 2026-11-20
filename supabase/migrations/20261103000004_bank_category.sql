-- Keep the bank's own category label for each transaction (the Sheet's "Category ID"
-- column), so transfers and credit card payments can be recognized automatically.
alter table public.transactions
  add column if not exists bank_category text;
