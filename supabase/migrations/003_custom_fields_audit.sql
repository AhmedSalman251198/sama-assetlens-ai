-- AssetLens AI — versioned project survey fields and electronic audit trail.
-- Run once in Supabase Dashboard > SQL Editor after migrations/002_asset_workflow.sql.

create table if not exists public.survey_config_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (project_id, version)
);

create unique index if not exists one_published_survey_config_per_project
  on public.survey_config_versions(project_id)
  where status = 'published';

create unique index if not exists one_draft_survey_config_per_project
  on public.survey_config_versions(project_id)
  where status = 'draft';

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.survey_config_versions(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label_ar text not null,
  label_en text not null default '',
  section text not null default 'survey',
  field_type text not null default 'text'
    check (field_type in ('text', 'textarea', 'number', 'date', 'select', 'boolean')),
  enabled boolean not null default true,
  required boolean not null default false,
  option_values jsonb not null default '[]'::jsonb
    check (jsonb_typeof(option_values) = 'array'),
  depends_on_field_key text,
  sort_order integer not null default 0,
  help_text_ar text not null default '',
  help_text_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (config_id, field_key)
);

alter table public.assets
  add column if not exists survey_config_id uuid
  references public.survey_config_versions(id) on delete set null;

create table if not exists public.asset_custom_values (
  asset_id uuid not null references public.assets(id) on delete cascade,
  custom_field_id uuid not null references public.custom_fields(id) on delete restrict,
  value_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (asset_id, custom_field_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists survey_configs_project_idx
  on public.survey_config_versions(project_id, status, version desc);
create index if not exists custom_fields_config_idx
  on public.custom_fields(config_id, enabled, sort_order);
create index if not exists asset_custom_values_field_idx
  on public.asset_custom_values(custom_field_id);
create index if not exists audit_logs_project_created_idx
  on public.audit_logs(project_id, created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs(actor_user_id, created_at desc);

drop trigger if exists custom_fields_set_updated_at on public.custom_fields;
create trigger custom_fields_set_updated_at
before update on public.custom_fields
for each row execute function private.set_updated_at();

drop trigger if exists asset_custom_values_set_updated_at on public.asset_custom_values;
create trigger asset_custom_values_set_updated_at
before update on public.asset_custom_values
for each row execute function private.set_updated_at();

-- Every existing project starts with an empty published configuration (version 1).
insert into public.survey_config_versions (project_id, version, status, published_at)
select project.id, 1, 'published', now()
from public.projects project
where not exists (
  select 1 from public.survey_config_versions config
  where config.project_id = project.id
);

update public.assets asset
set survey_config_id = config.id
from public.survey_config_versions config
where asset.survey_config_id is null
  and config.project_id = asset.project_id
  and config.status = 'published';

alter table public.survey_config_versions enable row level security;
alter table public.custom_fields enable row level security;
alter table public.asset_custom_values enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "visible project survey configs" on public.survey_config_versions;
create policy "visible project survey configs"
on public.survey_config_versions for select to authenticated
using (private.can_access_project(project_id));

drop policy if exists "admins manage survey configs" on public.survey_config_versions;
create policy "admins manage survey configs"
on public.survey_config_versions for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "visible project custom fields" on public.custom_fields;
create policy "visible project custom fields"
on public.custom_fields for select to authenticated
using (exists (
  select 1 from public.survey_config_versions config
  where config.id = custom_fields.config_id
    and private.can_access_project(config.project_id)
));

drop policy if exists "admins manage custom fields" on public.custom_fields;
create policy "admins manage custom fields"
on public.custom_fields for all to authenticated
using (private.is_app_admin()) with check (private.is_app_admin());

drop policy if exists "visible asset custom values" on public.asset_custom_values;
create policy "visible asset custom values"
on public.asset_custom_values for select to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_custom_values.asset_id
));

drop policy if exists "owners create asset custom values" on public.asset_custom_values;
create policy "owners create asset custom values"
on public.asset_custom_values for insert to authenticated
with check (exists (
  select 1
  from public.assets asset
  join public.custom_fields field on field.id = asset_custom_values.custom_field_id
  where asset.id = asset_custom_values.asset_id
    and (asset.created_by = auth.uid() or private.is_app_admin())
    and asset.survey_config_id = field.config_id
));

drop policy if exists "owners update asset custom values" on public.asset_custom_values;
create policy "owners update asset custom values"
on public.asset_custom_values for update to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_custom_values.asset_id
    and (asset.created_by = auth.uid() or private.is_app_admin())
))
with check (exists (
  select 1
  from public.assets asset
  join public.custom_fields field on field.id = asset_custom_values.custom_field_id
  where asset.id = asset_custom_values.asset_id
    and (asset.created_by = auth.uid() or private.is_app_admin())
    and asset.survey_config_id = field.config_id
));

