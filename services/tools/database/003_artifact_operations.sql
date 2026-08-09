create table if not exists artifacts.operations (
  operation_id uuid primary key,
  artifact_id text not null,
  owner_id text not null,
  lease_until timestamptz not null,
  operation_kind text not null check (operation_kind in ('put_html', 'put_file', 'delete')),
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table artifacts.operations add column if not exists owner_id text;
alter table artifacts.operations add column if not exists lease_until timestamptz;
update artifacts.operations set owner_id = 'legacy-' || operation_id::text where owner_id is null;
update artifacts.operations set lease_until = '-infinity'::timestamptz where lease_until is null;
alter table artifacts.operations alter column owner_id set not null;
alter table artifacts.operations alter column lease_until set not null;
create index if not exists artifact_operations_created_idx on artifacts.operations (created_at);
create unique index if not exists artifact_operations_artifact_idx on artifacts.operations (artifact_id);
