-- AssetLens AI R22.2.1 — restricted-role performance, strict project scope,
-- filtered counts and collision-resistant generated asset numbers.
-- Apply after migration 020. Safe to run more than once.

begin;

do $$
begin
  if to_regclass('public.assets') is null
     or to_regclass('public.app_users') is null
     or to_regclass('public.user_projects') is null then
    raise exception 'AssetLens base schema is incomplete. Apply migrations 001 through 020 first.';
  end if;
end $$;

-- Resolve the signed-in account and its projects once inside aggregate RPCs.
-- These functions are SECURITY DEFINER only to avoid running the same RLS
-- permission join once for every asset row. They explicitly apply auth.uid()
-- and active project assignments and never grant a wider project scope.
create or replace function private.assetlens_allowed_projects()
returns table(project_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select id
    from public.app_users
    where user_id = auth.uid() and active = true
    limit 1
  )
  select project.id
  from public.projects project
  cross join actor
  where project.active = true
    and (
      private.is_assetlens_super_admin()
      or exists (
        select 1
        from public.user_projects assignment
        where assignment.app_user_id = actor.id
          and assignment.project_id = project.id
      )
    )
$$;

create or replace function private.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.assetlens_allowed_projects() allowed
    where allowed.project_id = target_project_id
  )
$$;

-- Ownership must never outlive project assignment. If a surveyor or manager
-- is removed from a project, records they created there must disappear from
-- their scope immediately.
drop policy if exists "project assets are visible" on public.assets;
create policy "project assets are visible"
on public.assets for select to authenticated
using (private.can_access_project(project_id));

