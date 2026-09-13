-- R18: category defaults must never silently rate an individual asset.
-- Condition and criticality remain mandatory on every capture/manual/import path.
update public.asset_categories
set default_criticality_rating = null,
    updated_at = now()
where default_criticality_rating is not null;

alter table public.asset_categories
  alter column default_criticality_rating drop default,
  drop constraint if exists asset_categories_criticality_check;

alter table public.asset_categories
  add constraint asset_categories_criticality_check
  check (default_criticality_rating is null);

comment on column public.asset_categories.default_criticality_rating is
  'Deprecated. Individual asset criticality must be explicitly captured (1-5).';

notify pgrst, 'reload schema';
