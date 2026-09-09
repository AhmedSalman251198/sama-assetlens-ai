-- AssetLens AI R16.1 — five-level asset condition rating.
-- Safe/idempotent upgrade. Run after 009_roles_offices_accounts.sql.

alter table public.assets
  add column if not exists condition_rating smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_condition_rating_check'
  ) then
    alter table public.assets
      add constraint assets_condition_rating_check
      check (condition_rating between 1 and 5);
  end if;
end;
$$;

comment on column public.assets.condition_rating is
  'Asset condition: 1 Critical, 2 Poor/Needs Maintenance, 3 Fair, 4 Good, 5 Excellent.';

create index if not exists assets_condition_rating_idx
  on public.assets(condition_rating)
  where condition_rating is not null;

notify pgrst, 'reload schema';