-- Fast exact total for the paginated Asset Management register.
create or replace function public.assetlens_asset_list_count(
  filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_projects as materialized (
    select project_id from private.assetlens_allowed_projects()
  ),
  scoped as (
    select asset.id
    from public.assets asset
    join allowed_projects allowed on allowed.project_id = asset.project_id
    where asset.archived_at is null
      and (nullif(filters->>'project', '') is null or asset.project_id::text = filters->>'project')
      and (nullif(filters->>'building', '') is null or asset.building_id::text = filters->>'building')
      and (nullif(filters->>'floor', '') is null or asset.floor_id::text = filters->>'floor')
      and (nullif(filters->>'zone', '') is null or asset.zone_id::text = filters->>'zone')
      and (nullif(filters->>'asset', '') is null or asset.id::text = filters->>'asset')
      and (nullif(filters->>'category', '') is null or asset.category_id::text = filters->>'category')
      and (nullif(filters->>'operationalStatus', '') is null or asset.operational_status = filters->>'operationalStatus')
      and (nullif(filters->>'condition', '') is null or asset.condition_rating::text = filters->>'condition')
      and (nullif(filters->>'criticality', '') is null or asset.criticality_rating::text = filters->>'criticality')
      and (
        nullif(filters->>'status', '') is null
        or asset.status = filters->>'status'
      )
      and (
        nullif(filters->>'workflow', '') is null
        or filters->>'workflow' <> 'active'
        or asset.status in ('queued', 'processing')
      )
      and (
        nullif(filters->>'search', '') is null
        or asset.asset_no ilike concat('%', filters->>'search', '%')
        or asset.asset_type ilike concat('%', filters->>'search', '%')
        or asset.project_name ilike concat('%', filters->>'search', '%')
        or asset.building_name ilike concat('%', filters->>'search', '%')
        or asset.floor_name ilike concat('%', filters->>'search', '%')
        or asset.zone_name ilike concat('%', filters->>'search', '%')
        or asset.office_name ilike concat('%', filters->>'search', '%')
        or asset.surveyor_email ilike concat('%', filters->>'search', '%')
      )
  )
  select jsonb_build_object('count', count(*)::bigint) from scoped
$$;

-- One scoped scan supplies all report summary cards. Status cards deliberately
-- share the same project/location/type/date/quality/search filters.
create or replace function public.assetlens_report_counts(
  filters jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with allowed_projects as materialized (
    select project_id from private.assetlens_allowed_projects()
  ),
  scoped as (
    select asset.status
    from public.assets asset
    join allowed_projects allowed on allowed.project_id = asset.project_id
    where asset.archived_at is null
      and (nullif(filters->>'project', '') is null or asset.project_id::text = filters->>'project')
      and (nullif(filters->>'building', '') is null or asset.building_name = filters->>'building')
      and (nullif(filters->>'assetType', '') is null or asset.asset_type = filters->>'assetType')
      and (nullif(filters->>'category', '') is null or asset.category_id::text = filters->>'category')
      and (nullif(filters->>'operationalStatus', '') is null or asset.operational_status = filters->>'operationalStatus')
      and (nullif(filters->>'surveyor', '') is null or asset.surveyor_email = filters->>'surveyor')
      and (nullif(filters->>'condition', '') is null or asset.condition_rating::text = filters->>'condition')
      and (nullif(filters->>'criticality', '') is null or asset.criticality_rating::text = filters->>'criticality')
      and (nullif(filters->>'dateFrom', '') is null or asset.created_at >= (filters->>'dateFrom')::date::timestamptz)
      and (nullif(filters->>'dateTo', '') is null or asset.created_at < ((filters->>'dateTo')::date + 1)::timestamptz)
      and (coalesce(filters->>'quality', '') <> 'low' or asset.overall_confidence < 0.75)
      and (
        nullif(filters->>'search', '') is null
        or asset.asset_no ilike concat('%', filters->>'search', '%')
        or asset.asset_type ilike concat('%', filters->>'search', '%')
        or asset.project_name ilike concat('%', filters->>'search', '%')
        or asset.building_name ilike concat('%', filters->>'search', '%')
        or asset.floor_name ilike concat('%', filters->>'search', '%')
        or asset.zone_name ilike concat('%', filters->>'search', '%')
        or asset.office_name ilike concat('%', filters->>'search', '%')
        or asset.surveyor_email ilike concat('%', filters->>'search', '%')
        or asset.summary ilike concat('%', filters->>'search', '%')
        or asset.raw_text ilike concat('%', filters->>'search', '%')
      )
  )
  select jsonb_build_object(
    'total', count(*)::bigint,
    'completed', count(*) filter (where status = 'completed')::bigint,
    'review', count(*) filter (where status = 'review')::bigint,
    'active', count(*) filter (where status in ('queued', 'processing'))::bigint,
    'failed', count(*) filter (where status = 'failed')::bigint
  )
  from scoped
$$;

-- Configuration/structure snapshot without per-row RLS permission lookups.
create or replace function public.assetlens_config_snapshot(
  include_forms boolean default false,
  include_admin boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as materialized (
    select id, user_id, email, name, role, active
    from public.app_users
    where user_id = auth.uid() and active = true
    limit 1
  ),
  allowed_projects as materialized (
    select project_id from private.assetlens_allowed_projects()
  ),
  allowed_buildings as materialized (
    select building.id
    from public.buildings building
    join allowed_projects allowed on allowed.project_id = building.project_id
  ),
  allowed_configs as materialized (
    select config.id
    from public.survey_config_versions config
    join allowed_projects allowed on allowed.project_id = config.project_id
  )
  select jsonb_build_object(
    'actor', coalesce((select to_jsonb(actor) from actor), 'null'::jsonb),
    'projects', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select project.id, project.name, project.require_building, project.require_floor,
        project.require_zone, project.require_office, project.allow_manual,
        project.client_logo_storage_path, project.client_logo_mime_type
      from public.projects project
      join allowed_projects allowed on allowed.project_id = project.id
      where project.active = true
    ) row_data), '[]'::jsonb),
    'buildings', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select building.id, building.project_id, building.name
      from public.buildings building
      join allowed_projects allowed on allowed.project_id = building.project_id
      where building.active = true
    ) row_data), '[]'::jsonb),
    'floors', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.name) from (
      select floor.id, floor.building_id, floor.name, floor.sort_order
      from public.floors floor
      join allowed_buildings allowed on allowed.id = floor.building_id
    ) row_data), '[]'::jsonb),
    'zones', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select zone.id, zone.building_id, zone.floor_id, zone.name
      from public.zones zone
      join allowed_buildings allowed on allowed.id = zone.building_id
    ) row_data), '[]'::jsonb),
    'offices', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select office.id, office.building_id, office.floor_id, office.zone_id, office.name
      from public.offices office
      join allowed_buildings allowed on allowed.id = office.building_id
      where office.active = true
    ) row_data), '[]'::jsonb),
    'locationLevels', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.label_ar) from (
      select level.id, level.project_id, level.parent_level_id, level.level_key,
        level.label_ar, level.label_en, level.required, level.sort_order
      from public.location_levels level
      join allowed_projects allowed on allowed.project_id = level.project_id
      where level.active = true
    ) row_data), '[]'::jsonb),
    'locationOptions', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.name) from (
      select option.id, option.level_id, option.building_id, option.floor_id,
        option.zone_id, option.office_id, option.parent_option_id, option.name
      from public.location_options option
      join public.location_levels level on level.id = option.level_id
      join allowed_projects allowed on allowed.project_id = level.project_id
      where option.active = true and level.active = true
    ) row_data), '[]'::jsonb),
    'configs', case when include_forms then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.version desc) from (
      select config.id, config.project_id, config.version, config.status,
        config.created_at, config.published_at
      from public.survey_config_versions config
      join allowed_projects allowed on allowed.project_id = config.project_id
    ) row_data), '[]'::jsonb) else '[]'::jsonb end,
    'fields', case when include_forms then coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order, row_data.field_key) from (
      select field.id, field.config_id, field.field_key, field.label_ar, field.label_en,
        field.section, field.field_type, field.enabled, field.required,
        field.option_values, field.sort_order, field.help_text_ar, field.help_text_en,
        field.asset_types, field.unit, field.ai_extract, field.show_in_reports,
        field.show_in_qr
      from public.custom_fields field
      join allowed_configs allowed on allowed.id = field.config_id
    ) row_data), '[]'::jsonb) else '[]'::jsonb end,
    -- Account administration remains a separate super-admin-only hydration.
    'users', '[]'::jsonb,
    'assignments', '[]'::jsonb,
    'modulePermissions', '[]'::jsonb,
    'auditLogs', '[]'::jsonb
  )
