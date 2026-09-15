-- AssetLens AI R22.1 — strict project scope, project/client report branding,
-- and safe preliminary parent/child links. Apply after migration 018.
-- Safe to run more than once.

begin;

-- The legacy helper used the word "admin" to mean global access. From this
-- migration onward, global access belongs only to the nominated super admin.
create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_assetlens_super_admin()
$$;

create or replace function private.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_assetlens_super_admin() or exists (
    select 1
    from public.user_projects assignment
    join public.app_users profile on profile.id = assignment.app_user_id
    where assignment.project_id = target_project_id
      and profile.user_id = auth.uid()
      and profile.active = true
  )
$$;

create or replace function private.can_administer_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_assetlens_super_admin() or exists (
    select 1
    from public.user_projects assignment
    join public.app_users profile on profile.id = assignment.app_user_id
    where assignment.project_id = target_project_id
      and profile.user_id = auth.uid()
      and profile.active = true
      and profile.role = 'admin'
  )
$$;

create or replace function private.has_project_role(
  target_project_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_assetlens_super_admin() or exists (
    select 1
    from public.user_projects assignment
    join public.app_users profile on profile.id = assignment.app_user_id
    where assignment.project_id = target_project_id
      and profile.user_id = auth.uid()
      and profile.active = true
      and (profile.role = 'admin' or profile.role = any(allowed_roles))
  )
$$;

create or replace function private.can_capture_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_project_role(
    target_project_id,
    array['project_manager', 'surveyor']::text[]
  )
$$;

create or replace function private.can_review_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_project_role(
    target_project_id,
    array['project_manager', 'reviewer']::text[]
  )
$$;

create or replace function private.can_edit_asset(
  target_project_id uuid,
  asset_owner uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_review_project(target_project_id)
    or (asset_owner = auth.uid() and private.can_capture_project(target_project_id))
$$;

create or replace function private.can_delete_asset(
  target_project_id uuid,
  asset_owner uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_administer_project(target_project_id)
    or (asset_owner = auth.uid() and private.can_capture_project(target_project_id))
$$;

revoke all on function private.can_administer_project(uuid) from public;
grant execute on function private.can_administer_project(uuid) to authenticated;

-- Assigned administrators may edit their projects and manage the structure
-- inside them, but cannot create/archive projects or manage global accounts.
drop policy if exists "assigned admins update projects" on public.projects;
create policy "assigned admins update projects"
on public.projects for update to authenticated
using (private.can_administer_project(id))
with check (private.can_administer_project(id));

drop policy if exists "assigned admins manage buildings" on public.buildings;
create policy "assigned admins manage buildings"
on public.buildings for all to authenticated
using (private.can_administer_project(project_id))
with check (private.can_administer_project(project_id));

drop policy if exists "assigned admins manage floors" on public.floors;
create policy "assigned admins manage floors"
on public.floors for all to authenticated
using (exists (
  select 1 from public.buildings building
  where building.id = floors.building_id
    and private.can_administer_project(building.project_id)
))
with check (exists (
  select 1 from public.buildings building
  where building.id = floors.building_id
    and private.can_administer_project(building.project_id)
));

drop policy if exists "assigned admins manage zones" on public.zones;
create policy "assigned admins manage zones"
on public.zones for all to authenticated
using (exists (
  select 1 from public.buildings building
  where building.id = zones.building_id
    and private.can_administer_project(building.project_id)
))
with check (exists (
  select 1 from public.buildings building
  where building.id = zones.building_id
    and private.can_administer_project(building.project_id)
));

drop policy if exists "assigned admins manage offices" on public.offices;
create policy "assigned admins manage offices"
on public.offices for all to authenticated
using (exists (
  select 1 from public.buildings building
  where building.id = offices.building_id
    and private.can_administer_project(building.project_id)
))
with check (exists (
  select 1 from public.buildings building
  where building.id = offices.building_id
    and private.can_administer_project(building.project_id)
));

drop policy if exists "assigned admins manage survey configs" on public.survey_config_versions;
create policy "assigned admins manage survey configs"
on public.survey_config_versions for all to authenticated
using (private.can_administer_project(project_id))
with check (private.can_administer_project(project_id));

drop policy if exists "assigned admins manage custom fields" on public.custom_fields;
create policy "assigned admins manage custom fields"
on public.custom_fields for all to authenticated
using (exists (
  select 1 from public.survey_config_versions config
  where config.id = custom_fields.config_id
    and private.can_administer_project(config.project_id)
))
with check (exists (
  select 1 from public.survey_config_versions config
  where config.id = custom_fields.config_id
    and private.can_administer_project(config.project_id)
));

drop policy if exists "assigned admins manage location levels" on public.location_levels;
create policy "assigned admins manage location levels"
on public.location_levels for all to authenticated
using (private.can_administer_project(project_id))
with check (private.can_administer_project(project_id));

drop policy if exists "assigned admins manage location options" on public.location_options;
create policy "assigned admins manage location options"
on public.location_options for all to authenticated
using (exists (
  select 1 from public.location_levels level
  where level.id = location_options.level_id
    and private.can_administer_project(level.project_id)
))
with check (exists (
  select 1 from public.location_levels level
  where level.id = location_options.level_id
    and private.can_administer_project(level.project_id)
));

drop policy if exists "assigned admins manage project categories" on public.project_asset_categories;
create policy "assigned admins manage project categories"
on public.project_asset_categories for all to authenticated
using (private.can_administer_project(project_id))
with check (private.can_administer_project(project_id));

-- Assigned admins can see and clean up queue/image records only when the
-- related asset is in one of their projects.
drop policy if exists "assigned admins see project jobs" on public.analysis_jobs;
create policy "assigned admins see project jobs"
on public.analysis_jobs for select to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = analysis_jobs.asset_id
    and private.can_administer_project(asset.project_id)
));

drop policy if exists "assigned admins update project jobs" on public.analysis_jobs;
create policy "assigned admins update project jobs"
on public.analysis_jobs for update to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = analysis_jobs.asset_id
    and private.can_administer_project(asset.project_id)
))
with check (exists (
  select 1 from public.assets asset
  where asset.id = analysis_jobs.asset_id
    and private.can_administer_project(asset.project_id)
));