drop policy if exists "owners delete asset custom values" on public.asset_custom_values;
create policy "owners delete asset custom values"
on public.asset_custom_values for delete to authenticated
using (exists (
  select 1 from public.assets asset
  where asset.id = asset_custom_values.asset_id
    and (asset.created_by = auth.uid() or private.is_app_admin())
));

drop policy if exists "admins read audit trail" on public.audit_logs;
create policy "admins read audit trail"
on public.audit_logs for select to authenticated
using (private.is_app_admin());

-- Create or reuse one draft by cloning the latest published configuration.
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
  if not private.is_app_admin() then
    raise exception 'Administrator permission is required';
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

  insert into public.survey_config_versions (project_id, version, status, created_by)
  values (target_project_id, next_version, 'draft', auth.uid())
  returning * into draft;

  if published.id is not null then
    insert into public.custom_fields (
      config_id, field_key, label_ar, label_en, section, field_type, enabled,
      required, option_values, depends_on_field_key, sort_order, help_text_ar, help_text_en
    )
    select draft.id, field_key, label_ar, label_en, section, field_type, enabled,
      required, option_values, depends_on_field_key, sort_order, help_text_ar, help_text_en
    from public.custom_fields where config_id = published.id;
  end if;

  return next draft;
end;
$$;

-- Publish is atomic: the previous version is archived and the new one becomes active.
create or replace function public.publish_survey_config(target_config_id uuid)
returns setof public.survey_config_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.survey_config_versions;
begin
  if not private.is_app_admin() then
    raise exception 'Administrator permission is required';
  end if;

  select * into target from public.survey_config_versions
  where id = target_config_id for update;
  if target.id is null or target.status <> 'draft' then
    raise exception 'A valid draft configuration is required';
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

-- Compact electronic audit trail for configuration and asset activity.
create or replace function private.capture_assetlens_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  record_id uuid;
  related_project_id uuid;
  actor_email_value text := '';
  detail_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  begin record_id := nullif(row_data ->> 'id', '')::uuid; exception when others then record_id := null; end;
  begin related_project_id := nullif(row_data ->> 'project_id', '')::uuid; exception when others then related_project_id := null; end;

  if related_project_id is null and tg_table_name = 'assets' then
    begin related_project_id := nullif(row_data ->> 'project_id', '')::uuid; exception when others then related_project_id := null; end;
  elsif related_project_id is null and tg_table_name = 'custom_fields' then
    select config.project_id into related_project_id
    from public.survey_config_versions config
    where config.id = (row_data ->> 'config_id')::uuid;
  elsif related_project_id is null and tg_table_name in ('floors', 'zones') then
    select building.project_id into related_project_id
    from public.buildings building
    where building.id = (row_data ->> 'building_id')::uuid;
  end if;

  select profile.email into actor_email_value
  from public.app_users profile where profile.user_id = auth.uid() limit 1;

  detail_data := jsonb_strip_nulls(jsonb_build_object(
    'operation', lower(tg_op),
    'name', coalesce(row_data ->> 'name', row_data ->> 'label_en', row_data ->> 'label_ar'),
    'email', case when tg_table_name = 'app_users' then row_data ->> 'email' else null end,
    'asset_no', row_data ->> 'asset_no',
    'status', row_data ->> 'status',
    'version', row_data ->> 'version'
  ));

  insert into public.audit_logs (
    actor_user_id, actor_email, action, entity_type, entity_id, project_id, details
  ) values (
    auth.uid(), coalesce(actor_email_value, ''),
    lower(tg_table_name || '_' || tg_op), tg_table_name, record_id,
    related_project_id, detail_data
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'assets', 'projects', 'buildings', 'floors', 'zones', 'app_users',
    'user_projects', 'survey_config_versions', 'custom_fields'
  ] loop
    execute format('drop trigger if exists assetlens_audit_change on public.%I', table_name);
    execute format(
      'create trigger assetlens_audit_change after insert or update or delete on public.%I for each row execute function private.capture_assetlens_audit()',
      table_name
    );
  end loop;
end;
$$;

revoke all on public.survey_config_versions, public.custom_fields, public.asset_custom_values, public.audit_logs from anon, authenticated;
grant select, insert, update, delete on public.survey_config_versions, public.custom_fields, public.asset_custom_values to authenticated;
grant select on public.audit_logs to authenticated;
revoke all on function public.create_survey_config_draft(uuid) from public, anon;
revoke all on function public.publish_survey_config(uuid) from public, anon;
grant execute on function public.create_survey_config_draft(uuid) to authenticated;
grant execute on function public.publish_survey_config(uuid) to authenticated;
