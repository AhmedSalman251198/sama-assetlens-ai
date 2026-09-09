-- AssetLens AI R16.2 — asset criticality and weighted issue dashboard.
-- Safe/idempotent upgrade. Run once after 010_asset_condition_rating.sql.

alter table public.assets
  add column if not exists criticality_rating smallint;

-- Existing records predate this feature. Start them at the neutral/important
-- level so every asset participates consistently in filters and calculations.
update public.assets
set criticality_rating = 3
where criticality_rating is null;

alter table public.assets
  alter column criticality_rating set default 3,
  alter column criticality_rating set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_criticality_rating_check'
  ) then
    alter table public.assets
      add constraint assets_criticality_rating_check
      check (criticality_rating between 1 and 5);
  end if;
end;
$$;

comment on column public.assets.criticality_rating is
  'Single criticality input and automatic weight: 1 Very Low, 2 Low, 3 Important, 4 High, 5 Critical.';

create index if not exists assets_criticality_rating_idx
  on public.assets(criticality_rating)
  where criticality_rating is not null;

create or replace function public.assetlens_criticality_snapshot(
  target_project_id uuid default null,
  target_building_id uuid default null,
  target_floor_id uuid default null,
  target_zone_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with levels as (
    select generate_series(1, 5)::int as rating
  ),
  scoped_assets as (
    select
      1 as asset_marker,
      condition_rating,
      criticality_rating::int as criticality_weight
    from public.assets asset
    where (target_project_id is null or asset.project_id = target_project_id)
      and (target_building_id is null or asset.building_id = target_building_id)
      and (target_floor_id is null or asset.floor_id = target_floor_id)
      and (target_zone_id is null or asset.zone_id = target_zone_id)
  ),
  distribution as (
    select
      levels.rating,
      count(scoped_assets.asset_marker)::int as asset_count
    from levels
    left join scoped_assets on scoped_assets.criticality_weight = levels.rating
    group by levels.rating
  ),
  totals as (
    select
      count(*)::int as total_assets,
      count(*) filter (where condition_rating <= 2)::int as problem_assets,
      coalesce(sum(criticality_weight), 0)::int as total_weight,
      coalesce(sum(criticality_weight) filter (where condition_rating <= 2), 0)::int as problem_weight
    from scoped_assets
  )
  select jsonb_build_object(
    'weightedIssuePercent', case when totals.total_weight > 0 then round(totals.problem_weight * 100.0 / totals.total_weight)::int else 0 end,
    'problemWeight', totals.problem_weight,
    'totalWeight', totals.total_weight,
    'problemAssets', totals.problem_assets,
    'totalAssets', totals.total_assets,
    'distribution', (select jsonb_agg(jsonb_build_object(
      'rating', rating,
      'weight', rating,
      'count', asset_count
    ) order by rating desc) from distribution)
  )
  from totals;
$$;

revoke all on function public.assetlens_criticality_snapshot(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.assetlens_criticality_snapshot(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
