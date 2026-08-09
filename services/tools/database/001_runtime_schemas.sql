create schema if not exists tools;
create schema if not exists artifacts;
create schema if not exists field_guide;

-- Field Guide previously owned unqualified tables in public. Move them before
-- Drizzle applies the schema-qualified definition so the cutover preserves data.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'candidates',
    'review_rounds',
    'verdict_events',
    'application_receipts',
    'field_guide_schema_migrations',
    'decision_records',
    'decision_feedback_events',
    'decision_promotions',
    'decision_promotion_records'
  ] loop
    if to_regclass('public.' || relation_name) is not null
       and to_regclass('field_guide.' || relation_name) is not null then
      raise exception 'refusing to move public.%: field_guide.% already exists',
        relation_name,
        relation_name;
    elsif to_regclass('public.' || relation_name) is not null then
      execute format('alter table public.%I set schema field_guide', relation_name);
    end if;
  end loop;
end $$;

create table if not exists tools.check_runs (
  id text primary key,
  started_at timestamptz not null,
  completed_at timestamptz
);
create table if not exists tools.observations (
  id uuid primary key,
  run_id text not null references tools.check_runs(id),
  monitor_id text not null,
  checked_at timestamptz not null,
  success boolean not null,
  status_code integer,
  latency_ms integer not null,
  error_code text
);
create index if not exists observations_monitor_checked_idx on tools.observations (monitor_id, checked_at);
create table if not exists tools.incidents (
  id uuid primary key,
  monitor_id text not null,
  started_at timestamptz not null,
  resolved_at timestamptz,
  opening_observation_id uuid,
  closing_observation_id uuid
);
create index if not exists incidents_monitor_started_idx on tools.incidents (monitor_id, started_at);
create table if not exists tools.heartbeats (monitor_id text primary key, last_seen_at timestamptz not null);
create table if not exists tools.monitor_overrides (monitor_id text primary key, paused boolean not null default false, updated_at timestamptz not null);
create table if not exists tools.scheduled_task_runs (
  task_id text not null,
  slot timestamptz not null,
  owner_id text not null,
  lease_until timestamptz not null,
  completed_at timestamptz,
  result jsonb,
  primary key (task_id, slot)
);
create table if not exists artifacts.objects (
  id text primary key,
  kind text not null check (kind in ('html', 'file')),
  filename text not null,
  content_type text not null,
  bytes bigint not null check (bytes >= 0),
  object_key text not null unique,
  project text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz
);
