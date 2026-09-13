-- Apply after 015. Also safe if 015 has already been deployed: PostgreSQL
-- cannot change a function's RETURNS TABLE columns via CREATE OR REPLACE.
begin;

drop function if exists public.asset_qr_public_snapshot(uuid);
create function public.asset_qr_public_snapshot(target_asset uuid)
returns table (
  id uuid, asset_no text, asset_type text, project_name text,
  building_name text, floor_name text, zone_name text, office_name text,
  fields jsonb, condition_rating smallint, criticality_rating smallint,
  operational_status text, updated_at timestamptz, category text
)
language sql stable security definer set search_path = '' as $$
  select asset.id, asset.asset_no, asset.asset_type, asset.project_name,
    asset.building_name, asset.floor_name, asset.zone_name, asset.office_name,
    coalesce((select jsonb_agg(jsonb_build_object('key', field ->> 'key', 'value', left(field ->> 'value', 160)))
      from jsonb_array_elements(case when jsonb_typeof(asset.fields) = 'array' then asset.fields else '[]'::jsonb end) field
      where lower(regexp_replace(coalesce(field ->> 'key', ''), '[^a-zA-Z0-9]', '', 'g'))
        in ('manufacturer','brand','make','model','modelnumber','modelno','serial','serialnumber','serialno','sn')),
      '[]'::jsonb),
    asset.condition_rating, asset.criticality_rating, asset.operational_status,
    asset.updated_at, coalesce(category.label_en, category.label_ar, '')
  from public.assets asset
  left join public.asset_categories category on category.id = asset.category_id
  where asset.id = target_asset and asset.archived_at is null and asset.status = 'completed'
  limit 1
$$;
revoke all on function public.asset_qr_public_snapshot(uuid) from public;
grant execute on function public.asset_qr_public_snapshot(uuid) to anon, authenticated;

-- Dynamic levels can now be anchored to an office or another custom level.
alter table public.location_levels
  add column if not exists parent_level_id uuid references public.location_levels(id) on delete set null;
alter table public.location_options
  add column if not exists office_id uuid references public.offices(id) on delete set null,
  add column if not exists parent_option_id uuid references public.location_options(id) on delete set null;
create index if not exists location_levels_parent_idx on public.location_levels(parent_level_id);
create index if not exists location_options_parent_idx on public.location_options(parent_option_id);
create index if not exists location_options_office_idx on public.location_options(office_id);

create or replace function private.validate_location_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_project uuid; parent_sort integer; parent_level uuid; parent_building uuid;
begin
  if tg_table_name = 'location_levels' then
    if new.parent_level_id is null then return new; end if;
    select project_id, sort_order into parent_project, parent_sort
      from public.location_levels where id = new.parent_level_id;
    if parent_project is distinct from new.project_id or parent_sort >= new.sort_order then
      raise exception 'A custom level must follow a parent level in the same project.';
    end if;
  else
    if new.building_id is not null and not exists (
      select 1 from public.buildings building join public.location_levels level on level.project_id = building.project_id
      where building.id = new.building_id and level.id = new.level_id
    ) then raise exception 'The location value must belong to a building in the same project as its level.';
    end if;
    if new.floor_id is not null and not exists (
      select 1 from public.floors floor where floor.id = new.floor_id and floor.building_id = new.building_id
    ) then raise exception 'The floor must belong to the selected building.';
    end if;
    if new.zone_id is not null and not exists (
      select 1 from public.zones zone where zone.id = new.zone_id and zone.building_id = new.building_id
        and (zone.floor_id is null or zone.floor_id = new.floor_id)
    ) then raise exception 'The zone must belong to the selected building and floor.';
    end if;
    if new.parent_option_id is not null then
      select level_id, building_id into parent_level, parent_building
        from public.location_options where id = new.parent_option_id;
      if parent_level is distinct from (select parent_level_id from public.location_levels where id = new.level_id)
        or (parent_building is not null and new.building_id is distinct from parent_building) then
        raise exception 'The parent value must belong to the preceding level and building.';
      end if;
    end if;
    if new.office_id is not null and not exists (
      select 1 from public.offices office
      where office.id = new.office_id and office.building_id = new.building_id
        and (office.floor_id is null or office.floor_id = new.floor_id)
        and (office.zone_id is null or office.zone_id = new.zone_id)
    ) then raise exception 'The office must belong to the selected building and zone.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists location_level_parent_guard on public.location_levels;