drop policy if exists "assigned admins delete project jobs" on public.analysis_jobs;
create policy "assigned admins delete project jobs"
on public.analysis_jobs for delete to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = analysis_jobs.asset_id
    and private.can_administer_project(asset.project_id)
));

drop policy if exists "assigned admins delete project images" on public.asset_images;
create policy "assigned admins delete project images"
on public.asset_images for delete to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_images.asset_id
    and private.can_administer_project(asset.project_id)
));

-- Restore draft creation for assigned project administrators after narrowing
-- the legacy global-admin helper.
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
  if not private.can_administer_project(target_project_id) then
    raise exception 'Administrator permission for this project is required';
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

  insert into public.survey_config_versions
    (project_id, version, status, created_by)
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

-- Publishing is also project-scoped. The old implementation checked the
-- legacy global-admin helper and would incorrectly block assigned admins after
-- that helper was narrowed to the nominated super administrator.
create or replace function public.publish_survey_config(target_config_id uuid)
returns setof public.survey_config_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.survey_config_versions;
begin
  select * into target
  from public.survey_config_versions
  where id = target_config_id
  for update;

  if target.id is null or target.status <> 'draft' then
    raise exception 'A valid draft configuration is required';
  end if;
  if not private.can_administer_project(target.project_id) then
    raise exception 'Administrator permission for this project is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target.project_id::text, 2));
  update public.survey_config_versions
  set status = 'archived'
  where project_id = target.project_id and status = 'published';

  update public.survey_config_versions
  set status = 'published', published_by = auth.uid(), published_at = now()
  where id = target.id
  returning * into target;

  return next target;
end;
$$;

-- Optional client/project logo for report identity. Files stay private and
-- are served only through an authenticated, project-scoped API route.
alter table public.projects
  add column if not exists client_logo_storage_path text not null default '',
  add column if not exists client_logo_mime_type text not null default '';

alter table public.projects
  drop constraint if exists projects_client_logo_mime_check;