$$;

-- Shared dashboard implementation. It bypasses per-row RLS work but applies
-- the same explicit active assignment scope before reading any asset.
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
security definer
set search_path = ''
as $$
  with current_profile as materialized (
    select id, email, name, role
    from public.app_users
    where user_id = auth.uid() and active = true
    limit 1
  ),
  allowed_projects as materialized (
    select project_id from private.assetlens_allowed_projects()
  ),
  filtered_assets as materialized (
    select asset.*
    from public.assets asset
    join allowed_projects allowed on allowed.project_id = asset.project_id
    where asset.archived_at is null
      and (target_project_id is null or asset.project_id = target_project_id)
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
      count(*) filter (where status = 'failed')::int failed,
      count(*) filter (where condition_rating <= 2)::int problem_assets,
      coalesce(sum(criticality_rating), 0)::int total_weight,
      coalesce(sum(criticality_rating) filter (where condition_rating <= 2), 0)::int problem_weight
    from filtered_assets
  ),
  project_counts as (
    select project.id, project.name, count(asset.id)::int asset_count
    from public.projects project
    join allowed_projects allowed on allowed.project_id = project.id
    left join filtered_assets asset on asset.project_id = project.id
    where project.active = true
      and (target_project_id is null or project.id = target_project_id)
    group by project.id, project.name
  ),
  project_stats as (
    select id, name, asset_count, max(asset_count) over () max_asset_count
    from project_counts
    order by asset_count desc, name
    limit 12
  ),
  days as (
    select generated_at::date activity_date
    from generate_series(
      coalesce(date_from, current_date - 6)::timestamp,
      coalesce(date_to, current_date)::timestamp,
      interval '1 day'
    ) generated_at
  ),
  activity as (
    select days.activity_date, count(asset.id)::int asset_count
    from days
    left join filtered_assets asset
      on asset.created_at >= days.activity_date::timestamptz
     and asset.created_at < (days.activity_date + 1)::timestamptz
    group by days.activity_date
    order by days.activity_date
  ),
  criticality_distribution as (
    select level.rating, count(asset.id)::int asset_count
    from generate_series(1, 5) level(rating)
    left join filtered_assets asset on asset.criticality_rating = level.rating
    group by level.rating
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
      'projects', (select count(*)::int from public.projects project join allowed_projects allowed on allowed.project_id = project.id where project.active = true and (target_project_id is null or project.id = target_project_id)),
      'buildings', (select count(*)::int from public.buildings building join allowed_projects allowed on allowed.project_id = building.project_id where building.active = true and (target_project_id is null or building.project_id = target_project_id) and (target_building_id is null or building.id = target_building_id)),
      'floors', (select count(*)::int from public.floors floor join public.buildings building on building.id = floor.building_id join allowed_projects allowed on allowed.project_id = building.project_id where (target_project_id is null or building.project_id = target_project_id) and (target_building_id is null or building.id = target_building_id) and (target_floor_id is null or floor.id = target_floor_id)),
      'zones', (select count(*)::int from public.zones zone join public.buildings building on building.id = zone.building_id join allowed_projects allowed on allowed.project_id = building.project_id where (target_project_id is null or building.project_id = target_project_id) and (target_building_id is null or building.id = target_building_id) and (target_floor_id is null or zone.floor_id = target_floor_id or zone.floor_id is null) and (target_zone_id is null or zone.id = target_zone_id))
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
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('date', activity_date::text, 'count', asset_count) order by activity_date), '[]'::jsonb) from activity),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'count', asset_count,
      'percent', case when max_asset_count > 0 then round(asset_count * 100.0 / max_asset_count)::int else 0 end
    ) order by asset_count desc, name), '[]'::jsonb) from project_stats),
    'criticality', jsonb_build_object(
      'weightedIssuePercent', case when totals.total_weight > 0 then round(totals.problem_weight * 100.0 / totals.total_weight)::int else 0 end,
      'problemWeight', totals.problem_weight,
      'totalWeight', totals.total_weight,
      'problemAssets', totals.problem_assets,
      'totalAssets', totals.total,
      'distribution', (select jsonb_agg(jsonb_build_object('rating', rating, 'weight', rating, 'count', asset_count) order by rating desc) from criticality_distribution)
    )
  )
  from totals
