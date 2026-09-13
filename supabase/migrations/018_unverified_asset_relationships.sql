-- AssetLens AI R22 — preserve preliminary parent/child links without
-- inventing an engineering relationship type or interruption severity.

alter table public.asset_dependencies
  drop constraint if exists asset_dependencies_type_check,
  drop constraint if exists asset_dependencies_impact_check;

alter table public.asset_dependencies
  add constraint asset_dependencies_type_check
    check (dependency_type in ('unverified','supplies','controls','protects','serves','feeds','depends_on','other')),
  add constraint asset_dependencies_impact_check
    check (impact in ('unassessed','low','medium','high','critical'));

comment on column public.asset_dependencies.dependency_type is
  'unverified is a preliminary structural link awaiting engineering classification.';
comment on column public.asset_dependencies.impact is
  'unassessed means no engineering interruption severity has been assigned.';

notify pgrst, 'reload schema';
