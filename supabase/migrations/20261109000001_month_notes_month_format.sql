-- The app identifies a month by its first day ("2026-11-01"), so notes use the same form.
alter table public.month_notes drop constraint if exists month_notes_month_check;
alter table public.month_notes add constraint month_notes_month_check check (month ~ '^[0-9]{4}-[0-9]{2}-01$');
