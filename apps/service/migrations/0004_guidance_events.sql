-- Story 4.5: Guidance event records in the Company store. One append-only
-- table: every bound Guidance tool outcome (`hit`/`miss`) is one row,
-- recorded service-side with no agent cooperation. A `miss` row IS the gap
-- (miss projection — no second table, no dual write). Per-Application
-- sequence is max + 1 under `pg_advisory_xact_lock` (the `gate_runs`
-- pattern), unique per (application_id, sequence).
--
-- Privacy (NFR-9): the record holds the asked subject term only — never raw
-- prompt text. There is no prompt-text column anywhere. `created_at` is the
-- only retention hook; scheduled enforcement is Story 6.7 (default 90 days).
create table if not exists guidance_events (
  id text primary key,
  application_id text not null,
  sequence bigint not null,
  tool text not null,
  subject text not null,
  outcome text not null,
  standard_id text,
  standard_version integer,
  agent_tool text,
  bundle_hash text not null,
  created_at timestamptz not null default now(),
  unique (application_id, sequence)
);

create index if not exists guidance_events_application_id_idx
  on guidance_events (application_id);
