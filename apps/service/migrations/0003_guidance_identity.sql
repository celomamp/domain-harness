-- Story 4.3: the Guidance identity unit beside the CI Gate tables (0001)
-- and the bundle store (0002). Only the mismatch ledger is new: identity
-- bindings and binding refusals stay in the SHARED 0001 tables
-- (application_bindings, binding_refusals), so Guidance and the Gate use one
-- check with one row per Application across surfaces. Plain service style,
-- snake_case columns and text ids like every service table.
--
-- guidance_project_mismatches is append-only: one row per advisory Project
-- id disagreement (the bundle's Project id is the one used; the disagreement
-- is reported and recorded).
create table if not exists guidance_project_mismatches (
  id text primary key,
  application_id text not null,
  presented_project_id text not null,
  bundle_project_id text not null,
  bundle_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists guidance_project_mismatches_application_id_idx
  on guidance_project_mismatches (application_id);
