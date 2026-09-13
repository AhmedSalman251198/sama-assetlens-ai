-- AssetLens AI R17 — asset management, categories, lifecycle and image retention.
-- Safe/idempotent upgrade. Run once after 012_condition_justification_module_permissions.sql.

create extension if not exists pgcrypto;

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label_ar text not null,
  label_en text not null,
  color text not null default '#087f75',
  icon text not null default '◇',
  default_useful_life_years numeric(6,2),
  default_estimated_price numeric(16,2),
  currency text not null default 'AED',
  default_criticality_rating smallint,
  technical_fields jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_categories_code_check check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint asset_categories_color_check check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint asset_categories_life_check check (default_useful_life_years is null or default_useful_life_years > 0),
  constraint asset_categories_price_check check (default_estimated_price is null or default_estimated_price >= 0),
  constraint asset_categories_criticality_check check (default_criticality_rating is null or default_criticality_rating between 1 and 5),
  constraint asset_categories_technical_fields_check check (jsonb_typeof(technical_fields) = 'array')
);

create table if not exists public.project_asset_categories (
  project_id uuid not null references public.projects(id) on delete cascade,
  category_id uuid not null references public.asset_categories(id) on delete cascade,
  asset_type_required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id, category_id)
);

insert into public.asset_categories
  (code, label_ar, label_en, color, icon, default_useful_life_years, default_criticality_rating, technical_fields, sort_order)
values
  ('civil', 'مدني', 'Civil', '#9C6B45', '▦', 25, 2, '["material","dimensions","finish"]', 10),
  ('electrical', 'كهرباء', 'Electrical', '#E0A100', 'ϟ', 15, 4, '["ratedPower","voltage","current","frequency","phase"]', 20),
  ('fire_fighting', 'مكافحة الحريق', 'Fire Fighting', '#D74949', '◉', 15, 5, '["capacity","pressure","flowRate","standard"]', 30),
  ('fire_alarm', 'إنذار الحريق', 'Fire Alarm', '#EF6C47', '⌁', 10, 5, '["deviceType","loop","protocol","voltage"]', 40),
  ('hvac', 'التكييف والتهوية', 'HVAC', '#0B91A7', '❄', 15, 4, '["coolingCapacity","capacityTons","refrigerant","ratedPower","voltage","airFlow"]', 50),
  ('plumbing', 'السباكة', 'Plumbing', '#2581CA', '◌', 20, 3, '["flowRate","pressure","diameter","material"]', 60),
  ('mechanical', 'ميكانيكا', 'Mechanical', '#596D78', '⚙', 15, 4, '["ratedPower","speed","capacity","pressure"]', 70),
  ('elv_ict', 'أنظمة خفيفة وتقنية', 'ELV / ICT', '#7C62C7', '⌘', 8, 3, '["protocol","network","powerSupply","firmware"]', 80),
  ('furniture', 'أثاث', 'Furniture', '#7B8060', '▰', 10, 1, '["material","dimensions","color"]', 90),
  ('equipment', 'معدات', 'Equipment', '#087F75', '◇', 10, 3, '["capacity","ratedPower","voltage"]', 100),
  ('other', 'أخرى', 'Other', '#87939A', '+', 10, 2, '[]', 110)
on conflict (code) do update set
  label_ar = excluded.label_ar,
  label_en = excluded.label_en,
  color = excluded.color,
  icon = excluded.icon,
  technical_fields = excluded.technical_fields,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Existing projects receive the complete default catalog. Administrators can
-- later disable categories per project without affecting historic assets.
insert into public.project_asset_categories (project_id, category_id)
select project.id, category.id
from public.projects project
cross join public.asset_categories category
where project.active = true and category.active = true
on conflict (project_id, category_id) do nothing;

