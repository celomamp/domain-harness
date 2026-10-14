create table if not exists application_bindings (
  application_id text primary key,
  fingerprint text not null,
  created_at timestamptz not null default now()
);

create table if not exists gate_runs (
  id text primary key,
  application_id text not null,
  sequence bigint not null,
  revision text not null,
  bundle_hash text not null,
  extractor_version text not null,
  checked_count integer not null,
  open_count integer not null,
  adherence double precision not null,
  deviations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (application_id, sequence)
);

create table if not exists binding_refusals (
  id text primary key,
  application_id text not null,
  presented_fingerprint text not null,
  bound_fingerprint text not null,
  created_at timestamptz not null default now()
);