alter table public.projects
  add constraint projects_client_logo_mime_check
  check (client_logo_mime_type in ('', 'image/jpeg', 'image/png', 'image/webp'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-branding',
  'project-branding',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.project_id_from_storage_path(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end
$$;

drop policy if exists "project users read project branding" on storage.objects;
create policy "project users read project branding"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-branding'
  and private.can_access_project(private.project_id_from_storage_path(name))
);

drop policy if exists "project admins insert project branding" on storage.objects;
create policy "project admins insert project branding"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-branding'
  and private.can_administer_project(private.project_id_from_storage_path(name))
);

drop policy if exists "project admins update project branding" on storage.objects;
create policy "project admins update project branding"
on storage.objects for update to authenticated
using (
  bucket_id = 'project-branding'
  and private.can_administer_project(private.project_id_from_storage_path(name))
)
with check (
  bucket_id = 'project-branding'
  and private.can_administer_project(private.project_id_from_storage_path(name))
);

drop policy if exists "project admins delete project branding" on storage.objects;
create policy "project admins delete project branding"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-branding'
  and private.can_administer_project(private.project_id_from_storage_path(name))
);

-- Keep image cleanup working for an assigned project administrator even
-- though the legacy global-admin helper now means super admin only.
drop policy if exists "project admins delete stored asset images" on storage.objects;
create policy "project admins delete stored asset images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-images'
  and exists (
    select 1
    from public.asset_images image
    join public.assets asset on asset.id = image.asset_id
    where image.storage_path = storage.objects.name
      and private.can_administer_project(asset.project_id)
  )
);

-- Capture may create only a clearly unverified preliminary relationship.
drop policy if exists "capture creates preliminary asset relationships" on public.asset_dependencies;
create policy "capture creates preliminary asset relationships"
on public.asset_dependencies for insert to authenticated
with check (
  created_by = auth.uid()
  and dependency_type = 'unverified'
  and impact = 'unassessed'
  and private.can_capture_project(project_id)
);

create or replace function private.validate_asset_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  upstream_project uuid;
  downstream_project uuid;
  upstream_building uuid;
  downstream_building uuid;
begin
  select project_id, building_id
    into upstream_project, upstream_building
  from public.assets where id = new.upstream_asset_id and archived_at is null;

  select project_id, building_id
    into downstream_project, downstream_building
  from public.assets where id = new.downstream_asset_id and archived_at is null;

  if upstream_project is null or downstream_project is null
     or upstream_project is distinct from new.project_id
     or downstream_project is distinct from new.project_id then
    raise exception 'Both relationship assets must be active and belong to the selected project.';
  end if;

  if upstream_building is null or downstream_building is null
     or upstream_building is distinct from downstream_building then
    raise exception 'Parent and child assets must belong to the same registered building.';
  end if;

  if exists (
    select 1 from public.asset_dependencies existing
    where existing.id is distinct from new.id
      and (
        (existing.upstream_asset_id = new.upstream_asset_id
          and existing.downstream_asset_id = new.downstream_asset_id)
        or
        (existing.upstream_asset_id = new.downstream_asset_id
          and existing.downstream_asset_id = new.upstream_asset_id)
      )
  ) then
    raise exception 'A relationship between these assets already exists.';
  end if;

  return new;
end;
$$;

drop trigger if exists asset_dependency_project_guard on public.asset_dependencies;
create trigger asset_dependency_project_guard
before insert or update on public.asset_dependencies
for each row execute function private.validate_asset_dependency();

revoke all on function private.is_app_admin() from public;
revoke all on function private.can_access_project(uuid) from public;
revoke all on function private.has_project_role(uuid, text[]) from public;
revoke all on function private.can_capture_project(uuid) from public;
revoke all on function private.can_review_project(uuid) from public;
revoke all on function private.can_edit_asset(uuid, uuid) from public;
revoke all on function private.can_delete_asset(uuid, uuid) from public;
revoke all on function private.project_id_from_storage_path(text) from public;
grant execute on function private.is_app_admin() to authenticated;
grant execute on function private.can_access_project(uuid) to authenticated;
grant execute on function private.has_project_role(uuid, text[]) to authenticated;
grant execute on function private.can_capture_project(uuid) to authenticated;
grant execute on function private.can_review_project(uuid) to authenticated;
grant execute on function private.can_edit_asset(uuid, uuid) to authenticated;
grant execute on function private.can_delete_asset(uuid, uuid) to authenticated;
grant execute on function private.project_id_from_storage_path(text) to authenticated;

revoke all on function public.publish_survey_config(uuid) from public, anon;
grant execute on function public.publish_survey_config(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
