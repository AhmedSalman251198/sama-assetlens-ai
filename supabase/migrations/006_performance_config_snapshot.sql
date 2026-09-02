-- AssetLens AI R14 — configuration snapshot and high-traffic indexes.
-- Run once after 005_dashboard_snapshot.sql in Supabase Dashboard > SQL Editor.

-- Include the current profile in the same RLS-aware dashboard call, removing
-- two extra authentication/profile round trips from every dashboard visit.
create or replace function public.assetlens_dashboard_snapshot()
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
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where status = 'completed')::int as approved,
      count(*) filter (where status = 'review')::int as review,
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'processing')::int as processing,
      count(*) filter (where status = 'failed')::int as failed
    from public.assets
  ),
  project_counts as (
    select project.id, project.name, count(asset.id)::int as asset_count
    from public.projects project
    left join public.assets asset on asset.project_id = project.id
    where project.active = true
    group by project.id, project.name
  ),
  ranked_projects as (
    select id, name, asset_count,
      case when max(asset_count) over () > 0 then round(asset_count * 100.0 / max(asset_count) over ())::int else 0 end as percent
    from project_counts
    order by asset_count desc, name
    limit 12
  ),
  days as (
    select generate_series(current_date - interval '6 days', current_date, interval '1 day')::date as day
  ),
  activity as (
    select day, count(asset.id)::int as asset_count
    from days
    left join public.assets asset on asset.created_at >= day and asset.created_at < day + interval '1 day'
    group by day
    order by day
  )
  select jsonb_build_object(
    'currentUser', coalesce((select jsonb_build_object(
      'name', case when name <> '' then name else split_part(email, '@', 1) end,
      'email', email,
      'role', role
    ) from current_profile), 'null'::jsonb),
    'metrics', jsonb_build_object(
      'totalAssets', totals.total,
      'approvedAssets', totals.approved,
      'reviewAssets', totals.review,
      'activeQueue', totals.queued + totals.processing,
      'failedAssets', totals.failed,
      'projects', (select count(*)::int from public.projects where active = true),
      'buildings', (select count(*)::int from public.buildings where active = true),
      'floors', (select count(*)::int from public.floors),
      'zones', (select count(*)::int from public.zones)
    ),
    'status', jsonb_build_object(
      'approved', totals.approved,
      'review', totals.review,
      'queued', totals.queued,
      'processing', totals.processing,
      'failed', totals.failed
    ),
    'health', jsonb_build_object(
      'qualityScore', case when totals.total > 0 then round(totals.approved * 100.0 / totals.total)::int else 100 end,
      'completionRate', case when totals.total > 0 then round((totals.approved + totals.review) * 100.0 / totals.total)::int else 0 end
    ),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('date', day::text, 'count', asset_count) order by day), '[]'::jsonb) from activity),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', asset_count, 'percent', percent) order by asset_count desc, name), '[]'::jsonb) from ranked_projects)
  )
  from totals;
$$;

revoke all on function public.assetlens_dashboard_snapshot() from public, anon;
grant execute on function public.assetlens_dashboard_snapshot() to authenticated;

-- Lightweight profile lookup used by the persistent application shell.
create or replace function public.assetlens_current_actor()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'email', profile.email,
      'name', case when profile.name <> '' then profile.name else split_part(profile.email, '@', 1) end,
      'role', profile.role,
      'active', profile.active
    )
    from public.app_users profile
    where profile.user_id = auth.uid() and profile.active = true
    limit 1
  ), 'null'::jsonb);
$$;

revoke all on function public.assetlens_current_actor() from public, anon;
grant execute on function public.assetlens_current_actor() to authenticated;

create or replace function public.assetlens_config_snapshot(
  include_forms boolean default false,
  include_admin boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'actor', coalesce((
      select jsonb_build_object(
        'id', profile.id,
        'user_id', profile.user_id,
        'email', profile.email,
        'name', profile.name,
        'role', profile.role,
        'active', profile.active
      )
      from public.app_users profile
      where profile.user_id = auth.uid() and profile.active = true
      limit 1
    ), 'null'::jsonb),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(project_row) order by project_row.name)
      from (
        select id, name, require_building, require_floor, require_zone, allow_manual
        from public.projects
        where active = true
      ) project_row
    ), '[]'::jsonb),
    'buildings', coalesce((
      select jsonb_agg(to_jsonb(building_row) order by building_row.name)
      from (
        select id, project_id, name
        from public.buildings
        where active = true
      ) building_row
    ), '[]'::jsonb),
    'floors', coalesce((
      select jsonb_agg(to_jsonb(floor_row) order by floor_row.sort_order, floor_row.name)
      from (
        select id, building_id, name, sort_order
        from public.floors
      ) floor_row
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(to_jsonb(zone_row) order by zone_row.name)
      from (
        select id, building_id, floor_id, name
        from public.zones
      ) zone_row
    ), '[]'::jsonb),
    'configs', case when include_forms then coalesce((
      select jsonb_agg(to_jsonb(config_row) order by config_row.version desc)
      from (
        select id, project_id, version, status, created_at, published_at
        from public.survey_config_versions
      ) config_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'fields', case when include_forms then coalesce((
      select jsonb_agg(to_jsonb(field_row) order by field_row.sort_order, field_row.field_key)
      from (
        select id, config_id, field_key, label_ar, label_en, section, field_type,
          enabled, required, option_values, sort_order, help_text_ar, help_text_en
        from public.custom_fields
      ) field_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'users', case when include_admin and private.is_app_admin() then coalesce((
      select jsonb_agg(to_jsonb(user_row) order by user_row.role, user_row.name, user_row.email)
      from (
        select id, user_id, email, name, role, active
        from public.app_users
      ) user_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'assignments', case when include_admin and private.is_app_admin() then coalesce((
      select jsonb_agg(to_jsonb(assignment_row))
      from (
        select app_user_id, project_id
        from public.user_projects
      ) assignment_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'auditLogs', case when include_admin and private.is_app_admin() then coalesce((
      select jsonb_agg(to_jsonb(audit_row) order by audit_row.created_at desc)
      from (
        select id, actor_email, action, entity_type, entity_id, project_id, details, created_at
        from public.audit_logs
        order by created_at desc
        limit 100
      ) audit_row
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

revoke all on function public.assetlens_config_snapshot(boolean, boolean) from public, anon;
grant execute on function public.assetlens_config_snapshot(boolean, boolean) to authenticated;

-- Complements the existing indexes for dashboard ordering, report joins and queue polling.
create index if not exists assets_project_created_desc_idx
  on public.assets(project_id, created_at desc);
create index if not exists assets_created_desc_idx
  on public.assets(created_at desc);
create index if not exists asset_custom_values_asset_idx
  on public.asset_custom_values(asset_id);
create index if not exists analysis_jobs_asset_created_idx
  on public.analysis_jobs(asset_id, created_at desc);

notify pgrst, 'reload schema';