alter table public.assets
  add column if not exists category_id uuid references public.asset_categories(id) on delete set null,
  add column if not exists operational_status text not null default 'active',
  add column if not exists estimated_price numeric(16,2),
  add column if not exists replacement_cost numeric(16,2),
  add column if not exists price_currency text not null default 'AED',
  add column if not exists useful_life_years numeric(6,2),
  add column if not exists installation_date date,
  add column if not exists remaining_life_years numeric(6,2),
  add column if not exists estimate_source text not null default '',
  add column if not exists estimate_confidence text not null default '',
  add column if not exists enrichment_data jsonb not null default '{}'::jsonb,
  add column if not exists enrichment_source_url text not null default '',
  add column if not exists enrichment_fetched_at timestamptz,
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_operational_status_check'
  ) then
    alter table public.assets add constraint assets_operational_status_check
      check (operational_status in ('active','maintenance','out_of_service','transferred','disposed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_financial_values_check'
  ) then
    alter table public.assets add constraint assets_financial_values_check
      check (
        (estimated_price is null or estimated_price >= 0)
        and (replacement_cost is null or replacement_cost >= 0)
        and (useful_life_years is null or useful_life_years > 0)
        and (remaining_life_years is null or remaining_life_years >= 0)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assets'::regclass
      and conname = 'assets_enrichment_data_object_check'
  ) then
    alter table public.assets add constraint assets_enrichment_data_object_check
      check (jsonb_typeof(enrichment_data) = 'object');
  end if;
end;
$$;

alter table public.asset_images
  add column if not exists image_role text not null default 'asset',
  add column if not exists delete_after timestamptz,
  add column if not exists deleted_at timestamptz;

-- Treat the first historic image as the nameplate and calculate retention
-- from its original upload date. Other asset/context photos are unaffected.
update public.asset_images
set image_role = 'nameplate',
    delete_after = coalesce(delete_after, created_at + interval '30 days')
where sort_order = 0
  and deleted_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asset_images'::regclass
      and conname = 'asset_images_role_check'
  ) then
    alter table public.asset_images add constraint asset_images_role_check
      check (image_role in ('nameplate','asset'));
  end if;
end;
$$;

create table if not exists public.asset_status_history (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.assets(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create or replace function private.track_asset_operational_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.asset_status_history (asset_id, old_status, new_status, changed_by)
    values (new.id, null, new.operational_status, auth.uid());
  elsif old.operational_status is distinct from new.operational_status then
    insert into public.asset_status_history (asset_id, old_status, new_status, changed_by)
    values (new.id, old.operational_status, new.operational_status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists assets_operational_status_history on public.assets;
create trigger assets_operational_status_history
after insert or update of operational_status on public.assets
for each row execute function private.track_asset_operational_status();

create index if not exists assets_category_idx on public.assets(category_id);
create index if not exists assets_operational_status_idx on public.assets(operational_status);
create index if not exists assets_archived_at_idx on public.assets(archived_at);
create index if not exists asset_images_retention_idx on public.asset_images(delete_after) where deleted_at is null;
create index if not exists asset_status_history_asset_idx on public.asset_status_history(asset_id, created_at desc);

alter table public.asset_categories enable row level security;
alter table public.project_asset_categories enable row level security;
alter table public.asset_status_history enable row level security;

revoke all on public.asset_categories, public.project_asset_categories, public.asset_status_history from anon;
grant select on public.asset_categories, public.project_asset_categories, public.asset_status_history to authenticated;
grant insert, update, delete on public.asset_categories, public.project_asset_categories to authenticated;
grant usage, select on sequence public.asset_status_history_id_seq to authenticated;

drop policy if exists "authenticated users read categories" on public.asset_categories;
create policy "authenticated users read categories"
on public.asset_categories for select to authenticated using (true);
drop policy if exists "admins manage categories" on public.asset_categories;
create policy "admins manage categories"
on public.asset_categories for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "users read project categories" on public.project_asset_categories;
create policy "users read project categories"
on public.project_asset_categories for select to authenticated
using (private.can_access_project(project_id));
drop policy if exists "admins manage project categories" on public.project_asset_categories;
create policy "admins manage project categories"
on public.project_asset_categories for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "users read asset status history" on public.asset_status_history;
create policy "users read asset status history"
on public.asset_status_history for select to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_status_history.asset_id
    and private.can_access_project(asset.project_id)
));

notify pgrst, 'reload schema';
