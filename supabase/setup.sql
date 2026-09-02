-- AssetLens AI — Supabase schema, authentication profile sync, and RLS.
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique check (email = lower(email)),
  name text not null default '',
  role text not null default 'surveyor' check (role in ('admin', 'surveyor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  require_building boolean not null default true,
  require_floor boolean not null default true,
  require_zone boolean not null default false,
  allow_manual boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(project_id, name)
);

create table if not exists public.floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(building_id, name)
);

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_projects (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(app_user_id, project_id)
);

create index if not exists buildings_project_idx on public.buildings(project_id);
create index if not exists floors_building_idx on public.floors(building_id);
create index if not exists zones_building_idx on public.zones(building_id);
create index if not exists zones_floor_idx on public.zones(floor_id);
create index if not exists user_projects_project_idx on public.user_projects(project_id);

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.app_users where user_id = auth.uid() and active = true limit 1
$$;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where user_id = auth.uid() and role = 'admin' and active = true
  )
$$;

create or replace function private.sync_assetlens_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_users (user_id, email, name, role, active)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    'surveyor',
    true
  )
  on conflict (email) do update
  set user_id = excluded.user_id,
      name = case when excluded.name <> '' then excluded.name else public.app_users.name end,
      active = true;
  return new;
end;
$$;

drop trigger if exists on_auth_user_assetlens_sync on auth.users;
create trigger on_auth_user_assetlens_sync
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.sync_assetlens_user();

update public.app_users profile
set user_id = account.id
from auth.users account
where profile.user_id is null and profile.email = lower(account.email);

alter table public.app_users enable row level security;
alter table public.projects enable row level security;
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.zones enable row level security;
alter table public.user_projects enable row level security;

drop policy if exists "users read own profile" on public.app_users;
create policy "users read own profile" on public.app_users for select to authenticated
using (user_id = auth.uid() or private.is_app_admin());
drop policy if exists "admins manage users" on public.app_users;
create policy "admins manage users" on public.app_users for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "assigned projects are visible" on public.projects;
create policy "assigned projects are visible" on public.projects for select to authenticated
using (
  private.is_app_admin() or exists (
    select 1 from public.user_projects up
    where up.project_id = projects.id and up.app_user_id = private.current_app_user_id()
  )
);
drop policy if exists "admins manage projects" on public.projects;
create policy "admins manage projects" on public.projects for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "visible project buildings" on public.buildings;
create policy "visible project buildings" on public.buildings for select to authenticated
using (exists (select 1 from public.projects p where p.id = buildings.project_id));
drop policy if exists "admins manage buildings" on public.buildings;
create policy "admins manage buildings" on public.buildings for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "visible building floors" on public.floors;
create policy "visible building floors" on public.floors for select to authenticated
using (exists (select 1 from public.buildings b where b.id = floors.building_id));
drop policy if exists "admins manage floors" on public.floors;
create policy "admins manage floors" on public.floors for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "visible building zones" on public.zones;
create policy "visible building zones" on public.zones for select to authenticated
using (exists (select 1 from public.buildings b where b.id = zones.building_id));
drop policy if exists "admins manage zones" on public.zones;
create policy "admins manage zones" on public.zones for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "users read own assignments" on public.user_projects;
create policy "users read own assignments" on public.user_projects for select to authenticated
using (app_user_id = private.current_app_user_id() or private.is_app_admin());
drop policy if exists "admins manage assignments" on public.user_projects;
create policy "admins manage assignments" on public.user_projects for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

revoke all on public.app_users, public.projects, public.buildings, public.floors, public.zones, public.user_projects from anon, authenticated;
grant usage on schema public, private to authenticated;
grant select, insert, update, delete on public.app_users, public.projects, public.buildings, public.floors, public.zones, public.user_projects to authenticated;
revoke all on function private.current_app_user_id() from public;
revoke all on function private.is_app_admin() from public;
grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.is_app_admin() to authenticated;
