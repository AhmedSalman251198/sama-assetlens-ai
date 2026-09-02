-- AssetLens AI — cloud asset register, private image storage, and FIFO analysis queue.
-- Run once in Supabase Dashboard > SQL Editor after supabase/setup.sql.

create extension if not exists pgcrypto;
create schema if not exists private;

create or replace function private.can_access_project(target_project_id uuid)
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
  )
$$;

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_no text not null unique default (
    'AST-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  project_id uuid not null references public.projects(id) on delete restrict,
  building_id uuid references public.buildings(id) on delete set null,
  floor_id uuid references public.floors(id) on delete set null,
  zone_id uuid references public.zones(id) on delete set null,
  project_name text not null,
  building_name text not null default '',
  floor_name text not null default '',
  zone_name text not null default '',
  created_by uuid not null references auth.users(id) on delete restrict,
  surveyor_email text not null default '',
  source_file_names text[] not null default '{}',
  asset_type text not null default '',
  summary text not null default '',
  fields jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  raw_text text not null default '',
  overall_confidence numeric(5,4) not null default 0
    check (overall_confidence between 0 and 1),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'review')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.asset_images (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.assets(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists assets_project_idx on public.assets(project_id);
create index if not exists assets_created_by_idx on public.assets(created_by);
create index if not exists assets_status_created_idx on public.assets(status, created_at);
create index if not exists asset_images_asset_idx on public.asset_images(asset_id, sort_order);
create index if not exists analysis_jobs_owner_queue_idx
  on public.analysis_jobs(created_by, status, created_at);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
before update on public.assets
for each row execute function private.set_updated_at();

drop trigger if exists analysis_jobs_set_updated_at on public.analysis_jobs;
create trigger analysis_jobs_set_updated_at
before update on public.analysis_jobs
for each row execute function private.set_updated_at();

alter table public.assets enable row level security;
alter table public.asset_images enable row level security;
alter table public.analysis_jobs enable row level security;

drop policy if exists "project assets are visible" on public.assets;
create policy "project assets are visible"
on public.assets for select to authenticated
using (created_by = auth.uid() or private.can_access_project(project_id));

drop policy if exists "users create accessible assets" on public.assets;
create policy "users create accessible assets"
on public.assets for insert to authenticated
with check (created_by = auth.uid() and private.can_access_project(project_id));

drop policy if exists "owners update assets" on public.assets;
create policy "owners update assets"
on public.assets for update to authenticated
using (created_by = auth.uid() or private.is_app_admin())
with check (created_by = auth.uid() or private.is_app_admin());

drop policy if exists "owners delete assets" on public.assets;
create policy "owners delete assets"
on public.assets for delete to authenticated
using (created_by = auth.uid() or private.is_app_admin());

drop policy if exists "accessible asset images are visible" on public.asset_images;
create policy "accessible asset images are visible"
on public.asset_images for select to authenticated
using (exists (select 1 from public.assets asset where asset.id = asset_images.asset_id));

drop policy if exists "owners create asset images" on public.asset_images;
create policy "owners create asset images"
on public.asset_images for insert to authenticated
with check (exists (
  select 1 from public.assets asset
  where asset.id = asset_images.asset_id and asset.created_by = auth.uid()
));

drop policy if exists "owners delete asset images" on public.asset_images;
create policy "owners delete asset images"
on public.asset_images for delete to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_images.asset_id
    and (asset.created_by = auth.uid() or private.is_app_admin())
));

drop policy if exists "owners see analysis jobs" on public.analysis_jobs;
create policy "owners see analysis jobs"
on public.analysis_jobs for select to authenticated
using (created_by = auth.uid() or private.is_app_admin());

drop policy if exists "owners create analysis jobs" on public.analysis_jobs;
create policy "owners create analysis jobs"
on public.analysis_jobs for insert to authenticated
with check (
  created_by = auth.uid() and exists (
    select 1 from public.assets asset
    where asset.id = analysis_jobs.asset_id and asset.created_by = auth.uid()
  )
);

drop policy if exists "owners update analysis jobs" on public.analysis_jobs;
create policy "owners update analysis jobs"
on public.analysis_jobs for update to authenticated
using (created_by = auth.uid() or private.is_app_admin())
with check (created_by = auth.uid() or private.is_app_admin());

drop policy if exists "owners delete analysis jobs" on public.analysis_jobs;
create policy "owners delete analysis jobs"
on public.analysis_jobs for delete to authenticated
using (created_by = auth.uid() or private.is_app_admin());

-- Atomically claim only the oldest queued job for the signed-in user.
-- The advisory lock guarantees FIFO processing even when several uploads arrive together.
create or replace function public.claim_next_analysis_job()
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  claimed_job public.analysis_jobs;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  if exists (
    select 1 from public.analysis_jobs
    where created_by = current_user_id and status = 'processing'
  ) then
    return;
  end if;

  select job.* into claimed_job
  from public.analysis_jobs job
  where job.created_by = current_user_id and job.status = 'queued'
  order by job.created_at, job.id
  for update skip locked
  limit 1;

  if claimed_job.id is null then
    return;
  end if;

  update public.analysis_jobs
  set status = 'processing',
      attempts = attempts + 1,
      started_at = now(),
      completed_at = null,
      error = null
  where id = claimed_job.id
  returning * into claimed_job;

  update public.assets
  set status = 'processing', error = null
  where id = claimed_job.asset_id;

  return next claimed_job;
end;
$$;

revoke all on public.assets, public.asset_images, public.analysis_jobs from anon, authenticated;
grant select, insert, update, delete on public.assets, public.asset_images, public.analysis_jobs to authenticated;
revoke all on function private.can_access_project(uuid) from public;
grant execute on function private.can_access_project(uuid) to authenticated;
revoke all on function public.claim_next_analysis_job() from public, anon;
grant execute on function public.claim_next_analysis_job() to authenticated;

-- Private image bucket: 10 MB per image, supported formats only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-images',
  'asset-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users upload own asset images" on storage.objects;
create policy "authenticated users upload own asset images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'asset-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "accessible asset images can be read" on storage.objects;
create policy "accessible asset images can be read"
on storage.objects for select to authenticated
using (
  bucket_id = 'asset-images'
  and exists (
    select 1
    from public.asset_images image
    where image.storage_path = storage.objects.name
  )
);

drop policy if exists "owners delete stored asset images" on storage.objects;
create policy "owners delete stored asset images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-images'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or private.is_app_admin()
  )
);