create trigger location_level_parent_guard before insert or update on public.location_levels
for each row execute function private.validate_location_parent();
drop trigger if exists location_option_parent_guard on public.location_options;
create trigger location_option_parent_guard before insert or update on public.location_options
for each row execute function private.validate_location_parent();

-- API permissions must also be enforced for direct Supabase REST clients.
create or replace function private.can_manage_asset_intelligence(target_project uuid, requested_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_project(target_project) and exists (
    select 1 from public.app_users profile
    join public.user_module_permissions permissions on permissions.app_user_id = profile.id
    where profile.user_id = auth.uid() and profile.active = true
      and permissions.module_key = 'intelligence'
      and case requested_action when 'create' then permissions.can_create
        when 'edit' then permissions.can_edit when 'delete' then permissions.can_delete else false end
  )
$$;
revoke all on function private.can_manage_asset_intelligence(uuid, text) from public;
grant execute on function private.can_manage_asset_intelligence(uuid, text) to authenticated;

drop policy if exists "project managers manage asset dependencies" on public.asset_dependencies;
drop policy if exists "project managers create asset dependencies" on public.asset_dependencies;
drop policy if exists "project managers edit asset dependencies" on public.asset_dependencies;
drop policy if exists "project managers delete asset dependencies" on public.asset_dependencies;
create policy "project managers create asset dependencies" on public.asset_dependencies
for insert to authenticated with check (private.can_manage_asset_intelligence(project_id, 'create'));
create policy "project managers edit asset dependencies" on public.asset_dependencies
for update to authenticated using (private.can_manage_asset_intelligence(project_id, 'edit'))
with check (private.can_manage_asset_intelligence(project_id, 'edit'));
create policy "project managers delete asset dependencies" on public.asset_dependencies
for delete to authenticated using (private.can_manage_asset_intelligence(project_id, 'delete'));

drop policy if exists "project managers manage capital scenarios" on public.capital_scenarios;
drop policy if exists "project managers create capital scenarios" on public.capital_scenarios;
drop policy if exists "project managers edit capital scenarios" on public.capital_scenarios;
drop policy if exists "project managers delete capital scenarios" on public.capital_scenarios;
create policy "project managers create capital scenarios" on public.capital_scenarios
for insert to authenticated with check (private.can_manage_asset_intelligence(project_id, 'create'));
create policy "project managers edit capital scenarios" on public.capital_scenarios
for update to authenticated using (private.can_manage_asset_intelligence(project_id, 'edit'))
with check (private.can_manage_asset_intelligence(project_id, 'edit'));
create policy "project managers delete capital scenarios" on public.capital_scenarios
for delete to authenticated using (private.can_manage_asset_intelligence(project_id, 'delete'));

create or replace function private.validate_asset_dependency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.assets asset where asset.id = new.upstream_asset_id and asset.project_id = new.project_id)
    or not exists (select 1 from public.assets asset where asset.id = new.downstream_asset_id and asset.project_id = new.project_id) then
    raise exception 'Both dependency assets must belong to the selected project.';
  end if;
  return new;
end $$;
drop trigger if exists asset_dependency_project_guard on public.asset_dependencies;
create trigger asset_dependency_project_guard before insert or update on public.asset_dependencies
for each row execute function private.validate_asset_dependency();

notify pgrst, 'reload schema';
commit;
