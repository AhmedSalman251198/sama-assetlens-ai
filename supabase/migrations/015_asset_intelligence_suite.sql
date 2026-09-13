-- AssetLens AI R19 — resilient imports, public immutable QR snapshots and
-- the asset-intelligence workspace. Safe/idempotent after migration 014.

create extension if not exists pgcrypto;

-- Universal Excel Autopilot retry safety. A deterministic hash identifies the
-- source project/sheet/row and prevents a network retry from duplicating it.
alter table public.assets add column if not exists import_fingerprint text;
drop index if exists public.assets_import_fingerprint_idx;
create unique index assets_import_fingerprint_idx on public.assets(import_fingerprint);

-- Add the intelligence workspace to granular sidebar/action permissions.
alter table public.user_module_permissions
  drop constraint if exists user_module_permissions_module_key_check;
alter table public.user_module_permissions
  add constraint user_module_permissions_module_key_check
  check (module_key in ('dashboard', 'capture', 'organization', 'locations', 'transfers', 'reports', 'intelligence', 'administration'));

insert into public.user_module_permissions
  (app_user_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_export)
select
  profile.id,
  'intelligence',
  profile.role in ('admin', 'project_manager', 'reviewer', 'viewer'),
  profile.role in ('admin', 'project_manager'),
  profile.role in ('admin', 'project_manager'),
  profile.role = 'admin',
  profile.role in ('admin', 'project_manager'),
  profile.role in ('admin', 'project_manager', 'reviewer', 'viewer')
from public.app_users profile
on conflict (app_user_id, module_key) do nothing;

create table if not exists public.asset_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  upstream_asset_id uuid not null references public.assets(id) on delete cascade,
  downstream_asset_id uuid not null references public.assets(id) on delete cascade,
  dependency_type text not null default 'supplies',
  impact text not null default 'medium',
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_dependencies_distinct_check check (upstream_asset_id <> downstream_asset_id),
  constraint asset_dependencies_type_check check (dependency_type in ('supplies','controls','protects','serves','feeds','depends_on','other')),
  constraint asset_dependencies_impact_check check (impact in ('low','medium','high','critical')),
  unique (upstream_asset_id, downstream_asset_id)
);

create table if not exists public.capital_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  annual_budget numeric(16,2) not null check (annual_budget >= 0),
  horizon_years smallint not null default 5 check (horizon_years between 1 and 20),
  assumptions jsonb not null default '{}'::jsonb check (jsonb_typeof(assumptions) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists asset_dependencies_set_updated_at on public.asset_dependencies;
create trigger asset_dependencies_set_updated_at before update on public.asset_dependencies
for each row execute function private.set_updated_at();
drop trigger if exists capital_scenarios_set_updated_at on public.capital_scenarios;
create trigger capital_scenarios_set_updated_at before update on public.capital_scenarios
for each row execute function private.set_updated_at();

create index if not exists asset_dependencies_project_idx on public.asset_dependencies(project_id);
create index if not exists asset_dependencies_upstream_idx on public.asset_dependencies(upstream_asset_id);
create index if not exists asset_dependencies_downstream_idx on public.asset_dependencies(downstream_asset_id);
create index if not exists capital_scenarios_project_idx on public.capital_scenarios(project_id, created_at desc);

alter table public.asset_dependencies enable row level security;
alter table public.capital_scenarios enable row level security;
revoke all on public.asset_dependencies, public.capital_scenarios from anon;
grant select, insert, update, delete on public.asset_dependencies, public.capital_scenarios to authenticated;

drop policy if exists "project users read asset dependencies" on public.asset_dependencies;
create policy "project users read asset dependencies" on public.asset_dependencies
for select to authenticated using (private.can_access_project(project_id));
drop policy if exists "project managers manage asset dependencies" on public.asset_dependencies;
create policy "project managers manage asset dependencies" on public.asset_dependencies
for all to authenticated using (private.can_access_project(project_id)) with check (private.can_access_project(project_id));

drop policy if exists "project users read capital scenarios" on public.capital_scenarios;
create policy "project users read capital scenarios" on public.capital_scenarios
for select to authenticated using (private.can_access_project(project_id));
drop policy if exists "project managers manage capital scenarios" on public.capital_scenarios;
create policy "project managers manage capital scenarios" on public.capital_scenarios
for all to authenticated using (private.can_access_project(project_id)) with check (private.can_access_project(project_id));

-- Public QR lookup exposes a deliberately narrow, non-sensitive snapshot.
-- The immutable asset UUID embedded in the printed QR stays the same while
-- this function always returns the latest approved/review data when online.
create or replace function public.asset_qr_public_snapshot(target_asset uuid)
returns table (
  id uuid,
  asset_no text,
  asset_type text,
  project_name text,
  building_name text,
  floor_name text,
  zone_name text,
  office_name text,
  fields jsonb,
  condition_rating smallint,
  criticality_rating smallint,
  operational_status text,
  updated_at timestamptz,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    asset.id,
    asset.asset_no,
    asset.asset_type,
    asset.project_name,
    asset.building_name,
    asset.floor_name,
    asset.zone_name,
    asset.office_name,
    coalesce((select jsonb_agg(jsonb_build_object('key', field ->> 'key', 'value', left(field ->> 'value', 160)))
      from jsonb_array_elements(case when jsonb_typeof(asset.fields) = 'array' then asset.fields else '[]'::jsonb end) field
      where lower(regexp_replace(coalesce(field ->> 'key', ''), '[^a-zA-Z0-9]', '', 'g'))
        in ('manufacturer','brand','make','model','modelnumber','modelno','serial','serialnumber','serialno','sn')),
      '[]'::jsonb),
    asset.condition_rating,
    asset.criticality_rating,
    asset.operational_status,
    asset.updated_at,
    coalesce(category.label_en, category.label_ar, '')
  from public.assets asset
  left join public.asset_categories category on category.id = asset.category_id
  where asset.id = target_asset
    and asset.archived_at is null
    and asset.status = 'completed'
  limit 1
$$;

revoke all on function public.asset_qr_public_snapshot(uuid) from public;
grant execute on function public.asset_qr_public_snapshot(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
