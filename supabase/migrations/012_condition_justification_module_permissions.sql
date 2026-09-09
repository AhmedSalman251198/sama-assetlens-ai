-- AssetLens AI R16.3 — condition justification and granular module permissions.
-- Safe/idempotent upgrade. Run once after 011_asset_criticality_weighted_dashboard.sql.

alter table public.assets
  add column if not exists condition_justification text not null default '';

comment on column public.assets.condition_justification is
  'Required explanation for Critical/Poor condition ratings; optional for Fair.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_poor_condition_justification_check'
  ) then
    alter table public.assets
      add constraint assets_poor_condition_justification_check
      check (condition_rating is null or condition_rating > 2 or length(btrim(condition_justification)) >= 3)
      not valid;
  end if;
end;
$$;

create table if not exists public.user_module_permissions (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  module_key text not null check (module_key in ('dashboard', 'capture', 'organization', 'locations', 'transfers', 'reports', 'administration')),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (app_user_id, module_key)
);

create index if not exists user_module_permissions_user_idx
  on public.user_module_permissions(app_user_id);

alter table public.user_module_permissions enable row level security;

revoke all on table public.user_module_permissions from anon;
grant select, insert, update, delete on table public.user_module_permissions to authenticated;

drop policy if exists "users read own module permissions" on public.user_module_permissions;
create policy "users read own module permissions"
on public.user_module_permissions for select to authenticated
using (exists (
  select 1 from public.app_users profile
  where profile.id = user_module_permissions.app_user_id
    and profile.user_id = auth.uid()
    and profile.active = true
));

drop policy if exists "admins manage module permissions" on public.user_module_permissions;
create policy "admins manage module permissions"
on public.user_module_permissions for all to authenticated
using (private.is_app_admin())
with check (private.is_app_admin());

-- Seed safe role defaults for existing accounts. Super-admin receives every action.
insert into public.user_module_permissions (app_user_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_export)
select
  profile.id,
  module.module_key,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' then true
    when profile.role = 'admin' then true
    when profile.role = 'project_manager' then module.module_key <> 'administration'
    when profile.role = 'reviewer' then module.module_key in ('dashboard', 'organization', 'locations', 'reports')
    when profile.role = 'surveyor' then module.module_key in ('capture', 'locations', 'reports')
    else module.module_key in ('dashboard', 'reports')
  end,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' or profile.role = 'admin' then true
    when profile.role = 'project_manager' then module.module_key in ('capture', 'transfers')
    when profile.role = 'surveyor' then module.module_key = 'capture'
    else false
  end,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' or profile.role = 'admin' then true
    when profile.role = 'project_manager' then module.module_key in ('capture', 'transfers', 'reports')
    when profile.role = 'reviewer' then module.module_key = 'reports'
    when profile.role = 'surveyor' then module.module_key in ('capture', 'reports')
    else false
  end,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' or profile.role = 'admin' then true
    when profile.role = 'surveyor' then module.module_key = 'capture'
    else false
  end,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' or profile.role = 'admin' then true
    when profile.role in ('project_manager', 'reviewer') then module.module_key = 'reports'
    else false
  end,
  case
    when lower(profile.email) = 'eng.ahmedsalman96@gmail.com' or profile.role = 'admin' then true
    when profile.role in ('project_manager', 'reviewer', 'surveyor', 'viewer') then module.module_key in ('dashboard', 'reports')
    else false
  end
from public.app_users profile
cross join (values ('dashboard'), ('capture'), ('organization'), ('locations'), ('transfers'), ('reports'), ('administration')) as module(module_key)
on conflict (app_user_id, module_key) do nothing;

create or replace function private.has_module_permission(target_module text, target_action text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users profile
    left join public.user_module_permissions permission
      on permission.app_user_id = profile.id
     and permission.module_key = target_module
    where profile.user_id = auth.uid()
      and profile.active = true
      and (
        lower(profile.email) = 'eng.ahmedsalman96@gmail.com'
        or case target_action
          when 'view' then permission.can_view
          when 'create' then permission.can_view and permission.can_create
          when 'edit' then permission.can_view and permission.can_edit
          when 'delete' then permission.can_view and permission.can_delete
          when 'approve' then permission.can_view and permission.can_approve
          when 'export' then permission.can_view and permission.can_export
          else false
        end
      )
  )
$$;

revoke all on function private.has_module_permission(text, text) from public, anon;
grant execute on function private.has_module_permission(text, text) to authenticated;

notify pgrst, 'reload schema';
