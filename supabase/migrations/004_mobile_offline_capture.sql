-- AssetLens AI — mobile/PWA capture metadata.
-- Run once in Supabase Dashboard > SQL Editor after migration 003.

alter table public.assets
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists gps_accuracy_m double precision,
  add column if not exists barcode text not null default '',
  add column if not exists captured_offline boolean not null default false,
  add column if not exists device_captured_at timestamptz,
  add column if not exists offline_client_id uuid;

alter table public.assets
  drop constraint if exists assets_latitude_valid,
  add constraint assets_latitude_valid check (latitude is null or latitude between -90 and 90),
  drop constraint if exists assets_longitude_valid,
  add constraint assets_longitude_valid check (longitude is null or longitude between -180 and 180),
  drop constraint if exists assets_gps_accuracy_valid,
  add constraint assets_gps_accuracy_valid check (gps_accuracy_m is null or gps_accuracy_m >= 0);

create index if not exists assets_barcode_idx on public.assets(barcode) where barcode <> '';
create index if not exists assets_gps_idx on public.assets(latitude, longitude) where latitude is not null and longitude is not null;
create unique index if not exists assets_offline_client_id_idx on public.assets(offline_client_id) where offline_client_id is not null;
