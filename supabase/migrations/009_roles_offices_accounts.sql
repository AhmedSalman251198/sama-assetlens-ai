-- AssetLens AI R16 — direct accounts, project roles, and administrator-defined location levels.
-- Safe/idempotent upgrade. Run after 008_global_product_upgrade.sql.

create extension if not exists pgcrypto;
create schema if not exists private;

-- Expand the fixed two-role model without losing existing users.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_name.conname
    from pg_constraint constraint_name
    where constraint_name.conrelid = 'public.app_users'::regclass
      and constraint_name.contype = 'c'
      and pg_get_constraintdef(constraint_name.oid) ilike '%role%'
  loop
    execute format('alter table public.app_users drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('admin', 'project_manager', 'reviewer', 'surveyor', 'viewer'));

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.app_users
  where user_id = auth.uid() and active = true
  limit 1
$$;

create or replace function private.has_project_role(target_project_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_app_admin() or exists (
    select 1
    from public.user_projects assignment
    join public.app_users profile on profile.id = assignment.app_user_id
    where assignment.project_id = target_project_id
      and profile.user_id = auth.uid()
      and profile.active = true
      and profile.role = any(allowed_roles)
  )
$$;

create or replace function private.can_capture_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_project_role(target_project_id, array['project_manager', 'surveyor']::text[])
$$;

create or replace function private.can_review_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_project_role(target_project_id, array['project_manager', 'reviewer']::text[])
$$;

create or replace function private.can_edit_asset(target_project_id uuid, asset_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_app_admin()
    or private.can_review_project(target_project_id)
    or (asset_owner = auth.uid() and private.can_capture_project(target_project_id))
$$;

create or replace function private.can_delete_asset(target_project_id uuid, asset_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_app_admin()
    or (asset_owner = auth.uid() and private.can_capture_project(target_project_id))
$$;

-- Office is a fourth, optional location level after building/floor/zone.
alter table public.projects
  add column if not exists require_office boolean not null default false;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete cascade,
  zone_id uuid references public.zones(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.assets
  add column if not exists office_id uuid references public.offices(id) on delete set null,
  add column if not exists office_name text not null default '',
  add column if not exists additional_locations jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_additional_locations_array_check'
  ) then
    alter table public.assets add constraint assets_additional_locations_array_check
      check (jsonb_typeof(additional_locations) = 'array');
  end if;
end;
$$;

-- Extra location levels are fully administrator-defined. Office/room remains
-- as a backwards-compatible legacy column, while all new levels use JSON
-- snapshots so deleting a level never destroys historical asset data.
create table if not exists public.location_levels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  level_key text not null check (level_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label_ar text not null,
  label_en text not null default '',
  required boolean not null default false,
  sort_order integer not null default 10 check (sort_order >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(project_id, level_key)
);

create table if not exists public.location_options (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.location_levels(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete cascade,
  zone_id uuid references public.zones(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Convert an already-configured Office level into the dynamic model once.
insert into public.location_levels (project_id, level_key, label_ar, label_en, required, sort_order)
select project.id, 'office', 'المكتب / الغرفة', 'Office / Room', project.require_office, 10
from public.projects project
where project.require_office = true
   or exists (
     select 1 from public.assets asset
     where asset.project_id = project.id and asset.office_name <> ''
   )
on conflict (project_id, level_key) do nothing;

insert into public.location_options (level_id, building_id, floor_id, zone_id, name)
select level.id, office.building_id, office.floor_id, office.zone_id, office.name
from public.offices office
join public.buildings building on building.id = office.building_id
join public.location_levels level on level.project_id = building.project_id and level.level_key = 'office'
where not exists (
  select 1 from public.location_options existing
  where existing.level_id = level.id
    and existing.name = office.name
    and existing.building_id is not distinct from office.building_id
    and existing.floor_id is not distinct from office.floor_id
    and existing.zone_id is not distinct from office.zone_id
);

update public.assets asset
set additional_locations = jsonb_build_array(jsonb_build_object(
  'levelId', level.id, 'key', level.level_key,
  'labelAr', level.label_ar, 'labelEn', level.label_en,
  'valueId', asset.office_id, 'value', asset.office_name
))
from public.location_levels level
where level.project_id = asset.project_id
  and level.level_key = 'office'
  and asset.office_name <> ''
  and jsonb_array_length(asset.additional_locations) = 0;

update public.projects set require_office = false where require_office = true;

create index if not exists offices_building_idx on public.offices(building_id);
create index if not exists offices_floor_idx on public.offices(floor_id);
create index if not exists offices_zone_idx on public.offices(zone_id);
create index if not exists assets_office_idx on public.assets(office_id);
create index if not exists location_levels_project_order_idx on public.location_levels(project_id, sort_order);
create index if not exists location_options_level_idx on public.location_options(level_id);
create index if not exists location_options_scope_idx on public.location_options(building_id, floor_id, zone_id);

alter table public.offices enable row level security;
drop policy if exists "visible building offices" on public.offices;
create policy "visible building offices"
on public.offices for select to authenticated
using (exists (
  select 1 from public.buildings building
  where building.id = offices.building_id
));

drop policy if exists "admins manage offices" on public.offices;
create policy "admins manage offices"
on public.offices for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

alter table public.location_levels enable row level security;
alter table public.location_options enable row level security;
drop policy if exists "project location levels are visible" on public.location_levels;
create policy "project location levels are visible"
on public.location_levels for select to authenticated
using (private.can_access_project(project_id));
drop policy if exists "admins manage location levels" on public.location_levels;
create policy "admins manage location levels"
on public.location_levels for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "project location options are visible" on public.location_options;
create policy "project location options are visible"
on public.location_options for select to authenticated
using (exists (
  select 1 from public.location_levels level
  where level.id = location_options.level_id
    and private.can_access_project(level.project_id)
));
drop policy if exists "admins manage location options" on public.location_options;
create policy "admins manage location options"
on public.location_options for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

-- Role-aware asset write policies. Viewer is read-only; reviewer reviews;
-- surveyor captures; project manager can capture, review and transfer.
drop policy if exists "users create accessible assets" on public.assets;
drop policy if exists "role users create accessible assets" on public.assets;
create policy "role users create accessible assets"
on public.assets for insert to authenticated
with check (created_by = auth.uid() and private.can_capture_project(project_id));

drop policy if exists "owners update assets" on public.assets;
drop policy if exists "role users update assets" on public.assets;
create policy "role users update assets"
on public.assets for update to authenticated
using (private.can_edit_asset(project_id, created_by))
with check (private.can_edit_asset(project_id, created_by));

drop policy if exists "owners delete assets" on public.assets;
drop policy if exists "role users delete assets" on public.assets;
create policy "role users delete assets"
on public.assets for delete to authenticated
using (private.can_delete_asset(project_id, created_by));

drop policy if exists "owners create asset custom values" on public.asset_custom_values;
drop policy if exists "role users create asset custom values" on public.asset_custom_values;
create policy "role users create asset custom values"
on public.asset_custom_values for insert to authenticated
with check (exists (
  select 1
  from public.assets asset
  join public.custom_fields field on field.id = asset_custom_values.custom_field_id
  where asset.id = asset_custom_values.asset_id
    and private.can_edit_asset(asset.project_id, asset.created_by)
    and asset.survey_config_id = field.config_id
));

drop policy if exists "owners update asset custom values" on public.asset_custom_values;
drop policy if exists "role users update asset custom values" on public.asset_custom_values;
create policy "role users update asset custom values"
on public.asset_custom_values for update to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_custom_values.asset_id
    and private.can_edit_asset(asset.project_id, asset.created_by)
))
with check (exists (
  select 1
  from public.assets asset
  join public.custom_fields field on field.id = asset_custom_values.custom_field_id
  where asset.id = asset_custom_values.asset_id
    and private.can_edit_asset(asset.project_id, asset.created_by)
    and asset.survey_config_id = field.config_id
));

drop policy if exists "owners delete asset custom values" on public.asset_custom_values;
drop policy if exists "role users delete asset custom values" on public.asset_custom_values;
create policy "role users delete asset custom values"
on public.asset_custom_values for delete to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_custom_values.asset_id
    and private.can_edit_asset(asset.project_id, asset.created_by)
));

-- The configuration snapshot keeps navigation fast and includes every dynamic location level.
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
        'id', profile.id, 'user_id', profile.user_id, 'email', profile.email,
        'name', profile.name, 'role', profile.role, 'active', profile.active
      )
      from public.app_users profile
      where profile.user_id = auth.uid() and profile.active = true
      limit 1
    ), 'null'::jsonb),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(project_row) order by project_row.name)
      from (
        select id, name, require_building, require_floor, require_zone,
          require_office, allow_manual
        from public.projects where active = true
      ) project_row
    ), '[]'::jsonb),
    'buildings', coalesce((
      select jsonb_agg(to_jsonb(building_row) order by building_row.name)
      from (select id, project_id, name from public.buildings where active = true) building_row
    ), '[]'::jsonb),
    'floors', coalesce((
      select jsonb_agg(to_jsonb(floor_row) order by floor_row.sort_order, floor_row.name)
      from (select id, building_id, name, sort_order from public.floors) floor_row
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(to_jsonb(zone_row) order by zone_row.name)
      from (select id, building_id, floor_id, name from public.zones) zone_row
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(to_jsonb(office_row) order by office_row.name)
      from (
        select id, building_id, floor_id, zone_id, name
        from public.offices where active = true
      ) office_row
    ), '[]'::jsonb),
    'locationLevels', coalesce((
      select jsonb_agg(to_jsonb(level_row) order by level_row.sort_order, level_row.label_ar)
      from (
        select id, project_id, level_key, label_ar, label_en, required, sort_order
        from public.location_levels where active = true
      ) level_row
    ), '[]'::jsonb),
    'locationOptions', coalesce((
      select jsonb_agg(to_jsonb(option_row) order by option_row.name)
      from (
        select id, level_id, building_id, floor_id, zone_id, name
        from public.location_options where active = true
      ) option_row
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
          enabled, required, option_values, sort_order, help_text_ar, help_text_en,
          asset_types, unit, ai_extract, show_in_reports, show_in_qr
        from public.custom_fields
      ) field_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'users', case when include_admin and private.is_assetlens_super_admin() then coalesce((
      select jsonb_agg(to_jsonb(user_row) order by user_row.role, user_row.name, user_row.email)
      from (select id, user_id, email, name, role, active from public.app_users) user_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'assignments', case when include_admin and private.is_assetlens_super_admin() then coalesce((
      select jsonb_agg(to_jsonb(assignment_row))
      from (select app_user_id, project_id from public.user_projects) assignment_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'auditLogs', case when include_admin and private.is_app_admin() then coalesce((
      select jsonb_agg(to_jsonb(audit_row) order by audit_row.created_at desc)
      from (
        select id, actor_email, action, entity_type, entity_id, project_id, details, created_at
        from public.audit_logs order by created_at desc limit 100
      ) audit_row
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- Add dynamic location changes to the existing audit trail, including their project link.
create or replace function private.capture_assetlens_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  record_id uuid;
  related_project_id uuid;
  actor_email_value text := '';
  detail_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  begin record_id := nullif(row_data ->> 'id', '')::uuid; exception when others then record_id := null; end;
  begin related_project_id := nullif(row_data ->> 'project_id', '')::uuid; exception when others then related_project_id := null; end;

  if related_project_id is null and tg_table_name = 'custom_fields' then
    select config.project_id into related_project_id
    from public.survey_config_versions config
    where config.id = (row_data ->> 'config_id')::uuid;
  elsif related_project_id is null and tg_table_name in ('floors', 'zones', 'offices') then
    select building.project_id into related_project_id
    from public.buildings building
    where building.id = (row_data ->> 'building_id')::uuid;
  elsif related_project_id is null and tg_table_name = 'location_options' then
    select level.project_id into related_project_id
    from public.location_levels level
    where level.id = (row_data ->> 'level_id')::uuid;
  end if;

  select profile.email into actor_email_value
  from public.app_users profile where profile.user_id = auth.uid() limit 1;

  detail_data := jsonb_strip_nulls(jsonb_build_object(
    'operation', lower(tg_op),
    'name', coalesce(row_data ->> 'name', row_data ->> 'label_en', row_data ->> 'label_ar'),
    'email', case when tg_table_name = 'app_users' then row_data ->> 'email' else null end,
    'asset_no', row_data ->> 'asset_no',
    'status', row_data ->> 'status',
    'condition_rating', row_data ->> 'condition_rating',
    'version', row_data ->> 'version'
  ));

  insert into public.audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id, project_id, details
  ) values (
    auth.uid(), coalesce(actor_email_value, ''),
    lower(tg_table_name || '_' || tg_op), tg_table_name, record_id,
    related_project_id, detail_data
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists assetlens_audit_change on public.offices;
create trigger assetlens_audit_change
after insert or update or delete on public.offices
for each row execute function private.capture_assetlens_audit();

drop trigger if exists assetlens_audit_change on public.location_levels;
create trigger assetlens_audit_change
after insert or update or delete on public.location_levels
for each row execute function private.capture_assetlens_audit();
drop trigger if exists assetlens_audit_change on public.location_options;
create trigger assetlens_audit_change
after insert or update or delete on public.location_options
for each row execute function private.capture_assetlens_audit();

revoke all on public.offices from anon, authenticated;
grant select, insert, update, delete on public.offices to authenticated;
revoke all on public.location_levels, public.location_options from anon, authenticated;
grant select, insert, update, delete on public.location_levels, public.location_options to authenticated;
revoke all on function private.current_app_role() from public;
revoke all on function private.has_project_role(uuid, text[]) from public;
revoke all on function private.can_capture_project(uuid) from public;
revoke all on function private.can_review_project(uuid) from public;
revoke all on function private.can_edit_asset(uuid, uuid) from public;
revoke all on function private.can_delete_asset(uuid, uuid) from public;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.has_project_role(uuid, text[]) to authenticated;
grant execute on function private.can_capture_project(uuid) to authenticated;
grant execute on function private.can_review_project(uuid) to authenticated;
grant execute on function private.can_edit_asset(uuid, uuid) to authenticated;
grant execute on function private.can_delete_asset(uuid, uuid) to authenticated;
revoke all on function public.assetlens_config_snapshot(boolean, boolean) from public, anon;
grant execute on function public.assetlens_config_snapshot(boolean, boolean) to authenticated;

update public.app_users
set role = 'admin', active = true
where lower(email) = 'eng.ahmedsalman96@gmail.com';

notify pgrst, 'reload schema';
