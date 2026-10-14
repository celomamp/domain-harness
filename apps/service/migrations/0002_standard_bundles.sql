-- Story 4.2: the Standard bundle record store beside the CI Gate tables
-- (0001_ci_gate.sql). Service tables are plain: one owner, no RLS mirroring,
-- snake_case columns and text ids like the gate tables.
--
-- service_bundles holds one row per verified, hash-addressed bundle (Story
-- 4.1's hash: SHA-256 hex of the canonical bytes of the whole signed object);
-- active_bundle_pointers is one row per tenant naming the active bundle;
-- bundle_refusals and bundle_staleness_observations are append-only ledgers.

create table if not exists service_bundles (
  hash text primary key,
  tenant_id text not null,
  sequence bigint not null,
  payload jsonb not null,
  key_id text not null,
  signature text not null,
  issued_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, sequence)
);

create table if not exists active_bundle_pointers (
  tenant_id text primary key,
  hash text not null,
  sequence bigint not null,
  updated_at timestamptz not null default now()
);

create table if not exists bundle_refusals (
  id text primary key,
  tenant_id text not null,
  reason text not null,
  sequence bigint,
  hash text,
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists bundle_staleness_observations (
  id text primary key,
  tenant_id text not null,
  hash text not null,
  sequence bigint not null,
  stale boolean not null,
  age_seconds double precision not null,
  created_at timestamptz not null default now()
);
