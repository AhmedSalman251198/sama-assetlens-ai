-- AssetLens AI R18 database update
-- Prerequisite: migrations 001/setup through 013 have already been applied.
-- Safe to run again: current category defaults are cleared and the constraint
-- is recreated so every asset must be rated independently.

begin;

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

commit;

notify pgrst, 'reload schema';

-- Verification: both values must return zero.
select
  count(*) filter (where default_criticality_rating is not null) as categories_with_forbidden_default,
  count(*) filter (where active and (label_ar = '' or label_en = '')) as active_categories_missing_a_label
from public.asset_categories;
