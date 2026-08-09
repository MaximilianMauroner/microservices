create table if not exists artifacts.operations (
  operation_id uuid primary key,
  artifact_id text not null,
  operation_kind text not null check (operation_kind in ('put_html', 'put_file', 'delete')),
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists artifact_operations_created_idx on artifacts.operations (created_at);
create unique index if not exists artifact_operations_artifact_idx on artifacts.operations (artifact_id);
