create schema if not exists tools;

alter table tools.observations alter column id type text using id::text;
alter table tools.incidents alter column id type text using id::text;
alter table tools.incidents alter column opening_observation_id type text using opening_observation_id::text;
alter table tools.incidents alter column closing_observation_id type text using closing_observation_id::text;

create table if not exists tools.checker_states (
  environment text primary key,
  revision bigint not null default 0,
  value jsonb not null,
  updated_at timestamptz not null
);

create table if not exists tools.history_partitions (
  environment text not null,
  day date not null,
  revision bigint not null default 0,
  value jsonb not null,
  updated_at timestamptz not null,
  primary key (environment, day)
);
