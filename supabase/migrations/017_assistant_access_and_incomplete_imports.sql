-- AssetLens AI R21: independent AI permissions and reversible incomplete imports.
-- Run after 016. Existing permissions are never broadened, except for the
-- original super administrator; all other AI privileges start disabled.

alter table public.user_module_permissions
  drop constraint if exists user_module_permissions_module_key_check;
alter table public.user_module_permissions
  add constraint user_module_permissions_module_key_check
  check (module_key in ('dashboard', 'capture', 'organization', 'locations', 'transfers', 'reports', 'intelligence', 'assistant', 'ai_reports', 'administration'));

insert into public.user_module_permissions
  (app_user_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_export)
select profile.id, capability.module_key,
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com',
  lower(profile.email) = 'eng.ahmedsalman96@gmail.com'
from public.app_users profile
cross join (values ('assistant'), ('ai_reports')) as capability(module_key)
on conflict (app_user_id, module_key) do nothing;

-- Missing ratings are allowed while imported rows await review. Publishing/
-- approving still requires complete ratings in the application workflow.
-- Retain existing per-project survey requirements for capture/manual flows.
alter table public.assets
  add column if not exists operational_status_source_raw text;

update public.assets
set
  operational_status_source_raw = coalesce(operational_status_source_raw, operational_status),
  operational_status = 'unknown'
where operational_status is null
   or operational_status not in ('unknown','active','maintenance','out_of_service','transferred','disposed');

alter table public.assets drop constraint if exists assets_operational_status_check;
alter table public.assets add constraint assets_operational_status_check
  check (operational_status in ('unknown','active','maintenance','out_of_service','transferred','disposed'));
notify pgrst, 'reload schema';
