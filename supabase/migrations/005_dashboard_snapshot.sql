-- AssetLens AI R13 — one RLS-aware dashboard query instead of many REST round trips.
-- Run after 004_mobile_offline_capture.sql.

create or replace function public.assetlens_dashboard_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with totals as (
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
  ),
  recent as (
    select id, asset_no, asset_type, project_name, building_name, status, overall_confidence, created_at
    from public.assets
    order by created_at desc
    limit 6
  )
  select jsonb_build_object(
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
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', asset_count, 'percent', percent) order by asset_count desc, name), '[]'::jsonb) from ranked_projects),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'assetNo', asset_no, 'assetType', asset_type, 'project', project_name,
      'building', building_name, 'status', status, 'confidence', overall_confidence, 'createdAt', created_at
    ) order by created_at desc), '[]'::jsonb) from recent)
  )
  from totals;
$$;

revoke all on function public.assetlens_dashboard_snapshot() from public, anon;
grant execute on function public.assetlens_dashboard_snapshot() to authenticated;
