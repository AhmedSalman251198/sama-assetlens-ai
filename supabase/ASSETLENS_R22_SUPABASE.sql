-- AssetLens AI R22 - combined Supabase migration.
-- Run once in Supabase SQL Editor after migrations 001 through 016.
-- The script is transactional and safe to run again.

begin;

do $$
begin
  if to_regclass('public.assets') is null
     or to_regclass('public.app_users') is null
     or to_regclass('public.user_module_permissions') is null
     or to_regclass('public.asset_dependencies') is null then
    raise exception 'AssetLens base schema is incomplete. Apply migrations 001 through 016 first.';
  end if;
end $$;

-- Independent permissions for the assistant and AI reports.
alter table public.user_module_permissions
  drop constraint if exists user_module_permissions_module_key_check;

alter table public.user_module_permissions
  add constraint user_module_permissions_module_key_check
  check (module_key in (
    'dashboard', 'capture', 'organization', 'locations', 'transfers',
    'reports', 'intelligence', 'assistant', 'ai_reports', 'administration'
  ));

insert into public.user_module_permissions
  (app_user_id, module_key, can_view, can_create, can_edit,
   can_delete, can_approve, can_export)
select
  profile.id,
  capability.module_key,
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com'
from public.app_users profile
cross join (values ('assistant'), ('ai_reports')) as capability(module_key)
on conflict (app_user_id, module_key) do nothing;

-- Preserve an unrecognized imported value before normalizing the application
-- status. No asset row is deleted.
alter table public.assets
  add column if not exists operational_status_source_raw text;

update public.assets
set
  operational_status_source_raw = coalesce(operational_status_source_raw, operational_status),
  operational_status = 'unknown'
where operational_status is null
   or operational_status not in (
     'unknown', 'active', 'maintenance', 'out_of_service',
     'transferred', 'disposed'
   );

alter table public.assets
  drop constraint if exists assets_operational_status_check;

alter table public.assets
  add constraint assets_operational_status_check
  check (operational_status in (
    'unknown', 'active', 'maintenance', 'out_of_service',
    'transferred', 'disposed'
  ));

-- Preliminary parent/child links remain explicitly unverified and unassessed.
alter table public.asset_dependencies
  drop constraint if exists asset_dependencies_type_check,
  drop constraint if exists asset_dependencies_impact_check;

alter table public.asset_dependencies
  add constraint asset_dependencies_type_check
    check (dependency_type in (
      'unverified', 'supplies', 'controls', 'protects',
      'serves', 'feeds', 'depends_on', 'other'
    )),
  add constraint asset_dependencies_impact_check
    check (impact in ('unassessed', 'low', 'medium', 'high', 'critical'));

comment on column public.assets.operational_status_source_raw is
  'Original unrecognized operational status retained during import normalization.';

comment on column public.asset_dependencies.dependency_type is
  'unverified is a preliminary structural link awaiting engineering classification.';

comment on column public.asset_dependencies.impact is
  'unassessed means no engineering interruption severity has been assigned.';

commit;

notify pgrst, 'reload schema';

-- Verification output. Expected: two permission rows per active app user;
-- invalid_operational_statuses and invalid_relationship_values must both be 0.
select
  (select count(*)
   from public.user_module_permissions
   where module_key in ('assistant', 'ai_reports')) as ai_permission_rows,
  (select count(*)
   from public.assets
   where operational_status not in (
     'unknown', 'active', 'maintenance', 'out_of_service',
     'transferred', 'disposed'
   )) as invalid_operational_statuses,
  (select count(*)
   from public.asset_dependencies
   where dependency_type not in (
       'unverified', 'supplies', 'controls', 'protects',
       'serves', 'feeds', 'depends_on', 'other'
     )
      or impact not in ('unassessed', 'low', 'medium', 'high', 'critical'))
    as invalid_relationship_values;
