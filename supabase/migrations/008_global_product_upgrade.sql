-- AssetLens AI R15 — dynamic asset fields and filtered dashboard.
-- Safe, idempotent upgrade. Run once after 007_super_admin_account_control.sql.

alter table public.custom_fields
  add column if not exists asset_types text[] not null default '{}',
  add column if not exists unit text not null default '',
  add column if not exists ai_extract boolean not null default false,
  add column if not exists show_in_reports boolean not null default true,
  add column if not exists show_in_qr boolean not null default true;

comment on column public.custom_fields.asset_types is
  'Empty means every asset type; otherwise the field appears only for the listed normalized asset types.';

-- Clone every field capability when an administrator creates a new draft.
create or replace function public.create_survey_config_draft(target_project_id uuid)
returns setof public.survey_config_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.survey_config_versions;
  published public.survey_config_versions;
  next_version integer;
begin
  if not private.is_app_admin() then
    raise exception 'Administrator permission is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_project_id::text, 1));
  select * into draft from public.survey_config_versions
  where project_id = target_project_id and status = 'draft'
  limit 1;
  if draft.id is not null then return next draft; return; end if;

  select * into published from public.survey_config_versions
  where project_id = target_project_id and status = 'published'
  order by version desc limit 1;
  select coalesce(max(version), 0) + 1 into next_version
  from public.survey_config_versions where project_id = target_project_id;

  insert into public.survey_config_versions (project_id, version, status, created_by)
  values (target_project_id, next_version, 'draft', auth.uid())
  returning * into draft;

  if published.id is not null then
    insert into public.custom_fields (
      config_id, field_key, label_ar, label_en, section, field_type, enabled,
      required, option_values, depends_on_field_key, sort_order, help_text_ar,
      help_text_en, asset_types, unit, ai_extract, show_in_reports, show_in_qr
    )
    select draft.id, field_key, label_ar, label_en, section, field_type, enabled,
      required, option_values, depends_on_field_key, sort_order, help_text_ar,
      help_text_en, asset_types, unit, ai_extract, show_in_reports, show_in_qr
    from public.custom_fields where config_id = published.id;
  end if;

  return next draft;
end;
$$;

-- One RLS-aware aggregate used whenever the dashboard has active filters.
create or replace function public.assetlens_dashboard_filtered(
  target_project_id uuid default null,
  target_building_id uuid default null,
  target_floor_id uuid default null,
  target_zone_id uuid default null,
  date_from date default null,
  date_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with current_profile as (
    select id, email, name, role
    from public.app_users
    where user_id = auth.uid() and active = true
    limit 1
  ),
  filtered_assets as (
    select asset.*
    from public.assets asset
    where (target_project_id is null or asset.project_id = target_project_id)
      and (target_building_id is null or asset.building_id = target_building_id)
      and (target_floor_id is null or asset.floor_id = target_floor_id)
      and (target_zone_id is null or asset.zone_id = target_zone_id)
      and (date_from is null or asset.created_at >= date_from::timestamptz)
      and (date_to is null or asset.created_at < (date_to + 1)::timestamptz)
  ),
  totals as (
    select
      count(*)::int total,
      count(*) filter (where status = 'completed')::int approved,
      count(*) filter (where status = 'review')::int review,
      count(*) filter (where status = 'queued')::int queued,
      count(*) filter (where status = 'processing')::int processing,
      count(*) filter (where status = 'failed')::int failed
    from filtered_assets
  ),
  project_counts as (
    select project.id, project.name, count(asset.id)::int asset_count
    from public.projects project
    left join filtered_assets asset on asset.project_id = project.id
    where project.active = true
      and (target_project_id is null or project.id = target_project_id)
    group by project.id, project.name
  ),
  project_stats as (
    select
      id,
      name,
      asset_count,
      max(asset_count) over () as max_asset_count
    from project_counts
  ),
  days as (
    select series.generated_at::date as activity_date
    from generate_series(
      coalesce(date_from, current_date - 6)::timestamp,
      coalesce(date_to, current_date)::timestamp,
      interval '1 day'
    ) as series(generated_at)
  ),
  activity as (
    select days.activity_date, count(asset.id)::int as asset_count
    from days
    left join filtered_assets asset
      on asset.created_at >= days.activity_date::timestamptz
     and asset.created_at < (days.activity_date + 1)::timestamptz
    group by days.activity_date
    order by days.activity_date
  )
  select jsonb_build_object(
    'currentUser', coalesce((select jsonb_build_object(
      'name', case when name <> '' then name else split_part(email, '@', 1) end,
      'email', email, 'role', role
    ) from current_profile), 'null'::jsonb),
    'metrics', jsonb_build_object(
      'totalAssets', totals.total, 'approvedAssets', totals.approved,
      'reviewAssets', totals.review, 'activeQueue', totals.queued + totals.processing,
      'failedAssets', totals.failed,
      'projects', (select count(*)::int from public.projects where active = true and (target_project_id is null or id = target_project_id)),
      'buildings', (select count(*)::int from public.buildings where active = true and (target_project_id is null or project_id = target_project_id) and (target_building_id is null or id = target_building_id)),
      'floors', (select count(*)::int from public.floors floor
        join public.buildings building on building.id = floor.building_id
        where (target_project_id is null or building.project_id = target_project_id)
          and (target_building_id is null or floor.building_id = target_building_id)
          and (target_floor_id is null or floor.id = target_floor_id)),
      'zones', (select count(*)::int from public.zones zone
        join public.buildings building on building.id = zone.building_id
        where (target_project_id is null or building.project_id = target_project_id)
          and (target_building_id is null or zone.building_id = target_building_id)
          and (target_floor_id is null or zone.floor_id = target_floor_id or zone.floor_id is null)
          and (target_zone_id is null or zone.id = target_zone_id))
    ),
    'status', jsonb_build_object('approved', totals.approved, 'review', totals.review, 'queued', totals.queued, 'processing', totals.processing, 'failed', totals.failed),
    'health', jsonb_build_object(
      'qualityScore', case when totals.total > 0 then round(totals.approved * 100.0 / totals.total)::int else 100 end,
      'completionRate', case when totals.total > 0 then round((totals.approved + totals.review) * 100.0 / totals.total)::int else 0 end
    ),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('date', activity_date::text, 'count', asset_count) order by activity_date), '[]'::jsonb) from activity),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'count', asset_count,
      'percent', case when max_asset_count > 0 then round(asset_count * 100.0 / max_asset_count)::int else 0 end
    ) order by asset_count desc, name), '[]'::jsonb) from project_stats)
  ) from totals;
$$;

revoke all on function public.assetlens_dashboard_filtered(uuid, uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.assetlens_dashboard_filtered(uuid, uuid, uuid, uuid, date, date) to authenticated;

create index if not exists assets_dashboard_filter_idx
  on public.assets(project_id, building_id, floor_id, zone_id, created_at desc);

notify pgrst, 'reload schema';
