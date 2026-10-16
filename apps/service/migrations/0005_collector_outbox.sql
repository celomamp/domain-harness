-- Story 6.3: durable Compilation outbox in the Company store. One row per
-- queued Compilation plus a per-Application allocation watermark, so panel
-- outages never slow or fail Builder Guidance calls or Gate runs: the hot
-- path only awaits a local enqueue, and a background flush delivers with
-- retries and backoff. The watermark is the single per-Application sequence
-- ordering across all Compilation types (the registry UNIQUE on
-- (tenant_id, application_id, sequence) spans all types); allocation and
-- insert happen under `pg_advisory_xact_lock` on the Application id (the
-- `guidance_events` pattern), so a crash can never burn a sequence and fake
-- a gap. Sent rows are kept for gap derivation (missing watermark
-- sequences); scheduled enforcement is Story 6.7 (default 90 days).
create table if not exists collector_outbox (
  idempotency_key text primary key,
  application_id text not null,
  sequence bigint not null,
  payload jsonb not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (application_id, sequence)
);

create index if not exists collector_outbox_due_idx
  on collector_outbox (status, next_attempt_at);

create table if not exists collector_sequences (
  application_id text primary key,
  allocated_upto bigint not null
);
