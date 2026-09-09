-- AssetLens AI R14.1 — only the nominated super administrator can approve accounts.
-- Run after 006_performance_config_snapshot.sql.

create or replace function private.is_assetlens_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users
    where user_id = auth.uid()
      and lower(email) = 'eng.ahmedsalman96@gmail.com'
      and role = 'admin'
      and active = true
  )
$$;

-- A new Supabase Auth account is accepted only when the super admin has first
-- created its app_users row. This also blocks direct calls to /auth/v1/signup.
create or replace function private.sync_assetlens_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text := lower(coalesce(new.email, ''));
  approved_profile public.app_users%rowtype;
begin
  if account_email = '' then
    raise exception 'AssetLens accounts require an email address.';
  end if;

  select * into approved_profile
  from public.app_users
  where email = account_email and active = true
  limit 1;

  if account_email <> 'eng.ahmedsalman96@gmail.com' and approved_profile.id is null then
    raise exception 'This email has not been approved by the AssetLens super administrator.';
  end if;

  insert into public.app_users (user_id, email, name, role, active)
  values (
    new.id,
    account_email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when account_email = 'eng.ahmedsalman96@gmail.com' then 'admin' else coalesce(approved_profile.role, 'surveyor') end,
    true
  )
  on conflict (email) do update
  set user_id = excluded.user_id,
      name = case when excluded.name <> '' then excluded.name else public.app_users.name end,
      role = case when excluded.email = 'eng.ahmedsalman96@gmail.com' then 'admin' else public.app_users.role end,
      active = true;
  return new;
end;
$$;

drop policy if exists "admins manage users" on public.app_users;
drop policy if exists "super admin manages users" on public.app_users;
create policy "super admin manages users"
on public.app_users for all to authenticated
using (private.is_assetlens_super_admin())
with check (private.is_assetlens_super_admin());

drop policy if exists "admins manage assignments" on public.user_projects;
drop policy if exists "super admin manages assignments" on public.user_projects;
create policy "super admin manages assignments"
on public.user_projects for all to authenticated
using (private.is_assetlens_super_admin())
with check (private.is_assetlens_super_admin());

revoke all on function private.is_assetlens_super_admin() from public;
grant execute on function private.is_assetlens_super_admin() to authenticated;

-- Make sure the nominated account remains an active administrator.
update public.app_users
set role = 'admin', active = true
where lower(email) = 'eng.ahmedsalman96@gmail.com';