$$;

create or replace function public.assetlens_dashboard_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.assetlens_dashboard_filtered(null, null, null, null, null, null)
$$;

-- Kept for older front ends; new dashboard payloads already include this data.
create or replace function public.assetlens_criticality_snapshot(
  target_project_id uuid default null,
  target_building_id uuid default null,
  target_floor_id uuid default null,
  target_zone_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.assetlens_dashboard_filtered(
    target_project_id,
    target_building_id,
    target_floor_id,
    target_zone_id,
    null,
    null
  )->'criticality'
$$;

-- New records receive 48 bits of random suffix instead of 24 bits. Existing
-- identifiers remain unchanged and unique.
alter table public.assets
  alter column asset_no set default (
    'AST-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  );

update public.assets set estimate_source = '' where estimate_source is null;
update public.assets set estimate_confidence = '' where estimate_confidence is null;
alter table public.assets alter column estimate_source set default '';
alter table public.assets alter column estimate_source set not null;
alter table public.assets alter column estimate_confidence set default '';
alter table public.assets alter column estimate_confidence set not null;

create index if not exists app_users_active_auth_idx
  on public.app_users(user_id, id) where active = true;
create index if not exists user_projects_actor_project_idx
  on public.user_projects(app_user_id, project_id);
create index if not exists assets_active_project_page_idx
  on public.assets(project_id, created_at desc, id) where archived_at is null;
create index if not exists assets_active_project_status_idx
  on public.assets(project_id, status, created_at desc) where archived_at is null;
create index if not exists assets_active_project_condition_idx
  on public.assets(project_id, condition_rating) where archived_at is null;
create index if not exists assets_active_project_criticality_idx
  on public.assets(project_id, criticality_rating) where archived_at is null;
create index if not exists assets_active_project_location_idx
  on public.assets(project_id, building_id, floor_id, zone_id) where archived_at is null;

revoke all on function private.assetlens_allowed_projects() from public;
grant execute on function private.assetlens_allowed_projects() to authenticated;
revoke all on function private.can_access_project(uuid) from public;
grant execute on function private.can_access_project(uuid) to authenticated;
revoke all on function public.assetlens_asset_list_count(jsonb) from public, anon;
grant execute on function public.assetlens_asset_list_count(jsonb) to authenticated;
revoke all on function public.assetlens_report_counts(jsonb) from public, anon;
grant execute on function public.assetlens_report_counts(jsonb) to authenticated;
revoke all on function public.assetlens_config_snapshot(boolean, boolean) from public, anon;
grant execute on function public.assetlens_config_snapshot(boolean, boolean) to authenticated;
revoke all on function public.assetlens_dashboard_snapshot() from public, anon;
grant execute on function public.assetlens_dashboard_snapshot() to authenticated;
revoke all on function public.assetlens_dashboard_filtered(uuid, uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.assetlens_dashboard_filtered(uuid, uuid, uuid, uuid, date, date) to authenticated;
revoke all on function public.assetlens_criticality_snapshot(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.assetlens_criticality_snapshot(uuid, uuid, uuid, uuid) to authenticated;

analyze public.assets;
analyze public.user_projects;

commit;

notify pgrst, 'reload schema';
